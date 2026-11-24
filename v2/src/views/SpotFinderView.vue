<script lang="ts">
import { ref } from 'vue'
import { onForget } from '@/lib/forgetOnLogout'

/**
 * The nearby search outlives the screen: its mode, place, radius and order,
 * and whether it ran. "Skift arter" leads to Målarter, which goes on to the
 * dashboard, and back on Find pladser the search had started over in lucky
 * mode, its place to be looked up again. Kept in memory for the tab, not
 * stored, and forgotten at logout, or when its account is signed out
 * elsewhere: a place searched from may be a home.
 */
const kept = {
  mode: ref<'lucky' | 'nearby'>('lucky'),
  point: ref<{ lat: number; lon: number; name: string } | null>(null),
  radius: ref(40),
  sortBy: ref<'score' | 'dist'>('score'),
  /** A nearby search ran from the place kept: it runs again on return. */
  ran: ref(false),
  /** The account whose search it is (whose, below); null: a guest's. */
  who: null as string | null,
}
function startOver() {
  kept.mode.value = 'lucky'
  forgetSearch()
}
/** All of it but the mode: with the screen open, its link names the mode too. */
function forgetSearch() {
  kept.point.value = null
  kept.radius.value = 40
  kept.sortBy.value = 'score'
  kept.ran.value = false
  kept.who = null
}
onForget(startOver)
</script>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue' // and ref, imported above
import { useRoute, useRouter } from 'vue-router'
import { spName, t } from '@/lib/i18n'
import type { GeoResult } from '@/lib/weather'
import { placeName, usePlaceSearch } from '@/lib/placeSearch'
import { activeSpeciesInMonth, hasCopyOf, locationFromSpot, type NearbySpot, type Spot } from '@/lib/spots'
import { findLuckySpots, findNearbyRanked, regionLabel, spotTypeIcon, spotTypeLabel, type SpotResult } from '@/lib/spotfinder'
import { SPECIES_PREFS } from '@/lib/species'
import { scoreColor } from '@/lib/scoring'
import { useSetupStore, uid } from '@/stores/setup'
import { useForecastStore } from '@/stores/forecast'
import { useAuthStore } from '@/stores/auth'
import { localDayUTC, useNow } from '@/lib/clock'

const router = useRouter()
const route = useRoute()
const setup = useSetupStore()
const fc = useForecastStore()

// Whose search it is: the account signed in, else the one the setup the
// page holds belongs to (stores/setup; null: a guest's). Out of an account
// with no logout here to call onForget, an account's search starts over
// once the setup is the account's no longer: another tab's logout wiped
// it, or another account's took its place. Or once another account signs
// in. A token refresh the server refused leaves the account's setup on
// screen, and the search with it. A guest's goes on after a sign-in.
const auth = useAuthStore()
const whose = () => auth.user?.id ?? setup.account
const who = whose()
if (kept.who !== null && kept.who !== who) startOver()
kept.who = who

// The mode a link names wins (the welcome page's two buttons); else the one left.
const mode = kept.mode
if (route.query.mode === 'nearby' || route.query.mode === 'lucky') mode.value = route.query.mode
watch(() => route.query.mode, (m) => { if (m === 'nearby' || m === 'lucky') mode.value = m })
/**
 * A mode button. The mode goes into the link too, which it replaces: the
 * link kept the mode it was opened with, and back from Målarter reopened
 * that one, not the one used. Replaced, not pushed: back leaves the screen.
 */
