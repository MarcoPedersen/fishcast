<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import { shownLang, spName, t } from '@/lib/i18n'
import { SPECIES_PREFS } from '@/lib/species'
import { changeWaterType, countedSpeciesIds, hiddenSpeciesIds, pickableSpecies, selectedSpeciesIds, speciesEntry } from '@/lib/locationSpecies'
import { confirmDialog } from '@/lib/confirm'
import { showToast } from '@/lib/toast'
import { addStep, undoStep } from '@/lib/undoHistory'
import { locationFromSearch, municipalityShown, usePlaceSearch } from '@/lib/placeSearch'
import { bottomLookupFor, speciesBackFor, speciesLookupFor } from '@/lib/geo'
import { renameLocation } from '@/lib/renameLocation'
import {
  bottomGuessed, bottomPicked, clearBottomGuess, clearWaterGuess, guessFollowsMap, markBottomGuessed, markWaterGuessed,
  restoreWaterGuess, setBottomPicked, waterGuessed, waterGuessOf,
} from '@/lib/waterGuess'
import { BOTTOM_TYPES, CATALOGUE_MATCH_KM, movedSpotAt, type Spot } from '@/lib/spots'
import { haversine } from '@/lib/math'
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
// Enter saves as it comes up, but only a press that began in the field.
// Enter on ✎ opens the field as the key goes down; the field takes focus,
// so that key's release lands in it, and it shut the field as it opened.
const enterInField = ref(false)
function startRename(l: Location) {
  commitRename()
  enterInField.value = false
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
/**
 * The field takes focus as it opens, its name selected, so typing replaces
 * it: ✎ showed the field, but on a phone the keyboard came up only at a
 * second tap, on the field itself. Placed after v-model on the element:
 * v-model fills in the name as the field mounts, and before it there would
 * be nothing to select.
 */
const vFocusSelect = { mounted: (el: HTMLInputElement) => { el.focus(); el.select() } }
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
const dirShort = (deg: number) => windDir(deg, shownLang.value === 'en')
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

/**
 * What "Hent arter" puts back on each list the user emptied, by spot id
 * (geo.ts speciesBackFor). Only an empty list: one never filled is the
 * refill's (stores/setup.ts enrichMissingSpecies). A water type change that
 * takes off every species picked by hand empties the list too, and the line
 * then offers the lookup for the new water.
 */
const speciesBack = computed(() => new Map(setup.locations
  .filter((l) => Array.isArray(l.species) && !l.species.length)
  .map((l) => [l.id, speciesBackFor(l)] as const)))
/**
 * An emptied list gets the species back in one tap: the nearby spots', or
 * an official spot's own. Picking them one by one was the only way back.
 * The tap is a step in the spot's undo history, as a change of water type
 * is (lib/undoHistory), and the spot's one toast names what it put on. Its
 * Fortryd takes off what the tap put on and nothing else, so the list is
 * empty again, not missing, and the refill leaves it; a species picked
 * since stays. Then the toast of the spot's step before it comes back: the
 * change of water type that emptied the list can still put back the cod
 * picked by hand. A toast of its own was a fourth with three standing, and
 * pushed off the oldest, the spot's own water-type toast among them, and
 * the spot's history with it.
 */
function fetchSpecies(l: Location) {
  const back = speciesBack.value.get(l.id)
  if (!back) return
  l.species = back.species
  const ids = countedSpeciesIds(back.species, l.waterType)
  const put = new Set(back.species.map((sp) => sp.nameEn.toLowerCase()))
  const names = () => ids.map((id) => spName(SPECIES_PREFS[id])).join(', ')
  // The spot's name as the list holds it now: a sync puts fresh copies there,
  // and a rename from another tab came with them (as setWater's toasts).
  const nameNow = () => setup.locations.find((x) => x.id === l.id)?.name ?? l.name
  const said = () => `${nameNow()}: ${fill(t('loc_species_added'), { names: names() })}`
  addStep(`water:${l.id}`, {
    said,
    undo: () => {
      // The spot as the list holds it now (as setWater's Fortryd). Deleted
      // there, nothing is left to undo.
      const cur = setup.locations.find((x) => x.id === l.id)
      if (!cur) return false
      if (cur.species) cur.species = cur.species.filter((sp) => !put.has(sp.nameEn?.toLowerCase()))
      return true
    },
  })
  showStep(l.id, said)
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
  // Water and bottom type inferred as the map does for a tapped pin — guesses,
  // and the card says so beside each until the user picks one.
  setup.locations.push({ id, ...locationFromSearch(r) })
  markWaterGuessed(id)
  markBottomGuessed(id)
  // Give the automatic lookup its chance first, then ask only if it came up
  // empty — no point prompting for a spot we already know the species for.
  await setup.enrichMissingSpecies()
  const added = setup.locations.find((l) => l.id === id)
  if (added && !speciesCount(added)) speciesOpenId.value = id
}
// 🗑 sits next to ✎ and 📝 in a dense list and takes species + notes with it,
// so it asks first — the far milder "reset choices" already did. Its toasts
// go with it: the store takes down those of any spot that leaves the list
// (stores/setup), as their Fortryd would read as undoing the delete.
// The question names the spot: "denne lokation" left it to the user to recall which 🗑 they tapped.
async function remove(id: string) {
  const name = setup.locations.find((l) => l.id === id)?.name ?? ''
  if (!(await confirmDialog(fill(t('loc_remove_confirm'), { name })))) return
  setup.locations = setup.locations.filter((l) => l.id !== id)
}
function toggleFav(l: Location) { l.fav = !l.fav }
/**
 * The lookup a change of water type runs for the spot's species
 * (changeWaterType). A list never filled is filled as the refill fills one
 * (stores/setup.ts enrichMissingSpecies, geo.ts speciesBackFor): a copy of
 * an official spot with its own species that live in the new water, a
 * custom spot with what the official spots nearby give it, and none at all
 * when not one of them counts. With the custom spots' lookup alone, a copy
 * of Grærup Strand saved as Ferskvand, which the refill could not fill,
 * kept none when set to Saltvand, though its own are four flatfish. A list
 * filled or emptied is judged as before (speciesLookupFor): an official
 * spot's are its own, so an official spot's emptied list stays empty.
 */
function speciesLookupOf(l: Location) {
  if (l.species !== undefined) return speciesLookupFor(l)
  return (waterType: WaterType | undefined) =>
    speciesBackFor({ lat: l.lat, lon: l.lon, spotSlug: l.spotSlug, waterType })?.species ?? []
}
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
 * off, as not listed nearby for that water (`relooked`), and the species the
 * app knows it put on: a change that only puts species on gets its toast,
 * and its undo, too. An official spot's are its own, saved from the map
 * without a slug too (speciesLookupFor). A list never filled is filled as
 * the refill fills it (speciesLookupOf).
 * A custom spot's bottom type that is still the guess for the old water
 * becomes the guess for the new (bottomLookupFor): the map's turn to fresh
 * left a lake pin with the sea's stone and its slip warning. One the user
 * picked (setBottom) stays, the guess itself too (a tap on the active pill),
 * for this visit (waterGuess.ts bottomPicked).
 * Undone, the card is as it was, its guess too: a type that was a guess is
 * marked as one again, and one the user had picked stays theirs. The same
 * for the bottom type: a guess put back is shown as one, even if the user
 * picked a bottom type while the toast was up. Fortryd steps back one change
 * at a time, newest first, each with its own toast (lib/undoHistory). A
 * "Hent arter" is a step in the same history (fetchSpecies).
 */
function setWater(l: Location, w: WaterType, by: 'user' | 'map' = 'user') {
  const before = { waterType: l.waterType, species: l.species, bottomType: l.bottomType }
  const bottomGuessBefore = bottomGuessed(l.id)
  const bottomPickedBefore = bottomPicked(l.id)
  const guessBefore = waterGuessOf(l.id)
  l.waterType = w
  if (by === 'user') clearWaterGuess(l.id)
  const bottom = bottomLookupFor(l)
  if (bottom && !bottomPickedBefore && l.bottomType === bottom(before.waterType)) l.bottomType = bottom(w)
  const { species, dropped, added = [], relooked } = changeWaterType(l.species, w, before.waterType, speciesLookupOf(l))
  if (species !== l.species) l.species = species
  // Built when read: the toast stays until it is used or closed, and a
  // language switch meanwhile re-renders it (lib/toast).
  // The species sentences name no spot, and each spot keeps a toast of its
  // own: two can read the same, so the toast leads with the spot's name. The
  // map's turn to fresh names it in its own sentence. By the name the list
  // shows now: a sync puts a fresh copy in its place, renamed there maybe.
  const name = () => setup.locations.find((x) => x.id === l.id)?.name ?? l.name
  const sentences = () => {
    const names = dropped.map((id) => spName(SPECIES_PREFS[id])).join(', ')
    return [
      by === 'map' ? fill(t('wt_map_fresh'), { name: name() }) : '',
      dropped.length ? fill(t(relooked ? 'loc_species_dropped_nearby' : 'loc_species_dropped'), { names }) : '',
      added.length ? fill(t('loc_species_added'), { names: added.map((id) => spName(SPECIES_PREFS[id])).join(', ') }) : '',
    ].filter(Boolean).join(' ')
  }
  // A change with nothing to say raises no toast and adds no step: the
  // spot's toast, if one stands, goes on saying what it said, and its
  // Fortryd puts back the spot as it was before the change it names, the
  // silent one undone with it, as a species or bottom type picked while it
  // stands is. A step of its own would need a toast that says nothing.
  // Under a "Hent arter" toast the silent change stays: that Fortryd takes
  // off only what the tap put on (fetchSpecies). The Fortryd of a change of
  // water type below the tap still undoes it.
  if (!sentences()) return
  const said = () => (by === 'map' ? sentences() : `${name()}: ${sentences()}`)
  // The map's turn undone is the user's "no" to fresh, and only that: salt or
  // brackish is still the app's guess, so the card still says so, but the map
  // can't turn it again (waterGuess.ts 'mapUndone'). A user's pick undone puts
  // back the guess it ended, unless the map would turn that guess fresh at
  // once (the lookup found the lake while the toast was up): then Fortryd
  // would seem to do nothing, so it comes back as the map's turn undone.
  // Each change is a step in the spot's undo history (lib/undoHistory): its
  // toast takes the older one's place, and its Fortryd undoes this change
  // only, which is what its sentence names, then brings back the older one.
  addStep(`water:${l.id}`, {
    said,
    undo: () => {
      // The spot as the list holds it now: a sync from another tab or
      // device puts a fresh copy in its place, and Fortryd changed the old
      // one, no longer shown. Deleted there, nothing is left to undo. A sync
      // keeps the steps: another tab's save replaces every spot's copy,
      // changed or not.
      const cur = setup.locations.find((x) => x.id === l.id)
      if (!cur) return false
      putBack(cur, before)
      restoreWaterGuess(l.id, by === 'map' ? 'mapUndone' : guessBefore)
      if (guessFollowsMap(cur, coast.autoFor(cur))) restoreWaterGuess(l.id, 'mapUndone')
      if (bottomGuessBefore) markBottomGuessed(l.id)
      setBottomPicked(l.id, bottomPickedBefore)
      // The list goes back as it was before this change. A "Hent arter"
      // since is a step above this one, so its own Fortryd came first: what
      // it put on is off by now. A species picked by hand since goes with
      // the rest, as one picked while this change's toast stands does.
      return true
    },
  })
  showStep(l.id, said)
}
/**
 * Puts the fields of `before` back on the spot as they were. One the spot
 * did not have goes again: assigned, it stayed on the spot as undefined, a
 * field of the spot all the same, likely the bottom type of null the round
 * E browser check read. The saved copy dropped it either way.
 */
function putBack(l: Location, before: Pick<Location, 'waterType' | 'species' | 'bottomType'>) {
  const spot = l as unknown as Record<string, unknown>
  for (const [k, v] of Object.entries(before)) {
    if (v === undefined) delete spot[k]
    else spot[k] = v
  }
}
/**
 * The toast of a spot's latest change: of water type, or a "Hent arter"
 * (fetchSpecies). One toast per spot: two spots never share one, however
 * alike their sentences read (lib/toast key). Its Fortryd undoes that
 * change, then shows the toast of the change before it, if any, with that
 * one's own sentence and Fortryd.
 */
function showStep(id: string, said: () => string) {
  showToast(said, {
    key: `water:${id}`,
    action: {
      label: () => t('undo'),
      run: () => {
        const prev = undoStep(`water:${id}`)
        if (prev) showStep(id, prev.said)
      },
    },
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

// The bottom type, which the safety advice reads (conditions.ts safetyRec).
// A searched place's or a tapped pin's is a guess from the official spots
// nearby, and no screen showed it or could change it: a wrong one was kept.
const BOTTOM_LABEL_KEY = { sand: 'bt_sand', stone: 'bt_stone', mixed: 'bt_mixed', mud: 'bt_mud' } as const
/** The user's own pick: no longer a guess. Edited straight onto the location, like the water type. */
function setBottom(l: Location, b: string) {
  l.bottomType = b
  clearBottomGuess(l.id)
  setBottomPicked(l.id, true)
}

// A copy saved before a correction moved its official spot keeps the old
// pin (spots.ts movedSpotAt). It is still the spot everywhere, its coast
// too (stores/coast.ts), but its weather, waves and tides are fetched for
// the old place: Helsingør Kysten's in town, 2.3 km from the Sound at
// Kronborg, Gurre Sø's in the fields, 7 km from the lake. Adding the spot
// again was the only way to the right place.
/** The spot this copy's pin was, how far it moved, and whether the user has it saved at its pin now too. */
function movedOf(l: Location): { spot: Spot; km: number; have: boolean } | null {
  const spot = movedSpotAt(l.lat, l.lon)
  if (!spot) return null
  const km = Math.max(1, Math.round(haversine(l.lat, l.lon, spot.lat, spot.lon)))
  // Moved, this one would make two copies of one spot: the card only says so.
  const have = setup.locations.some((o) => o.id !== l.id && haversine(o.lat, o.lon, spot.lat, spot.lon) <= CATALOGUE_MATCH_KM)
  return { spot, km, have }
}
/**
 * Moves the copy to the spot's pin. All the user set stays: name, note, ★,
 * species, water and bottom type, slug and depth. A coast pick ('none' too)
 * does not: it read the shore at the old place, which was not the spot
 * (at Helsingør Kysten's old pin the map showed a pond, and the card asked
 * for a direction by hand), and at the spot's pin the catalogue's coast,
 * derived at the shore, applies. The toast says so where the card showed
 * the pick: not at fresh water. The guess marks go by id and stay, so a
 * guessed water type is still a guess the map's answer at the new pin can
 * turn. The forecast was fetched for the old place, so it is no longer
 * fresh (forecastKey) and the next refresh fetches the new one. Fortryd
 * moves it back, its pick too.
 */
function moveToPin(l: Location, s: Spot) {
  const before = { lat: l.lat, lon: l.lon, coast: l.coast }
  const shown = lineOf(l)
  const coastSaid = !!shown && srcOf(shown) === 'manual'
  l.lat = s.lat
  l.lon = s.lon
  delete l.coast
  // Wind direction turned off ('none') is no direction picked: it counts again.
  const coastLine = before.coast === 'none' ? 'loc_moved_coast_none' : 'loc_moved_coast'
  const said = () => [fill(t('loc_moved_done'), { name: l.name }), coastSaid ? t(coastLine) : ''].filter(Boolean).join(' ')
  showToast(said, {
    key: `moved:${l.id}`,
    action: {
      label: () => t('undo'),
      run: () => {
        // The spot as the list holds it now: a sync since puts fresh copies there (as setWater's Fortryd).
        const now = setup.locations.find((x) => x.id === l.id)
        if (!now) return
        now.lat = before.lat
        now.lon = before.lon
        if (before.coast !== undefined) now.coast = before.coast
      },
    },
  })
}
</script>

<template>
  <div class="wizard">
    <h1>{{ t('topbar_locations') }}</h1>

    <div class="card">
      <!-- The label is the box's: for no field, a screen reader named the box by its placeholder. -->
      <label for="loc-search">{{ t('search_loc_label') }}</label>
      <input id="loc-search" v-model="query" type="search" autocomplete="off" enterkeyhint="search"
          :placeholder="t('loc_search_ph')" @input="onInput" />
      <div v-if="results.length" class="results">
        <button v-for="r in results" :key="r.lat + ',' + r.lon" class="result" @click="add(r)">
          📍 {{ r.name }}<span v-if="municipalityShown(r, results)">, {{ municipalityShown(r, results) }}</span><span v-if="r.admin1">, {{ r.admin1 }}</span>
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
        <input v-if="renamingId === l.id" v-model="renameDraft" v-focus-select class="rename" :aria-label="t('rename')" @blur="commitRename"
          @keydown.enter="enterInField = true" @keyup.enter="enterInField && commitRename()" @keydown.esc="cancelRename" />
        <span v-else class="loc-name">📍 {{ l.name }}</span>
        <div class="loc-acts">
          <!-- While renaming, mousedown would blur the field first (committing it),
               so the click then found nothing open and re-opened the editor. -->
          <!-- Each names its spot to a screen reader: in a list of cards "Omdøb" alone said not which. -->
          <button class="btn ghost sm" :title="t('rename')" :aria-label="fill(t('rename_named'), { name: l.name })"
            @mousedown="renamingId === l.id && $event.preventDefault()"
            @click="renamingId === l.id ? commitRename() : startRename(l)">✎</button>
          <!-- Each opens a field or a picker below: aria-expanded says so, as the class alone told a screen reader nothing. -->
          <button class="btn ghost sm" :class="{ on: noteOpenId === l.id }" :title="t('note_label')" :aria-label="fill(t('note_named'), { name: l.name })"
            :aria-expanded="noteOpenId === l.id" @click="noteOpenId = noteOpenId === l.id ? null : l.id">📝</button>
          <button class="btn ghost sm" :class="{ on: speciesOpenId === l.id }"
            :title="t('loc_species')" :aria-label="fill(t('loc_species_named'), { name: l.name })" :aria-expanded="speciesOpenId === l.id"
            @click="speciesOpenId = speciesOpenId === l.id ? null : l.id">🐟</button>
          <button class="btn ghost sm" :title="t('loc_remove')" :aria-label="fill(t('loc_remove_named'), { name: l.name })" @click="remove(l.id)">🗑</button>
        </div>
      </div>

      <!-- Saved before the official spot's pin was corrected (movedOf). -->
      <p v-if="movedOf(l)" class="moved">
        {{ fill(t(movedOf(l)!.have ? 'loc_moved_have' : 'loc_moved'), { km: movedOf(l)!.km }) }}
        <button v-if="!movedOf(l)!.have" class="linkbtn" @click="moveToPin(l, movedOf(l)!.spot)">{{ t('loc_moved_go') }}</button>
      </p>

      <!-- The pill that is on says so with aria-pressed, as the app's other
           pills do: by colour alone a screen reader heard three names and
           nothing of which the spot has. -->
      <div class="wt-row">
        <span class="wt-label">{{ t('pin_wt') }}:</span>
        <button v-for="w in waterTypes" :key="w" class="wt" :class="{ on: (l.waterType || 'brackish') === w }"
          :aria-pressed="(l.waterType || 'brackish') === w" @click="setWater(l, w)">{{ wtLabel(w) }}</button>
        <span v-if="waterGuessed(l.id)" class="wt-guess">{{ t('wt_guessed') }}</span>
      </div>

      <!-- No bottom type reads as mixed, as the safety advice takes it. -->
      <div class="wt-row bt-row">
        <span class="wt-label">{{ t('loc_bottom') }}:</span>
        <button v-for="b in BOTTOM_TYPES" :key="b" class="wt bt" :class="{ on: (l.bottomType || 'mixed') === b }"
          :aria-pressed="(l.bottomType || 'mixed') === b" @click="setBottom(l, b)">{{ t(BOTTOM_LABEL_KEY[b]) }}</button>
        <span v-if="bottomGuessed(l.id)" class="wt-guess">{{ t('wt_guessed') }}</span>
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
            :class="{ on: isPicked(l, c.id) }" :aria-pressed="isPicked(l, c.id)" @click="toggleSpecies(l, c.id)">
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
        <!-- A list the user emptied stays empty (setup enrichMissingSpecies): it isn't unknown. -->
        🐟 {{ t(Array.isArray(l.species) && !l.species.length ? 'loc_species_cleared' : 'loc_species_unknown') }}
        <button class="linkbtn" @click="speciesOpenId = l.id">{{ t('loc_species_add') }}</button>
        <button v-if="speciesBack.get(l.id)" class="linkbtn" @click="fetchSpecies(l)">
          {{ t(speciesBack.get(l.id)!.own ? 'loc_species_own' : 'loc_species_nearby') }}</button>
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
.moved { font-size: 0.76rem; color: var(--gold); margin: 6px 0 0; }
.moved .linkbtn { margin-left: 8px; }
.osm-line { font-size: 0.66rem; color: var(--muted); margin: 10px 4px 0; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.sp-have { font-size: 0.74rem; color: var(--muted); margin: 8px 0 0; }
.linkbtn { background: none; border: none; padding: 0; font: inherit; color: var(--primary); cursor: pointer; margin-left: 6px; text-decoration: underline; }
/* Text links ("Ret", "Vælg selv", "Mod SSV", "Vælg arter", "Flyt din plads
   dertil") were 16 px tall, "Ret" 16 px wide. Touch screens only: each is a
   40 px box and its line grows with it, so nothing above or below is
   covered. The text stays at the box's left; a short word's extra width
   lies after it. */
@media (pointer: coarse) {
  .linkbtn { display: inline-flex; align-items: center; min-height: 40px; min-width: 40px; vertical-align: middle; }
}
.sp-pick { margin-top: 8px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: rgba(56,189,248,.06); }
.sp-pick-hint { font-size: 0.74rem; color: var(--muted); margin: 0 0 8px; }
.sp-pick-list { display: flex; flex-wrap: wrap; gap: 6px; }
.sp-chip { font-size: 0.74rem; padding: 4px 9px; border-radius: 10px; border: 1px solid var(--border); background: none; color: var(--muted); cursor: pointer; }
.sp-chip:hover { border-color: var(--primary); }
.sp-chip.on { border-color: var(--green); color: var(--green); background: rgba(34,197,94,.1); font-weight: 600; }
.sp-unfit-hint { margin-top: 10px; color: var(--gold); }
.sp-chip.unfit { border-color: var(--gold); color: var(--gold); }
/* 26 px tall: too small for a finger. Touch screens only; still a pill. */
@media (pointer: coarse) { .sp-chip { min-height: 36px; border-radius: 18px; } }
.results { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.result { text-align: left; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: none; color: var(--text); cursor: pointer; }
.result:hover { border-color: var(--primary); }
@media (pointer: coarse) { .result { min-height: 40px; } }
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
/* On a touch screen ▲ and ▼ were 14x12 px and ☆ 27x26: each becomes a
   40 px box, the arrows side by side. The top row grows from 26 to 40 px,
   as tall as the icon buttons in it. */
@media (pointer: coarse) {
  .star { min-width: 40px; min-height: 40px; }
  .movers { flex-direction: row; gap: 0; }
  .mv { min-width: 40px; min-height: 40px; }
  /* "Flyt din plads dertil": a text link 16 px tall that moves the spot. Its
     own line grows to 40 px; the water-type pills below it stay clear. */
  .moved .linkbtn { display: inline-flex; align-items: center; min-height: 40px; vertical-align: middle; }
  /* "Vælg arter" and "Hent arter …" under "Ingen arter valgt": the same. */
  .sp-missing .linkbtn { display: inline-flex; align-items: center; min-height: 40px; vertical-align: middle; }
  /* The rename field was 26 px tall, in a row the ☆ and ▲▼ make 40. */
  .rename { min-height: 40px; }
}
/* On a phone the name needs that width, and the icon buttons drop to a row
   of their own, right-aligned, empty on the left (max-width: 640px below).
   So the arrows stay stacked in a 40 px column, ▲ its top half and ▼ its
   bottom half, each reaching on outward by an invisible ::after (▲ up into
   the card's padding, ▼ down into that empty space) for 40x40 to a finger. */
@media (pointer: coarse) and (max-width: 640px) {
  .movers { flex-direction: column; }
  .mv { position: relative; min-height: 20px; }
  .mv::after { content: ''; position: absolute; left: 0; right: 0; }
  .mv:first-child::after { top: -20px; bottom: 0; }
  .mv:last-child::after { top: 0; bottom: -20px; }
}
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
