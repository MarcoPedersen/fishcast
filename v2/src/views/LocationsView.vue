<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { lang, t } from '@/lib/i18n'
import { geocode, type GeoResult } from '@/lib/weather'
import { useSetupStore, uid } from '@/stores/setup'
import type { Location, WaterType } from '@/lib/types'

const router = useRouter()
const setup = useSetupStore()

const query = ref('')
const results = ref<GeoResult[]>([])
let timer: ReturnType<typeof setTimeout> | undefined

const renamingId = ref<string | null>(null)
const noteOpenId = ref<string | null>(null)

// Favourites first, otherwise insertion order
const sorted = computed(() =>
  [...setup.locations].sort((a, b) => Number(!!b.fav) - Number(!!a.fav)),
)

function onInput() {
  clearTimeout(timer)
  if (!query.value.trim()) { results.value = []; return }
  timer = setTimeout(async () => { results.value = await geocode(query.value, lang.value) }, 350)
}
function add(r: GeoResult) {
  const name = r.admin1 ? `${r.name}, ${r.admin1}` : r.name
  if (!setup.locations.some((l) => l.lat === r.lat && l.lon === r.lon)) {
    setup.locations.push({ id: uid(), name, lat: r.lat, lon: r.lon })
  }
  query.value = ''
  results.value = []
}
function remove(id: string) { setup.locations = setup.locations.filter((l) => l.id !== id) }
function toggleFav(l: Location) { l.fav = !l.fav }
const waterTypes: WaterType[] = ['salt', 'brackish', 'fresh']
function wtLabel(w: WaterType) {
  return w === 'fresh' ? t('wt_fresh_label') : w === 'salt' ? t('wt_salt_label') : t('wt_brackish_label')
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

    <div v-for="l in sorted" :key="l.id" class="card loc">
      <div class="loc-top">
        <button class="star" :class="{ on: l.fav }" :title="t(l.fav ? 'fav_remove' : 'fav_add')"
          :aria-label="t(l.fav ? 'fav_remove' : 'fav_add')" @click="toggleFav(l)">
          {{ l.fav ? '★' : '☆' }}
        </button>
        <input v-if="renamingId === l.id" v-model="l.name" class="rename" :aria-label="t('rename')" @blur="renamingId = null"
          @keyup.enter="renamingId = null" />
        <span v-else class="loc-name">📍 {{ l.name }}</span>
        <button class="btn ghost sm" :title="t('rename')" :aria-label="t('rename')" @click="renamingId = renamingId === l.id ? null : l.id">✎</button>
        <button class="btn ghost sm" :class="{ on: noteOpenId === l.id }" :title="t('note_label')" :aria-label="t('note_label')"
          @click="noteOpenId = noteOpenId === l.id ? null : l.id">📝</button>
        <button class="btn ghost sm" :title="t('loc_remove')" :aria-label="t('loc_remove')" @click="remove(l.id)">🗑</button>
      </div>

      <div class="wt-row">
        <span class="wt-label">{{ t('pin_wt') }}:</span>
        <button v-for="w in waterTypes" :key="w" class="wt" :class="{ on: (l.waterType || 'brackish') === w }"
          @click="l.waterType = w">{{ wtLabel(w) }}</button>
      </div>

      <textarea v-if="noteOpenId === l.id" v-model="l.note" class="note" :placeholder="t('note_placeholder')" rows="2" />
      <p v-else-if="l.note" class="note-preview">📝 {{ l.note }}</p>
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
.loc { margin-top: 8px; }
.loc-top { display: flex; align-items: center; gap: 6px; }
.loc-name { flex: 1; font-weight: 600; }
.rename { flex: 1; padding: 4px 8px; }
.star { background: none; border: none; cursor: pointer; font-size: 1.1rem; color: var(--muted); }
.star.on { color: var(--gold); }
.btn.on { border-color: var(--primary); color: var(--primary); }
.wt-row { display: flex; align-items: center; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.wt-label { font-size: 0.76rem; color: var(--muted); }
.wt { font-size: 0.74rem; padding: 3px 9px; border-radius: 10px; border: 1px solid var(--border); background: none; color: var(--muted); cursor: pointer; }
.wt.on { border-color: var(--primary); color: var(--primary); font-weight: 600; }
.note { width: 100%; margin-top: 8px; resize: vertical; }
.note-preview { margin-top: 8px; font-size: 0.78rem; color: var(--muted); }
.nav { display: flex; justify-content: space-between; margin-top: 24px; }
.notice { color: var(--muted); font-size: 0.82rem; margin-top: 12px; }
</style>
