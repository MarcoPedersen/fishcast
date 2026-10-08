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
 * Kept out of MapView so the node tests can drive those races.
 */
import { ref } from 'vue'
import { spName } from './i18n'
import { findNearbySpots, activeSpeciesInMonth, type Spot } from './spots'
import { reverseGeocode, smartDetectWaterType, inferSpecies, inferBottomType, speciesFromNearby } from './geo'
import type { Location, WaterType } from './types'

export interface PendingForm {
  lat: number; lon: number; name: string; waterType: WaterType
  bottomType: string; speciesNames: string[]; nearbyCount: number; loading: boolean
  /** Only an official spot knows it (torsk's 'deep' bonus reads it); a tapped point never does. */
  depth?: Location['depth']
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
    pending.value = {
      lat, lon, name: '',
      waterType: smartDetectWaterType(lat, lon, '', nearby),
      bottomType: inferBottomType(nearby),
      speciesNames: inferSpecies(nearby).slice(0, 6).map((s) => spName(s as any)),
      nearbyCount: nearby.length,
      loading: true,
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
    const month = new Date().getMonth() + 1
    pending.value = {
      lat: spot.lat, lon: spot.lon, name: spot.name, waterType: spot.waterType,
      bottomType: spot.bottomType, depth: spot.depth,
      speciesNames: activeSpeciesInMonth(spot, month).map((s) => spName(s as any)),
      nearbyCount: 0, loading: false,
    }
  }

  /** The user edited a field; a late geocode leaves it alone. */
  function touch(field: 'name' | 'waterType') { touched.add(field) }

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
      // Inferred from nearby official spots — without this the spot can't earn
      // the relevance bonus and would score below an official spot beside it.
      species: speciesFromNearby(p.lat, p.lon),
      ...(p.depth ? { depth: p.depth } : {}),
    }
  }

  return { pending, startAt, startFromSpot, touch, cancel, toLocation }
}
