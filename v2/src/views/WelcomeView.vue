<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { dayOfMonth, t } from '@/lib/i18n'
import { scoreLabel } from '@/lib/scoring'
import { endsNextDay } from '@/lib/availabilityCheck'
import { useSetupStore, uid } from '@/stores/setup'
import { useAuthStore } from '@/stores/auth'
import { SHARE_MAX_LOCS, parseSharedSetup, parseSharedWindow, sharedWindowDay, sharedWindowEnd } from '@/lib/share'
import { useNow } from '@/lib/clock'
import { importEffect, locationFromShared, takeInSetup, type SetupCounts } from '@/lib/shareImport'
import { confirmDialog } from '@/lib/confirm'
import { quickStartNote, quickStartPicks } from '@/lib/quickStart'
import { catalogueSpotAt, hasCopyOf, locationFromSpot } from '@/lib/spots'
import { showToast } from '@/lib/toast'

const router = useRouter()
const route = useRoute()
const setup = useSetupStore()
const auth = useAuthStore()

const sharedWin = computed(() => parseSharedWindow(route.query.win as string | undefined))
const sharedSetup = computed(() => parseSharedSetup(route.query.setup as string | undefined))
// A link whose payload can't be read: cut short on its way (a chat app, a
// line break in a mail), or mangled. It opened to the plain welcome page with
// no word, as if the spots it carried were lost. The title of its banner.
const brokenLink = computed(() =>
  route.query.setup !== undefined && !sharedSetup.value ? 'setup_shared_title'
  : route.query.win !== undefined && !sharedWin.value ? 'share_window' : null)

// The app's clock, ticking each minute: the year below is the recipient's own
// year now, and the window is over the minute it ends, on a page left open too.
const now = useNow()

// The shared window's day as the dashboard writes it: "Lør 21. Nov", "Sat 21
// Nov". The banner showed the link's "2026-11-21". The link carries the
// window's date, UTC midnight of its day (ScoredWindow.date), so the UTC
// parts name that day wherever the recipient is. A date that names no day
// (2026-13-01 passes the link's pattern check) is shown as the link has it.
// A day in another year than the recipient's names its year, as a catch's
// card does ("Fre 1. Jan 2027"): a link opened long after it was shared, or
// around New Year, read as this year's.
function sharedDay(d: string): string {
  const at = sharedWindowDay(d)
  if (!at) return d
  const day = `${t('day' + at.getUTCDay())} ${dayOfMonth(at.getUTCDate())} ${t('month' + at.getUTCMonth())}`
  const year = at.getUTCFullYear()
  return year === new Date(now.value).getFullYear() ? day : `${day} ${year}`
}

// The shared window has ended: a link opened after it read as if it were still coming.
const sharedOver = computed(() => {
  const end = sharedWin.value ? sharedWindowEnd(sharedWin.value) : null
  return end !== null && now.value >= end
})

function clearShare() { router.replace({ name: 'welcome', query: {} }) }
// Leaving after an import or add must REPLACE the share entry in one step.
// clearShare() followed by push() never worked: the push cancels the pending
// replace, so `#/?setup=…` stayed in history and Back brought the import
// banner up again — and re-importing threw away every edit made since.

function addSharedWindow() {
  const w = sharedWin.value
  if (!w) return
  // Saved already where the link puts it, or where it is saved: a spot at an
  // official spot's former pin is saved at the spot's pin now (shareImport).
  const loc = locationFromShared(w, w.legacy) // depth, slug, species too
  // A link on one of an official spot's pins, old or new, is a copy of that
  // spot: saved already where the recipient has one at any of its pins, as
  // the spot finder's "added" knows (hasCopyOf). One at the old pin offers
  // the move on its card (LocationsView).
  const twin = catalogueSpotAt(w.la, w.lo)
  const have = !!twin && hasCopyOf([{ lat: w.la, lon: w.lo }], twin) && hasCopyOf(setup.locations, twin)
  if (!have && !setup.locations.some((l) => (l.lat === w.la && l.lon === w.lo) || (l.lat === loc.lat && l.lon === loc.lon))) {
    setup.locations.push({ id: uid(), ...loc })
  }
  router.replace({ name: setup.hasSetup() ? 'dashboard' : 'availability' })
}

