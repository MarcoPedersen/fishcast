<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { lang, spName, t } from '@/lib/i18n'
import { DK_SPOTS, findNearbySpots, activeSpeciesInMonth, type Spot } from '@/lib/spots'
import { reverseGeocode, smartDetectWaterType, inferSpecies, inferBottomType } from '@/lib/geo'
import { getScoredWindows, scoreLabel } from '@/lib/scoring'
import { useModal } from '@/lib/useModal'
import type { WaterType } from '@/lib/types'
import { useSetupStore, uid } from '@/stores/setup'
import { useForecastStore } from '@/stores/forecast'

const router = useRouter()
const setup = useSetupStore()
const fc = useForecastStore()

// Today's best achievable score per saved location — colours the pins so the
// map itself answers "where's good right now".
const scoresByLoc = computed(() => {
  const m = new Map<string, number>()
  if (!setup.availability.length) return m
  const wins = getScoredWindows(setup.locations, setup.availability, fc.forecasts, setup.targetSpecies, fc.lightning)
  const n = new Date()
  const today = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())
  for (const w of wins) {
    if (w.noData || w.date.getTime() !== today) continue
    m.set(w.location.id, Math.max(m.get(w.location.id) ?? 0, w.score))
  }
  return m
})
function scoreHex(s: number): string {
  return s >= 80 ? '#22c55e' : s >= 65 ? '#38bdf8' : s >= 45 ? '#f59e0b' : '#ef4444'
}

// Leaflet objects are intentionally NOT reactive (shallowRef / plain) — Vue must
// not proxy Leaflet internals.
const mapEl = ref<HTMLElement | null>(null)
const map = shallowRef<L.Map | null>(null)
let spotLayer: L.LayerGroup
let userLayer: L.LayerGroup
let pendingMarker: L.Marker | null = null

const showSpots = ref(true)

// Reactive "add location" form, shown as a Vue overlay when a pin is placed.
interface PendingForm {
  lat: number; lon: number; name: string; waterType: WaterType
  bottomType: string; speciesNames: string[]; nearbyCount: number; loading: boolean
}
const pending = ref<PendingForm | null>(null)
const { dialogRef: sheetRef } = useModal(() => pending.value != null, () => cancelPending())

const dot = (color: string, size: number) =>
  L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,.9);box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })

