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
 * suitability score, which measures something different).
 */
import { computed, onBeforeUnmount, onMounted, nextTick, ref, shallowRef, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { t } from '@/lib/i18n'
import { getScoredWindows, scoreLabel, isOvernight } from '@/lib/scoring'
import { findNearbySpots } from '@/lib/spots'
import { fetchForecast } from '@/lib/weather'
import type { Forecast, Location, ScoredWindow } from '@/lib/types'
import { useSetupStore } from '@/stores/setup'

const props = defineProps<{ windows: ScoredWindow[]; horizon: number }>()
const setup = useSetupStore()

const mapEl = ref<HTMLElement | null>(null)
const map = shallowRef<L.Map | null>(null)
let pinLayer: L.LayerGroup | null = null

function daysAhead(d: Date): number {
  const n = new Date()
  const today = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())
  return Math.round((d.getTime() - today) / 86400000)
}

/** Best window per location within the current horizon. */
function bestPerLocation(windows: ScoredWindow[]) {
  const m = new Map<string, ScoredWindow>()
  for (const w of windows) {
    if (w.noData) continue
    const cur = m.get(w.location.id)
    if (!cur || w.score > cur.score) m.set(w.location.id, w)
  }
  return m
}
const bestByLoc = computed(() => bestPerLocation(props.windows))

const scored = computed(() => [...bestByLoc.value.values()].map((w) => w.score))
const spread = computed(() =>
  scored.value.length > 1 ? Math.max(...scored.value) - Math.min(...scored.value) : 0,
)

// ── Compare with official spots (on demand — each spot costs a weather fetch)
const MAX_COMPARE = 8
const RADIUS_KM = 30
const compare = ref(false)
const loadingOfficial = ref(false)
const progress = ref({ done: 0, total: 0 })
const officialBest = shallowRef<ScoredWindow[]>([])
const officialDist = new Map<string, number>()

async function loadOfficial() {
  if (!setup.locations.length || !setup.availability.length) return
  loadingOfficial.value = true
  officialBest.value = []
  try {
    // Candidates: official spots near the user's spots, closest first, deduped,
    // excluding ones they already have saved.
    const seen = new Map<string, { loc: Location; dist: number }>()
    for (const own of setup.locations) {
      for (const s of findNearbySpots(own.lat, own.lon, RADIUS_KM)) {
        const key = s.slug ?? `${s.lat},${s.lon}`
        if (seen.has(key)) continue
        if (setup.locations.some((l) => Math.abs(l.lat - s.lat) < 1e-4 && Math.abs(l.lon - s.lon) < 1e-4)) continue
        seen.set(key, {
          dist: s.distKm,
          loc: {
            id: 'off-' + key, name: s.name, lat: s.lat, lon: s.lon,
            waterType: s.waterType, bottomType: s.bottomType, spotSlug: s.slug,
            species: s.species?.map((sp) => ({ nameEn: sp.nameEn, months: sp.months })),
          },
        })
      }
    }
    const candidates = [...seen.values()].sort((a, b) => a.dist - b.dist).slice(0, MAX_COMPARE)
    candidates.forEach((c) => officialDist.set(c.loc.id, Math.round(c.dist)))
    progress.value = { done: 0, total: candidates.length }

    // Sequential: free shared APIs, no reason to hammer them.
    const forecasts: Record<string, Forecast> = {}
    for (const c of candidates) {
      try { forecasts[c.loc.id] = await fetchForecast(c.loc) } catch { /* skip this spot */ }
      progress.value = { done: progress.value.done + 1, total: candidates.length }
    }
    const locs = candidates.map((c) => c.loc).filter((l) => forecasts[l.id])
    const wins = getScoredWindows(locs, setup.availability, forecasts, setup.targetSpecies)
      .filter((w) => daysAhead(w.date) < props.horizon)
    officialBest.value = [...bestPerLocation(wins).values()]
  } finally {
    loadingOfficial.value = false
    render()
  }
}

watch(compare, (on) => {
  if (on && !officialBest.value.length && !loadingOfficial.value) loadOfficial()
  else render()
})
// Horizon changed while comparing → the official scores are for the old range.
watch(() => props.horizon, () => { if (compare.value) loadOfficial() })

/** Best official spot that beats your best — the actual "is there better?" answer. */
const betterThanMine = computed(() => {
  if (!compare.value || !officialBest.value.length) return null
  const mine = scored.value.length ? Math.max(...scored.value) : 0
  const best = officialBest.value.reduce((a, b) => (b.score > a.score ? b : a))
  return best.score > mine ? best : null
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
    html: `<div style="min-width:30px;height:30px;padding:0 6px;border-radius:${radius};background:${hex(score)};color:#07111f;border:2px solid rgba(255,255,255,.9);${dash}box-shadow:0 2px 6px rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;font-family:system-ui,sans-serif">${score}</div>`,
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
    const popup = best
      ? `<strong>📍 ${loc.name}</strong><br><span style="color:#7d93ad">${best.score} · ${scoreLabel(best.score)}</span>` +
        `<br><span style="color:#7d93ad;font-size:11px">${t('day' + best.date.getDay())} ${best.date.getDate()}. · ${best.from}–${best.to}${isOvernight(best.from, best.to) ? ' (+1)' : ''}</span>`
      : `<strong>📍 ${loc.name}</strong><br><span style="color:#7d93ad">${t('map_no_score')}</span>`
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
      const km = officialDist.get(l.id)
      L.marker([l.lat, l.lon], { icon: pin(w.score, true) })
        .bindPopup(
          `<strong>${l.name}</strong> <span style="color:#7d93ad;font-size:11px">(${t('map_official')})</span>` +
          `<br><span style="color:#7d93ad">${w.score} · ${scoreLabel(w.score)}</span>` +
          (km != null ? `<br><span style="color:#7d93ad;font-size:11px">${km} ${t('maptab_km_away')}</span>` : ''),
        )
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
  render()
})
onBeforeUnmount(() => { map.value?.remove(); map.value = null; pinLayer = null })
watch(() => props.windows, render)
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
      <span v-if="loadingOfficial" class="muted sm">
        ⏳ {{ t('maptab_compare_loading') }} {{ progress.done }}/{{ progress.total }}
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
