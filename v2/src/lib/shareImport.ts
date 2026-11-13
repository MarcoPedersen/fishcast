/**
 * A spot from a share link, as the location the recipient saves. Kept out of
 * share.ts: App.vue loads that at start, and this reads the spot catalogue.
 */
import { CATALOGUE_MATCH_KM, DK_SPOTS, catalogueSpotAt, locationFromSpot, movedSpotAt, type Spot } from './spots'
import { fitWaterType } from './locationSpecies'
import { haversine } from './math'
import type { Location, WaterType } from './types'
import type { SharedLoc, SharedSetup } from './share'

export { CATALOGUE_MATCH_KM } from './spots'

/**
 * Everything the sharer's spot carries that the scorer reads: its depth
 * (makrel's and torsk's 'deep' bonus), its official slug and its species (the
 * spot-relevance bonus), with the place, water, bottom and coast. Imported as
 * name and place alone, the same deep spot scored up to 8 points lower for
 * the recipient than for the sharer.
 *
 * `legacy`: the link predates depth, slug and species, so what it lacks is
 * unknown rather than absent. A spot sitting on an official one (or on a
 * pin it had before the catalogue moved it) was most likely saved from it
 * (locationFromSpot), so it takes that spot's depth, slug and species.
 * Left to enrichMissingSpecies, the species came from the
 * spots nearby, and the same official spot still scored up to 15 points
 * apart. Any other spot's species are still filled in that way. Only those
 * that fit the water the link gives the spot (fitWaterType): a brackish spot
 * shared as Saltvand brought pike and zander the picker hides at salt, while
 * they still counted.
 *
 * A spot at an official spot's former pin (movedSpotAt), from a link of any
 * age, is saved at the spot's pin now: the sharer's copy predates the
 * correction, and kept at the old pin the recipient's new copy had its
 * weather fetched 2–7 km off (Gurre Sø's in the fields). The coast the sharer
 * picked there read the old place, so it is left out: the coast store gives
 * the spot its own (stores/coast.ts). `keepPin` keeps it at the old pin, its
 * coast too (locationsFromSharedSetup).
 */
export function locationFromShared(l: SharedLoc, legacy: boolean, spots: readonly Spot[] = DK_SPOTS, keepPin = false): Omit<Location, 'id'> {
  const moved = keepPin ? undefined : movedSpotAt(l.la, l.lo, spots)
  const loc: Omit<Location, 'id'> = {
    name: l.n, lat: moved?.lat ?? l.la, lon: moved?.lon ?? l.lo, waterType: l.wt as WaterType | undefined, bottomType: l.bt,
    ...(l.co && !moved && { coast: l.co }),
    ...(l.sl && { spotSlug: l.sl }),
    ...(l.dp && { depth: l.dp }),
    ...(l.ss && { species: l.ss }),
  }
  if (legacy && !loc.depth && !loc.spotSlug) {
    const twin = catalogueSpotAt(l.la, l.lo, spots)
    if (twin) {
      const saved = locationFromSpot(twin) // copied as a saved spot copies them
      loc.spotSlug = saved.spotSlug
      loc.depth = saved.depth
      if (!loc.species) loc.species = fitWaterType(saved.species, loc.waterType)
    }
  }
  return loc
}

/**
 * A shared setup's spots, as the locations the recipient saves
 * (locationFromShared). A spot at an official spot's former pin moves to the
 * spot's pin, unless the setup has the spot there already, or another copy
 * moves there first. A sharer who added the spot again at its pin now holds
 * two copies, and the old one's card says so (LocationsView). Both moved,
 * the recipient got two copies at the very same place, and no card said so.
 * The old one stays where it is, as the sharer's does.
 */
export function locationsFromSharedSetup(s: Pick<SharedSetup, 'locs' | 'legacy'>, spots: readonly Spot[] = DK_SPOTS): Omit<Location, 'id'>[] {
  const atPin = (sp: Spot) => s.locs.some((o) => haversine(o.la, o.lo, sp.lat, sp.lon) <= CATALOGUE_MATCH_KM)
  const taken = new Set<Spot>()
  return s.locs.map((l) => {
    const moved = movedSpotAt(l.la, l.lo, spots)
    const keepPin = !!moved && (taken.has(moved) || atPin(moved))
    if (moved) taken.add(moved)
    return locationFromShared(l, s.legacy, spots, keepPin)
  })
}