// A pin that shows today's score as a coloured, numbered badge.
const scorePin = (score: number) =>
  L.divIcon({
    className: '',
    html: `<div style="min-width:26px;height:26px;padding:0 5px;border-radius:13px;background:${scoreHex(score)};color:#07111f;border:2px solid rgba(255,255,255,.9);box-shadow:0 1px 4px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;font-family:system-ui,sans-serif">${score}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })

function renderUserLayer() {
  userLayer.clearLayers()
  for (const loc of setup.locations) {
    const sc = scoresByLoc.value.get(loc.id)
    const icon = sc != null ? scorePin(sc) : dot('#38bdf8', 16)
    const popup = sc != null
      ? `<strong>📍 ${loc.name}</strong><br><span style="color:#7d93ad">${t('map_score_today')}: ${sc} · ${scoreLabel(sc)}</span>`
      : `<strong>📍 ${loc.name}</strong>`
    L.marker([loc.lat, loc.lon], { icon }).bindPopup(popup).addTo(userLayer)
  }
}

function renderSpotLayer() {
  spotLayer.clearLayers()
  if (!showSpots.value) return
  const month = new Date().getMonth() + 1
  for (const spot of DK_SPOTS) {
    const active = activeSpeciesInMonth(spot, month).slice(0, 5).map((s) => spName(s as any)).join(', ')
    L.circleMarker([spot.lat, spot.lon], {
      radius: 6, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.8, weight: 1.5,
    })
      .bindPopup(
        `<strong>${spot.name}</strong><br><span style="color:#7d93ad">${spot.region} · ${spot.spotType}</span>` +
        (active ? `<br><span style="color:#bbf7d0;font-size:11px">${active}</span>` : ''),
      )
      .on('click', () => prefillFromSpot(spot))
      .addTo(spotLayer)
  }
}

// Token guards against a slow reverse-geocode from an OLDER click resolving
// after a newer click/spot-prefill and overwriting the form with wrong coords.
let clickToken = 0
async function onMapClick(e: L.LeafletMouseEvent) {
  const { lat, lng } = e.latlng
  const token = ++clickToken
  placePending(lat, lng)
  pending.value = {
    lat, lon: lng, name: '…', waterType: 'brackish', bottomType: 'mixed',
    speciesNames: [], nearbyCount: 0, loading: true,
  }
  const [name, nearby] = await Promise.all([
    reverseGeocode(lat, lng),
    Promise.resolve(findNearbySpots(lat, lng, 40).slice(0, 5)),
  ])
  if (token !== clickToken) return // superseded by a newer click / spot prefill
  pending.value = {
    lat, lon: lng, name,
    waterType: smartDetectWaterType(lat, lng, name, nearby),
    bottomType: inferBottomType(nearby),
    speciesNames: inferSpecies(nearby).slice(0, 6).map((s) => spName(s as any)),
    nearbyCount: nearby.length,
    loading: false,
  }
}

function prefillFromSpot(spot: Spot) {
  clickToken++ // invalidate any in-flight map-click geocode
  placePending(spot.lat, spot.lon)
  const month = new Date().getMonth() + 1
  pending.value = {
    lat: spot.lat, lon: spot.lon, name: spot.name, waterType: spot.waterType,
    bottomType: spot.bottomType,
    speciesNames: activeSpeciesInMonth(spot, month).map((s) => spName(s as any)),
    nearbyCount: 0, loading: false,
  }
}

function placePending(lat: number, lon: number) {
  if (pendingMarker) pendingMarker.remove()
  pendingMarker = L.marker([lat, lon], { icon: dot('#ef4444', 18) }).addTo(map.value!)
}

function confirmAdd() {
  if (!pending.value) return
  const p = pending.value
  if (!setup.locations.some((l) => l.lat === p.lat && l.lon === p.lon)) {
    setup.locations.push({
      id: uid(), name: p.name || `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`,
      lat: p.lat, lon: p.lon, waterType: p.waterType, bottomType: p.bottomType,
    })
  }
  cancelPending()
}

function cancelPending() {
  pending.value = null
  if (pendingMarker) { pendingMarker.remove(); pendingMarker = null }
}

onMounted(() => {
  const m = L.map(mapEl.value!).setView([56.0, 10.5], 7)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap', maxZoom: 18,
  }).addTo(m)
  spotLayer = L.layerGroup().addTo(m)
  userLayer = L.layerGroup().addTo(m)
  m.on('click', onMapClick)
  map.value = m
  renderSpotLayer()
  renderUserLayer()
  // Pull forecasts so pins can colour by today's score (idempotent — the store
  // keeps what it already has).
  if (setup.locations.length) fc.fetchAll(setup.locations)
})

onBeforeUnmount(() => { map.value?.remove(); map.value = null })

watch(showSpots, renderSpotLayer)
watch(() => setup.locations.length, renderUserLayer)
watch(scoresByLoc, renderUserLayer) // recolour pins as forecasts arrive
watch(lang, () => { renderSpotLayer(); renderUserLayer() })
</script>

<template>
  <div class="mapview">
    <h1 class="page-title">{{ t('topbar_locations') }}</h1>
    <div class="row between head">
      <button class="btn ghost sm" @click="router.push({ name: 'locations' })">← {{ t('map_back_list') }}</button>
      <button class="btn ghost sm" @click="router.push({ name: 'dashboard' })">{{ t('goto_dash') }}</button>
    </div>

    <div class="cta">
      <span class="cta-pin">📍</span>
      <span class="cta-text">{{ t('map_add_cta') }}</span>
    </div>

    <div ref="mapEl" class="map"></div>

    <div class="legend">
      <span><i class="d ring"></i> {{ t('map_your_locs') }} <small>({{ t('map_score_legend') }})</small></span>
      <span><i class="d" style="background:#22c55e"></i> {{ t('map_official') }}</span>
      <span><i class="d" style="background:#ef4444"></i> {{ t('map_click_new') }}</span>
      <label class="toggle"><input type="checkbox" v-model="showSpots" /> {{ t('map_show_all') }}</label>
    </div>

    <!-- Add-location overlay (Vue-controlled, replaces v1's inline-onclick popup) -->
    <div v-if="pending" class="sheet" @click.self="cancelPending">
      <div class="card" ref="sheetRef" role="dialog" aria-modal="true" tabindex="-1" :aria-label="t('pin_new')">
        <div class="row between">
          <strong>{{ t('pin_new') }}</strong>
          <button class="btn ghost sm" @click="cancelPending">✕</button>
        </div>
        <label>{{ t('pin_name') }}</label>
        <input v-model="pending.name" />
        <label>{{ t('pin_wt') }} <small>{{ t('pin_auto') }}</small></label>
        <select v-model="pending.waterType">
          <option value="salt">{{ t('wt_salt_opt') }}</option>
          <option value="brackish">{{ t('wt_brackish_opt') }}</option>
          <option value="fresh">{{ t('wt_fresh_opt') }}</option>
        </select>
        <div v-if="pending.loading" class="muted sm">{{ t('pin_loading') }}</div>
        <div v-else-if="pending.speciesNames.length" class="pills">
          <span v-for="(s, i) in pending.speciesNames" :key="i" class="pill">{{ s }}</span>
        </div>
        <div v-else class="muted sm">{{ t('no_active_nearby') }}</div>
        <button class="btn primary" @click="confirmAdd">{{ t('share_add_loc') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.head h1 { font-size: 1.3rem; }
.page-title { font-size: 1.3rem; margin-bottom: 8px; }
.head { margin-bottom: 4px; }
.row { display: flex; align-items: center; gap: 10px; } .row.between { justify-content: space-between; }
.cta {
  display: flex; align-items: center; gap: 10px;
  margin-top: 12px; padding: 11px 14px; border-radius: 10px;
  background: rgba(56,189,248,.10); border: 1px solid rgba(56,189,248,.45);
  color: var(--text); font-size: 0.9rem; font-weight: 600;
}
.cta-pin { font-size: 1.25rem; animation: pin-bob 1.4s ease-in-out infinite; }
@keyframes pin-bob { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
.map { height: 440px; border-radius: 12px; border: 1px solid var(--border); margin: 8px 0 8px; cursor: crosshair; }
.legend { display: flex; gap: 14px; font-size: 0.76rem; color: var(--muted); align-items: center; flex-wrap: wrap; }
.legend .d { display: inline-block; width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,.6); vertical-align: middle; margin-right: 3px; }
.legend .d.ring { background: conic-gradient(#22c55e, #38bdf8, #f59e0b, #ef4444, #22c55e); }
.toggle { cursor: pointer; display: flex; align-items: center; gap: 4px; }
.toggle input { width: auto; }
.sheet { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: grid; place-items: end center; z-index: 1000; }
.sheet .card { width: 100%; max-width: 460px; margin-bottom: 18px; display: flex; flex-direction: column; gap: 8px; }
.sheet label { font-size: 0.78rem; color: var(--muted); }
.pills { display: flex; gap: 4px; flex-wrap: wrap; }
.pill { background: rgba(56,189,248,.12); border: 1px solid var(--border); border-radius: 12px; padding: 2px 8px; font-size: 0.74rem; }
.muted { color: var(--muted); } .sm { font-size: 0.78rem; }
</style>
