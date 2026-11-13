<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { lang, setLang, t } from '@/lib/i18n'
import { useAuthStore } from '@/stores/auth'
import { useSetupStore } from '@/stores/setup'
import { useForecastStore } from '@/stores/forecast'
import { useCoastStore } from '@/stores/coast'
import { useScoredStore } from '@/stores/scored'
import { session } from '@/stores/session'
import { confirmDialog } from '@/lib/confirm'
import {
  enableNotifications, disableNotifications, notifsEnabled, reminderNote, scheduleWindowNotifications,
} from '@/lib/notifications'
import { shareSetupUrl } from '@/lib/share'
import { showToast } from '@/lib/toast'
import { localDayUTC, useNow } from '@/lib/clock'
import { coordKey } from '@/lib/coast'
import { forecastKey } from '@/lib/weather'
import type { Location } from '@/lib/types'
import { useEdgeFade } from '@/lib/edgeFade'
import { navPage } from '@/router/navPage'
import Toasts from '@/components/Toasts.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()
const setup = useSetupStore()
const fc = useForecastStore()
const coast = useCoastStore()
const scored = useScoredStore()

// Each spot's automatic coast (onshore spec §1.4), derived once per device in
// the background. Keyed on what changes the answer — the pin, the water type,
// whether the user chose a coast — so a rename or a ★ derives nothing, and
// never per forecast or rescore. App.vue is always mounted.
watch(
  () => setup.locations.map((l) => `${coordKey(l)}|${l.waterType ?? ''}|${l.coast ? 'm' : ''}`).join(';'),
  () => coast.ensure(setup.locations),
  { immediate: true },
)

// Every spot new to the app gets its forecast at once, however it came: the
// list's search, the setup map, the spot finder, the quick start, a shared
// link, another device or tab. Only the dashboard and the setup map fetched,
// on opening, so a spot added anywhere else had no score on the map's pins or
// in the reminders until then, and one that arrived by sync with the
// dashboard open stayed without data there. By id and forecast key: a spot
// moved, or switched to or from fresh water, counts as new; a rename, or the
// same spots adopted again as new objects, fetches nothing. Through fetchAll,
// so the store's rules hold: a fresh forecast is not refetched, a fetch under
// way is left to itself, and offline the spot is marked failed and said so
// once, for the reconnect to retry.
// Not the spots there at start: the screen opened decides those (the
// dashboard and the setup map load them; elsewhere the app waits, reminders
// aside). Nor while the tab is hidden: the tab that added a spot fetches it,
// and this one does when it is shown again.
const spotKey = (l: Location) => `${l.id}|${forecastKey(l)}`
let knownSpots = new Set(setup.locations.map(spotKey))
function fetchNewSpots() {
  if (document.hidden) return
  const keys = setup.locations.map(spotKey)
  const added = setup.locations.filter((_, i) => !knownSpots.has(keys[i]))
  knownSpots = new Set(keys)
  if (added.length) void fc.fetchAll(added)
}
watch(() => setup.locations.map(spotKey), fetchNewSpots)

// Refresh when the tab regains focus or the connection comes back — so a
// long-open app never shows yesterday's data. This goes through the store's
// batched path: one fetchFor per stale location sent ~4 requests each (the
// burst batching was added to stop), toasted once per failure, and skipped
// locations whose fetch had failed, so "back online" never refetched them.
// It also re-checks lightning, which a resume with young weather never did.
function refreshOnResume(reasonKey: string) {
  if (!setup.locations.length) return
  void fc.refreshOnResume(setup.locations, { reasonKey, all: notifsEnabled() })
}

// Reminders + share live in the topbar (app-level) rather than the dashboard:
// scheduling is already app-wide, and the setup they share is too.
const notifOn = ref(notifsEnabled())