function setMode(m: 'lucky' | 'nearby') {
  mode.value = m
  if (route.query.mode !== m) void router.replace({ query: { ...route.query, mode: m } })
}
// Lucky mode needs no input, so run it immediately (on arrival or when switched
// to); reset results when leaving it so nearby starts fresh. Back on the
// screen, a nearby search runs again from the place kept, for the species
// picked meanwhile.
watch(mode, () => { searched.value = false; results.value = []; kept.ran.value = false; if (mode.value === 'lucky') search() })
onMounted(() => { if (mode.value === 'lucky' || (kept.ran.value && point.value)) search() })
// The month ranks the spots and picks their species. Read once at mount, a
// screen left open into a new month kept the old one's: it follows the
// shared clock, as Målarter does, and the spots listed are ranked again,
// nearby within the radius they were searched with. Each day, not each
// month: the rules of the day rank them too (a closure starts on 15 March).
const now = useNow()
const dayKey = computed(() => localDayUTC(now.value))
const month = computed(() => new Date(dayKey.value).getUTCMonth() + 1)
/** Noon of the local day, as the season rules read a day (lib/seasonGuard). */
const day = computed(() => {
  const d = new Date(dayKey.value)
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12)
})
watch(dayKey, () => { if (searched.value) search(searchedRadius.value) })
// The species picked rank them too. Picked in another tab, or on another
// device and pulled, the line above the list named the new ones, and the
// list stayed ranked for the old. Ranked again, as on a new day.
watch(() => setup.targetSpecies.join(','), () => { if (searched.value) search(searchedRadius.value) })

// Nearby-mode geo search
const point = kept.point
const radius = kept.radius

const results = ref<SpotResult[]>([])
const searched = ref(false)

const ctx = computed(() => ({
  locations: setup.locations,
  forecastIds: new Set(Object.keys(fc.forecasts)),
  day: day.value,
}))

// The same search as Lokationer (lib/placeSearch). This one had its own copy
// with no request ordering and no catch: offline it threw unhandled and said
// "no places found", a slow "Hund" answering after "Hundested" replaced the
// newer results, and a pick within the debounce re-opened the dropdown.
const {
  query, results: geoResults, busy: geoBusy, searched: geoSearched, failed: geoFailed, more: geoMore, said: geoSaid,
  onInput: onGeoInput, reset: resetSearch,
} = usePlaceSearch()
if (point.value) query.value = point.value.name // the place kept
/** Drop any pending or in-flight search, and show the picked place in the box. */
function choose(p: { lat: number; lon: number; name: string }) {
  resetSearch()
  point.value = p
  query.value = p.name
  kept.ran.value = false // not searched from yet
}
function pickPoint(r: GeoResult) {
  choose({ lat: r.lat, lon: r.lon, name: placeName(r, geoResults.value) }) // as its row reads: a twin's municipality too
}
function pickSaved(l: { lat: number; lon: number; name: string }) {
  choose({ lat: l.lat, lon: l.lon, name: l.name })
}
/**
 * Typing over the picked place drops it, until a new one is picked. It was
 * kept: "Nordhuse" typed and not picked, the search ran from Hornbæk, and
 * Hornbæk's spots stood under a box that said Nordhuse.
 * The event goes on to the search, which reads the field from it: a phone
 * keyboard mid-word has not handed v-model the word yet.
 */
function onType(e: Event) {
  point.value = null
  onGeoInput(e)
}
/**
 * The spots listed are those near the place in the box. Typed over, or
 * another place picked, the last place's spots stayed, at their distances
 * from it. They go, until a search from the new place: headed with the old
 * place instead, they would still stand under a box naming another.
 */
watch(point, () => {
  if (mode.value === 'nearby') { results.value = []; searched.value = false }
})

/**
 * The kept search's account rule (whose), with the screen open: signed out
 * elsewhere, the box still showed the account's place and its spots stayed
 * listed. They go as the search does; a guest's stay through a sign-in.
 * Lucky mode's spots go too: they were ranked for the account's species,
 * and its saved spots raised those near them. They stayed under "alle
 * arter" once a logout in another tab wiped those here. The radius and
 * the order go back too, as on return; the mode stays, as the link has it.
 * Whose search the screen shows is its own: a logout here starts the kept
 * one over (onForget) before this hears the setup go, and the box kept
 * the account's place.
 */
let shown = who
watch(whose, (id) => {
  if (shown !== null && shown !== id) {
    resetSearch()
    query.value = ''
    forgetSearch()
    results.value = []
    searched.value = false
  }
  shown = id
  kept.who = id
})

