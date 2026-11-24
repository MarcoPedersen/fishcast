/**
 * The Lokationer place search: a debounced Open-Meteo geocode, plus turning a
 * picked result into a location. Kept out of LocationsView so the node tests
 * can drive the request races.
 */
import { computed, ref } from 'vue'
import { shownLang, t } from './i18n'
import { findNearbySpots } from './spots'
import { GUESS_RADIUS_KM, inferBottomType, smartDetectWaterType } from './geo'
import { geocode, type GeoResult } from './weather'
import type { Location } from './types'

export const SEARCH_DEBOUNCE_MS = 350

/**
 * What the search box asks: Denmark's places, or the world's when Denmark
 * has none. Open-Meteo answers with the six best matches in the world, so
 * a Danish postcode, which "no places found" says to try, found the cities
 * abroad that share it: "8000" gave Zürich and Burgas and no Aarhus, and
 * "3100" put Toulouse above Hornbæk. "Lund" gave six Lunds abroad and none
 * of Denmark's. A place found only abroad, such as Malmö, is still found.
 *
 * The world is asked at the same time, not only when Denmark has nothing:
 * Open-Meteo matches loosely within Denmark, so "Kiel" found Kielstrup and
 * Keldbymagle, "Mölle" (Kullen) found Mollerup, and the place abroad that
 * was typed never showed. A place abroad comes after Denmark's when its
 * name begins with what was typed (accents aside), so "8000" stays Aarhus
 * alone. One request failing leaves the other's answer; both failing is
 * offline, most likely, and throws as before.
 *
 * Denmark's places go to `early` as soon as they come. The world's request
 * could hang to its 10 s deadline with Denmark's answered, and those waited
 * under "Søger…". They come first either way, so the places abroad join
 * them when the world answers, and nothing shown moves.
 */
/**
 * A name as the search compares it: no case, no accents, and the Nordic
 * letters that are letters of their own written as the plain ones they
 * replace. Asked in Danish, Open-Meteo spells Mölle (Kullen) 'Mølle' and
 * Malmö 'Malmø', and ø does not come apart the way ö does: 'Mölle' found
 * Mollem and Molles and not Mølle itself.
 */
const NORDIC: Record<string, string> = { ø: 'o', æ: 'ae', ß: 'ss' }
const fold = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[øæß]/g, (c) => NORDIC[c]).trim()
const MAX_RESULTS = 8
export async function searchPlaces(q: string, lang: string, early?: (danish: GeoResult[]) => void): Promise<GeoResult[]> {
  const denmark = geocode(q, lang, 'DK')
  if (early) denmark.then((d) => { if (d.length) early(d) }, () => {}) // its failure is read below
  const [dk, world] = await Promise.allSettled([denmark, geocode(q, lang)])
  if (dk.status === 'rejected' && world.status === 'rejected') throw dk.reason
  const danish = dk.status === 'fulfilled' ? dk.value : []
  const everywhere = world.status === 'fulfilled' ? world.value : []
  if (!danish.length) return everywhere
  const typed = fold(q)
  const abroad = everywhere.filter((r) => r.country !== 'DK' && fold(r.name).startsWith(typed))
  return [...danish, ...abroad].slice(0, MAX_RESULTS)
}

/**
 * Every keystroke, clear and pick bumps a sequence number, and an answer for
 * an older one is dropped. Before, "Hund" answering after "Hundested" showed
 * Hundige/Hundborg under "Hundested"; picking a result within the debounce
 * still fired the pending search and put "No places found" under the emptied
 * box; and an offline request threw unhandled and ALSO said "No places
 * found" — the very offline-vs-no-result confusion this state exists to end.
 */
