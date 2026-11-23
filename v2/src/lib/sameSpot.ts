/**
 * Which saved spots are one: a shared setup's spots taken in over the user's
 * own (shareImport.ts keepOwnCopies), and a guest's spots met by an account's
 * setup at sign-in (stores/setup.ts). Kept apart from lib/spots, so the setup
 * store can ask without loading the catalogue at start.
 */
import { haversine } from './math'
import type { Location } from './types'

/**
 * Pins this close are one place: the catalogue's radius (lib/spots
 * CATALOGUE_MATCH_KM, which a test holds this to). A copy of an official spot
 * sits on its pin, and a link carries a place as it was saved.
 */
export const SAME_PLACE_KM = 0.03

type Spotlike = Pick<Location, 'lat' | 'lon' | 'spotSlug'>

const km = (a: Spotlike, b: Spotlike) => haversine(a.lat, a.lon, b.lat, b.lon)
const sameSlug = (a: Spotlike, b: Spotlike) => !!a.spotSlug && a.spotSlug === b.spotSlug

/** One place (SAME_PLACE_KM), or copies of one official spot (its slug), wherever they sit. */
export function sameSpot(a: Spotlike, b: Spotlike): boolean {
  return km(a, b) <= SAME_PLACE_KM || sameSlug(a, b)
}

/**
 * Each of `incoming` paired with the one of `have` that is the same spot, or
 * undefined: first the nearest at its place, then one of the same official
 * spot by its slug, then by `also`, a test of the caller's own. Each of
 * `have` is paired once, so a sharer's two copies of one spot (one at its old
 * pin, one at its pin now) can't both become the user's one copy. By place
 * first: the user's copy at the pin now is the sharer's copy there, not the
 * one at the old pin that shares its slug.
 */
export function pairSpots<A extends Spotlike, B extends Spotlike>(
  incoming: readonly A[], have: readonly B[], also?: (a: A, b: B) => boolean,
): (B | undefined)[] {
  const out: (B | undefined)[] = incoming.map(() => undefined)
  const free = new Set(have.keys())
  incoming.forEach((a, i) => {
    let best = -1
    let bestKm = SAME_PLACE_KM
    for (const j of free) {
      const d = km(a, have[j])
      if (d <= bestKm) { best = j; bestKm = d }
    }
    if (best >= 0) { out[i] = have[best]; free.delete(best) }
  })
  for (const test of [sameSlug, also]) {
    if (!test) continue
    incoming.forEach((a, i) => {
      if (out[i]) return
      const j = [...free].find((k) => test(a, have[k]))
      if (j !== undefined) { out[i] = have[j]; free.delete(j) }
    })
  }
  return out
}
