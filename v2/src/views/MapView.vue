<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, nextTick, ref, watch, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { shownLang, t } from '@/lib/i18n'
import { DK_SPOTS, type Spot } from '@/lib/spots'
import { spotTypeLabel } from '@/lib/spotfinder'
import { html } from '@/lib/html'
import { OSM_TILE_ATTRIBUTION } from '@/lib/osmCredit'
import { useLeafletControls } from '@/lib/leafletControls'
import { createPinSync, type PinSpec } from '@/lib/pinSync'
import { pinIconOptions } from '@/lib/pinIcon'
import { hiddenUnder, pinInReach, tapPointers } from '@/lib/pinReach'
import { savedSpotPins } from '@/lib/setupMapPins'
import { usePendingSpot } from '@/lib/pendingSpot'
import { markBottomGuessed, markWaterGuessed } from '@/lib/waterGuess'
import { useModal } from '@/lib/useModal'
import { useNow } from '@/lib/clock'
import { bestTodayByLocation, useNotEnded } from '@/lib/upcoming'
import { useSetupStore, uid } from '@/stores/setup'
import { useForecastStore } from '@/stores/forecast'
import { useScoredStore } from '@/stores/scored'

const router = useRouter()
const setup = useSetupStore()
const fc = useForecastStore()
const scored = useScoredStore()

// Today's best achievable score per saved location — colours the pins so the
// map itself answers "where's good right now". Same day rules as the
// dashboard: "today" is the LOCAL day (it was the UTC date, still yesterday in
// Denmark until 01:00/02:00, so just after midnight the pins showed
// yesterday's scores), last night's overnight window counts while it runs, and
// a window stops counting once it has ended.
// The windows are the app's one scored list (stores/scored), shared with the
// dashboard and the reminders; it rolls over at local midnight by itself, and
// holds coast results while the coast queue runs, so they land in one step.
// "Today" is that list's own day, so the two turn together at midnight.
const now = useNow()
const today = computed(() => scored.today)
// A new array only when a window actually ends, so the pins aren't
// re-synced each minute.
const live = useNotEnded(() => scored.windows, () => now.value)
const scoresByLoc = computed(() => bestTodayByLocation(live.value, today.value))

// Leaflet objects are intentionally NOT reactive (shallowRef / plain) — Vue must
// not proxy Leaflet internals.
const mapEl = ref<HTMLElement | null>(null)
const map = shallowRef<L.Map | null>(null)
useLeafletControls(map) // Leaflet's zoom buttons and popup ✕ in the app's language
let spotLayer: L.LayerGroup
let userLayer: L.LayerGroup
let pendingMarker: L.Marker | null = null

const showSpots = ref(true)

// Reactive "add location" form, shown as a Vue overlay when a pin is placed.
// The geocode races (late answers re-opening or overwriting it) live in
// lib/pendingSpot.
const sheet = usePendingSpot()
const { pending, shown, otherWater } = sheet
const { dialogRef: sheetRef } = useModal(() => pending.value != null, () => cancelPending())
// Opened on an official spot: where it is and what kind, as its dot's popup said.
const officialSpot = computed(() => (pending.value?.official ? pending.value.sources[0] : null))

const dot = (color: string, size: number) =>
  L.divIcon({
    className: '',
    html: html`<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,.9);box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>`.value,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })

// Centred on the spot; its popup points at the pin's top edge, so the whole pin takes a tap (lib/pinIcon).
const divIcon = (i: PinSpec['icon']) => L.divIcon(pinIconOptions(i))

// Your spots' pins (lib/setupMapPins), updated in place as on the dashboard
// map (MapTab): the scores move with each forecast, lightning reading and
// coast result, and clearing and re-adding every marker on each one closed
// the popup you had open. Markers are only added or removed with the spots.
const pins = createPinSync<L.Marker>({
  add: (p) => L.marker([p.lat, p.lon], { icon: divIcon(p.icon) }).bindPopup(p.popup).addTo(userLayer),
  update: (mk, p, changed) => {
    if (changed.moved) mk.setLatLng([p.lat, p.lon])
    if (changed.icon) mk.setIcon(divIcon(p.icon)) // keeps the bound (and open) popup
    // After setIcon: setting the content places an open popup again, by the new pin's anchor.
    if (changed.popup) mk.setPopupContent(p.popup)
  },
  remove: (mk) => { userLayer.removeLayer(mk) },
})
// Reads each spot's name and position, today's scores and the language.
const userPins = computed(() => savedSpotPins(setup.locations, scoresByLoc.value))
function renderUserLayer() {
  if (map.value) pins.sync(userPins.value)
}

