<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { lang, t } from '@/lib/i18n'
import { confirmDialog } from '@/lib/confirm'
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

// Manual ordering: drag a card (or use ↑/↓) to reorder. The array order is the
// source of truth — saved + synced via the store watcher. The ★ is now just a
// visual marker, no longer an auto-sort.
const dragIndex = ref<number | null>(null)
const overIndex = ref<number | null>(null)

function move(from: number, to: number) {
  const arr = setup.locations
  if (from === to || to < 0 || to >= arr.length) return
  const [item] = arr.splice(from, 1)
  arr.splice(to, 0, item)
}
function onDragStart(i: number, e: DragEvent) {
  dragIndex.value = i
  // Firefox refuses to start an HTML5 drag unless some data is set.
  e.dataTransfer?.setData('text/plain', String(i))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onDragOver(i: number) { overIndex.value = i }
function onDrop(i: number) {
  if (dragIndex.value !== null) move(dragIndex.value, i)
  dragIndex.value = null
  overIndex.value = null
}
function onDragEnd() { dragIndex.value = null; overIndex.value = null }

// An unresolvable query used to produce no feedback at all — indistinguishable
// from "still typing" or "offline". Track the search so the UI can say which.
const geoBusy = ref(false)
const geoSearched = ref(false)
function onInput() {
  clearTimeout(timer)
  geoSearched.value = false
  if (!query.value.trim()) { results.value = []; geoBusy.value = false; return }
  geoBusy.value = true
  timer = setTimeout(async () => {
    try {
      results.value = await geocode(query.value, lang.value)
    } finally {
      geoBusy.value = false
      geoSearched.value = true
    }
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
// 🗑 sits next to ✎ and 📝 in a dense list and takes species + notes with it,
// so it asks first — the far milder "reset choices" already did.
async function remove(id: string) {
  if (!(await confirmDialog(t('loc_remove_confirm')))) return
  setup.locations = setup.locations.filter((l) => l.id !== id)
}
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
      <input v-model="query" type="search" autocomplete="off" enterkeyhint="search"
          :placeholder="t('loc_search_ph')" @input="onInput" />
      <div v-if="results.length" class="results">
        <button v-for="r in results" :key="r.lat + ',' + r.lon" class="result" @click="add(r)">
          📍 {{ r.name }}<span v-if="r.admin1">, {{ r.admin1 }}</span>
          <small>{{ r.country }}</small>
        </button>
      </div>
      <p v-else-if="geoBusy" class="geo-state" role="status">{{ t('geo_searching') }}</p>
      <p v-else-if="geoSearched" class="geo-state">{{ t('geo_no_results') }}</p>
    </div>

    <button class="map-cta" @click="router.push({ name: 'map' })">
      <span class="map-cta-title">{{ t('loc_open_map') }}</span>
      <span class="map-cta-sub">{{ t('loc_open_map_sub') }}</span>
      <span class="map-cta-arrow">→</span>
    </button>

    <div v-for="(l, i) in setup.locations" :key="l.id" class="card loc"
      :class="{ dragging: dragIndex === i, dragover: overIndex === i && dragIndex !== i }"
      @dragover.prevent="onDragOver(i)" @drop.prevent="onDrop(i)">
      <div class="loc-top">
        <span class="handle" draggable="true" :title="t('drag_handle')" :aria-label="t('drag_handle')"
          @dragstart="onDragStart(i, $event)" @dragend="onDragEnd">⠿</span>
        <div class="movers" v-if="setup.locations.length > 1">
          <button class="mv" :disabled="i === 0" :title="t('move_up')" :aria-label="t('move_up')" @click="move(i, i - 1)">▲</button>
          <button class="mv" :disabled="i === setup.locations.length - 1" :title="t('move_down')" :aria-label="t('move_down')" @click="move(i, i + 1)">▼</button>
        </div>
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

    <div v-if="!setup.locations.length" class="empty">
      <div class="empty-icon">🗺️</div>
      <strong>{{ t('loc_empty_title') }}</strong>
      <span class="empty-sub">{{ t('loc_empty_sub') }}</span>
    </div>

    <div class="nav">
      <button class="btn ghost" @click="router.push({ name: 'availability' })">{{ t('back') }}</button>
      <button class="btn primary" :disabled="!setup.locations.length"
        @click="router.push({ name: 'species' })">{{ t('next') }}</button>
    </div>
  </div>
</template>

<style scoped>
.geo-state { font-size: 0.78rem; color: var(--muted); margin: 8px 0 0; }
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
.loc { margin-top: 8px; transition: border-color .12s, opacity .12s, transform .12s; }
.loc.dragging { opacity: 0.5; }
.loc.dragover { border-color: var(--primary); transform: translateY(2px); }
.loc-top { display: flex; align-items: center; gap: 6px; }
.handle { cursor: grab; color: var(--muted); font-size: 1.1rem; line-height: 1; padding: 0 2px; user-select: none; }
.handle:active { cursor: grabbing; }
.movers { display: flex; flex-direction: column; gap: 1px; }
.mv { background: none; border: none; color: var(--muted); cursor: pointer; font-size: 0.6rem; line-height: 1; padding: 1px 2px; }
.mv:hover:not(:disabled) { color: var(--primary); }
.mv:disabled { opacity: 0.3; cursor: default; }
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
.empty {
  display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px;
  margin-top: 16px; padding: 28px 18px; border-radius: 12px;
  border: 1px dashed var(--border); color: var(--muted);
}
.empty-icon { font-size: 2rem; opacity: 0.7; margin-bottom: 4px; }
.empty strong { color: var(--text); font-size: 0.95rem; }
.empty-sub { font-size: 0.8rem; max-width: 280px; }
</style>
