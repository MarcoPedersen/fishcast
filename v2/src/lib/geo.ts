/**
 * Geo helpers ported from v1: reverse geocoding + smart inference of
 * species / water type / bottom type from nearby official spots.
 */
import { shownLang } from './i18n'
import { DK_SPOTS, catalogueSpotAt, findNearbySpots, locationFromSpot, type NearbySpot, type SpotSpecies } from './spots'
import { countedSpeciesIds, fitWaterType } from './locationSpecies'
import { westCoastLagoonAt } from './lagoons'
import { HANSTHOLM_LON } from './ruleArea'
import { speaksForBottom, speaksForWater } from './waterCompat'
import type { Location, WaterType } from './types'

/** How far round a custom spot the official spots fill in its species. */
export const SPECIES_RADIUS_KM = 12

/**
 * Species (name + active months) merged from official spots near a point.
 *
 * Custom locations otherwise carry no species data, which silently costs them
 * the spot-relevance bonus in scoring (SCORE_WEIGHTS.relevanceMax, up to +15) —
 * so a hand-placed pin next to an official spot scored up to 15 points lower
 * for no real reason. Giving custom spots the same inferred data makes them
 * comparable.
 *
 * For a location of `waterType`: only the spots whose water can tell
 * (speaksForWater: no lake's species at the sea), and only the species that
 * fit it (fitWaterType: no sea fish in fresh water). Without a water type,
 * every spot's.
 */
export function speciesFromNearby(
  lat: number, lon: number, waterType?: WaterType, radiusKm = SPECIES_RADIUS_KM,
): { nameEn: string; months: number[] }[] {
  const merged = new Map<string, Set<number>>()
  for (const spot of findNearbySpots(lat, lon, radiusKm)) {
    if (!speaksForWater(spot.waterType, waterType)) continue
    for (const sp of spot.species ?? []) {
      if (!sp.nameEn) continue
      if (!merged.has(sp.nameEn)) merged.set(sp.nameEn, new Set())
      sp.months.forEach((m) => merged.get(sp.nameEn)!.add(m))
    }
  }
  return fitWaterType([...merged.entries()]
    .map(([nameEn, months]) => ({ nameEn, months: [...months].sort((a, b) => a - b) })), waterType)
}

/**
 * The lookup a change of water type runs again for a spot's species
 * (locationSpecies.ts changeWaterType), or none for an official spot: its
 * species are its own. One saved from the setup map has no spotSlug
 * (pendingSpot.toLocation), so it is known, as stores/coast.ts knows it, by
 * sitting within 30 m of one, or of a pin it had before the catalogue moved
 * it (catalogueSpotAt). Handed the lookup, Arresø saved from the map
 * and set to Brakvand lost every species, since a sea spot takes no lake's.
 */
export function speciesLookupFor(l: Pick<Location, 'lat' | 'lon' | 'spotSlug'>):
  ((waterType: WaterType | undefined) => { nameEn: string; months: number[] }[]) | undefined {
  if (l.spotSlug || catalogueSpotAt(l.lat, l.lon)) return undefined
  return (waterType) => speciesFromNearby(l.lat, l.lon, waterType)
}

/**
 * The species the spot card offers to put back on a list the user emptied
 * (LocationsView), and the refill puts on a list never filled
 * (stores/setup.ts enrichMissingSpecies). An official spot, known as
 * speciesLookupFor knows it, gets its own from the catalogue, not the
 * lookup's: Gurre Sø lists pike, perch and zander, and the lookup round it
 * adds sea trout. A custom spot gets what the official spots nearby give its
 * water type. Only species that fit the water type, and none at all when not
 * one of them counts: neither gives a list the score can't use. `own` says
 * which it is.
 */