// Reminder scheduling lives here, not in the dashboard: timers are lost when the
// tab closes, so they must re-arm on every app start and whenever the tab
// regains focus — regardless of which view the user happens to open.
// The windows are the app's one scored list (stores/scored), which the
// dashboard and the setup map read too. Scoring them here as well cost a
// second full pass (~100 ms on 18 spots) on every forecast, lightning or
// coast write.
// The list rolls over at local midnight and holds every day, so the reminders'
// "due by this time tomorrow" (notifications.ts) finds every slot it needs.
// Gated on reminders: with them off, nothing here asks for the list, so on
// the screens without it (the spot list, the species picker) nothing scores.
const allWindows = computed(() => (notifOn.value ? scored.windows : []))
function rearmReminders() {
  // Always through the scheduler, which clears first — with an empty list when
  // reminders are off. Returning early left the old timers armed after
  // sign-out, after the last slot or location was removed, or after reminders
  // were switched off in another tab, and they still fired with old spot names.
  scheduleWindowNotifications(notifsEnabled() ? allWindows.value : [])
}
watch(allWindows, rearmReminders)

async function toggleNotifs() {
  if (notifOn.value) { disableNotifications(); notifOn.value = false; return }
  const r = await enableNotifications()
  if (r === 'on') { notifOn.value = true; rearmReminders() }
  // Every outcome says something (lib/notifications reminderNote): blocked,
  // the bell did nothing at all; on, it must say "only while FishCast is open".
  showToast(reminderNote(r), { ttl: 10000 })
}
const shareCopied = ref(false)

// On a phone the nav is one strip that scrolls sideways, scrollbar hidden: at
// 375 px Find pladser and Fangstlog sat off-screen with nothing to say so. It
// fades at an edge with more beyond it, and the page in use is scrolled into
// view (lib/edgeFade). aria-current marks that page for a screen reader too.
// A page without a button of its own marks the one it belongs to: the setup
// map is Lokationer (router/navPage).
const navEl = ref<HTMLElement | null>(null)
const { fadeClass: navFade, reveal: revealNav } = useEdgeFade(navEl)
const here = (name: string) => (navPage(route) === name ? 'page' : undefined)
watch(() => route.name, () => revealNav(navEl.value?.querySelector('[aria-current="page"]')), { flush: 'post' })
// Topbar labels are "<emoji> <words>". Split them so the words can collapse on
// a narrow screen while the icon stays and the accessible name stays complete —
// the extra row pushed the mobile topbar to ~141px (17% of an 812px screen).
function splitLabel(s: string): { icon: string; text: string } {
  const i = s.indexOf(' ')
  return i === -1 ? { icon: '', text: s } : { icon: s.slice(0, i), text: s.slice(i + 1) }
}
const notifLabel = computed(() => splitLabel(notifOn.value ? t('notif_enabled') : t('notif_enable')))
const shareLabel = computed(() => splitLabel(shareCopied.value ? t('share_copied') : t('share_setup_btn')))
async function shareSetup() {
  try {
    await navigator.clipboard.writeText(
      shareSetupUrl(setup.locations, setup.targetSpecies, setup.availability),
    )
    shareCopied.value = true
    setTimeout(() => { shareCopied.value = false }, 2000)
  } catch { /* clipboard denied — leave the label alone so it can be retried */ }
}

// Reminders need scored windows, which need forecast data — and only the
// dashboard fetches on mount. So when reminders are on, make sure we have data
// even if the user never opens the dashboard. Gated on the reminder flag so we
// don't spend API calls for everyone else.
function ensureDataForReminders() {
  if (!notifsEnabled() || !setup.locations.length) return
  // isFresh, not "has an entry": the cache now keeps day-old entries for
  // offline starts, and those would otherwise be scored as if current.
  if (setup.locations.some((l) => !fc.isFresh(l))) void fc.fetchAll(setup.locations)
}

function onVisible() {
  if (document.hidden) return
  fetchNewSpots() // any that came from another tab meanwhile
  refreshOnResume('toast_refreshing_stale') // also fetches what reminders need
  rearmReminders() // timers may have been throttled/dropped while hidden
}
function onOnline() { refreshOnResume('toast_back_online') }
// After local midnight every forecast is stale (fc.isFresh): one fetched
// yesterday has no tides for the list's new 7th day. So again when the UTC
// date turns (01:00/02:00): Open-Meteo counts its days from it, and the
// midnight refetch left the 7th day's night without its last hours. A tab
// kept visible gets no focus event to refetch on, so the day change itself does.
const now = useNow()
const today = computed(() => localDayUTC(now.value))
const utcDay = computed(() => Math.floor(now.value / 86400000))
watch([today, utcDay], () => { if (!document.hidden) refreshOnResume('toast_refreshing_stale') })
// Reminders switched off in another tab — by its toggle, or by logging out
// there (disableNotifications). notifOn was read once at start, so this tab's
// toggle went on saying "on" while nothing would ever be scheduled. (key null:
// that tab cleared the whole storage.)
function onStorage(e: StorageEvent) {
  if (e.key === 'fc2-notifs' || e.key === null) notifOn.value = notifsEnabled()
}

