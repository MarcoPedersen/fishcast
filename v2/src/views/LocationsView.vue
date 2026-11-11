<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import { lang, spName, t } from '@/lib/i18n'
import { SPECIES_PREFS } from '@/lib/species'
import { changeWaterType, countedSpeciesIds, hiddenSpeciesIds, pickableSpecies, selectedSpeciesIds, speciesEntry } from '@/lib/locationSpecies'
import { confirmDialog } from '@/lib/confirm'
import { showToast } from '@/lib/toast'
import { locationFromSearch, usePlaceSearch } from '@/lib/placeSearch'
import { speciesLookupFor } from '@/lib/geo'
import { renameLocation } from '@/lib/renameLocation'
import { clearWaterGuess, guessFollowsMap, markWaterGuessed, waterGuessed } from '@/lib/waterGuess'
import type { GeoResult } from '@/lib/weather'
import { useSetupStore, uid } from '@/stores/setup'
import { useCatchStore } from '@/stores/catches'
import { useCoastStore } from '@/stores/coast'
import { windDir } from '@/lib/conditions'
import { DIR_NAME_KEY, EXPOSURE_KEY, SPREAD_KEY, coastCheck, coastLine, dirIndex, lineFromMap, pickedCoast, type CoastLine } from '@/lib/coast'
import CoastPicker from '@/components/CoastPicker.vue'
import OsmCredit from '@/components/OsmCredit.vue'
import type { CoastOverride, Location, WaterType } from '@/lib/types'

const router = useRouter()
const setup = useSetupStore()
const catches = useCatchStore()
const coast = useCoastStore()

const renamingId = ref<string | null>(null)
// Rename edits a draft, committed on blur/Enter — it used to write every
// keystroke into the stored spot, so a cleared field saved a spot called "",
// and the catches logged under the old name lost their spot (lib/renameLocation).
const renameDraft = ref('')
function startRename(l: Location) {
  commitRename()
  renamingId.value = l.id
  renameDraft.value = l.name
}
function commitRename() {
  const id = renamingId.value
  renamingId.value = null // first: the blur that follows Enter finds nothing to commit
  // The name changes at once; the catches follow once the log is re-read.
  if (id) void renameLocation(id, renameDraft.value, setup, catches)
}
/** Escape: the old name stays. */
function cancelRename() { renamingId.value = null }
onBeforeUnmount(commitRename) // navigating away mid-edit still keeps the new name
const noteOpenId = ref<string | null>(null)
const speciesOpenId = ref<string | null>(null)
const coastOpenId = ref<string | null>(null)

// ── Coast direction (onshore spec §3.1) ──────────────────────────────
// The line shows the user's choice, else this device's automatic value; the
// score reads the same thing (stores/coast.ts shoreById). Directions use the
// wind's own abbreviations, so "vind fra V" and "kysten vender mod V" compare
// at a glance; screen readers get the long names.
const lineOf = (l: Location): CoastLine | null => coastLine(l, coast.autoFor(l), coast.statusFor(l))
/** Who set what the line shows: the user, or this device's automatic value; null while there is nothing to show. */
const srcOf = (c: CoastLine) => ('src' in c ? c.src : null)
/** A card shows a value derived from OpenStreetMap data: the page credits it, with its licence (review C1). */
const showsMapData = computed(() => setup.locations.some((l) => lineFromMap(lineOf(l))))
const dirShort = (deg: number) => windDir(deg, lang.value === 'en')
const dirLong = (deg: number) => t(DIR_NAME_KEY[dirIndex(deg)])
const fill = (s: string, params: Record<string, string | number>) =>
  Object.entries(params).reduce((out, [k, v]) => out.replace(`{${k}}`, String(v)), s)
function lineText(c: CoastLine, long = false): string {
  switch (c.kind) {
    case 'coast': return `${fill(t(SPREAD_KEY[c.spread]), { dir: long ? dirLong(c.dir) : dirShort(c.dir) })} · ${t(EXPOSURE_KEY[c.exposure])}`
    case 'off': return t('coast_off')
    case 'pending': return t('coast_pending')
    case 'failed': return t('coast_failed')
    case 'nowater': return t('coast_nowater')
    case 'inland': return t('coast_inland')
    case 'enclosed': return t('coast_enclosed')
    case 'gap': return t('coast_gap')
    default: return t('coast_unknown')
  }
}
/**
 * The one check the card asks, if any — only while the coast is automatic
 * (coastCheck): 'gap' is answered with a pick (critique R8.2), 'far' with
 * "Ser rigtigt ud" on this device only, 'inland' with the picker or the
 * water type.
 */
