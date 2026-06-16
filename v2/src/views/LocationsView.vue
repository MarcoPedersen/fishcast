<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { lang, t } from '@/lib/i18n'
import { geocode, type GeoResult } from '@/lib/weather'
import { useSetupStore, uid } from '@/stores/setup'

const router = useRouter()
const setup = useSetupStore()

const query = ref('')
const results = ref<GeoResult[]>([])
let timer: ReturnType<typeof setTimeout> | undefined

function onInput() {
  clearTimeout(timer)
  if (!query.value.trim()) { results.value = []; return }
  timer = setTimeout(async () => {
    results.value = await geocode(query.value, lang.value)
  }, 350)
}

function add(r: GeoResult) {
  const name = r.admin1 ? `${r.name}, ${r.admin1}` : r.name
  if (!setup.locations.some((l) => l.lat === r.lat && l.lon === r.lon)) {
    setup.locations.push({ id: uid(), name, lat: r.lat, lon: r.lon })
  }
  query.value = ''
  results.value = []
}
function remove(id: string) {
  setup.locations = setup.locations.filter((l) => l.id !== id)
}
</script>

<template>
  <div class="wizard">
    <h1>{{ t('topbar_locations') }}</h1>

    <div class="card">
      <label>{{ t('search_loc_label') }}</label>
      <input v-model="query" :placeholder="t('loc_search_ph')" @input="onInput" />
      <div v-if="results.length" class="results">
        <button v-for="r in results" :key="r.lat + ',' + r.lon" class="result" @click="add(r)">
          📍 {{ r.name }}<span v-if="r.admin1">, {{ r.admin1 }}</span>
          <small>{{ r.country }}</small>
        </button>
      </div>
    </div>

    <button class="map-cta" @click="router.push({ name: 'map' })">
      <span class="map-cta-title">{{ t('loc_open_map') }}</span>
      <span class="map-cta-sub">{{ t('loc_open_map_sub') }}</span>
      <span class="map-cta-arrow">→</span>
    </button>

    <div v-for="l in setup.locations" :key="l.id" class="card row between">
      <span>📍 {{ l.name }}</span>
      <button class="btn ghost sm" @click="remove(l.id)">🗑</button>
    </div>
    <p v-if="!setup.locations.length" class="notice">{{ t('no_locations') }}</p>

    <div class="nav">
      <button class="btn ghost" @click="router.push({ name: 'availability' })">{{ t('back') }}</button>
      <button class="btn primary" :disabled="!setup.locations.length"
        @click="router.push({ name: 'species' })">{{ t('next') }}</button>
    </div>
  </div>
</template>

<style scoped>
.results { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.result { text-align: left; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: none; color: var(--text); cursor: pointer; }
.result:hover { border-color: var(--primary); }
.result small { color: var(--muted); margin-left: 8px; }
.map-cta {
  display: grid; grid-template-columns: 1fr auto; align-items: center;
  width: 100%; text-align: left; margin-top: 10px; padding: 14px 16px;
  border-radius: 12px; cursor: pointer; color: var(--text);
  background: rgba(56,189,248,.10); border: 1px solid rgba(56,189,248,.45);
}
.map-cta:hover { background: rgba(56,189,248,.16); border-color: var(--primary); }
.map-cta-title { font-weight: 700; font-size: 0.95rem; }
.map-cta-sub { grid-column: 1; font-size: 0.78rem; color: var(--muted); margin-top: 2px; }
.map-cta-arrow { grid-row: 1 / 3; grid-column: 2; font-size: 1.3rem; color: var(--primary); }
.row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.row.between { justify-content: space-between; }
.nav { display: flex; justify-content: space-between; margin-top: 24px; }
.notice { color: var(--muted); font-size: 0.82rem; margin-top: 12px; }
</style>