// The radius the shown results were searched with — the slider can move after.
const searchedRadius = ref(radius.value)
function search(km = radius.value) {
  if (mode.value === 'lucky') {
    results.value = findLuckySpots(setup.targetSpecies, month.value, ctx.value)
  } else if (point.value) {
    results.value = findNearbyRanked(point.value.lat, point.value.lon, km, setup.targetSpecies, month.value, ctx.value)
    searchedRadius.value = km
    kept.ran.value = true
  }
  searched.value = true
}

function waterBadge(w: string) {
  return w === 'fresh' ? t('wt_fresh_label') : w === 'salt' ? t('wt_salt_label') : t('wt_brackish_label')
}
function isAdded(spot: Spot) {
  return hasCopyOf(setup.locations, spot)
}
function add(spot: Spot) {
  if (isAdded(spot)) return
  setup.locations.push({ id: uid(), ...locationFromSpot(spot) }) // depth too — see locationFromSpot
}
const medals = ['🥇', '🥈', '🥉']
// The value goes in through a function: a string there reads "$&" or "$'" in a name as a replace pattern.
const fill = (s: string, params: Record<string, string | number>) =>
  Object.entries(params).reduce((out, [k, v]) => out.replace(`{${k}}`, () => String(v)), s)

// Suitability is coarse, so several spots routinely tie on the exact same score.
// Numbering them 1,2,3,4 and handing out 🥇🥈🥉 implied an ordering that doesn't
// exist. Rank by DISTINCT score instead, so equal scores share a rank (and a
// medal) and the medal means "best score / 2nd best / 3rd best".
//
// Rank is a property of the score, NOT of the display order — otherwise sorting
// by distance renumbered the medals and produced three joint winners.
//
// Only spots that list your species are ranked: the `unlisted` fallbacks score
// on a different scale, and handing them medals put a pike-less beach on gold
// for "Gedde". Nor those where all of them are closed today (`closed`):
// Sletterhage took silver for cod inside the Baltic ban.
const listedResults = computed(() => results.value.filter((r) => !r.unlisted))
const openResults = computed(() => listedResults.value.filter((r) => !r.closed))
const rankByScore = computed(() => {
  const m = new Map<number, number>()
  let rank = 0
  for (const r of [...openResults.value].sort((a, b) => b.score - a.score)) {
    if (!m.has(r.score)) { rank++; m.set(r.score, rank) }
  }
  return m
})
/** How many results share a score — drives the "delt placering" hint. */
const countByScore = computed(() => {
  const m = new Map<number, number>()
  for (const r of openResults.value) m.set(r.score, (m.get(r.score) ?? 0) + 1)
  return m
})
/**
 * The line on the card of a spot where a target is closed today, as the
 * dashboard flags a window there. Closed for some of them too, not only for
 * all: Kegnæs Fyr kept its medal for sea trout and said nothing of cod.
 */
const closedLine = (r: SpotResult) => {
  const ids = r.closed ?? r.alsoClosed
  return ids?.length ? `🚫 ${t('season_closed')}: ${ids.map((id) => spName(SPECIES_PREFS[id])).join(', ')}` : ''
}
/**
 * "1 plads fundet" / "N pladser fundet", the open ones. The closed ones are
 * counted apart: "6 pladser fundet" for cod in November had four inside the
 * Baltic ban. Both are said, as both are listed: "2 pladser fundet · 4 med
 * fredningstid i dag", or "4 pladser med fredningstid i dag" when none is open.
 */