const checkOf = (l: Location) => coastCheck(l, coast.autoFor(l))
/** "Mod {dir}" on the gap prompt: the user's own answer, so a manual coast — not the distrusted entry's shape (pickedCoast). */
function fishToward(l: Location, deg: number) {
  l.coast = pickedCoast(deg, coast.autoFor(l))
}
/** The picker's choice: an edit of the location, so the store watcher saves and syncs it. */
function setCoast(l: Location, v: CoastOverride | 'none' | undefined) {
  if (v === undefined) {
    delete l.coast
    if (!coast.autoFor(l)) coast.retry(l)
  } else l.coast = v
}

// Species are edited straight onto the location, like water type — no draft to
// save, and the store watcher syncs it.
function toggleSpecies(l: Location, id: string) {
  // Its open months follow the location's water: a coastal sea trout keeps
  // the winter, a river one doesn't (locationSpecies.ts openMonths).
  const entry = speciesEntry(id, l.waterType)
  if (!entry) return
  const cur = l.species ?? []
  const key = entry.nameEn.toLowerCase()
  const has = cur.some((sp) => sp.nameEn?.toLowerCase() === key)
  l.species = has
    ? cur.filter((sp) => sp.nameEn?.toLowerCase() !== key)
    : [...cur, entry]
}
function isPicked(l: Location, id: string): boolean {
  return selectedSpeciesIds(l.species).includes(id)
}
/** What the score uses: species the app knows that fit the spot's water type (countedSpeciesIds). */
function speciesCount(l: Location): number {
  return countedSpeciesIds(l.species, l.waterType).length
}

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
// from "still typing" or "offline". Track the search so the UI can say which;
// the request ordering (a stale answer must not win) lives in lib/placeSearch.
const {
  query, results, busy: geoBusy, searched: geoSearched, failed: geoFailed, onInput, reset: resetSearch,
} = usePlaceSearch()
async function add(r: GeoResult) {
  resetSearch() // also drops a search still pending from the last keystroke
  if (setup.locations.some((l) => l.lat === r.lat && l.lon === r.lon)) return
  const id = uid()
  // Water and bottom type inferred as the map does for a tapped pin — a
  // guess, and the card says so until the user picks a type.
  setup.locations.push({ id, ...locationFromSearch(r) })
  markWaterGuessed(id)
  // Give the automatic lookup its chance first, then ask only if it came up
  // empty — no point prompting for a spot we already know the species for.
  await setup.enrichMissingSpecies()
  const added = setup.locations.find((l) => l.id === id)
  if (added && !speciesCount(added)) speciesOpenId.value = id
}
// 🗑 sits next to ✎ and 📝 in a dense list and takes species + notes with it,
// so it asks first — the far milder "reset choices" already did.
async function remove(id: string) {
  if (!(await confirmDialog(t('loc_remove_confirm')))) return
  setup.locations = setup.locations.filter((l) => l.id !== id)
}
function toggleFav(l: Location) { l.fav = !l.fav }
/**
 * The user's own pick of water type: no longer a guess. Or the map's, for a
 * guess the coast lookup contradicts (guessFollowsMap): still a guess, and a
 * toast says so. Species that don't fit the new water go with it, named in
 * a toast that can undo the change: left on, the picker hid them while they
 * still counted. Species picked by hand take the open months of the new
 * water (changeWaterType), quietly: a river's sea trout is closed in December.
 * A custom spot whose species are none, or still the lookup's for the old
 * water, takes the lookup's for the new one: a lake pin guessed brackish had
 * none, since a sea spot takes no lake's species. The toast names all it took
 * off, as not listed nearby for that water (`relooked`). An official spot's
 * are its own, saved from the map without a slug too (speciesLookupFor).
 */
