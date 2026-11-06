/**
 * The setup map's "new spot" sheet: tap the map (or an official spot), and a
 * sheet opens with a name and water type to confirm. The name comes from a
 * Nominatim reverse-geocode, which can be slow on coastal mobile coverage —
 * and every race around that request used to lose the user's input:
 *
 *  - tapping Add before it answered saved a spot called "…" with placeholder
 *    'brackish'/'mixed' instead of the inferred water and bottom type;
 *  - dismissing the sheet didn't invalidate the request, so its late answer
 *    re-opened the sheet (without the red pin);
 *  - a name typed or a water type picked meanwhile was overwritten.
 *
 * The species the sheet lists are the ones Add saves (`shown`): it listed
 * those of the official spots within 40 km and saved those within 12 km, so
 * a point 40 km from Rørvig showed five species and was saved with none.
 * They are those of the spots within 12 km, as a searched place gets, and
 * only where there are none the five nearest within 40 km: a pin in
 * mid-Arresø took cod, mackerel and plaice from the harbours round the lake.
 *
 * Kept out of MapView so the node tests can drive those races.
 */
import { computed, ref } from 'vue'
import { findNearbySpots, type NearbySpot, type Spot, type SpotSpecies } from './spots'
import { reverseGeocode, smartDetectWaterType, inferSpecies, inferBottomType, SPECIES_RADIUS_KM } from './geo'
import { fitWaterType } from './locationSpecies'
import type { Location, WaterType } from './types'

/**
 * Every species of these spots, the likeliest first (inferSpecies: near, and
 * in season this month), with its months merged across the spots. All of
 * them, not this month's: the spot is saved with them for every month.
 */
function nearbySpecies(nearby: NearbySpot[]): SpotSpecies[] {
  const months = new Map<string, Set<number>>()
  for (const s of nearby) {
    for (const sp of s.species ?? []) {
      if (!sp.nameEn) continue
      if (!months.has(sp.nameEn)) months.set(sp.nameEn, new Set())
      sp.months.forEach((m) => months.get(sp.nameEn)!.add(m))
    }
  }
  const seen = new Set<string>()
  return inferSpecies(nearby).flatMap((sp) => {
    if (!sp.nameEn || seen.has(sp.nameEn)) return []
    seen.add(sp.nameEn)
    return [{ name: sp.name, nameEn: sp.nameEn, months: [...months.get(sp.nameEn)!].sort((a, b) => a - b) }]
  })
}

export interface PendingForm {
  lat: number; lon: number; name: string; waterType: WaterType
  /** What the nearby official spots hold; the sheet shows, and Add saves, those that live in `waterType` (`shown`). */
  bottomType: string; species: SpotSpecies[]; nearbyCount: number; loading: boolean
  /** Only an official spot knows it (torsk's 'deep' bonus reads it); a tapped point never does. */
  depth?: Location['depth']
  /** The water type is smartDetectWaterType's guess: a tapped point the user hasn't picked a type for. */
  guessed: boolean
}

/**
 * Nominatim has no timeout of its own, and Add stays disabled while the place
 * loads — so give up after this and fall back to the coordinates.
 */
export const GEOCODE_TIMEOUT_MS = 6000

const coords = (lat: number, lon: number) => `${lat.toFixed(4)}, ${lon.toFixed(4)}`

export function usePendingSpot(
  geocode: (lat: number, lon: number) => Promise<string> = reverseGeocode,
) {
  const pending = ref<PendingForm | null>(null)
  // Bumped by every new click, spot pick, cancel and confirm, so a slow
  // geocode from an older request can never write into the sheet.
  let token = 0
  // Fields the user changed while the place was loading — the geocode must not
  // overwrite them.
  const touched = new Set<'name' | 'waterType'>()

  async function startAt(lat: number, lon: number) {
    const mine = ++token
    touched.clear()
    // The nearby-spot inference needs no network, so the sheet starts with it;
    // the geocoded name only refines the water type ("…sø", "…havn").
    const nearby = findNearbySpots(lat, lon, 40).slice(0, 5)
    const close = findNearbySpots(lat, lon, SPECIES_RADIUS_KM)
    pending.value = {
      lat, lon, name: '',
      waterType: smartDetectWaterType(lat, lon, '', nearby),
      bottomType: inferBottomType(nearby),
      species: nearbySpecies(close.length ? close : nearby),
      nearbyCount: nearby.length,
      loading: true,
      guessed: true,
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const name = await Promise.race([
      geocode(lat, lon),
      new Promise<string>((r) => { timer = setTimeout(() => r(coords(lat, lon)), GEOCODE_TIMEOUT_MS) }),
    ])
    clearTimeout(timer)
    const p = pending.value
    if (mine !== token || !p) return // dismissed, confirmed or superseded meanwhile
    if (!touched.has('name')) p.name = name
    if (!touched.has('waterType')) p.waterType = smartDetectWaterType(lat, lon, name, nearby)
    p.loading = false
  }

  function startFromSpot(spot: Spot) {
    token++ // invalidate any in-flight map-click geocode
    touched.clear()
    pending.value = {
      lat: spot.lat, lon: spot.lon, name: spot.name, waterType: spot.waterType,
      bottomType: spot.bottomType, depth: spot.depth,
      // Its own species, as locationFromSpot copies them, this month's first.
      species: nearbySpecies([{ ...spot, distKm: 0 }]),
      nearbyCount: 0, loading: false, guessed: false,
    }
  }

  /** The species the sheet lists, and Add saves: those of `species` that live in the water type picked. */
  const shown = computed(() => (pending.value ? fitWaterType(pending.value.species, pending.value.waterType) : []))

  /** The user edited a field; a late geocode leaves it alone. A water type they picked is no longer a guess. */
  function touch(field: 'name' | 'waterType') {
    touched.add(field)
    if (field === 'waterType' && pending.value) pending.value.guessed = false
  }

  function cancel() {
    token++
    pending.value = null
  }

  /**
   * The location to save, or null while the place is still loading. A blank
   * name falls back to the coordinates rather than saving an empty one.
   */
  function toLocation(): Omit<Location, 'id'> | null {
    const p = pending.value
    if (!p || p.loading) return null
    return {
      name: p.name.trim() || coords(p.lat, p.lon),
      lat: p.lat, lon: p.lon, waterType: p.waterType, bottomType: p.bottomType,
      // What the sheet showed, from the nearby official spots — without
      // species the spot can't earn the relevance bonus and would score below
      // an official spot beside it.
      species: shown.value.map(({ nameEn, months }) => ({ nameEn, months: [...months] })),
      ...(p.depth ? { depth: p.depth } : {}),
    }
  }

  return { pending, shown, startAt, startFromSpot, touch, cancel, toLocation }
}