// Lightning goes stale in minutes, and nothing else re-checks it while the app
// just stays open: a 14:00 'clear' missed the storm that arrived at 15:00, and
// a 14:00 'danger' kept capping the evening long after it passed. The store
// only re-asks where the last check is over 15 min old, and only for spots
// with weather loaded — strike data is no use without windows to score.
const LIGHTNING_POLL_MS = 5 * 60 * 1000
let lightningPoll: ReturnType<typeof setInterval> | undefined
function pollLightning() {
  if (document.visibilityState !== 'visible') return
  const loaded = setup.locations.filter((l) => fc.forecasts[l.id])
  if (loaded.length) void fc.refreshLightning(loaded)
}

// The service worker's old all-in-one API cache. No route uses it any more
// (vite.config.ts), so nothing would ever expire its up to 80 entries, tide
// responses of a few hundred KB among them. Can go once every device has run it.
function dropLegacyApiCache() {
  if (typeof caches === 'undefined') return // insecure context, no Cache API
  caches.delete('fishcast-api').catch(() => { /* nothing to free */ })
}

onMounted(() => {
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)
  window.addEventListener('storage', onStorage)
  lightningPoll = setInterval(pollLightning, LIGHTNING_POLL_MS)
  ensureDataForReminders()
  rearmReminders()
  dropLegacyApiCache()
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisible)
  window.removeEventListener('online', onOnline)
  window.removeEventListener('storage', onStorage)
  clearInterval(lightningPoll)
})

// When a reset-email link is opened, Supabase fires PASSWORD_RECOVERY (and clears
// the token from the URL) — send the user to the auth screen to set a new password.
watch(() => auth.recovering, (v) => { if (v) router.push({ name: 'auth' }) }, { immediate: true })

