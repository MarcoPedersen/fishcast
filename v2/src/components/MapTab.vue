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
import { t } from '@/lib/i18n'
import { html } from '@/lib/html'
import { officialSpotPopup, ownSpotPopup } from '@/lib/mapPopups'
import {
  bestPerLocation, betterOfficial, compareCandidates, loadOfficialForecasts, officialWindows,
  type Candidate,
} from '@/lib/officialCompare'
import type { Forecast, ScoredWindow } from '@/lib/types'
import { useSetupStore } from '@/stores/setup'
import { useForecastStore } from '@/stores/forecast'

const props = defineProps<{ windows: ScoredWindow[]; horizon: number }>()
const setup = useSetupStore()
const fc = useForecastStore()

const mapEl = ref<HTMLElement | null>(null)
const map = shallowRef<L.Map | null>(null)
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

/**
 * Scored from the forecasts already fetched, so a horizon change (or a new
 * lightning reading) only re-scores — it used to refetch every spot. Official
 * spots get the lightning reading of your nearest spot, as your own pins do.
 */
const officialWins = computed(() => (official.value
  ? officialWindows({
    ...official.value,
    own: setup.locations,
    availability: setup.availability,
    targetSpecies: setup.targetSpecies,
    lightning: fc.lightning,
    horizon: props.horizon,
  })
  : []))
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
  if (!compare.value) return null
  const mine = scored.value.length ? Math.max(...scored.value) : 0
  return betterOfficial(mine, officialWins.value, setup.locations, fc.lightning)
})

function hex(s: number): string {
  return s >= 80 ? '#22c55e' : s >= 65 ? '#38bdf8' : s >= 45 ? '#f59e0b' : '#ef4444'
}
/** Saved spots are round; official spots are square, so they never blur together. */
function pin(score: number, official: boolean) {
  const radius = official ? '6px' : '15px'
  const dash = official ? 'border-style:dashed;' : ''
  return L.divIcon({
    className: '',
    html: html`<div style="min-width:30px;height:30px;padding:0 6px;border-radius:${radius};background:${hex(score)};color:#07111f;border:2px solid rgba(255,255,255,.9);${dash}box-shadow:0 2px 6px rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;font-family:system-ui,sans-serif">${score}</div>`.value,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  })
}

function render() {
  const m = map.value
  if (!m) return
  pinLayer?.clearLayers()
  const pts: L.LatLngExpression[] = []

  for (const loc of setup.locations) {
    const best = bestByLoc.value.get(loc.id)
    pts.push([loc.lat, loc.lon])
    const popup = ownSpotPopup(loc, best) // escaped — names are untrusted (see mapPopups)
    const icon = best ? pin(best.score, false) : L.divIcon({
      className: '',
      html: '<div style="width:14px;height:14px;border-radius:50%;background:#7d93ad;border:2px solid rgba(255,255,255,.85)"></div>',
      iconSize: [14, 14], iconAnchor: [7, 7],
    })
    L.marker([loc.lat, loc.lon], { icon }).bindPopup(popup).addTo(pinLayer!)
  }

  if (compare.value) {
    for (const w of officialBest.value) {
      const l = w.location
      pts.push([l.lat, l.lon])
      const km = officialDist.value.get(l.id)
      L.marker([l.lat, l.lon], { icon: pin(w.score, true) })
        .bindPopup(officialSpotPopup(w, km))
        .addTo(pinLayer!)
    }
  }

  if (pts.length) m.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 11 })
}

onMounted(async () => {
  const m = L.map(mapEl.value!, { scrollWheelZoom: false }).setView([56.0, 10.5], 7)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap', maxZoom: 18,
  }).addTo(m)
  pinLayer = L.layerGroup().addTo(m)
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
})
watch([() => props.windows, officialBest], render)
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
      <!-- One batched request now, so there is no per-spot count to show. -->
      <span v-if="compare && loadingOfficial" class="muted sm">⏳ {{ t('maptab_compare_loading') }}</span>
      <span v-else-if="compare && officialFailed" class="muted sm">
        {{ t('maptab_compare_failed') }}
        <button class="linkbtn" @click="loadOfficial">{{ t('toast_retry') }}</button>
      </span>
      <span v-else-if="compare && !officialBest.length" class="muted sm">{{ t('maptab_compare_none') }}</span>
    </div>

    <p v-if="betterThanMine" class="better">
      💡 <strong>{{ betterThanMine.location.name }}</strong> ({{ betterThanMine.score }})
      {{ t('maptab_better') }}
    </p>

    <div ref="mapEl" class="map"></div>

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