// One-tap start: geolocate → add the nearest spots (or the best DK spots if
// location is unavailable) + a sensible default window → straight to a
// populated dashboard.
const quickBusy = ref(false)
function getPosition(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((res) => {
    if (!navigator.geolocation) return res(null)
    navigator.geolocation.getCurrentPosition(
      (p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => res(null),
      { timeout: 8000, maximumAge: 600000 },
    )
  })
}
async function quickStart() {
  quickBusy.value = true
  try {
    const month = new Date().getMonth() + 1
    const ctx = { locations: setup.locations, forecastIds: new Set<string>() }
    const { results, where } = quickStartPicks(await getPosition(), month, ctx)
    for (const r of results) {
      const s = r.spot
      if (!hasCopyOf(setup.locations, s)) {
        setup.locations.push({ id: uid(), ...locationFromSpot(s) }) // depth too — see locationFromSpot
      }
    }
    if (!setup.availability.length) {
      setup.availability = [{ id: uid(), days: [0, 1, 2, 3, 4, 5, 6], from: '05:00', to: '10:00', methods: ['shore'] }]
    }
    // Not the spots near the user: say so, on the screen it lands on.
    const note = quickStartNote(where)
    if (note) showToast(note, { ttl: 12000 })
    router.push({ name: setup.hasSetup() ? 'dashboard' : 'availability' })
  } finally {
    quickBusy.value = false
  }
}

// What taking the link in takes from the user's setup, and what of it stays
// (lib/shareImport importEffect), counted as the banner's body counts: 📍
// spots, 🎯 target species, ⏱ windows. The question counted all the user had
// as replaced: a spot they had, kept with its ★ and note, read as lost, and a
// link of their own setup as losing everything. A link without time windows
// keeps the user's own (takeInSetup).
const effect = computed(() => sharedSetup.value ? importEffect(sharedSetup.value, setup) : null)
const counted = (c: SetupCounts) => ([[c.spots, '📍'], [c.species, '🎯'], [c.windows, '⏱']] as const)
  .filter(([n]) => n > 0).map(([n, e]) => `${n} ${e}`).join(' · ')
const goneText = computed(() => effect.value ? counted(effect.value.gone) : '')
/** What of the user's stays, as a sentence; '' when they have nothing. */
const keptLine = computed(() => {
  const kept = effect.value ? counted(effect.value.kept) : ''
  return kept && t('setup_import_keeps').replace('{kept}', kept)
})
/** `lead` with what goes in its {gone}, then what stays; '' when nothing goes. */
function whatGoes(lead: string): string {
  if (!goneText.value) return ''
  const goes = lead.replace('{gone}', goneText.value)
  return keptLine.value ? `${goes} ${keptLine.value}` : goes
}
const warnLine = computed(() => whatGoes(t('setup_import_warn')))

async function importSharedSetup() {
  const s = sharedSetup.value
  if (!s) return
  // Importing replaces what the user has — the most destructive action in the
  // app, and it syncs. Deleting a single location already asks; this only
  // showed a line of warning text with the import button right next to it.
  // Asked when something goes, naming what goes and what stays. Read before
  // the question: the answer may come after the link has left the address.
  const ask = whatGoes(t('setup_import_confirm'))
  if (ask && !(await confirmDialog(ask))) return
  // Depth, slug and species too; a spot or window the user has already stays
  // theirs (★, note, id). A link without windows keeps the user's.
  const after = takeInSetup(s, setup, uid)
  setup.locations = after.locations
  setup.targetSpecies = after.targetSpecies
  setup.availability = after.availability
  // A setup still without windows (or spots) opens the step that adds them:
  // the dashboard has nothing to show without, and sent the user back here.
  if (setup.hasSetup()) return router.replace({ name: 'dashboard' })
  if (!setup.locations.length) return router.replace({ name: 'locations' })
  showToast(t('setup_import_no_av'), { ttl: 12000 })
  router.replace({ name: 'availability' })
}
</script>

<template>
  <div class="welcome">
    <div v-if="sharedWin" class="share-banner">
      <div class="sb-title">📤 {{ t('share_window') }}</div>
      <!-- "+1": the window ends the next day, named for a screen reader as on
           the dashboard (endsNextDay). The score is named, on a line of its own,
           and left out when the link has none. -->
      <div class="sb-body">📍 {{ sharedWin.n }} · {{ sharedDay(sharedWin.d) }} · {{ sharedWin.f }}–{{ sharedWin.t }}<span
        v-if="endsNextDay(sharedWin.f, sharedWin.t)" class="nextday" role="img"
        :title="t('window_next_day')" :aria-label="t('window_next_day')">+1</span></div>
      <div v-if="sharedWin.s !== undefined" class="sb-score">{{ t('share_score') }}: {{ sharedWin.s }} · {{ scoreLabel(sharedWin.s) }}</div>
      <div v-if="sharedOver" class="sb-over">⌛ {{ t('share_window_over') }}</div>
      <div class="sb-actions">
        <button class="btn primary sm" @click="addSharedWindow">{{ t('share_add_loc') }}</button>
        <button class="btn ghost sm" @click="clearShare">{{ t('close') }}</button>
      </div>
    </div>

    <div v-if="sharedSetup" class="share-banner">
      <div class="sb-title">📤 {{ t('setup_shared_title') }}</div>
      <div class="sb-body">📍 {{ sharedSetup.locs.length }} · 🎯 {{ sharedSetup.sp.length }} · ⏱ {{ sharedSetup.av.length }}</div>
      <!-- The sharer has more spots than a link holds (lib/share SHARE_MAX_LOCS). -->
      <div v-if="sharedSetup.of" class="sb-warn sb-cut">⚠️ {{ t('setup_shared_cut').replace('{n}', String(SHARE_MAX_LOCS)).replace('{total}', String(sharedSetup.of)) }}</div>
      <!-- What of the user's goes, and what stays; only what stays when nothing goes. -->
      <div class="sb-warn" v-if="warnLine">⚠️ {{ warnLine }}</div>
      <div class="sb-keep" v-else-if="keptLine">{{ keptLine }}</div>
      <div class="sb-actions">
        <button class="btn primary sm" @click="importSharedSetup">{{ t('setup_import') }}</button>
        <button class="btn ghost sm" @click="clearShare">{{ t('close') }}</button>
      </div>
    </div>

    <div v-if="brokenLink" class="share-banner">
      <div class="sb-title">📤 {{ t(brokenLink) }}</div>
      <div class="sb-warn">⚠️ {{ t('share_link_broken') }}</div>
      <div class="sb-actions">
        <button class="btn ghost sm" @click="clearShare">{{ t('close') }}</button>
      </div>
    </div>

    <div class="hero-emoji">🎣</div>
    <h1>FishCast</h1>
    <p class="sub">{{ t('welcome_v2_sub') }}</p>

    <button v-if="!setup.hasSetup()" class="btn primary lg quickstart" :disabled="quickBusy" @click="quickStart">
      <span class="qs-title">{{ quickBusy ? t('quick_start_busy') : t('quick_start') }}</span>
      <span class="qs-sub">{{ t('quick_start_sub') }}</span>
    </button>

    <button class="btn lg" :class="setup.hasSetup() ? 'primary' : 'ghost'"
      @click="router.push({ name: setup.hasSetup() ? 'dashboard' : 'availability' })">
      {{ setup.hasSetup() ? t('goto_dash') : t('setup_start') }}
    </button>

    <div class="or">{{ t('or') }} · {{ t('welcome_no_setup') }}</div>
    <div class="options">
      <button class="option" @click="router.push({ name: 'finder', query: { mode: 'lucky' } })">
        <span class="option-title">{{ t('sf_lucky_badge') }}</span>
        <span class="option-sub">{{ t('sf_lucky_sub') }}</span>
      </button>
      <button class="option" @click="router.push({ name: 'finder', query: { mode: 'nearby' } })">
        <span class="option-title">{{ t('sf_nearby_badge') }}</span>
        <span class="option-sub">{{ t('sf_nearby_sub') }}</span>
      </button>
    </div>

    <p v-if="auth.supabaseConfigured && !auth.isLoggedIn" class="auth-hint">
      {{ t('auth_why') }}
      <button type="button" class="linkbtn" @click="router.push({ name: 'auth' })">{{ t('auth_login') }} / {{ t('auth_signup') }}</button>
    </p>
    <!-- Reads as a state, not fine print: a build without Supabase credentials
         has no login button at all, which otherwise looks like a missing feature. -->
    <p v-else-if="!auth.supabaseConfigured" class="local-note">ℹ️ {{ t('auth_local_note') }}</p>
  </div>
</template>

<style scoped>
.welcome { text-align: center; padding: 60px 20px; }
.hero-emoji { font-size: 3rem; }
h1 { color: var(--primary); margin: 10px 0 6px; }
.sub { color: var(--muted); margin-bottom: 28px; }
/* Block-level flex + auto side margins: keeps the button on its own line (an
   inline-flex button would share the line with the button below it) while
   shrinking to fit its content and staying centred. */
.quickstart {
  display: flex; flex-direction: column; align-items: center; gap: 2px;
  width: fit-content; margin: 0 auto 10px;
}
.qs-title { font-weight: 700; }
.qs-sub { font-size: 0.74rem; font-weight: 400; opacity: 0.85; }
.local-note {
  margin: 24px auto 0; max-width: 460px; padding: 10px 14px;
  font-size: 0.82rem; color: var(--text); text-align: left;
  border: 1px solid var(--border); border-left: 3px solid var(--gold);
  border-radius: 8px; background: rgba(250, 204, 21, .07);
}
.auth-hint { margin-top: 24px; font-size: 0.82rem; color: var(--muted); max-width: 420px; margin-inline: auto; }
.auth-hint .linkbtn { background: none; border: none; padding: 0; font: inherit; color: var(--primary); cursor: pointer; margin-left: 6px; }
.auth-hint .linkbtn:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 3px; }
/* Touch screens: the link was 17 px tall. Its line grows to 40. */
@media (pointer: coarse) {
  .auth-hint .linkbtn { display: inline-flex; align-items: center; min-height: 40px; vertical-align: middle; }
}
.or { color: var(--muted); font-size: 0.8rem; margin: 20px 0 12px; }
.share-banner { max-width: 460px; margin: 0 auto 18px; padding: 14px 16px; border-radius: 12px; text-align: left;
  background: rgba(56,189,248,.10); border: 1px solid rgba(56,189,248,.45); }