const countLabel = computed(() => {
  const open = openResults.value.length
  const shut = listedResults.value.length - open
  if (!open) return fill(t(shut === 1 ? 'sf_results_all_closed_one' : 'sf_results_all_closed'), { n: shut })
  const found = `${open} ${t(open === 1 ? 'sf_results_count_one' : 'sf_results_count')}`
  return shut ? `${found} · ${fill(t('sf_results_closed'), { n: shut })}` : found
})
// A bare "0 pladser fundet" left the user guessing — e.g. no official spot
// lists salmon at all, which reads like a bug. Say why instead.
const emptyMsg = computed(() => {
  if (listedResults.value.length) return null
  if (setup.targetSpecies.length) {
    return mode.value === 'lucky'
      ? t('sf_none_list').replace('{species}', targetNames.value)
      : t('sf_none_list_near').replace('{km}', String(searchedRadius.value)).replace('{species}', targetNames.value)
  }
  return `${t('sf_no_spots_found')} ${t('sf_no_spots_radius')} ${searchedRadius.value} km`
})
const ranked = computed(() =>
  sortedResults.value.map((r) => ({
    r,
    rank: rankByScore.value.get(r.score) ?? 1,
    shared: (countByScore.value.get(r.score) ?? 1) > 1,
  })),
)

