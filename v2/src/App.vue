<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { lang, setLang, t } from '@/lib/i18n'
import { useAuthStore } from '@/stores/auth'
import { useSetupStore } from '@/stores/setup'
import { useCatchStore } from '@/stores/catches'
import { useForecastStore } from '@/stores/forecast'
import { getScoredWindows } from '@/lib/scoring'
import {
  enableNotifications, disableNotifications, notifsEnabled, scheduleWindowNotifications,
} from '@/lib/notifications'
import { shareSetupUrl } from '@/lib/share'
import { showToast } from '@/lib/toast'
import Toasts from '@/components/Toasts.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

const router = useRouter()
const auth = useAuthStore()
const setup = useSetupStore()
const catches = useCatchStore()
const fc = useForecastStore()

// Refresh forecasts that have gone stale (>3h) when the tab regains focus or
// the connection comes back — so a long-open app never shows yesterday's data.
const STALE_MS = 3 * 60 * 60 * 1000
function autoRefresh(reasonKey: string) {
  if (!setup.locations.length) return
  const now = Date.now()
  const stale = setup.locations.filter((l) => {
    const f = fc.forecasts[l.id]
    return f && now - f.fetched > STALE_MS
  })
  if (!stale.length) return
  showToast('⟳ ' + t(reasonKey), { type: 'info', ttl: 3000 })
  stale.forEach((l) => fc.fetchFor(l))
}
// Reminder scheduling lives here, not in the dashboard: timers are lost when the
// tab closes, so they must re-arm on every app start and whenever the tab
// regains focus — regardless of which view the user happens to open.
const allWindows = computed(() =>
  setup.locations.length && setup.availability.length
    ? getScoredWindows(setup.locations, setup.availability, fc.forecasts, setup.targetSpecies, fc.lightning)
    : [],
)
function rearmReminders() {
  if (!notifsEnabled() || !allWindows.value.length) return
  scheduleWindowNotifications(allWindows.value)
}
watch(allWindows, rearmReminders)

// Reminders + share live in the topbar (app-level) rather than the dashboard:
// scheduling is already app-wide, and the setup they share is too.
const notifOn = ref(notifsEnabled())
async function toggleNotifs() {
  if (notifOn.value) { disableNotifications(); notifOn.value = false; return }
  if (await enableNotifications()) { notifOn.value = true; rearmReminders() }
}
const shareCopied = ref(false)
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
  if (setup.locations.some((l) => !fc.forecasts[l.id])) fc.fetchAll(setup.locations)
}

function onVisible() {
  if (document.hidden) return
  autoRefresh('toast_refreshing_stale')
  ensureDataForReminders()
  rearmReminders() // timers may have been throttled/dropped while hidden
}
function onOnline() { autoRefresh('toast_back_online') }
onMounted(() => {
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)
  ensureDataForReminders()
  rearmReminders()
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisible)
  window.removeEventListener('online', onOnline)
})

// When a reset-email link is opened, Supabase fires PASSWORD_RECOVERY (and clears
// the token from the URL) — send the user to the auth screen to set a new password.
watch(() => auth.recovering, (v) => { if (v) router.push({ name: 'auth' }) }, { immediate: true })

async function logout() {
  await auth.signOut()
  // Wipe this account's data locally so the next user on this device doesn't
  // inherit it (and can't accidentally push it into their own account).
  setup.clear()
  catches.clear()
  router.push({ name: 'welcome' })
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="logo" @click="router.push({ name: 'welcome' })">🎣 <span>FishCast</span></div>
      <nav class="actions">
        <template v-if="setup.hasSetup()">
          <button class="btn ghost sm" @click="router.push({ name: 'dashboard' })">📊 Dashboard</button>
          <button class="btn ghost sm badged" @click="router.push({ name: 'species' })">
            {{ t('topbar_species') }}
            <span v-if="setup.targetSpecies.length" class="count">{{ setup.targetSpecies.length }}</span>
          </button>
          <button class="btn ghost sm" @click="router.push({ name: 'locations' })">{{ t('topbar_locations') }}</button>
          <button class="btn ghost sm badged" @click="router.push({ name: 'availability' })">
            {{ t('topbar_times') }}
            <span v-if="setup.availability.length" class="count">{{ setup.availability.length }}</span>
          </button>
        </template>
        <button class="btn ghost sm" @click="router.push({ name: 'finder' })">{{ t('topbar_finder') }}</button>
        <button class="btn ghost sm" @click="router.push({ name: 'catchlog' })">{{ t('topbar_log') }}</button>
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
          <button class="btn ghost sm" :class="{ on: notifOn }" @click="toggleNotifs"
            :title="notifOn ? t('notif_enabled') : t('notif_enable')"
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
