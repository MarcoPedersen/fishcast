/**
 * Where a location lies for the Danish fishing rules.
 *
 * The 2026 minimum-size list (lfst "Fredning og mindstemål i saltvand 2026",
 * valid from 01.01.2026) has one column per sea area: "Nordsøen, herunder
 * Limfjorden og Ringkøbing Fjord", "Skagerrak/Kattegat" and "Bælterne og
 * Østersøen", and the recreational cod ban covers ICES subdivisions 22–32,
 * the last of those columns. Several closures name one water (Bornholm, the
 * Wadden Sea, the west-coast fjords). A location's water type alone can't place
 * it in any of them; its coordinates can.
 *
 * Boundaries (Commission Regulation (EC) No 2187/2005, Annex I, checked
 * 2026-11-06 on legislation.gov.uk):
 *  - ICES 22 starts south of the line Hasenøre Head (56°09′N 10°44′E) –
 *    Gniben Point (56°01′N 11°18′E); everything along the east coast of Jutland
 *    south-west of it (Aarhus Bay, Kalø Vig, Samsø, the Belts) is ICES 22.
 *  - ICES 23 (the Sound) starts at the line Gilbjerg Head (56°08′N 12°18′E) –
 *    Kullen (56°18′N 12°28′E). ICES 24/25 hold Bornholm.
 *  - The North Sea meets the Skagerrak at Hanstholm (8°36′E on the coast).
 * The Isefjord and Roskilde Fjord open north of Gniben, so they are Kattegat.
 *
 * The coastlines are drawn as boxes, not polygons. Within ~3 km of a boundary,
 * and inside the boxes for the fjords and the Wadden Sea, the answer is a hedge:
 * both areas, or a region that "maybe" applies. Guidance errs on caution — a
 * hedged rule is shown as "check where you fish", never as a flat closure.
 */

/** The lfst size-table columns. 'belts' = Bælterne og Østersøen = ICES 22–32. */
export type SeaArea = 'northSea' | 'skagerrak' | 'belts'
export const SEA_AREAS: readonly SeaArea[] = ['northSea', 'skagerrak', 'belts']

/**
 * Named waters with rules of their own.
 * - bornholm: the waters around Bornholm and its streams (sea trout in colour).
 * - wadden: Vadehavet (sea trout, salmon).
 * - ringkobing / stadil / nissum: the west-coast fjords; stadil includes Von Å.
 * - southZealand: the waters of BEK nr 1673 af 10/12/2025 by Sydsjælland, Møn,
 *   Lolland and Falster (pike and perch).
 */
export type RuleRegion = 'bornholm' | 'wadden' | 'ringkobing' | 'stadil' | 'nissum' | 'southZealand'
/** 'in' = certainly inside; 'maybe' = inside the box, which is coarser than the legal area. */
export type Membership = 'in' | 'maybe'

export interface RulePlace {
  /** The sea areas the point may be in: one, or two on a boundary. */
  areas: SeaArea[]
  regions: Partial<Record<RuleRegion, Membership>>
}

/** Within this many km of a boundary, both sides are possible. */
const MARGIN_KM = 3

type LatLon = [number, number]
const HASENORE: LatLon = [56.15, 10.7333]
const GNIBEN: LatLon = [56.0167, 11.3]
const GILBJERG: LatLon = [56.1333, 12.3]
const KULLEN: LatLon = [56.3, 12.4667]
/** Hanstholm, where the North Sea meets the Skagerrak. */
const HANSTHOLM_LON = 8.6
/** The Limfjord's mouth to the Kattegat at Hals. */
const LIMFJORD_EAST_LON = 10.33