function setWater(l: Location, w: WaterType, by: 'user' | 'map' = 'user') {
  const before = { waterType: l.waterType, species: l.species }
  l.waterType = w
  if (by === 'user') clearWaterGuess(l.id)
  const { species, dropped, relooked } = changeWaterType(l.species, w, before.waterType, speciesLookupFor(l))
  if (species !== l.species) l.species = species
  // Built when read: the toast stays until it is used or closed, and a
  // language switch meanwhile re-renders it (lib/toast).
  const said = () => {
    const names = dropped.map((id) => spName(SPECIES_PREFS[id])).join(', ')
    return [
      by === 'map' ? fill(t('wt_map_fresh'), { name: l.name }) : '',
      dropped.length ? fill(t(relooked ? 'loc_species_dropped_nearby' : 'loc_species_dropped'), { names }) : '',
    ].filter(Boolean).join(' ')
  }
  if (!said()) return
  // Undone, the map's answer gets the user's "no": the guess goes with it, so it can't follow again.
  showToast(said, {
    action: { label: () => t('undo'), run: () => { Object.assign(l, before); clearWaterGuess(l.id) } },
  })
}
// A guessed salt or brackish spot turns fresh once the coast lookup finds a
// lake or river there and no sea: a pin in mid-Arresø is guessed brackish.
watchEffect(() => {
  for (const l of setup.locations) if (guessFollowsMap(l, coast.autoFor(l))) setWater(l, 'fresh', 'map')
})
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
      <p v-else-if="geoFailed" class="geo-state" role="status">{{ t('geo_failed') }}</p>
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
        <input v-if="renamingId === l.id" v-model="renameDraft" class="rename" :aria-label="t('rename')" @blur="commitRename"
          @keyup.enter="commitRename" @keydown.esc="cancelRename" />
        <span v-else class="loc-name">📍 {{ l.name }}</span>
        <div class="loc-acts">
          <!-- While renaming, mousedown would blur the field first (committing it),
               so the click then found nothing open and re-opened the editor. -->
          <button class="btn ghost sm" :title="t('rename')" :aria-label="t('rename')"
            @mousedown="renamingId === l.id && $event.preventDefault()"
            @click="renamingId === l.id ? commitRename() : startRename(l)">✎</button>
          <button class="btn ghost sm" :class="{ on: noteOpenId === l.id }" :title="t('note_label')" :aria-label="t('note_label')"
            @click="noteOpenId = noteOpenId === l.id ? null : l.id">📝</button>
          <button class="btn ghost sm" :class="{ on: speciesOpenId === l.id }"
            :title="t('loc_species')" :aria-label="t('loc_species')"
            @click="speciesOpenId = speciesOpenId === l.id ? null : l.id">🐟</button>
          <button class="btn ghost sm" :title="t('loc_remove')" :aria-label="t('loc_remove')" @click="remove(l.id)">🗑</button>
        </div>
      </div>

      <div class="wt-row">
        <span class="wt-label">{{ t('pin_wt') }}:</span>
        <button v-for="w in waterTypes" :key="w" class="wt" :class="{ on: (l.waterType || 'brackish') === w }"
          @click="setWater(l, w)">{{ wtLabel(w) }}</button>
        <span v-if="waterGuessed(l.id)" class="wt-guess">{{ t('wt_guessed') }}</span>
      </div>

      <!-- Which way the coast faces (fresh water: none). The words are the
           line; the long direction names go to screen readers. -->
      <template v-if="lineOf(l)">
        <div class="coast-row">
          <span class="coast-text">
            <span aria-hidden="true">🧭 {{ lineText(lineOf(l)!) }}</span>
            <span class="sr-only">{{ lineText(lineOf(l)!, true) }}</span>
            <em v-if="srcOf(lineOf(l)!)" class="coast-src">
              · {{ t(srcOf(lineOf(l)!) === 'auto' ? 'coast_src_auto' : 'coast_src_manual') }}</em>
          </span>
          <button v-if="lineOf(l)!.kind === 'failed'" class="linkbtn" @click="coast.retry(l)">{{ t('coast_retry') }}</button>
          <button class="linkbtn" :aria-expanded="coastOpenId === l.id"
            @click="coastOpenId = coastOpenId === l.id ? null : l.id">
            {{ t(srcOf(lineOf(l)!) ? 'coast_edit' : 'coast_choose') }}
          </button>
        </div>
        <p v-if="checkOf(l) && coastOpenId !== l.id" class="coast-check">
          <template v-if="checkOf(l)!.kind === 'gap'">
            {{ fill(t('coast_check_gap'), { a: dirShort(checkOf(l)!.auto.nearFacing ?? 0), b: dirShort(checkOf(l)!.auto.facing ?? 0) }) }}
            <button class="linkbtn" @click="fishToward(l, checkOf(l)!.auto.nearFacing ?? 0)">{{ fill(t('coast_toward'), { dir: dirShort(checkOf(l)!.auto.nearFacing ?? 0) }) }}</button>
            <button class="linkbtn" @click="fishToward(l, checkOf(l)!.auto.facing ?? 0)">{{ fill(t('coast_toward'), { dir: dirShort(checkOf(l)!.auto.facing ?? 0) }) }}</button>
          </template>
          <!-- A question with answers that act: salt or brackish opens the
               picker (the spot is unscored until a direction is picked),
               fresh sets the water type. A "Ser rigtigt ud" here hid the
               prompt and changed nothing. -->
          <template v-else-if="checkOf(l)!.kind === 'inland'">
            {{ t('coast_check_inland') }}
            <button class="linkbtn" @click="coastOpenId = l.id">{{ t('coast_inland_salt') }}</button>
            <button class="linkbtn" @click="setWater(l, 'fresh')">{{ t('coast_inland_fresh') }}</button>
          </template>
          <template v-else>
            {{ fill(t('coast_check_far'), { n: Math.round(checkOf(l)!.auto.pinToWaterM ?? 0) }) }}
            <button class="linkbtn" @click="coast.confirm(l)">{{ t('coast_ok') }}</button>
          </template>
          <button v-if="checkOf(l)!.kind !== 'inland'" class="linkbtn" @click="coastOpenId = l.id">{{ t('coast_edit') }}</button>
        </p>
        <CoastPicker v-if="coastOpenId === l.id" :loc="l" :auto="coast.autoFor(l)" :status="coast.statusFor(l)"
          @set="setCoast(l, $event)" @retry="coast.retry(l)" @close="coastOpenId = null" />
      </template>

      <!-- Species picker. Water type filters the list, so a freshwater spot
           doesn't offer cod. Months come from each species' known season. -->
      <div v-if="speciesOpenId === l.id" class="sp-pick">
        <p class="sp-pick-hint">{{ t('loc_species_hint') }}</p>
        <div class="sp-pick-list">
          <button v-for="c in pickableSpecies(l.waterType)" :key="c.id" class="sp-chip"
            :class="{ on: isPicked(l, c.id) }" @click="toggleSpecies(l, c.id)">
            {{ SPECIES_PREFS[c.id]?.emoji }} {{ spName(SPECIES_PREFS[c.id]) }}
          </button>
        </div>
        <!-- Selected but hidden above: a setup from before a change of water
             type dropped them. Neither counted on the card nor scored, but
             kept as saved: shown, and removable. -->
        <template v-if="hiddenSpeciesIds(l.species, l.waterType).length">
          <p class="sp-pick-hint sp-unfit-hint">{{ t('loc_species_unfit') }}</p>
          <div class="sp-pick-list">
            <button v-for="id in hiddenSpeciesIds(l.species, l.waterType)" :key="id" class="sp-chip unfit" @click="toggleSpecies(l, id)">
              {{ SPECIES_PREFS[id]?.emoji }} {{ spName(SPECIES_PREFS[id]) }} ✕
            </button>
          </div>
        </template>
      </div>
      <!-- Persistent, not a one-shot prompt: this also surfaces the older spots
           that were added before the lookup existed, and those whose species
           all count for nothing (unknown to the app, or hidden by the water type). -->
      <p v-else-if="!speciesCount(l)" class="sp-missing">
        🐟 {{ t('loc_species_unknown') }}
        <button class="linkbtn" @click="speciesOpenId = l.id">{{ t('loc_species_add') }}</button>
      </p>
      <!-- "1 arter valgt" read wrong; Danish needs the singular. -->
      <p v-else class="sp-have">🐟 {{ speciesCount(l) }} {{ t(speciesCount(l) === 1 ? 'loc_species_count_one' : 'loc_species_count') }}</p>

      <textarea v-if="noteOpenId === l.id" v-model="l.note" class="note" :placeholder="t('note_placeholder')" rows="2" />
      <p v-else-if="l.note" class="note-preview">📝 {{ l.note }}</p>
    </div>

    <p v-if="showsMapData" class="osm-line"><OsmCredit :text="t('coast_osm_list')" /></p>

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
.sp-missing { font-size: 0.76rem; color: var(--gold); margin: 8px 0 0; }
.coast-row { display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 6px; margin-top: 8px; font-size: 0.76rem; color: var(--muted); }
.coast-text { min-width: 0; }
.coast-src { font-style: normal; opacity: 0.8; }
.coast-row .linkbtn { margin-left: 0; }
.coast-check { font-size: 0.76rem; color: var(--gold); margin: 6px 0 0; }
.coast-check .linkbtn { margin-left: 8px; }
.osm-line { font-size: 0.66rem; color: var(--muted); margin: 10px 4px 0; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.sp-have { font-size: 0.74rem; color: var(--muted); margin: 8px 0 0; }
.linkbtn { background: none; border: none; padding: 0; font: inherit; color: var(--primary); cursor: pointer; margin-left: 6px; text-decoration: underline; }
.sp-pick { margin-top: 8px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: rgba(56,189,248,.06); }
.sp-pick-hint { font-size: 0.74rem; color: var(--muted); margin: 0 0 8px; }
.sp-pick-list { display: flex; flex-wrap: wrap; gap: 6px; }
.sp-chip { font-size: 0.74rem; padding: 4px 9px; border-radius: 10px; border: 1px solid var(--border); background: none; color: var(--muted); cursor: pointer; }
.sp-chip:hover { border-color: var(--primary); }
.sp-chip.on { border-color: var(--green); color: var(--green); background: rgba(34,197,94,.1); font-weight: 600; }
.sp-unfit-hint { margin-top: 10px; color: var(--gold); }
.sp-chip.unfit { border-color: var(--gold); color: var(--gold); }
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
.loc-acts { display: flex; gap: 6px; margin-left: auto; }
.rename { flex: 1; padding: 4px 8px; }
.star { background: none; border: none; cursor: pointer; font-size: 1.1rem; color: var(--muted); }
.star.on { color: var(--gold); }
.btn.on { border-color: var(--primary); color: var(--primary); }
.wt-row { display: flex; align-items: center; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.wt-label { font-size: 0.76rem; color: var(--muted); }
.wt { font-size: 0.74rem; padding: 3px 9px; border-radius: 10px; border: 1px solid var(--border); background: none; color: var(--muted); cursor: pointer; }
.wt.on { border-color: var(--primary); color: var(--primary); font-weight: 600; }
/* ~22 px tall: too small for a finger. Touch screens only; still a pill. */
@media (pointer: coarse) { .wt { min-height: 32px; border-radius: 16px; } }
.wt-guess { font-size: 0.72rem; color: var(--gold); }
.note { width: 100%; margin-top: 8px; resize: vertical; }
.note-preview { margin-top: 8px; font-size: 0.78rem; color: var(--muted); }
.nav { display: flex; justify-content: space-between; margin-top: 24px; }
.empty {
  display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px;
  margin-top: 16px; padding: 28px 18px; border-radius: 12px;
  border: 1px dashed var(--border); color: var(--muted);
}
.empty-icon { font-size: 2rem; opacity: 0.7; margin-bottom: 4px; }
.empty strong { color: var(--text); font-size: 0.95rem; }
.empty-sub { font-size: 0.8rem; max-width: 280px; }

@media (max-width: 640px) {
  /* A long spot name and four icon buttons can't share one line at phone
     width. "Slæbestedet" lost the fight and broke into three
     lines with the 📍 orphaned above it, so give the name the whole
     first row and drop the actions underneath. */
  .loc-top { flex-wrap: wrap; }
  .loc-acts { flex: 1 0 100%; margin-left: 0; justify-content: flex-end; }
}
</style>
