/**
 * A spot from a share link, as the location the recipient saves. Kept out of
 * share.ts: App.vue loads that at start, and this reads the spot catalogue.
 */
import { DK_SPOTS, locationFromSpot, type Spot } from './spots'
import { haversine } from './math'
import type { Location, WaterType } from './types'
import type { SharedLoc } from './share'

/** An official spot this close is the one a location was saved from — the coast store's catalogue radius (stores/coast.ts). */
export const CATALOGUE_MATCH_KM = 0.03

/**
 * Everything the sharer's spot carries that the scorer reads: its depth
 * (makrel's and torsk's 'deep' bonus), its official slug and its species (the
 * spot-relevance bonus), with the place, water, bottom and coast. Imported as
 * name and place alone, the same deep spot scored up to 8 points lower for
 * the recipient than for the sharer.
 *
 * `legacy`: the link predates depth, slug and species, so what it lacks is
 * unknown rather than absent. A spot sitting on an official one was most
 * likely saved from it (locationFromSpot), so it takes that spot's depth,
 * slug and species. Left to enrichMissingSpecies, the species came from the
 * spots nearby, and the same official spot still scored up to 15 points
 * apart. Any other spot's species are still filled in that way.
 */
export function locationFromShared(l: SharedLoc, legacy: boolean, spots: readonly Spot[] = DK_SPOTS): Omit<Location, 'id'> {
  const loc: Omit<Location, 'id'> = {
    name: l.n, lat: l.la, lon: l.lo, waterType: l.wt as WaterType | undefined, bottomType: l.bt,
    ...(l.co && { coast: l.co }),
    ...(l.sl && { spotSlug: l.sl }),
    ...(l.dp && { depth: l.dp }),
    ...(l.ss && { species: l.ss }),
  }
  if (legacy && !loc.depth && !loc.spotSlug) {
    const twin = spots.find((s) => haversine(l.la, l.lo, s.lat, s.lon) <= CATALOGUE_MATCH_KM)
    if (twin) {
      const saved = locationFromSpot(twin) // copied as a saved spot copies them
      loc.spotSlug = saved.spotSlug
      loc.depth = saved.depth
      if (!loc.species) loc.species = saved.species
    }
  }
  return loc
}
