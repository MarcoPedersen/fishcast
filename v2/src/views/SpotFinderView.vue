<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { lang, spName, t } from '@/lib/i18n'
import { geocode, type GeoResult } from '@/lib/weather'
import { activeSpeciesInMonth, type NearbySpot, type Spot } from '@/lib/spots'
import { findLuckySpots, findNearbyRanked, spotTypeIcon, type SpotResult } from '@/lib/spotfinder'
import { SPECIES_PREFS } from '@/lib/species'
import { scoreColor } from '@/lib/scoring'
import { useSetupStore, uid } from '@/stores/setup'
import { useForecastStore } from '@/stores/forecast'

const router = useRouter()
const route = useRoute()
const setup = useSetupStore()
const fc = useForecastStore()

const mode = ref<'lucky' | 'nearby'>(route.query.mode === 'nearby' ? 'nearby' : 'lucky')
watch(() => route.query.mode, (m) => { if (m === 'nearby' || m === 'lucky') mode.value = m })
// Lucky mode needs no input, so run it immediately (on arrival or when switched
// to); reset results when leaving it so nearby starts fresh.
watch(mode, () => { searched.value = false; results.value = []; if (mode.value === 'lucky') search() })
onMounted(() => { if (mode.value === 'lucky') search() })
const month = new Date().getMonth() + 1

// Nearby-mode geo search
const query = ref('')
const geoResults = ref<GeoResult[]>([])
const point = ref<{ lat: number; lon: number; name: string } | null>(null)
const radius = ref(40)
let timer: ReturnType<typeof setTimeout> | undefined

const results = ref<SpotResult[]>([])
const searched = ref(false)

const ctx = computed(() => ({
  locations: setup.locations,
  forecastIds: new Set(Object.keys(fc.forecasts)),
}))

function onGeoInput() {
  clearTimeout(timer)
  if (!query.value.trim()) { geoResults.value = []; return }
  timer = setTimeout(async () => { geoResults.value = await geocode(query.value, lang.value) }, 350)
}
function pickPoint(r: GeoResult) {
  point.value = { lat: r.lat, lon: r.lon, name: r.admin1 ? `${r.name}, ${r.admin1}` : r.name }
  query.value = point.value.name
  geoResults.value = []
}
function pickSaved(l: { lat: number; lon: number; name: string }) {
  point.value = { lat: l.lat, lon: l.lon, name: l.name }
  query.value = l.name
  geoResults.value = [] // close any open search dropdown
}

function search() {
  if (mode.value === 'lucky') {
    results.value = findLuckySpots(setup.targetSpecies, month, ctx.value)
  } else if (point.value) {
    results.value = findNearbyRanked(point.value.lat, point.value.lon, radius.value, setup.targetSpecies, month, ctx.value)
  }
  searched.value = true
}

function waterBadge(w: string) {
  return w === 'fresh' ? t('wt_fresh_label') : w === 'salt' ? t('wt_salt_label') : t('wt_brackish_label')
}
function isAdded(spot: Spot) {
  return setup.locations.some((l) => l.lat === spot.lat && l.lon === spot.lon)
}
function add(spot: Spot) {
  if (isAdded(spot)) return
  setup.locations.push({
    id: uid(), name: spot.name, lat: spot.lat, lon: spot.lon,
    waterType: spot.waterType, bottomType: spot.bottomType, spotSlug: spot.slug,
    species: spot.species?.map((s) => ({ nameEn: s.nameEn, months: s.months })),
  })
}
const medals = ['🥇', '🥈', '🥉']
const targetNames = computed(() =>
  setup.targetSpecies.map((id) => spName(SPECIES_PREFS[id])).filter(Boolean).join(', '),
)
function distKm(spot: NearbySpot | Spot): number | null {
  return 'distKm' in spot ? spot.distKm : null
}
</script>

