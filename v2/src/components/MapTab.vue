<script lang="ts">
// Module scope: MapTab is v-if'd and remounts every time you visit the Vinduer
// tab, which is the only place the horizon can be changed. Ticking "compare",
// switching to change the horizon and coming back used to find it unticked.
let compareWanted = false
</script>

<script setup lang="ts">
/**
 * Dashboard map tab — your saved spots as score pins, so you can see at a
 * glance where the good fishing is right now (and whether nearby spots differ).
 * Scores come from the dashboard's already-horizon-filtered windows, so the map
 * follows the I dag / 3 dage / 7 dage selector.
 *
 * Optional "compare with official spots" fetches real forecasts for nearby
 * official spots and scores them with the SAME engine, so the numbers are
 * directly comparable to your own (deliberately not the spot-finder's
 * suitability score, which measures something different). The comparison
 * logic, lightning included, lives in lib/officialCompare.
 */
import { computed, onBeforeUnmount, onMounted, nextTick, ref, shallowRef, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { shownLang, t } from '@/lib/i18n'
import { html } from '@/lib/html'
import { OSM_TILE_ATTRIBUTION } from '@/lib/osmCredit'
import { useLeafletControls } from '@/lib/leafletControls'
import { officialSpotPopup, ownSpotPopup } from '@/lib/mapPopups'
import { createPinSync, type PinSpec } from '@/lib/pinSync'
import { pinIconOptions } from '@/lib/pinIcon'
import { pinInReach, tapPointers } from '@/lib/pinReach'
import {
  bestPerLocation, betterOfficial, compareCandidates, loadOfficialForecasts, officialLightning, sameReadings, scoreOfficial,
  type Candidate,
} from '@/lib/officialCompare'
import type { Forecast, LightningStatus, ScoredWindow } from '@/lib/types'
import { localDayUTC, useNow } from '@/lib/clock'
import { useNotEnded } from '@/lib/upcoming'
import { useSetupStore } from '@/stores/setup'
import { useForecastStore } from '@/stores/forecast'
import { useCoastStore } from '@/stores/coast'

const props = defineProps<{ windows: ScoredWindow[]; horizon: number }>()
const setup = useSetupStore()
const fc = useForecastStore()
const coast = useCoastStore()

const mapEl = ref<HTMLElement | null>(null)
const map = shallowRef<L.Map | null>(null)
useLeafletControls(map) // Leaflet's zoom buttons and popup ✕ in the app's language
let pinLayer: L.LayerGroup | null = null
let sizeObserver: ResizeObserver | null = null

/** Best window per location within the current horizon. */
const bestByLoc = computed(() => bestPerLocation(props.windows))

const scored = computed(() => [...bestByLoc.value.values()].map((w) => w.score))
const spread = computed(() =>
  scored.value.length > 1 ? Math.max(...scored.value) - Math.min(...scored.value) : 0,
)

// ── Compare with official spots (on demand; fetched once, then reused)
const compare = ref(compareWanted)
const loadingOfficial = ref(false)
const officialFailed = ref(false)
const official = shallowRef<{ candidates: Candidate[]; forecasts: Record<string, Forecast> } | null>(null)

// Overlapping loads (spots edited, compare re-ticked mid-fetch) used to let the
// first one's finally clear the spinner while the second was still running.
let loadToken = 0
async function loadOfficial() {
  if (!setup.locations.length || !setup.availability.length) return
  const token = ++loadToken
  const candidates = compareCandidates(setup.locations)
  loadingOfficial.value = true
  officialFailed.value = false
  try {
    const forecasts = await loadOfficialForecasts(candidates.map((c) => c.loc))
    if (token === loadToken) official.value = { candidates, forecasts }
  } catch {
    if (token === loadToken) officialFailed.value = true
  } finally {
    if (token === loadToken) loadingOfficial.value = false
  }
}

// The clock, as the dashboard keeps it for your own pins. scoreOfficial and
// betterOfficial default to `new Date()`, which a computed reads once and
// keeps: left open past an official window's end (or past midnight) the tab
// kept that window's pin and its "spot Y is better" banner.
const now = useNow()
const today = computed(() => localDayUTC(now.value))
// The official spots' weather is fresh by your spots' rule (lib/forecastFreshness):
// never past the local date, or the UTC date, it was fetched on. App.vue
// refetches your spots as either turns; this loaded only when compare was
// ticked, so past midnight it rescored yesterday's weather, with no tides
// for the new 7th day. Loaded again as either turns (a cache hit otherwise).
const utcDay = computed(() => Math.floor(now.value / 86400000))
watch([today, utcDay], () => { if (compare.value) loadOfficial() })

/**
 * Back online. Offline as the day turned, that reload failed: yesterday's
 * pins stayed under "couldn't fetch, retry", and nothing loaded them again
 * once the connection was back (App.vue refetches only your own spots). So
 * here, when the last load failed, or what it holds was fetched on an
 * earlier local or UTC date (a batch that answered with no weather keeps
 * the old). A load that got today's weather is left alone.
 */
function onOnline() {
  if (!compare.value) return
  const day = (ms: number) => `${localDayUTC(ms)}|${Math.floor(ms / 86400000)}`
  const nowDay = day(Date.now())
  const held = Object.values(official.value?.forecasts ?? {})
  if (officialFailed.value || held.some((f) => day(f.fetched) !== nowDay)) loadOfficial()
}
onMounted(() => window.addEventListener('online', onOnline))
onBeforeUnmount(() => window.removeEventListener('online', onOnline))

/**
 * The official spots' lightning, each the reading of your nearest spot that
 * has one (officialLightning), so they are capped as your own pins are. A
 * check writes fc.lightning whenever one of your readings changes, the first
 * all-clear answers after a start included, and each write used to rescore
 * every official spot for the result already on screen. The same object comes
 * back while these readings are unchanged, so only a check that changes one
 * of them rescores.
 */
const officialReadings = computed<Record<string, LightningStatus>>((prev) => {
  const next = official.value
    ? officialLightning({ ...official.value, own: setup.locations, lightning: fc.lightning })
    : {}
  return prev && sameReadings(prev, next) ? prev : next
})

/**
 * Scored from the forecasts already fetched, so a horizon change (or a new
 * lightning reading) only re-scores — it used to refetch every spot.
 * Re-scored when the local day changes (getScoredWindows and the horizon read
 * the clock themselves, where Vue can't see it), not on every tick.
 */
const officialScored = computed(() => {
  void today.value
  return official.value
    ? scoreOfficial({
      ...official.value,
      own: setup.locations,
      availability: setup.availability,
      targetSpecies: setup.targetSpecies,
      horizon: props.horizon,
      shores: coast.shoreById,
    }, officialReadings.value)
    : []
})
// ...and windows drop off as they end, exactly as your own do on the
// dashboard. useNotEnded hands out a new array only when one actually ends,
// so the pins aren't re-rendered every minute.
const officialWins = useNotEnded(() => officialScored.value, () => now.value)
const officialBest = computed(() => [...bestPerLocation(officialWins.value).values()])
const officialDist = computed(() =>
  new Map((official.value?.candidates ?? []).map((c) => [c.loc.id, Math.round(c.dist)])),
)

watch(compare, (on) => {
  compareWanted = on
  if (on) loadOfficial() // a cache hit when nothing changed — see loadOfficialForecasts
  render()
})
// The candidates are the official spots near YOUR spots, so re-pick them when
// a spot is added, moved or removed while comparing.
watch(() => setup.locations.map((l) => `${l.lat},${l.lon}`).join('|'), () => {
  if (compare.value) loadOfficial()
})
if (compare.value) loadOfficial() // remounted with compare still on

/** Best official spot that beats your best — the actual "is there better?" answer. */
const betterThanMine = computed(() => {
  // None of yours has a score (its weather not loaded, or failed): there is
  // nothing to beat. Measured against 0, any official spot "scored higher".
  if (!compare.value || !scored.value.length) return null
  const mine = Math.max(...scored.value)
  // `now` passed in: at the default it froze, and lightning's "today only" and
  // the "already over" rule kept judging by the moment this first ran.
  return betterOfficial(mine, officialWins.value, setup.locations, fc.lightning, new Date(now.value))
})

function hex(s: number): string {
  return s >= 80 ? '#22c55e' : s >= 65 ? '#38bdf8' : s >= 45 ? '#f59e0b' : '#ef4444'
}
/**
 * Text kept off the screen for a screen reader. Leaflet makes each pin a
 * button named by what is inside it: a badge was "72", never which spot,
 * and the dot of a spot with no score was a button with no name at all.
 */
const OFFSCREEN = 'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0'
/** Saved spots are round; official spots are square, so they never blur together. Each says its spot, then its score. */
function pin(score: number, official: boolean, name: string): PinSpec['icon'] {
  const radius = official ? '6px' : '15px'
  const dash = official ? 'border-style:dashed;' : ''
  const said = official ? `${name} (${t('map_official')}), ` : `${name}, `
  return {
    html: html`<div style="min-width:30px;height:30px;padding:0 6px;border-radius:${radius};background:${hex(score)};color:#07111f;border:2px solid rgba(255,255,255,.9);${dash}box-shadow:0 2px 6px rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;font-family:system-ui,sans-serif"><span style="${OFFSCREEN}">${said}</span>${score}</div>`.value,
    size: 30,
  }
}
/** Your spot with no score in the range: a plain dot, saying its spot and that it has none. */
function noScore(name: string): PinSpec['icon'] {
  return {
    html: html`<div style="width:14px;height:14px;border-radius:50%;background:#7d93ad;border:2px solid rgba(255,255,255,.85)"><span style="${OFFSCREEN}">${name}, ${t('map_no_score')}</span></div>`.value,
    size: 14,
  }
}
// Centred on the spot; its popup points at the pin's top edge, so the whole pin takes a tap (lib/pinIcon).
const divIcon = (i: PinSpec['icon']) => L.divIcon(pinIconOptions(i))

// Markers are updated in place rather than cleared and re-added: the windows
// change on every lightning reading, and each rebuild closed the open popup
// and refitted the map (see pinSync).
const pins = createPinSync<L.Marker>({
  add: (p) => L.marker([p.lat, p.lon], { icon: divIcon(p.icon) }).bindPopup(p.popup).addTo(pinLayer!),
  update: (mk, p, changed) => {
    if (changed.moved) mk.setLatLng([p.lat, p.lon])
    if (changed.icon) mk.setIcon(divIcon(p.icon)) // keeps the bound (and open) popup
    // After setIcon: setting the content places an open popup again, by the new pin's anchor.
    if (changed.popup) mk.setPopupContent(p.popup)
  },
  remove: (mk) => { pinLayer?.removeLayer(mk) },
})

// Which pointer made each tap: the map element's pointerups (lib/pinReach).
const taps = tapPointers()

/**
 * The pin whose popup was open as a tap on the map began. The map closes
 * that popup on 'preclick', before 'click' (closePopupOnClick); this tab's
 * handler, added as the map is made, runs before the popup's own.
 */
let openAtTap: L.Marker | null = null
function onMapPreclick() {
  openAtTap = pins.shown().find(({ marker }) => marker.isPopupOpen())?.marker ?? null
}

/**
 * A tap on the map that hit no pin. A finger's tap within reach of a pin
 * toggles the nearest pin's popup (lib/pinReach), as a tap right on it does:
 * one that was open stays shut. A mouse clicks what it points at.
 */
function onMapClick(e: L.LeafletMouseEvent) {
  const m = map.value
  const wasOpen = openAtTap
  openAtTap = null
  if (!m || !taps.reach(e.originalEvent)) return
  const near = pinInReach(e.containerPoint, pins.shown().map(({ marker, spec }) => ({ lat: spec.lat, lon: spec.lon, pin: marker })),
    (lat, lon) => m.latLngToContainerPoint([lat, lon]))
  if (near !== wasOpen) near?.openPopup()
}

function render() {
  const m = map.value
  if (!m || !pinLayer) return
  const specs: PinSpec[] = []

  for (const loc of setup.locations) {
    const best = bestByLoc.value.get(loc.id)
    specs.push({
      id: loc.id, lat: loc.lat, lon: loc.lon,
      icon: best ? pin(best.score, false, loc.name) : noScore(loc.name),
      popup: ownSpotPopup(loc, best), // escaped — names are untrusted (see mapPopups)
    })
  }

  if (compare.value) {
    for (const w of officialBest.value) {
      const l = w.location
      specs.push({
        id: l.id, lat: l.lat, lon: l.lon,
        icon: pin(w.score, true, l.name),
        popup: officialSpotPopup(w, officialDist.value.get(l.id)),
      })
    }
  }

  // Refit only when the set of pins changed, not on every score update —
  // otherwise a lightning reading landing snaps you back out of your zoom.
  if (pins.sync(specs) && specs.length) {
    m.fitBounds(L.latLngBounds(specs.map((s) => [s.lat, s.lon] as L.LatLngTuple)).pad(0.25), { maxZoom: 11 })
  }
}

onMounted(async () => {
  const m = L.map(mapEl.value!, { scrollWheelZoom: false }).setView([56.0, 10.5], 7)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    // CORS, so the worker caches each tile as itself, not as a ~7 MB opaque blob: see lib/osmTiles.ts.
    attribution: OSM_TILE_ATTRIBUTION, maxZoom: 18, crossOrigin: 'anonymous',
  }).addTo(m)
  pinLayer = L.layerGroup().addTo(m)
  m.on('preclick', onMapPreclick)
  m.on('click', onMapClick)
  map.value = m
  await nextTick()
  m.invalidateSize() // the tab was hidden until now
  // ...and again on any later reflow: a one-shot call still leaves a stale size
  // if the container settles after this tick.
  if (typeof ResizeObserver !== 'undefined' && mapEl.value) {
    sizeObserver = new ResizeObserver(() => m.invalidateSize())
    sizeObserver.observe(mapEl.value)
  }
  render()
})
onBeforeUnmount(() => {
  sizeObserver?.disconnect(); sizeObserver = null
  map.value?.remove(); map.value = null; pinLayer = null
  pins.clear()
})
// The popups are worded: built again in the language shown, which for English
// turns a moment after the switch, as its table lands (lib/i18n.ts).
watch([() => props.windows, officialBest, shownLang], render)
</script>

