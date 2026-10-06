/**
 * The Lokationer place search: a debounced Open-Meteo geocode, plus turning a
 * picked result into a location. Kept out of LocationsView so the node tests
 * can drive the request races.
 */
import { ref } from 'vue'
import { lang } from './i18n'
import { findNearbySpots } from './spots'
import { inferBottomType, smartDetectWaterType } from './geo'
import { geocode, type GeoResult } from './weather'
import type { Location } from './types'

export const SEARCH_DEBOUNCE_MS = 350

/**
 * Every keystroke, clear and pick bumps a sequence number, and an answer for
 * an older one is dropped. Before, "Hund" answering after "Hundested" showed
 * Hundige/Hundborg under "Hundested"; picking a result within the debounce
 * still fired the pending search and put "No places found" under the emptied
 * box; and an offline request threw unhandled and ALSO said "No places
 * found" — the very offline-vs-no-result confusion this state exists to end.
 */
export function usePlaceSearch(search: (q: string, lang: string) => Promise<GeoResult[]> = geocode) {
  const query = ref('')
  const results = ref<GeoResult[]>([])
  const busy = ref(false)
  const searched = ref(false) // a search finished with an answer (possibly empty)
  const failed = ref(false) // the request itself failed — offline, most likely
  let timer: ReturnType<typeof setTimeout> | undefined
  let seq = 0

  function onInput() {
    clearTimeout(timer)
    const mine = ++seq
    searched.value = false
    failed.value = false
    if (!query.value.trim()) { results.value = []; busy.value = false; return }
    busy.value = true
    timer = setTimeout(async () => {
      try {
        const r = await search(query.value, lang.value)
        if (mine !== seq) return // superseded by a newer keystroke, a clear or a pick
        results.value = r
        searched.value = true
      } catch {
        if (mine !== seq) return
        results.value = []
        failed.value = true
      } finally {
        if (mine === seq) busy.value = false
      }
    }, SEARCH_DEBOUNCE_MS)
  }

  /** After a pick: empty the box and forget any pending or in-flight search. */
  function reset() {
    clearTimeout(timer)
    seq++
    query.value = ''
    results.value = []
    busy.value = false
    searched.value = false
    failed.value = false
  }

  return { query, results, busy, searched, failed, onInput, reset }
}

/**
 * A picked search result as a location. Water and bottom type are inferred the
 * way the map infers them for a tapped pin — left blank, a lake or river found
 * by search counted as brackish and was scored with sea-tide data from the
 * nearest DMI harbour station.
 */
export function locationFromSearch(r: GeoResult): Omit<Location, 'id'> {
  const name = r.admin1 ? `${r.name}, ${r.admin1}` : r.name
  const nearby = findNearbySpots(r.lat, r.lon, 40).slice(0, 5)
  return {
    name, lat: r.lat, lon: r.lon,
    waterType: smartDetectWaterType(r.lat, r.lon, name, nearby),
    bottomType: inferBottomType(nearby),
  }
}