/**
 * The official spots' dots. A tap on one opens the add sheet for it, alone:
 * its popup used to open too, under the sheet's backdrop, its ✕ out of
 * reach. The sheet says what the popup did (where, what kind of spot, the
 * species). The popup also stopped the tap at the dot; bubblingMouseEvents
 * does that now, or it would go on to start a new spot where it landed.
 */
function renderSpotLayer() {
  spotLayer.clearLayers()
  if (!showSpots.value) return
  for (const spot of DK_SPOTS) {
    L.circleMarker([spot.lat, spot.lon], {
      radius: 6, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.8, weight: 1.5, bubblingMouseEvents: false,
    })
      .on('click', () => prefillFromSpot(spot))
      .addTo(spotLayer)
  }
}

// Which pointer made each tap: the map element's pointerups (lib/pinReach).
const taps = tapPointers()

/**
 * Your pin whose popup was open as a tap on the map began. The map closes
 * that popup on 'preclick', before 'click' (closePopupOnClick); this view's
 * handler, added as the map is made, runs before the popup's own.
 */
let openAtTap: L.Marker | null = null
function onMapPreclick() {
  openAtTap = pins.shown().find(({ marker }) => marker.isPopupOpen())?.marker ?? null
}

/**
 * A tap on the map that hit no pin. A finger's tap within reach of a pin is
 * a tap on the nearest (lib/pinReach): your spot's pin toggles its popup, as
 * a tap right on it does, and an official spot's dot opens its sheet.
 * Anywhere else, or with a mouse, it starts a new spot where it landed.
 */
function onMapClick(e: L.LeafletMouseEvent) {
  const wasOpen = openAtTap
  openAtTap = null
  const meant = taps.reach(e.originalEvent) ? pinMeant(e.containerPoint, wasOpen) : null
  if (meant) { meant(); return }
  const { lat, lng } = e.latlng
  placePending(lat, lng)
  sheet.startAt(lat, lng)
}

/** An official spot's dot as drawn (renderSpotLayer): radius 6 and half its 1.5 px edge. */
const DOT_RADIUS_PX = 6 + 1.5 / 2

/**
 * What a tap at this point meant to hit, as what that pin does; null for
 * none. `wasOpen` is your pin whose popup the tap closed: meant, it stays shut.
 */
function pinMeant(tap: L.Point, wasOpen: L.Marker | null): (() => void) | null {
  const m = map.value!
  const toScreen = (lat: number, lon: number) => m.latLngToContainerPoint([lat, lon])
  const yours = pins.shown()
  // Your spots' pins are drawn over the dots. A dot wholly under one can't be
  // seen, so it takes no tap: one beside your pin is your pin's.
  const over = yours.map(({ spec }) => ({ at: toScreen(spec.lat, spec.lon), r: spec.icon.size / 2 }))
  const dots = showSpots.value ? DK_SPOTS.filter((s) => !hiddenUnder(toScreen(s.lat, s.lon), DOT_RADIUS_PX, over)) : []
  // Your spots first: one wins a tie with the dot it was added from.
  return pinInReach(tap, [
    ...yours.map(({ marker, spec }) => ({ lat: spec.lat, lon: spec.lon, pin: () => { if (marker !== wasOpen) marker.openPopup() } })),
    ...dots.map((s) => ({ lat: s.lat, lon: s.lon, pin: () => prefillFromSpot(s) })),
  ], toScreen)
}

function prefillFromSpot(spot: Spot) {
  placePending(spot.lat, spot.lon)
  sheet.startFromSpot(spot)
}

function placePending(lat: number, lon: number) {
  if (pendingMarker) pendingMarker.remove()
  pendingMarker = L.marker([lat, lon], { icon: dot('#ef4444', 18) }).addTo(map.value!)
}

function confirmAdd() {
  const loc = sheet.toLocation() // null while the place is still loading
  if (!loc) return
  if (!setup.locations.some((l) => l.lat === loc.lat && l.lon === loc.lon)) {
    const id = uid()
    setup.locations.push({ id, ...loc })
    if (pending.value?.guessed) markWaterGuessed(id) // the card goes on saying so
    if (!pending.value?.official) markBottomGuessed(id) // a tapped point's is always the guess
  }
  cancelPending()
}

function cancelPending() {
  sheet.cancel() // also invalidates an in-flight geocode, so it can't re-open the sheet
  if (pendingMarker) { pendingMarker.remove(); pendingMarker = null }
}

/**
 * Leaflet caches the container size at construction. This view is a lazily
 * loaded route chunk, so onMounted can run before the browser has laid the
 * container out — Leaflet then measures a collapsed box and renders a grey
 * sliver instead of a map, which reads as "the map didn't load". MapTab already
 * did this for its hidden-tab case; the setup map never did.
 *
 * The observer also covers later reflows (window resize, the sidebar list
 * growing as spots are added) rather than only the first paint.
 */