<template>
  <div class="finder">
    <div class="row between">
      <h1>{{ t('sf_finder_title') }}</h1>
      <button class="btn ghost sm" @click="router.push({ name: 'dashboard' })">{{ t('goto_dash') }}</button>
    </div>

    <div class="modes">
      <!-- Only set the mode — the mode watcher resets results and auto-runs
           lucky; re-clicking the active mode is then a harmless no-op. -->
      <button class="mode" :class="{ active: mode === 'lucky' }" @click="mode = 'lucky'">
        {{ t('sf_lucky_badge') }}<small>{{ t('sf_lucky_sub') }}</small>
      </button>
      <button class="mode" :class="{ active: mode === 'nearby' }" @click="mode = 'nearby'">
        {{ t('sf_nearby_badge') }}<small>{{ t('sf_nearby_sub') }}</small>
      </button>
    </div>

    <div class="targeting">
      🎯 {{ t('sf_targeting') }}
      <strong>{{ targetNames || t('sf_targeting_all') }}</strong>
      <button class="link" @click="router.push({ name: 'species' })">{{ t('sf_edit_species') }}</button>
    </div>

    <!-- Nearby: location picker -->
    <div v-if="mode === 'nearby'" class="card">
      <label>{{ t('sf_from_where') }}</label>
      <input v-model="query" :placeholder="t('sf_search_geo_ph')" @input="onGeoInput" />
      <div v-if="geoResults.length" class="results-list">
        <button v-for="r in geoResults" :key="r.lat + ',' + r.lon" class="result" @click="pickPoint(r)">
          📍 {{ r.name }}<span v-if="r.admin1">, {{ r.admin1 }}</span>
        </button>
      </div>
      <template v-if="setup.locations.length">
        <div class="muted sm" style="margin-top:8px">{{ t('sf_use_saved') }}</div>
        <div class="saved">
          <button v-for="l in setup.locations" :key="l.id" class="chip" @click="pickSaved(l)">📍 {{ l.name }}</button>
        </div>
      </template>
      <div class="radius">
        <label>{{ t('sf_radius') }}: <strong>{{ radius }} km</strong></label>
        <input type="range" min="10" max="120" step="5" v-model.number="radius" />
      </div>
    </div>

    <button class="btn primary lg search" :disabled="mode === 'nearby' && !point" @click="search">
      {{ t('sf_search_btn') }}
    </button>
    <p v-if="mode === 'nearby' && !point" class="muted sm center">{{ t('sf_pick_point') }}</p>

    <!-- Results -->
    <div v-if="searched" class="results">
      <p class="count">{{ results.length }} {{ t('sf_results_count') }}</p>
      <div v-for="(r, i) in results" :key="i" class="card result-card">
        <div class="rank">{{ medals[i] || (i + 1) + '.' }}</div>
        <div class="body">
          <div class="name">
            {{ r.spot.name }}
            <span v-if="distKm(r.spot) != null" class="dist">{{ distKm(r.spot) }} km</span>
          </div>
          <div class="meta">
            {{ (r.spot as Spot).region }} · {{ spotTypeIcon((r.spot as Spot).spotType) }} {{ (r.spot as Spot).spotType }}
            · {{ waterBadge((r.spot as Spot).waterType) }}
          </div>
          <div class="fac" v-if="(r.spot as Spot).facilities.parking || (r.spot as Spot).facilities.boatRamp || (r.spot as Spot).facilities.wheelchair">
            <span v-if="(r.spot as Spot).facilities.parking">🅿️</span>
            <span v-if="(r.spot as Spot).facilities.boatRamp">⛵</span>
            <span v-if="(r.spot as Spot).facilities.wheelchair">♿</span>
          </div>
          <div class="pills">
            <span v-for="(s, j) in activeSpeciesInMonth(r.spot as Spot, month).slice(0, 5)" :key="j" class="pill">
              {{ spName(s as any) }}
            </span>
          </div>
        </div>
        <div class="right">
          <div class="score" :class="scoreColor(r.score)">{{ r.score }}</div>
          <span v-if="isAdded(r.spot as Spot)" class="tag-added">{{ t('added') }}</span>
          <button v-else class="btn primary sm" @click="add(r.spot as Spot)">{{ t('add') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.row { display: flex; align-items: center; gap: 10px; } .row.between { justify-content: space-between; }
h1 { font-size: 1.3rem; }
.modes { display: flex; gap: 8px; margin: 14px 0; }
.mode { flex: 1; display: flex; flex-direction: column; gap: 2px; padding: 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text); cursor: pointer; font-weight: 600; }
.mode small { font-weight: 400; color: var(--muted); font-size: 0.72rem; }
.mode.active { border-color: var(--primary); background: rgba(56,189,248,.08); }
.targeting { font-size: 0.82rem; color: var(--muted); margin-bottom: 12px; }
.targeting strong { color: var(--cyan); }
.link { background: none; border: none; color: var(--primary); cursor: pointer; font-size: 0.78rem; margin-left: 8px; text-decoration: underline; }
label { font-size: 0.78rem; color: var(--muted); }
.results-list { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.result { text-align: left; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: none; color: var(--text); cursor: pointer; }
.result:hover { border-color: var(--primary); }
.saved { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.chip { padding: 4px 10px; border-radius: 12px; border: 1px solid var(--border); background: none; color: var(--text); cursor: pointer; font-size: 0.76rem; }
.radius { margin-top: 12px; }
.search { width: 100%; justify-content: center; margin-top: 14px; }
.center { text-align: center; margin-top: 8px; }
.count { color: var(--muted); font-size: 0.82rem; margin: 18px 0 8px; }
.result-card { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 10px; }
.rank { font-size: 1.2rem; min-width: 28px; }
.body { flex: 1; }
.name { font-weight: 700; }
.dist { color: var(--muted); font-weight: 400; font-size: 0.78rem; margin-left: 6px; }
.meta { font-size: 0.78rem; color: var(--muted); margin-top: 3px; }
.fac { margin-top: 4px; font-size: 0.85rem; }
.pills { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
.pill { background: rgba(56,189,248,.12); border: 1px solid var(--border); border-radius: 12px; padding: 2px 8px; font-size: 0.72rem; }
.right { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.score { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; }
.score-great { background: rgba(34,197,94,.2); color: var(--green); }
.score-good { background: rgba(56,189,248,.2); color: var(--primary); }
.score-avg { background: rgba(245,158,11,.2); color: var(--gold); }
.score-poor { background: rgba(239,68,68,.2); color: var(--red); }
.tag-added { color: var(--green); font-size: 0.7rem; }
.muted { color: var(--muted); } .sm { font-size: 0.78rem; }
</style>
