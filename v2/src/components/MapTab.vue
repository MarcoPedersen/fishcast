<script setup lang="ts">
/**
 * Dashboard map tab — your saved spots as score pins, so you can see at a
 * glance where the good fishing is right now (and whether nearby spots differ).
 * Scores come from the dashboard's already-horizon-filtered windows, so the map
 * follows the I dag / 3 dage / 7 dage selector.
 */
import { computed, onBeforeUnmount, onMounted, nextTick, ref, shallowRef, watch } from 'vue'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { t } from '@/lib/i18n'
import { scoreLabel } from '@/lib/scoring'
import type { ScoredWindow } from '@/lib/types'
import { useSetupStore } from '@/stores/setup'

const props = defineProps<{ windows: ScoredWindow[] }>()
const setup = useSetupStore()

const mapEl = ref<HTMLElement | null>(null)
const map = shallowRef<L.Map | null>(null)
let pinLayer: L.LayerGroup | null = null

/** Best window per location within the current horizon. */
const bestByLoc = computed(() => {
  const m = new Map<string, ScoredWindow>()
  for (const w of props.windows) {
    if (w.noData) continue
    const cur = m.get(w.location.id)
    if (!cur || w.score > cur.score) m.set(w.location.id, w)
  }
  return m
})

const scored = computed(() => [...bestByLoc.value.values()].map((w) => w.score))
const spread = computed(() =>
  scored.value.length > 1 ? Math.max(...scored.value) - Math.min(...scored.value) : 0,
)

function hex(s: number): string {
  return s >= 80 ? '#22c55e' : s >= 65 ? '#38bdf8' : s >= 45 ? '#f59e0b' : '#ef4444'
}

function pin(score: number) {
  return L.divIcon({
    className: '',
    html: `<div style="min-width:30px;height:30px;padding:0 6px;border-radius:15px;background:${hex(score)};color:#07111f;border:2px solid rgba(255,255,255,.9);box-shadow:0 2px 6px rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;font-family:system-ui,sans-serif">${score}</div>`,
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
        `<br><span style="color:#7d93ad;font-size:11px">${t('day' + best.date.getDay())} ${best.date.getDate()}. · ${best.from}–${best.to}</span>`
      : `<strong>📍 ${loc.name}</strong><br><span style="color:#7d93ad">${t('map_no_score')}</span>`
    const icon = best ? pin(best.score) : L.divIcon({
      className: '',
      html: '<div style="width:14px;height:14px;border-radius:50%;background:#7d93ad;border:2px solid rgba(255,255,255,.85)"></div>',
      iconSize: [14, 14], iconAnchor: [7, 7],
    })
    L.marker([loc.lat, loc.lon], { icon }).bindPopup(popup).addTo(pinLayer!)
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
    <div ref="mapEl" class="map"></div>
    <p v-if="!setup.locations.length" class="notice">{{ t('no_locations') }}</p>
  </div>
</template>

<style scoped>
.maptab { padding-top: 4px; }
.hint { font-size: 0.76rem; color: var(--muted); line-height: 1.5; margin: 0 0 8px; }
.spread strong { color: var(--text); }
.map { height: 460px; border-radius: 12px; border: 1px solid var(--border); }
.notice { color: var(--muted); font-size: 0.82rem; margin-top: 10px; }
</style>