.sb-title { font-weight: 700; }
.sb-body { font-size: 0.85rem; color: var(--text); margin-top: 4px; }
.sb-score { font-size: 0.8rem; color: var(--muted); margin-top: 2px; }
.sb-over { font-size: 0.78rem; color: var(--gold); margin-top: 6px; }
.nextday { font-size: 0.62rem; font-weight: 700; color: var(--primary); vertical-align: super; margin-left: 2px; }
.sb-warn { font-size: 0.74rem; color: var(--gold); margin-top: 6px; }
.sb-keep { font-size: 0.74rem; color: var(--muted); margin-top: 6px; }
.sb-actions { display: flex; gap: 8px; margin-top: 10px; }
.options { display: flex; gap: 10px; max-width: 520px; margin: 0 auto; }
.option {
  flex: 1; display: flex; flex-direction: column; gap: 3px; padding: 16px 14px;
  border-radius: 12px; cursor: pointer; text-align: left; color: var(--text);
  background: var(--bg-card); border: 1px solid var(--border);
}
.option:hover { border-color: var(--primary); background: rgba(56,189,248,.08); }
.option-title { font-weight: 700; font-size: 0.95rem; }
.option-sub { font-size: 0.76rem; color: var(--muted); }
@media (max-width: 480px) { .options { flex-direction: column; } }
</style>
