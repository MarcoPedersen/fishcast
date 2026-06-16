<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { lang, spName, t } from '@/lib/i18n'
import { DK_SPOTS, findNearbySpots, activeSpeciesInMonth, type Spot } from '@/lib/spots'
import { reverseGeocode, smartDetectWaterType, inferSpecies, inferBottomType, type WaterType } from '@/lib/geo'
import { useSetupStore, uid } from '@/stores/setup'

const router = useRouter()
const setup = useSetupStore()

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

const dot = (color: string, size: number) =>
  L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,.9);box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })

function renderUserLayer() {
  userLayer.clearLayers()
  for (const loc of setup.locations) {
    L.marker([loc.lat, loc.lon], { icon: dot('#38bdf8', 16) })
      .bindPopup(`<strong>📍 ${loc.name}</strong>`)
      .addTo(userLayer)
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

async function onMapClick(e: L.LeafletMouseEvent) {
  const { lat, lng } = e.latlng
  placePending(lat, lng)
  pending.value = {
    lat, lon: lng, name: '…', waterType: 'brackish', bottomType: 'mixed',
    speciesNames: [], nearbyCount: 0, loading: true,
  }
  const [name, nearby] = await Promise.all([
    reverseGeocode(lat, lng),
    Promise.resolve(findNearbySpots(lat, lng, 40).slice(0, 5)),
  ])
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
})

onBeforeUnmount(() => { map.value?.remove(); map.value = null })

watch(showSpots, renderSpotLayer)
watch(() => setup.locations.length, renderUserLayer)
watch(lang, () => { renderSpotLayer(); renderUserLayer() })
</script>

<template>
  <div class="mapview">
    <div class="row between head">
      <h1>📍 {{ t('topbar_locations') }}</h1>
      <button class="btn ghost sm" @click="router.push({ name: 'dashboard' })">{{ t('goto_dash') }}</button>
    </div>

    <div ref="mapEl" class="map"></div>

    <div class="legend">
      <span><i class="d" style="background:#38bdf8"></i> {{ t('map_your_locs') }}</span>
      <span><i class="d" style="background:#22c55e"></i> {{ t('map_official') }}</span>
      <span><i class="d" style="background:#ef4444"></i> {{ t('map_click_new') }}</span>
      <label class="toggle"><input type="checkbox" v-model="showSpots" /> {{ t('map_show_all') }}</label>
    </div>
    <p class="hint">{{ t('map_instructions') }}</p>

    <!-- Add-location overlay (Vue-controlled, replaces v1's inline-onclick popup) -->
    <div v-if="pending" class="sheet">
      <div class="card">
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
.row { display: flex; align-items: center; gap: 10px; } .row.between { justify-content: space-between; }
.map { height: 440px; border-radius: 12px; border: 1px solid var(--border); margin: 12px 0 8px; }
.legend { display: flex; gap: 14px; font-size: 0.76rem; color: var(--muted); align-items: center; flex-wrap: wrap; }
.legend .d { display: inline-block; width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,.6); vertical-align: middle; margin-right: 3px; }
.toggle { cursor: pointer; display: flex; align-items: center; gap: 4px; }
.toggle input { width: auto; }
.hint { font-size: 0.78rem; color: var(--muted); margin-top: 6px; }
.sheet { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: grid; place-items: end center; z-index: 1000; }
.sheet .card { width: 100%; max-width: 460px; margin-bottom: 18px; display: flex; flex-direction: column; gap: 8px; }
.sheet label { font-size: 0.78rem; color: var(--muted); }
.pills { display: flex; gap: 4px; flex-wrap: wrap; }
.pill { background: rgba(56,189,248,.12); border: 1px solid var(--border); border-radius: 12px; padding: 2px 8px; font-size: 0.74rem; }
.muted { color: var(--muted); } .sm { font-size: 0.78rem; }
</style>