/** km from p to the segment a–b (equirectangular — fine over a few tens of km). */
function kmToSegment(p: LatLon, a: LatLon, b: LatLon): number {
  const kx = 111.32 * Math.cos((p[0] * Math.PI) / 180), ky = 110.57
  const P = [p[1] * kx, p[0] * ky], A = [a[1] * kx, a[0] * ky], B = [b[1] * kx, b[0] * ky]
  const dx = B[0] - A[0], dy = B[1] - A[1]
  const t = Math.max(0, Math.min(1, ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(P[0] - (A[0] + t * dx), P[1] - (A[1] + t * dy))
}
const kmToLon = (lat: number, dLon: number) => Math.abs(dLon) * 111.32 * Math.cos((lat * Math.PI) / 180)
const kmToLat = (dLat: number) => Math.abs(dLat) * 110.57
const box = (lat: number, lon: number, s: number, n: number, w: number, e: number) =>
  lat >= s && lat <= n && lon >= w && lon <= e

/** The Limfjord, coarsely: its western broads, and the narrow eastern arm through Aalborg. */
function inLimfjord(lat: number, lon: number): boolean {
  return box(lat, lon, 56.45, 57.08, 8.15, 9.55) || box(lat, lon, 56.93, 57.08, 9.55, LIMFJORD_EAST_LON)
}

function seaAreas(lat: number, lon: number): SeaArea[] {
  // Bornholm and Christiansø: ICES 24 and 25.
  if (lon >= 14.4) return ['belts']
  if (inLimfjord(lat, lon)) {
    return kmToLon(lat, lon - LIMFJORD_EAST_LON) < MARGIN_KM ? ['northSea', 'skagerrak'] : ['northSea']
  }
  // The west coast (and the Wadden Sea), up to Hanstholm.
  if (lon < HANSTHOLM_LON) {
    return lat > 56.95 && kmToLon(lat, lon - HANSTHOLM_LON) < MARGIN_KM ? ['northSea', 'skagerrak'] : ['northSea']
  }
  if (lat >= 56.95) {
    // Jammerbugt, Skagen, Læsø, Aalborg Bay. Near Hanstholm or the Limfjord's
    // mouth it could still be North Sea.
    const nearNS = kmToLon(lat, lon - HANSTHOLM_LON) < MARGIN_KM ||
      (lat <= 57.08 + 0.03 && kmToLon(lat, lon - LIMFJORD_EAST_LON) < MARGIN_KM)
    return nearNS ? ['northSea', 'skagerrak'] : ['skagerrak']
  }
  if (lon < 8.7) return ['northSea']

  const both: SeaArea[] = ['skagerrak', 'belts']
  // Zealand's north coast and the Sound.
  if (lon >= GNIBEN[1]) {
    if (kmToSegment([lat, lon], GILBJERG, KULLEN) < MARGIN_KM) return both
    // East of Gilbjerg–Kullen: the Sound (ICES 23) and south of it.
    const cross = (KULLEN[1] - GILBJERG[1]) * (lat - GILBJERG[0]) - (KULLEN[0] - GILBJERG[0]) * (lon - GILBJERG[1])
    if (lon > GILBJERG[1] && cross < 0) return ['belts']
    // The Isefjord and Roskilde Fjord open to the Kattegat.
    if (box(lat, lon, 55.6, 55.99, 11.68, 12.12)) return ['skagerrak']
    if (lat >= 55.995) return ['skagerrak']
    // Sjællands Odde: a narrow spit between the Kattegat and Sejerø Bugt.
    if (lat >= 55.95 && lon <= 11.68) return both
    return ['belts']
  }
  // East Jutland and the open Kattegat west of Gniben.
  if (kmToSegment([lat, lon], HASENORE, GNIBEN) < MARGIN_KM) return both
  if (lon >= HASENORE[1]) {
    const lineLat = HASENORE[0] + ((lon - HASENORE[1]) * (GNIBEN[0] - HASENORE[0])) / (GNIBEN[1] - HASENORE[1])
    return lat > lineLat ? ['skagerrak'] : ['belts']
  }
  // West of Hasenøre, Djursland splits the water: its north coast and the
  // Randers and Mariager fjords face the Kattegat, its south side (Ebeltoft
  // Vig, Kalø Vig, Aarhus Bay) is ICES 22.
  if (kmToLat(lat - 56.4) < MARGIN_KM) return both
  return lat > 56.4 ? ['skagerrak'] : ['belts']
}

function regionsAt(lat: number, lon: number): Partial<Record<RuleRegion, Membership>> {
  const r: Partial<Record<RuleRegion, Membership>> = {}
  if (box(lat, lon, 54.95, 55.35, 14.6, 15.25)) r.bornholm = 'in'
  // The Danish Wadden Sea: the German border to Blåvandshuk.
  if (box(lat, lon, 54.9, 55.6, 8.0, 8.95)) r.wadden = 'maybe'
  if (box(lat, lon, 55.82, 56.12, 8.13, 8.42)) r.ringkobing = 'maybe'
  if (box(lat, lon, 56.12, 56.24, 8.11, 8.32)) r.stadil = 'maybe'
  if (box(lat, lon, 56.28, 56.42, 8.12, 8.32)) r.nissum = 'maybe'
  if (box(lat, lon, 54.55, 55.3, 11.3, 12.6)) r.southZealand = 'maybe'
  return r
}

/** The areas and regions a point may lie in. */
export function rulePlaceAt(lat: number, lon: number): RulePlace {
  return { areas: seaAreas(lat, lon), regions: regionsAt(lat, lon) }
}
