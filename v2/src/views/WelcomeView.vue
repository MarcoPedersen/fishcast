<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { t } from '@/lib/i18n'
import { useSetupStore, uid } from '@/stores/setup'
import { useAuthStore } from '@/stores/auth'
import { parseSharedSetup, parseSharedWindow } from '@/lib/share'
import { findNearbyRanked, findLuckySpots } from '@/lib/spotfinder'

const router = useRouter()
const route = useRoute()
const setup = useSetupStore()
const auth = useAuthStore()

const sharedWin = computed(() => parseSharedWindow(route.query.win as string | undefined))
const sharedSetup = computed(() => parseSharedSetup(route.query.setup as string | undefined))

function clearShare() { router.replace({ name: 'welcome', query: {} }) }

function addSharedWindow() {
  const w = sharedWin.value
  if (!w) return
  if (!setup.locations.some((l) => l.lat === w.la && l.lon === w.lo)) {
    setup.locations.push({ id: uid(), name: w.n, lat: w.la, lon: w.lo, waterType: w.wt as any })
  }
  clearShare()
  router.push({ name: setup.hasSetup() ? 'dashboard' : 'availability' })
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
    const pos = await getPosition()
    let results = pos ? findNearbyRanked(pos.lat, pos.lon, 60, [], month, ctx) : []
    if (!results.length) results = findLuckySpots([], month, ctx)
    for (const r of results.slice(0, 3)) {
      const s = r.spot as any
      if (!setup.locations.some((l) => l.lat === s.lat && l.lon === s.lon)) {
        setup.locations.push({
          id: uid(), name: s.name, lat: s.lat, lon: s.lon,
          waterType: s.waterType, bottomType: s.bottomType, spotSlug: s.slug,
          species: s.species?.map((sp: any) => ({ nameEn: sp.nameEn, months: sp.months })),
        })
      }
    }
    if (!setup.availability.length) {
      setup.availability = [{ id: uid(), days: [0, 1, 2, 3, 4, 5, 6], from: '05:00', to: '10:00', methods: ['shore'] }]
    }
    router.push({ name: setup.hasSetup() ? 'dashboard' : 'availability' })
  } finally {
    quickBusy.value = false
  }
}

function importSharedSetup() {
  const s = sharedSetup.value
  if (!s) return
  setup.locations = s.locs.map((l) => ({ id: uid(), name: l.n, lat: l.la, lon: l.lo, waterType: l.wt as any, bottomType: l.bt }))
  setup.targetSpecies = s.sp
  setup.availability = s.av.map((a) => ({ id: uid(), days: a.d, from: a.f, to: a.t, methods: (a.m as any) || ['shore'] }))
  clearShare()
  router.push({ name: 'dashboard' })
}
</script>

<template>
  <div class="welcome">
    <div v-if="sharedWin" class="share-banner">
      <div class="sb-title">📤 {{ t('share_window') }}</div>
      <div class="sb-body">📍 {{ sharedWin.n }} · {{ sharedWin.d }} · {{ sharedWin.f }}–{{ sharedWin.t }} · {{ sharedWin.s }}</div>
      <div class="sb-actions">
        <button class="btn primary sm" @click="addSharedWindow">{{ t('share_add_loc') }}</button>
        <button class="btn ghost sm" @click="clearShare">{{ t('close') }}</button>
      </div>
    </div>

    <div v-if="sharedSetup" class="share-banner">
      <div class="sb-title">📤 {{ t('setup_shared_title') }}</div>
      <div class="sb-body">📍 {{ sharedSetup.locs.length }} · 🎯 {{ sharedSetup.sp.length }} · ⏱ {{ sharedSetup.av.length }}</div>
      <div class="sb-warn" v-if="setup.hasSetup()">⚠️ {{ t('setup_import_warn') }}</div>
      <div class="sb-actions">
        <button class="btn primary sm" @click="importSharedSetup">{{ t('setup_import') }}</button>
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
.or { color: var(--muted); font-size: 0.8rem; margin: 20px 0 12px; }
.share-banner { max-width: 460px; margin: 0 auto 18px; padding: 14px 16px; border-radius: 12px; text-align: left;
  background: rgba(56,189,248,.10); border: 1px solid rgba(56,189,248,.45); }
.sb-title { font-weight: 700; }
.sb-body { font-size: 0.85rem; color: var(--text); margin-top: 4px; }
.sb-warn { font-size: 0.74rem; color: var(--gold); margin-top: 6px; }
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
