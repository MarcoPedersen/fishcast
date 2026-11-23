/**
 * A spot from a share link, as the location the recipient saves. Kept out of
 * share.ts: App.vue loads that at start, and this reads the spot catalogue.
 */
import { CATALOGUE_MATCH_KM, DK_SPOTS, catalogueSpotAt, locationFromSpot, movedSpotAt, type Spot } from './spots'
import { fitWaterType } from './locationSpecies'
import { haversine } from './math'
import { pairSpots, sameWindow } from './sameSpot'
import type { Availability, FishingMethod, Location, WaterType } from './types'
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
      // None of them fit: still nothing known of the sharer's, so never
      // filled, not an empty list, which is one the user cleared.
      const own = fitWaterType(saved.species, loc.waterType)
      if (!loc.species && own.length) loc.species = own
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

/**
 * What a link gives a spot the user has already: what the scorer reads and
 * the user's copy never had, none of it shown on the spot's card as a value
 * of their own. A coast the user's copy lacks is automatic (the coast
 * picker's choice), and a water type it lacks shows as Brakvand: both are
 * the user's, as an emptied species list is. Taken as blanks, the sharer's
 * hand-picked coast replaced the user's automatic one.
 */
const FILLS = ['spotSlug', 'depth', 'bottomType', 'species'] as const

/**
 * A shared setup's spots (locationsFromSharedSetup) put in place of the
 * user's own. A spot the user has already stays theirs: its id, ★, note,
 * name, water, coast and every value of their own, taking from the link only
 * what theirs lacks of FILLS (a depth, a slug, a bottom, species never
 * filled). The link's copy replaced it whole, and with the id went the link
 * from each catch logged there (CatchEntry.locationId). A spot the user has
 * is one at the same place, or a copy of the same official spot at any of
 * its pins (sameSpot.ts pairSpots), as a shared window's spot is known
 * (WelcomeView). The link's other spots are new; the user's spots the link
 * lacks go, as the import says.
 */
export function keepOwnCopies(incoming: readonly Omit<Location, 'id'>[], own: readonly Location[], newId: () => string, spots: readonly Spot[] = DK_SPOTS): Location[] {
  const twins = new Map<object, Spot | undefined>()
  const twin = (l: Pick<Location, 'lat' | 'lon'>) => {
    if (!twins.has(l)) twins.set(l, catalogueSpotAt(l.lat, l.lon, spots))
    return twins.get(l)
  }
  const pairs = pairSpots(incoming, own, (a, b) => !!twin(a) && twin(a) === twin(b))
  return incoming.map((l, i) => {
    const mine = pairs[i]
    if (!mine) return { id: newId(), ...l }
    const kept = Object.fromEntries(Object.entries(mine).filter(([, v]) => v !== undefined)) as Location
    for (const k of FILLS) if (kept[k] === undefined && l[k] !== undefined) Object.assign(kept, { [k]: l[k] })
    return kept
  })
}

/**
 * A shared setup's windows put in place of the user's own. A window the user
 * has already (sameWindow) stays theirs, id and all, each one once; the
 * link's others are new, with the shore as their method when the link names
 * none. Counted as replaced, the user's own setup's link read as taking
 * every window away.
 */
export function keepOwnWindows(incoming: SharedSetup['av'], own: readonly Availability[], newId: () => string): Availability[] {
  const free = [...own]
  return incoming.map((a) => {
    const w = { days: a.d, from: a.f, to: a.t, methods: (a.m ?? ['shore']) as FishingMethod[] }
    const i = free.findIndex((o) => sameWindow(o, w))
    return i < 0 ? { id: newId(), ...w } : free.splice(i, 1)[0]
  })
}

/** A setup as the user holds it, and as taking in a shared one leaves it. */
export interface OwnSetup { locations: Location[]; targetSpecies: string[]; availability: Availability[] }

/**
 * A shared setup taken in over the user's own, part by part: its spots
 * (keepOwnCopies), its target species and its windows (keepOwnWindows). A
 * part the link holds none of keeps the user's own. Taken whole, a link
 * without windows left the dashboard nothing to show, and one without spots
 * or target species put none in place of the user's.
 */
export function takeInSetup(s: Pick<SharedSetup, 'locs' | 'sp' | 'av' | 'legacy'>, own: OwnSetup, newId: () => string, spots: readonly Spot[] = DK_SPOTS): OwnSetup {
  return {
    locations: s.locs.length ? keepOwnCopies(locationsFromSharedSetup(s, spots), own.locations, newId, spots) : own.locations,
    targetSpecies: s.sp.length ? [...s.sp] : own.targetSpecies,
    availability: s.av.length ? keepOwnWindows(s.av, own.availability, newId) : own.availability,
  }
}

/** How many of the user's spots (📍), target species (🎯) and windows (⏱). */
export interface SetupCounts { spots: number; species: number; windows: number }

/**
 * What taking in `s` (takeInSetup) takes away from the user's setup, and
 * what of it stays. The import's question counted all the user had as
 * replaced: a spot the user has, kept with its ★ and note, was counted as
 * lost, and a link of the user's own setup read as losing everything.
 */
export function importEffect(s: Pick<SharedSetup, 'locs' | 'sp' | 'av' | 'legacy'>, own: OwnSetup, spots: readonly Spot[] = DK_SPOTS): { gone: SetupCounts; kept: SetupCounts } {
  const NEW = '\u0000new' // no saved spot's or window's id
  const after = takeInSetup(s, own, () => NEW, spots)
  const ids = (xs: readonly { id: string }[]) => new Set(xs.map((x) => x.id).filter((id) => id !== NEW))
  const spotIds = ids(after.locations)
  const windowIds = ids(after.availability)
  const kept: SetupCounts = {
    spots: own.locations.filter((l) => spotIds.has(l.id)).length,
    species: own.targetSpecies.filter((id) => after.targetSpecies.includes(id)).length,
    windows: own.availability.filter((a) => windowIds.has(a.id)).length,
  }
  const gone: SetupCounts = {
    spots: own.locations.length - kept.spots,
    species: own.targetSpecies.length - kept.species,
    windows: own.availability.length - kept.windows,
  }
  return { gone, kept }
}