// Nearby results are ranked by suitability, so a great spot 38 km away can sit
// above a good one 2 km away. That's defensible but not always what you want
// when the whole point was "near me" — hence a sort choice, nearby-mode only.
const sortBy = kept.sortBy
watch(mode, () => { sortBy.value = 'score' })
const sortedResults = computed(() => {
  if (mode.value !== 'nearby' || sortBy.value === 'score') return results.value
  const byDist = (a: SpotResult, b: SpotResult) => {
    const da = distKm(a.spot), db = distKm(b.spot)
    if (da == null || db == null) return 0
    return da - db
  }
  // Distance order within each group: spots listing your species stay first,
  // those where they are open today before those where they are closed.
  return [
    ...openResults.value.slice().sort(byDist),
    ...listedResults.value.filter((r) => r.closed).sort(byDist),
    ...results.value.filter((r) => r.unlisted).sort(byDist),
  ]
})
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
      <!-- The dashboard sends a visit with no setup back to the welcome page
           (router): opened from there, with spots added, this led back to it.
           With no setup yet it starts one, as the welcome page's button does. -->
      <button class="btn ghost sm" @click="router.push({ name: setup.hasSetup() ? 'dashboard' : 'availability' })">
        {{ setup.hasSetup() ? t('goto_dash') : t('setup_start') }}
      </button>
    </div>

    <div class="modes">
      <!-- Only set the mode (and the link) — the mode watcher resets results
           and auto-runs lucky; re-clicking the active mode is then a harmless no-op.
           aria-pressed: the class alone told a screen reader nothing of which is on. -->
      <button class="mode" :class="{ active: mode === 'lucky' }" :aria-pressed="mode === 'lucky'" @click="setMode('lucky')">
        {{ t('sf_lucky_badge') }}<small>{{ t('sf_lucky_sub') }}</small>
      </button>
      <button class="mode" :class="{ active: mode === 'nearby' }" :aria-pressed="mode === 'nearby'" @click="setMode('nearby')">
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
      <input v-model="query" type="search" autocomplete="off" enterkeyhint="search"
            :placeholder="t('sf_search_geo_ph')" @input="onType" />
      <!-- One status line, there from the start, which a screen reader says as it
           changes (lib/placeSearch said); the lines seen below say the same. -->
      <p class="sr-only" role="status">{{ geoSaid }}</p>
      <div v-if="geoResults.length" class="results-list">
        <button v-for="r in geoResults" :key="r.lat + ',' + r.lon" class="result" @click="pickPoint(r)">
          📍 {{ placeName(r, geoResults) }}
        </button>
      </div>
      <!-- Under places only while the world is asked for this search's (Denmark's
           show first, lib/placeSearch); not under the last search's while typing on. -->
      <p v-if="geoBusy && (!geoResults.length || geoMore)" class="geo-state" aria-hidden="true">{{ t('geo_searching') }}</p>
      <p v-else-if="geoFailed" class="geo-state" aria-hidden="true">{{ t('geo_failed') }}</p>
      <p v-else-if="geoSearched && !geoResults.length" class="geo-state" aria-hidden="true">{{ t('geo_no_results') }}</p>
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

    <button class="btn primary lg search" :disabled="mode === 'nearby' && !point" @click="search()">
      {{ t('sf_search_btn') }}
    </button>
    <p v-if="mode === 'nearby' && !point" class="muted sm center">{{ t('sf_pick_point') }}</p>

    <!-- Results -->
    <div v-if="searched" class="results">
      <div class="res-head">
        <p v-if="listedResults.length" class="count">{{ countLabel }}</p>
        <div v-if="mode === 'nearby' && results.length > 1" class="sortby" role="group" :aria-label="t('sf_sort_by')">
          <button class="sbtn" :class="{ on: sortBy === 'score' }" :aria-pressed="sortBy === 'score'" @click="sortBy = 'score'">{{ t('sf_sort_score') }}</button>
          <button class="sbtn" :class="{ on: sortBy === 'dist' }" :aria-pressed="sortBy === 'dist'" @click="sortBy = 'dist'">{{ t('sf_sort_dist') }}</button>
        </div>
      </div>
      <div v-if="emptyMsg" class="empty-res">
        <strong>{{ emptyMsg }}</strong>
        <span v-if="!results.length" class="muted sm">{{ mode === 'lucky' ? t('sf_none_list_hint') : t('sf_try_broader') }}</span>
      </div>
      <p v-if="listedResults.length" class="sf-score-note">ℹ️ {{ t('sf_score_note') }}</p>
      <template v-for="({ r, rank, shared }, i) in ranked" :key="r.spot.slug">
        <p v-if="r.unlisted && (i === 0 || !ranked[i - 1].r.unlisted)" class="unlisted-head">{{ t('sf_unlisted_head') }}</p>
        <div class="card result-card" :class="{ unlisted: r.unlisted }">
          <div v-if="r.unlisted || r.closed" class="rank muted">·</div>
          <div v-else class="rank" :title="shared ? t('sf_shared_rank') : undefined">
            {{ medals[rank - 1] || rank + '.' }}<span v-if="shared" class="tie">=</span>
          </div>
          <div class="body">
            <div class="name">
              {{ r.spot.name }}
              <span v-if="distKm(r.spot) != null" class="dist">{{ distKm(r.spot) }} km</span>
            </div>
            <div class="meta">
              {{ regionLabel((r.spot as Spot).region) }} · {{ spotTypeIcon((r.spot as Spot).spotType) }} {{ spotTypeLabel((r.spot as Spot).spotType) }}
              · {{ waterBadge((r.spot as Spot).waterType) }}
            </div>
            <p v-if="closedLine(r)" class="sf-closed" role="note">{{ closedLine(r) }}</p>
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
            <!-- No suitability score for a spot that lists none of your species:
                 its number is on the general scale and would compare falsely. -->
            <template v-if="!r.unlisted">
              <div class="score" :class="scoreColor(r.score)" :title="t('sf_score_note')">{{ r.score }}</div>
              <span class="score-cap">{{ t('sf_score_cap') }}</span>
            </template>
            <!-- Named by its spot: every card's read "+ Tilføj" alike. Added,
                 it stays the same element, off (aria-disabled) and saying so:
                 it gave way to a "✓ Tilføjet" text, and the focus it held
                 went with it to the top of the page. One element, not
                 v-if / v-else, which would swap it for another. -->
            <button :class="isAdded(r.spot as Spot) ? 'tag-added' : 'btn primary sm'"
              :aria-disabled="isAdded(r.spot as Spot) || undefined"
              :aria-label="fill(t(isAdded(r.spot as Spot) ? 'sf_added_named' : 'sf_add_named'), { name: r.spot.name })"
              @click="add(r.spot as Spot)">{{ isAdded(r.spot as Spot) ? t('added') : t('add') }}</button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.row { display: flex; align-items: center; gap: 10px; } .row.between { justify-content: space-between; }