let sizeObserver: ResizeObserver | null = null
function watchSize(m: L.Map, el: HTMLElement) {
  m.invalidateSize()
  if (typeof ResizeObserver === 'undefined') return
  sizeObserver = new ResizeObserver(() => m.invalidateSize())
  sizeObserver.observe(el)
}

onMounted(async () => {
  const m = L.map(mapEl.value!).setView([56.0, 10.5], 7)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    // CORS, so the worker caches each tile as itself, not as a ~7 MB opaque blob: see lib/osmTiles.ts.
    attribution: OSM_TILE_ATTRIBUTION, maxZoom: 18, crossOrigin: 'anonymous',
  }).addTo(m)
  spotLayer = L.layerGroup().addTo(m)
  userLayer = L.layerGroup().addTo(m)
  m.on('preclick', onMapPreclick)
  m.on('click', onMapClick)
  map.value = m
  await nextTick()
  watchSize(m, mapEl.value!)
  renderSpotLayer()
  renderUserLayer()
  // Pull forecasts so pins can colour by today's score (idempotent — the store
  // keeps what it already has). A spot added while the map is open is fetched
  // by the app, as one added anywhere else (App.vue).
  if (setup.locations.length) fc.fetchAll(setup.locations)
})

onBeforeUnmount(() => {
  sizeObserver?.disconnect(); sizeObserver = null
  map.value?.remove(); map.value = null
  pins.clear()
})

watch(showSpots, renderSpotLayer)
watch(userPins, renderUserLayer) // spots added or removed, scores as forecasts arrive, the language
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

    <div ref="mapEl" class="map" @pointerup="taps.up"></div>

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
          <!-- Icon-only: "✕" alone gave a screen reader nothing to announce. -->
          <button class="btn ghost sm" :aria-label="t('pin_cancel')" :title="t('pin_cancel')"
            @click="cancelPending">✕</button>
        </div>
        <div v-if="officialSpot" class="muted sm">{{ officialSpot.region }} · {{ spotTypeLabel(officialSpot.spotType) }}</div>
        <!-- Each label is its field's: for no field, a screen reader named
             the name field by its placeholder, "…", and the list by nothing. -->
        <label for="pin-name">{{ t('pin_name') }}</label>
        <input id="pin-name" v-model="pending.name" placeholder="…" @input="sheet.touch('name')" />
        <label for="pin-wt">{{ t('pin_wt') }} <small v-if="pending.guessed" class="guess">({{ t('wt_guessed') }})</small></label>
        <select id="pin-wt" v-model="pending.waterType" @change="sheet.touch('waterType')">
          <option value="salt">{{ t('wt_salt_opt') }}</option>
          <option value="brackish">{{ t('wt_brackish_opt') }}</option>
          <option value="fresh">{{ t('wt_fresh_opt') }}</option>
        </select>
        <div v-if="pending.loading" class="muted sm">{{ t('pin_loading') }}</div>
        <!-- Exactly what Add saves with the spot (pendingSpot `shown`). -->
        <template v-else-if="shown.length">
          <label>{{ t('pin_species') }}</label>
          <div class="pills">
            <span v-for="s in shown" :key="s.nameEn" class="pill">{{ shownLang === 'en' ? s.nameEn : s.name }}</span>
          </div>
        </template>
        <!-- None for this water type, though the spots near have some: say so, not "none nearby". -->
        <div v-else class="muted sm">{{ t(otherWater ? 'no_species_this_water' : 'no_active_nearby') }}</div>
        <button class="btn primary" :disabled="pending.loading" @click="confirmAdd">{{ t('share_add_loc') }}</button>
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
/* Touch screens: "Vis alle pladser", checkbox and label, was 19 px tall.
   Its line of the legend grows to 40. */
@media (pointer: coarse) { .toggle { min-height: 40px; } }
/* Above the toasts (2000): a Fortryd left standing covered "+ Tilføj lokation". Below the confirm dialog (3000). */
.sheet { position: fixed; inset: 0; background: rgba(0,0,0,.5); display: grid; place-items: end center; z-index: 2500; }
.sheet .card { width: 100%; max-width: 460px; margin-bottom: 18px; display: flex; flex-direction: column; gap: 8px; }
.sheet label { font-size: 0.78rem; color: var(--muted); }
.sheet .guess { color: var(--gold); }
.pills { display: flex; gap: 4px; flex-wrap: wrap; }
.pill { background: rgba(56,189,248,.12); border: 1px solid var(--border); border-radius: 12px; padding: 2px 8px; font-size: 0.74rem; }
.muted { color: var(--muted); } .sm { font-size: 0.78rem; }
</style>