export function speciesBackFor(l: Pick<Location, 'lat' | 'lon' | 'spotSlug' | 'waterType'>):
  { species: { nameEn: string; months: number[] }[]; own: boolean } | undefined {
  const spot = DK_SPOTS.find((s) => s.slug === l.spotSlug) ?? catalogueSpotAt(l.lat, l.lon)
  const own = !!(l.spotSlug || spot)
  const species = own
    ? fitWaterType(spot && locationFromSpot(spot).species, l.waterType)
    : speciesFromNearby(l.lat, l.lon, l.waterType)
  return countedSpeciesIds(species, l.waterType).length ? { species, own } : undefined
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const fallback = `${lat.toFixed(4)}, ${lng.toFixed(4)}`
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=17&addressdetails=1&accept-language=${shownLang.value}`
    const res = await fetch(url)
    const data = await res.json()
    const a = data.address || {}
    const specific = a.amenity || a.tourism || a.leisure || a.natural || a.man_made
    const road = a.road || a.path || a.footway
    const place = a.hamlet || a.quarter || a.suburb || a.village || a.town || a.city
    if (specific && place) return `${specific}, ${place}`
    if (specific) return specific
    if (road && place) return `${road}, ${place}`
    if (place) return place
    return fallback
  } catch {
    return fallback
  }
}

export interface InferredSpecies extends SpotSpecies {
  score: number
}

/** Distance-weighted species inference from nearby spots, boosted by current month. */
export function inferSpecies(nearby: NearbySpot[]): InferredSpecies[] {
  const month = new Date().getMonth() + 1
  const map = new Map<string, InferredSpecies>()
  for (const spot of nearby) {
    const weight = 1 / (spot.distKm + 0.5)
    for (const sp of spot.species || []) {
      if (!map.has(sp.name)) map.set(sp.name, { ...sp, score: 0 })
      const e = map.get(sp.name)!
      e.score += weight
      if (sp.months.includes(month)) e.score += weight * 0.6
    }
  }
  return [...map.values()].sort((a, b) => b.score - a.score)
}

/**
 * How far (km, as findNearbySpots rounds it) an official lake or river spot
 * decides 'fresh' for a place whose name doesn't say lake or river. A lake
 * spot is one point on a shore; 7 km off it, Hornbæk is a harbour town.
 */
const FRESH_NEAR_KM = 2

/**
 * How far an official lake or river spot backs a name that is one word
 * ending in -sø: Arresø's spot is 3 km from the point the search gives,
 * Julsø's 7. The same as the close-spot reach below.
 */
const LAKE_NAME_NEAR_KM = 8

/**
 * Names that end in -sø but are no lake: the seas, the islands, and a
 * coastal village the coastal words below don't catch (Havnsø and Vigsø they do).
 * A village elsewhere needs no entry: such a name counts only beside an
 * official lake or river spot (LAKE_NAME_NEAR_KM).
 */
const NOT_LAKES = new Set([
  'nordsø', 'østersø',
  'agersø', 'barsø', 'brandsø', 'christiansø', 'dybsø', 'frederiksø', 'læsø', 'romsø', 'samsø', 'vigelsø', 'vorsø',
  'gudsø',
])

/**
 * A word of the name ends like a lake's: "Arresø", "Julsø", "Silkeborg
 * Langsø", "Furesøen". Only a separate "Sø" counted ("Esrum Sø"), so a
 * search for Arresø, Julsø or Mossø called the lake brackish. But a word
 * like that names a village or a coast as often (Reersø, Vedersø Klit,
 * Drejø's Søndersø), so smartDetectWaterType asks for an official lake or
 * river spot near as well. A name with a coastal word in it is no lake by
 * this (Havnsø, Vigsø).
 */
function nameHasLake(name: string): boolean {
  return (name.match(/[a-zæøå]+/g) ?? []).some((word) => {
    const w = word.endsWith('søen') ? word.slice(0, -2) : word
    return w.length > 2 && w.endsWith('sø') && !NOT_LAKES.has(w)
  })
}

/**
 * A line 2–3 km behind the Skagerrak's open shore, from Hanstholm to the tip
 * of Grenen, as [lat, lon] west to east. North of it lie that coast's beach,
 * dunes and villages, and the sea off them. The Skagerrak off Jutland is
 * about as salt as the North Sea, but only west of Hanstholm did the guess
 * say salt: Hanstholm, Blokhus, Løkken and Hirtshals came out brackish. No
 * official spot lies on that coast to say otherwise.
 *
 * Drawn from the shore as the OpenStreetMap contributors map it (data under
 * the ODbL): 2.5 km inland, simplified to within 500 m. The villages on the
 * coast lie within 1.7 km of the shore (Tversted), the towns behind it 5 km
 * and more (Saltum, Fjerritslev): those are guessed as any inland town is.
 * The Limfjord lies 8 km and more behind the line, so it keeps its guess.
 * At Skagen the line runs down the middle of the spit, to within 150 m, out
 * to Grenen's tip: the town and its harbour face the Kattegat, which keeps
 * its guess too (brackish, as the catalogue has every Kattegat spot).
 */
const SKAGERRAK_BACK: readonly (readonly [number, number])[] = [
  [57.102, HANSTHOLM_LON], [57.076, 8.76], [57.096, 8.88], [57.133, 8.98], [57.134, 9.03], [57.119, 9.11],
  [57.116, 9.19], [57.123, 9.29], [57.144, 9.42], [57.2, 9.55], [57.232, 9.6], [57.366, 9.75],
  [57.463, 9.83], [57.504, 9.9], [57.57, 9.97], [57.567, 10.11], [57.576, 10.2], [57.619, 10.35],
  [57.668, 10.45], [57.723, 10.55], [57.739, 10.6],
  [57.748, 10.656], // Grenen's tip
]

/** Whether the point lies north of SKAGERRAK_BACK: on the Skagerrak's open coast, or at sea off it. */
function onSkagerrakCoast(lat: number, lon: number): boolean {
  if (lat >= 58.0 || lon < SKAGERRAK_BACK[0][1]) return false
  for (let i = 1; i < SKAGERRAK_BACK.length; i++) {
    const [aLat, aLon] = SKAGERRAK_BACK[i - 1]
    const [bLat, bLon] = SKAGERRAK_BACK[i]
    if (lon <= bLon) return lat > aLat + ((lon - aLon) / (bLon - aLon)) * (bLat - aLat)
  }
  return false
}

/**
 * Water-type detection: close spots → name keywords → the west coast, its
 * lagoons apart, and the Skagerrak's open coast → brackish default.
 *
 * It says 'fresh' only on a strong sign — a name that says lake or river
 * ("Esrum Sø", "Odense Å"), a one-word lake name ("Arresø") with an official
 * lake or river spot within LAKE_NAME_NEAR_KM, or such a spot within
 * FRESH_NEAR_KM — because the two mistakes differ. A wrong salt or
 * brackish is caught only when the coast lookup finds a lake or river
 * nearest and no sea within reach (coast.ts 'inland'): a guess then turns
 * fresh (waterGuess.ts guessFollowsMap), and a type the user picked is asked
 * about. Sea found far off, no water near the pin, or no lookup at all
 * (offline) catch nothing: an inland town such as Hinnerup, or a village a
 * few km from its lake such as Bryrup, stays brackish and is scored with
 * the nearest station's tide and sea temperature. A wrong fresh is never
 * caught: the spot gets no tide, sea temperature or coast direction, the
 * check never runs for it, and the species picker offers only lake fish.
 * That is the worse of the two, so the guess takes the first. Hornbæk, Gilleleje,
 * Tisvildeleje and Dronningmølle were fresh by a lake 3–8 km inland, the only
 * official spot within 8 km; Ebeltoft, Horsens and Mariager by a zone rule
 * that called East Jutland east of 9.8° fresh — its coast, not its lakes.
 */
export function smartDetectWaterType(
  lat: number, lon: number, placeName: string, nearby: NearbySpot[],
): WaterType {
  const name = (placeName || '').toLowerCase()
  const nameIsCoastal = /fjord|vig|bugt|havn|strand|odde|næs|holm|rev|kyst|klint|mole|pynt/.test(name)
  // NB: JS \b treats æ/ø/å as non-word chars, so /\bsø\b/ matches inside
  // "Sønderborg" — use explicit Danish-letter lookarounds instead.
  const lakeSpotNear = nearby.some((s) => s.waterType === 'fresh' && s.distKm <= LAKE_NAME_NEAR_KM)
  const nameIsFresh = /(?<![a-zæøå])(søen|sø|lake|dam|mose|kanal)(?![a-zæøå])/.test(name)
    || /(?<![a-zæøå])å(?![a-zæøå])|aaen|vandl|river/.test(name)
    || (!nameIsCoastal && lakeSpotNear && nameHasLake(name))

  if (nearby.length) {
    const close = nearby.filter((s) => {
      if (s.distKm > 8) return false
      if (nameIsCoastal && s.waterType === 'fresh') return false
      if (nameIsFresh && s.waterType !== 'fresh') return false
      if (!nameIsFresh && s.waterType === 'fresh' && s.distKm > FRESH_NEAR_KM) return false
      return true
    })
    if (close.length) {
      const weighted: Record<string, number> = {}
      close.forEach((s) => { weighted[s.waterType] = (weighted[s.waterType] || 0) + 1 / (s.distKm + 0.5) })
      return Object.entries(weighted).sort((a, b) => b[1] - a[1])[0][0] as WaterType
    }
  }

  if (nameIsFresh) return 'fresh'
  // West of Hanstholm the North Sea, but not in the lagoons behind its dunes
  // (lagoons.ts): Ringkøbing Fjord and Nissum Fjord were salt by it. East of
  // it the Skagerrak's open coast.
  const westCoast = lon < HANSTHOLM_LON && lat > 54.5 && lat < 58.0
  if (westCoast) return westCoastLagoonAt(lat, lon) ? 'brackish' : 'salt'
  return onSkagerrakCoast(lat, lon) ? 'salt' : 'brackish'
}

/**
 * How far round a searched place or a tapped pin the official spots guess
 * its water type (the five nearest, smartDetectWaterType) and its bottom
 * type (inferBottomType).
 */
export const GUESS_RADIUS_KM = 40

/** How many official spots vote on a bottom type. */
const BOTTOM_VOTERS = 5

/**
 * The bottom type most of the official spots near a place have: of `nearby`
 * (findNearbySpots, nearest first), the five nearest whose water can tell
 * (speaksForBottom), or the five nearest when none can; a tie goes to the
 * nearer. Lakes voted on the sea: once Gurre Sø sat on its lake, it and
 * Esrum Sø gave Espergærde, Humlebæk and Hornbæk on the Sound their 'mixed'
 * over Helsingør Kysten's 'stone', and so no slip warning for waders
 * (conditions.ts safetyRec). A place set to fresh took the coast's stone the
 * same way. The five nearest of its water, not those among the five nearest:
 * Hillerød's five nearest are four lakes and Helsingør Kysten 23 km off,
 * which alone would have said 'stone' there. Without a water type, the five
 * nearest of every kind. With none of its water near, 'mixed', what the
 * safety advice assumes of an unknown bottom: the other water's said
 * nothing, and gave a lake the coast's slip or weever note.
 */
export function inferBottomType(nearby: NearbySpot[], waterType?: WaterType): string {
  const fit = nearby.filter((s) => speaksForBottom(s.waterType, waterType))
  const counts: Record<string, number> = {}
  for (const s of fit.slice(0, BOTTOM_VOTERS)) {
    if (s.bottomType) counts[s.bottomType] = (counts[s.bottomType] || 0) + 1
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'mixed'
}

/**
 * The guess a change of water type runs again for a spot's bottom type
 * (LocationsView setWater), or none for an official spot: its bottom type is
 * its own. Known as speciesLookupFor knows it, by its slug or its pin.
 */
export function bottomLookupFor(l: Pick<Location, 'lat' | 'lon' | 'spotSlug'>):
  ((waterType: WaterType | undefined) => string) | undefined {
  if (l.spotSlug || catalogueSpotAt(l.lat, l.lon)) return undefined
  return (waterType) => inferBottomType(findNearbySpots(l.lat, l.lon, GUESS_RADIUS_KM), waterType)
}