// Pushes anything unsynced first and keeps local data if signing out fails —
// see session.logout(); it used to wipe edits that had never reached the account.
async function logout() {
  const result = await session.logout(confirmDialog)
  if (result === 'failed') showToast('⚠️ ' + t('auth_err_logout'), { type: 'error' })
  else if (result === 'done') {
    // session.logout cleared the weather caches and switched reminders off
    // (disableNotifications); keep the topbar toggle in step with that.
    notifOn.value = false
    router.push({ name: 'welcome' })
  }
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="logo" @click="router.push({ name: 'welcome' })">🎣 <span>FishCast</span></div>
      <nav ref="navEl" class="actions" :class="navFade">
        <template v-if="setup.hasSetup()">
          <button class="btn ghost sm" :aria-current="here('dashboard')" @click="router.push({ name: 'dashboard' })">📊 Dashboard</button>
          <button class="btn ghost sm badged" :aria-current="here('species')" @click="router.push({ name: 'species' })">
            {{ t('topbar_species') }}
            <span v-if="setup.targetSpecies.length" class="count">{{ setup.targetSpecies.length }}</span>
          </button>
          <button class="btn ghost sm" :aria-current="here('locations')" @click="router.push({ name: 'locations' })">{{ t('topbar_locations') }}</button>
          <button class="btn ghost sm badged" :aria-current="here('availability')" @click="router.push({ name: 'availability' })">
            {{ t('topbar_times') }}
            <span v-if="setup.availability.length" class="count">{{ setup.availability.length }}</span>
          </button>
        </template>
        <button class="btn ghost sm" :aria-current="here('finder')" @click="router.push({ name: 'finder' })">{{ t('topbar_finder') }}</button>
        <button class="btn ghost sm" :aria-current="here('catchlog')" @click="router.push({ name: 'catchlog' })">{{ t('topbar_log') }}</button>
      </nav>
      <div class="topbar-right">
        <div class="tr-row">
          <button class="btn ghost sm" :class="{ active: lang === 'da' }" aria-label="Dansk" @click="setLang('da')">🇩🇰</button>
          <button class="btn ghost sm" :class="{ active: lang === 'en' }" aria-label="English" @click="setLang('en')">🇬🇧</button>
          <template v-if="auth.supabaseConfigured">
            <button v-if="!auth.isLoggedIn" class="btn primary sm" @click="router.push({ name: 'auth' })">
              {{ t('auth_login') }}
            </button>
            <button v-else class="btn ghost sm" :title="auth.user?.email" @click="logout">
              {{ t('auth_logout') }}
            </button>
          </template>
        </div>
        <!-- Setup-wide actions, kept out of the dashboard's own header row -->
        <div v-if="setup.hasSetup()" class="tr-row setup-actions">
          <!-- The title says what the label can't: reminders are timers in this
               page, so they come only while FishCast is open (lib/notifications). -->
          <button class="btn ghost sm" :class="{ on: notifOn }" @click="toggleNotifs"
            :title="notifOn ? t('notif_enabled_hint') : t('notif_enable_hint')"
            :aria-label="notifOn ? t('notif_enabled') : t('notif_enable')">
            <span aria-hidden="true">{{ notifLabel.icon }}</span><span class="lbl">{{ notifLabel.text }}</span>
          </button>
          <button class="btn ghost sm" @click="shareSetup"
            :title="shareCopied ? t('share_copied') : t('share_setup_btn')"
            :aria-label="shareCopied ? t('share_copied') : t('share_setup_btn')">
            <span aria-hidden="true">{{ shareLabel.icon }}</span><span class="lbl">{{ shareLabel.text }}</span>
          </button>
        </div>
      </div>
    </header>
    <main class="main">
      <RouterView />
    </main>
    <Toasts />
    <ConfirmDialog />
  </div>
</template>

<style scoped>
.topbar { align-items: center; gap: 10px; }
.logo { display: inline-flex; align-items: center; gap: 6px; line-height: 1; flex-shrink: 0; }
.actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex: 1 1 auto; }
.topbar-right { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; margin-left: auto; flex-shrink: 0; }
.tr-row { display: flex; align-items: center; gap: 6px; }
.setup-actions .lbl { margin-left: 4px; }
.btn.on { border-color: var(--green); color: var(--green); }
.actions .btn, .topbar-right .btn { white-space: nowrap; line-height: 1.1; }
.badged { position: relative; }
.count {
  position: absolute; top: -6px; right: -6px;
  min-width: 17px; height: 17px; padding: 0 4px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--red); color: #fff; font-size: 0.66rem; font-weight: 700;
  border-radius: 9px; border: 1.5px solid var(--bg);
}
/* On touch every .btn is at least 40 px tall and wide (style.css). Here the
   width is left to the button: with "Log ind" / "Log ud" in the row, 40 px
   wide DK, GB, bell and share made it 16 px wider, and at 375 px it no longer
   fit beside the logo and took a row of its own (topbar 144 px, not 119). */
@media (pointer: coarse) {
  .topbar-right .btn { min-width: auto; }
}

/* Mobile: logo + language/login on the top row, nav tabs as a single
   horizontally-scrollable strip — keeps the header short instead of a
   9-button stack. */
@media (max-width: 640px) {
  .topbar { flex-wrap: wrap; row-gap: 8px; }
  .logo { order: 1; }
  .topbar-right { order: 2; margin-left: auto; }
  .actions {
    order: 3; flex-basis: 100%; flex-wrap: nowrap; overflow-x: auto;
    -webkit-overflow-scrolling: touch; scrollbar-width: none; padding-bottom: 2px;
  }
  .actions::-webkit-scrollbar { display: none; }
  .actions .btn { flex: 0 0 auto; }
  .count { top: -4px; }
  /* Icon-only setup actions so they share the language/login row instead of
     adding one. The title + aria-label keep the full name for hover and screen
     readers. Wraps back to two rows if it ever doesn't fit. */
  .setup-actions .lbl { display: none; }
  .setup-actions .btn { padding-left: 9px; padding-right: 9px; }
  .topbar-right { flex-direction: row; flex-wrap: wrap; justify-content: flex-end; }
}
</style>
