/**
 * Geo helpers ported from v1: reverse geocoding + smart inference of
 * species / water type / bottom type from nearby official spots.
 */
import { lang } from './i18n'
import { findNearbySpots, type NearbySpot, type SpotSpecies } from './spots'
import type { WaterType } from './types'

/** How far round a custom spot the official spots fill in its species. */
export const SPECIES_RADIUS_KM = 12

/**
 * Species (name + active months) merged from official spots near a point.
 *
 * Custom locations otherwise carry no species data, which silently costs them
 * the spot-relevance bonus in scoring (up to +12) — so a hand-placed pin next
 * to an official spot scored ~10 points lower for no real reason. Giving custom
 * spots the same inferred data makes them comparable.
 */
export function speciesFromNearby(
  lat: number, lon: number, radiusKm = SPECIES_RADIUS_KM,
): { nameEn: string; months: number[] }[] {
  const merged = new Map<string, Set<number>>()
  for (const spot of findNearbySpots(lat, lon, radiusKm)) {
    for (const sp of spot.species ?? []) {
      if (!sp.nameEn) continue
      if (!merged.has(sp.nameEn)) merged.set(sp.nameEn, new Set())
      sp.months.forEach((m) => merged.get(sp.nameEn)!.add(m))
    }
  }
  return [...merged.entries()]
    .map(([nameEn, months]) => ({ nameEn, months: [...months].sort((a, b) => a - b) }))
}

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const fallback = `${lat.toFixed(4)}, ${lng.toFixed(4)}`
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=17&addressdetails=1&accept-language=${lang.value === 'en' ? 'en' : 'da'}`
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
 * spot is one point on a shore; 4 km off it, Hornbæk is a harbour town.
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
 * Water-type detection: close spots → name keywords → the west coast → brackish default.
 *
 * It says 'fresh' only on a strong sign — a name that says lake or river
 * ("Esrum Sø", "Odense Å"), a one-word lake name ("Arresø") with an official
 * lake or river spot within LAKE_NAME_NEAR_KM, or such a spot within
 * FRESH_NEAR_KM — because the two mistakes differ. A wrong
 * salt or brackish is caught: the coast check finds a lake or river on the
 * map and asks (coast.ts coastIssues 'inland'). A wrong fresh is not: the
 * spot gets no tide, sea temperature or coast direction, the check never runs
 * for it, and the species picker offers only lake fish. Hornbæk, Gilleleje,
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
  if (nameIsCoastal) return lon < 8.6 && lat > 54.5 && lat < 58.0 ? 'salt' : 'brackish'
  if (lon < 8.6 && lat > 54.5 && lat < 58.0) return 'salt'
  return 'brackish'
}

export function inferBottomType(nearby: NearbySpot[]): string {
  const counts: Record<string, number> = {}
  nearby.forEach((s) => { if (s.bottomType) counts[s.bottomType] = (counts[s.bottomType] || 0) + 1 })
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'mixed'
}