h1 { font-size: 1.3rem; }
.modes { display: flex; gap: 8px; margin: 14px 0; }
.res-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.sortby { display: flex; gap: 4px; }
.sbtn { font-size: 0.74rem; padding: 4px 9px; border-radius: 8px; border: 1px solid var(--border); background: none; color: var(--muted); cursor: pointer; }
.sbtn.on { border-color: var(--primary); color: var(--text); background: rgba(56,189,248,.12); font-weight: 600; }
.tie { font-size: 0.7rem; color: var(--muted); margin-left: 1px; }
.mode { flex: 1; display: flex; flex-direction: column; gap: 2px; padding: 12px; border-radius: 10px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text); cursor: pointer; font-weight: 600; }
.mode small { font-weight: 400; color: var(--muted); font-size: 0.72rem; }
.mode.active { border-color: var(--primary); background: rgba(56,189,248,.08); }
.targeting { font-size: 0.82rem; color: var(--muted); margin-bottom: 12px; }
.targeting strong { color: var(--cyan); }
.sf-score-note { font-size: 0.74rem; color: var(--muted); line-height: 1.45; margin: -4px 0 10px; }
.score-cap { font-size: 0.6rem; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; text-align: center; display: block; margin-top: 2px; }
.link { background: none; border: none; color: var(--primary); cursor: pointer; font-size: 0.78rem; margin-left: 8px; text-decoration: underline; }
label { font-size: 0.78rem; color: var(--muted); }
.geo-state { font-size: 0.78rem; color: var(--muted); margin: 8px 0 0; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.results-list { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.result { text-align: left; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border); background: none; color: var(--text); cursor: pointer; }
.result:hover { border-color: var(--primary); }
@media (pointer: coarse) { .result { min-height: 40px; } }
.saved { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.chip { padding: 4px 10px; border-radius: 12px; border: 1px solid var(--border); background: none; color: var(--text); cursor: pointer; font-size: 0.76rem; }
/* Touch screens: "Skift arter" was 19 px tall, the sort buttons 26 and the
   saved-spot chips 26. The link's line grows to 40; the chips to 36, as
   the species chips do. */
@media (pointer: coarse) {
  .link { display: inline-flex; align-items: center; min-height: 40px; vertical-align: middle; }
  .sbtn { min-height: 40px; }
  .chip { min-height: 36px; border-radius: 18px; }
}
.radius { margin-top: 12px; }
.search { width: 100%; justify-content: center; margin-top: 14px; }
.center { text-align: center; margin-top: 8px; }
.count { color: var(--muted); font-size: 0.82rem; margin: 18px 0 8px; }
.result-card { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 10px; }
.result-card.unlisted { opacity: 0.8; }
.unlisted-head { font-size: 0.8rem; color: var(--muted); font-weight: 700; margin: 16px 0 8px; }
.empty-res {
  display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px;
  margin: 14px 0; padding: 18px 14px; border-radius: 12px;
  border: 1px dashed var(--border); color: var(--muted);
}
.empty-res strong { color: var(--text); font-size: 0.9rem; }
.rank { font-size: 1.2rem; min-width: 28px; }
.body { flex: 1; }
.name { font-weight: 700; }
.dist { color: var(--muted); font-weight: 400; font-size: 0.78rem; margin-left: 6px; }
.meta { font-size: 0.78rem; color: var(--muted); margin-top: 3px; }
/* As Målarter's "Fredningstid nu" on a species card. */
.sf-closed { font-size: 0.74rem; color: var(--red); font-weight: 600; margin: 4px 0 0; }
.fac { margin-top: 4px; font-size: 0.85rem; }
.pills { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
.pill { background: rgba(56,189,248,.12); border: 1px solid var(--border); border-radius: 12px; padding: 2px 8px; font-size: 0.72rem; }
.right { display: flex; flex-direction: column; align-items: center; gap: 6px; }
.score { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; }
.score-great { background: rgba(34,197,94,.2); color: var(--green); }
.score-good { background: rgba(56,189,248,.2); color: var(--primary); }
.score-avg { background: rgba(245,158,11,.2); color: var(--gold); }
.score-poor { background: rgba(239,68,68,.2); color: var(--red); }
/* A button now (the + Tilføj one, its spot added): it keeps the look of the text it was. */
.tag-added { color: var(--green); font-size: 0.7rem; background: none; border: none; padding: 0; font-family: inherit; cursor: default; }
.muted { color: var(--muted); } .sm { font-size: 0.78rem; }
</style>