export function usePlaceSearch(
  search: (q: string, lang: string, early?: (r: GeoResult[]) => void) => Promise<GeoResult[]> = searchPlaces,
) {
  const query = ref('')
  const results = ref<GeoResult[]>([])
  const busy = ref(false)
  const searched = ref(false) // a search finished with an answer (possibly empty)
  const failed = ref(false) // the request itself failed — offline, most likely
  const more = ref(false) // the places shown are this search's first, and the rest are still asked
  let timer: ReturnType<typeof setTimeout> | undefined
  let seq = 0

  /**
   * Given the field's input event, the text is the field's own. An Android
   * keyboard with suggestions composes each word until a space or the search
   * key ends it, and v-model takes none of it in until then: the search read
   * the box as it was before the word, and "Hornb" found nothing until the
   * word ended.
   */
  function onInput(e?: Event) {
    const typed = (e?.target as HTMLInputElement | null | undefined)?.value
    if (typeof typed === 'string') query.value = typed
    clearTimeout(timer)
    const mine = ++seq
    searched.value = false
    failed.value = false
    more.value = false
    if (!query.value.trim()) { results.value = []; busy.value = false; return }
    busy.value = true
    timer = setTimeout(async () => {
      try {
        // Places that come early show while the rest are asked: busy stays on.
        const r = await search(query.value, shownLang.value, (early) => {
          if (mine === seq) { results.value = early; more.value = true }
        })
        if (mine !== seq) return // superseded by a newer keystroke, a clear or a pick
        results.value = r
        searched.value = true
      } catch {
        if (mine !== seq) return
        results.value = []
        failed.value = true
      } finally {
        if (mine === seq) { busy.value = false; more.value = false }
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
    more.value = false
  }

  /**
   * Where the search is, for the views' one status line (role=status), which
   * a screen reader says as it changes. 'Søger…' and the failed line were each
   * an element of their own, put in fresh, and often went unsaid; the places
   * found were never said. While a new search runs over the last one's
   * places, it says only that it searches: those are not what it found.
   */
  const said = computed(() => {
    const n = results.value.length
    const found = () => (n === 1 ? t('geo_found_one') : t('geo_found').replace('{n}', () => String(n)))
    if (busy.value) return more.value ? `${found()} ${t('geo_searching')}` : t('geo_searching')
    if (failed.value) return t('geo_failed')
    if (searched.value) return n ? found() : t('geo_no_results')
    return ''
  })

  return { query, results, busy, searched, failed, said, onInput, reset }
}

/**
 * The municipality a result shows, when another of `all` has its name and
 * region: two "Hjerting, Region Syddanmark" were two buttons alike, one on
 * the coast by Esbjerg and one 45 km inland by Vejen. '' when the name and
 * region tell it apart.
 */
export function municipalityShown(r: GeoResult, all: readonly GeoResult[]): string {
  const twin = all.some((o) => o !== r && o.name === r.name && o.admin1 === r.admin1)
  return twin ? r.admin2 ?? '' : ''
}

/**
 * A result's name as its row in `all` reads it: the place, its municipality
 * when a twin is listed (municipalityShown), and its region. A place picked
 * is named so too: both Hjerting were saved as 'Hjerting, Region
 * Syddanmark', two spots of one name.
 */
export function placeName(r: GeoResult, all: readonly GeoResult[] = [r]): string {
  return [r.name, municipalityShown(r, all), r.admin1].filter(Boolean).join(', ')
}

/**
 * A picked search result as a location, named as its row in `all` reads.
 * Water and bottom type are inferred the way the map infers them for a
 * tapped pin — left blank, a lake or river found by search counted as
 * brackish and was scored with sea-tide data from the nearest DMI harbour
 * station. The bottom type from the spots of the water type guessed. The
 * water guess reads the name without the municipality, as before: it looks
 * for words such as "sø" and "vig", and Furesø and Lemvig hold them.
 */
export function locationFromSearch(r: GeoResult, all: readonly GeoResult[] = [r]): Omit<Location, 'id'> {
  const near = findNearbySpots(r.lat, r.lon, GUESS_RADIUS_KM)
  const waterType = smartDetectWaterType(r.lat, r.lon, placeName(r), near.slice(0, 5))
  return { name: placeName(r, all), lat: r.lat, lon: r.lon, waterType, bottomType: inferBottomType(near, waterType) }
}