<template>
  <div class="maptab">
    <p class="hint">
      🗺 {{ t('maptab_hint') }}
      <span v-if="scored.length > 1" class="spread">
        · {{ t('maptab_spread') }}: <strong>{{ spread }}</strong>
        {{ spread <= 5 ? t('maptab_spread_low') : t('maptab_spread_high') }}
      </span>
    </p>

    <div class="controls">
      <label class="cmp">
        <input type="checkbox" v-model="compare"
          :disabled="!setup.locations.length || !setup.availability.length" />
        {{ t('maptab_compare') }}
      </label>
      <!-- A live region, on the page before compare is ticked: what the compare
           is doing was plain text, which a screen reader reads only when it
           gets there, so ticking the box seemed to do nothing. -->
      <span role="status">
        <!-- One batched request now, so there is no per-spot count to show. -->
        <span v-if="compare && loadingOfficial" class="muted sm">⏳ {{ t('maptab_compare_loading') }}</span>
        <span v-else-if="compare && officialFailed" class="muted sm">
          {{ t('maptab_compare_failed') }}
          <button class="linkbtn" @click="loadOfficial">{{ t('toast_retry') }}</button>
        </span>
        <!-- "None within 30 km" only when that is literally true: spots that are
             there but have nothing to score in this range (no window falls in it,
             or the batch had no weather for them) used to be reported as absent. -->
        <span v-else-if="compare && official && !official.candidates.length" class="muted sm">{{ t('maptab_compare_none') }}</span>
        <span v-else-if="compare && official && !officialBest.length" class="muted sm">{{ t('maptab_compare_nowin') }}</span>
      </span>
    </div>

    <!-- The compare's answer, told as it lands, as the line above is. -->
    <div aria-live="polite">
      <p v-if="betterThanMine" class="better">
        💡 <strong>{{ betterThanMine.location.name }}</strong> ({{ betterThanMine.score }})
        {{ t('maptab_better') }}
      </p>
    </div>

    <div ref="mapEl" class="map" @pointerup="taps.up"></div>

    <p class="legend">
      <span class="lg-dot round"></span> {{ t('map_your_locs') }}
      <span v-if="compare"><span class="lg-dot square"></span> {{ t('map_official') }}</span>
    </p>
    <p v-if="!setup.locations.length" class="notice">{{ t('no_locations') }}</p>
  </div>
</template>

<style scoped>
.maptab { padding-top: 4px; }
.hint { font-size: 0.76rem; color: var(--muted); line-height: 1.5; margin: 0 0 8px; }
.spread strong { color: var(--text); }
.controls { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.cmp { display: inline-flex; align-items: center; gap: 6px; font-size: 0.8rem; cursor: pointer; }
.cmp input { width: auto; cursor: pointer; }
.muted { color: var(--muted); } .sm { font-size: 0.76rem; }
.linkbtn { background: none; border: none; padding: 0; font: inherit; color: var(--primary); cursor: pointer; margin-left: 4px; text-decoration: underline; }
/* Touch screens: the compare checkbox with its label was 19 px tall and
   "Prøv igen" a 16 px link. Their row grows to 40. */
@media (pointer: coarse) {
  .cmp { min-height: 40px; }
  .linkbtn { display: inline-flex; align-items: center; min-height: 40px; vertical-align: middle; }
}
.better {
  font-size: 0.8rem; line-height: 1.5; margin: 0 0 8px; padding: 8px 10px;
  border-radius: 8px; background: rgba(34,197,94,.10); border: 1px solid rgba(34,197,94,.4);
}
.map { height: 460px; border-radius: 12px; border: 1px solid var(--border); }
.legend { display: flex; align-items: center; gap: 14px; font-size: 0.74rem; color: var(--muted); margin-top: 8px; flex-wrap: wrap; }
.legend span { display: inline-flex; align-items: center; gap: 5px; }
.lg-dot { display: inline-block; width: 12px; height: 12px; background: var(--muted); border: 1.5px solid rgba(255,255,255,.7); }
.lg-dot.round { border-radius: 50%; }
.lg-dot.square { border-radius: 3px; border-style: dashed; }
.notice { color: var(--muted); font-size: 0.82rem; margin-top: 10px; }
</style>
