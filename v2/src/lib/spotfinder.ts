/**
 * Spot finder ranking — TS port of v1 scoreSpotForSpecies / runLucky / runNearby.
 * Pure: real-time bonus inputs (saved locations + forecast keys) are passed in.
 */
import { t } from './i18n'
import { SPECIES_PREFS } from './species'
import { DK_SPOTS, findNearbySpots, type NearbySpot, type Spot } from './spots'
import { clamp, haversine } from './math'
import { waterCompatible } from './waterCompat'
import { seasonFlagsOn } from './seasonGuard'
import type { Location } from './types'

interface RealtimeCtx {
  locations: Location[]
  forecastIds: Set<string>
  /**
   * The local day searched for (noon of it). A target closed at a spot that
   * day, by the rules the dashboard flags (lib/seasonGuard), doesn't make
   * the spot a pick: see SpotResult.closed. Left out, no rule is read.
   */
  day?: Date
}

/** Score one spot for one target species in a given month. Null if species not listed. */
function scoreSpotForSpecies(
  spot: Spot, speciesId: string, month: number, ctx: RealtimeCtx,
): number | null {
  const pref = SPECIES_PREFS[speciesId]
  if (!pref) return null
  const entry = spot.species?.find((s) => s.nameEn?.toLowerCase() === pref.nameEn?.toLowerCase())
  if (!entry) return null

  let score = 25 // base: species listed here

  const active = entry.months.includes(month)
  if (active) {
    score += 20
    const prev = month === 1 ? 12 : month - 1
    const next = month === 12 ? 1 : month + 1
    if (entry.months.includes(prev) && entry.months.includes(next)) score += 8
  } else {
    score -= 15
  }

  if (pref.bottomPref?.includes(spot.bottomType)) score += 8
  if (pref.depthPref === spot.depth) score += 5

  score += waterCompatible(pref.waterType, spot.waterType) ? 6 : -12

  const richness = spot.species?.filter((s) => s.months.includes(month)).length || 0
  score += Math.min(richness * 2, 8)

  const nearSaved = ctx.locations.find((l) => haversine(l.lat, l.lon, spot.lat, spot.lon) < 8)
  if (nearSaved && ctx.forecastIds.has(nearSaved.id)) score += 5

  return clamp(Math.round(score), 0, 100)
}

export function scoreSpotGeneral(spot: Spot, month: number): number {
  const active = spot.species?.filter((s) => s.months.includes(month)).length || 0
  return clamp(20 + active * 5, 0, 100)
}

/**
 * `unlisted`: the spot lists none of the target species — shown after the
 * spots that do, and its score is on the general scale, not the species one.
 * `closed`: every target the spot lists is closed there on the day searched
 * (cod at a Baltic spot during the ban, pike at a lake in April), these
 * ones. It still lists them, so it is shown, but after every spot where one
 * is open: Held og lykke put four of its six cod picks inside the ban.
 * `alsoClosed`: some of the targets the spot lists are closed there that
 * day, these ones, and another it lists is open (cod at Sletterhage in
 * November, sea trout open). It ranks as an open spot, on the open one's
 * score, and its card names the closed ones too.
 */
export interface SpotResult {
  spot: NearbySpot | Spot; score: number; unlisted?: boolean; closed?: string[]; alsoClosed?: string[]
}

/** Null: targets are set and the spot lists none of them. */
function scoreFor(
  spot: Spot, targetSpecies: string[], month: number, ctx: RealtimeCtx,
): { score: number; closed?: string[]; alsoClosed?: string[] } | null {
  if (!targetSpecies.length) return { score: scoreSpotGeneral(spot, month) }
  const open: number[] = []
  const shut: number[] = []
  const closed: string[] = []
  for (const id of targetSpecies) {
    const s = scoreSpotForSpecies(spot, id, month, ctx)
    if (s === null) continue
    if (ctx.day && seasonFlagsOn([id], spot, ctx.day).some((f) => f.level === 'closed')) {
      shut.push(s)
      closed.push(id)
    } else open.push(s)
  }
  if (open.length) return closed.length ? { score: Math.max(...open), alsoClosed: closed } : { score: Math.max(...open) }
  return shut.length ? { score: Math.max(...shut), closed } : null
}

/** Open spots first, each group best score first. */
const byOpenThenScore = (a: SpotResult, b: SpotResult) => Number(!!a.closed) - Number(!!b.closed) || b.score - a.score

/** Lucky Cast: best hotspots across all Denmark, region-diversified, top 6. */
export function findLuckySpots(targetSpecies: string[], month: number, ctx: RealtimeCtx): SpotResult[] {
  const candidates = DK_SPOTS
    .map((spot) => {
      const r = scoreFor(spot, targetSpecies, month, ctx)
      return r !== null ? { spot, ...r } : null
    })
    .filter((c): c is SpotResult => c !== null)
    .sort(byOpenThenScore)

  const regionCount: Record<string, number> = {}
  const results: SpotResult[] = []
  for (const c of candidates) {
    const r = (c.spot as Spot).region
    regionCount[r] = (regionCount[r] || 0) + 1
    if (regionCount[r] <= 2) results.push(c)
    if (results.length >= 6) break
  }
  return results
}

/**
 * Find Nearby: spots within radius of a point, top 8.
 *
 * With target species, spots that list none of them used to fall back to
 * scoreSpotGeneral (20 + 5 per active species) and were sorted into the same
 * list — a different scale, so a species-rich sea coast with no pike took the
 * gold medal for "Gedde" over the pike lakes. Spots that list a target now
 * always come first; the rest follow, marked `unlisted`, and are only there to
 * fill the 8 slots — they can never push a listed spot out. Of the listed
 * spots, those closed for every target they list come last (`closed`).
 */
export function findNearbyRanked(
  lat: number, lon: number, radiusKm: number, targetSpecies: string[], month: number, ctx: RealtimeCtx,
): SpotResult[] {
  const listed: SpotResult[] = []
  const unlisted: SpotResult[] = []
  for (const spot of findNearbySpots(lat, lon, radiusKm)) {
    // Null only when targets are set and the spot lists none of them.
    const r = scoreFor(spot, targetSpecies, month, ctx)
    if (r !== null) {
      if (r.score > 0) listed.push({ spot, ...r })
      continue
    }
    const general = scoreSpotGeneral(spot, month)
    if (general > 0) unlisted.push({ spot, score: general, unlisted: true })
  }
  const byScore = (a: SpotResult, b: SpotResult) => b.score - a.score
  return [...listed.sort(byOpenThenScore), ...unlisted.sort(byScore)].slice(0, 8)
}

/**
 * Localised spot type. The raw enum was rendered straight into the Danish UI,
 * so it read "🌊 coast" right next to a translated "Brakvand".
 */
const SPOT_TYPES = new Set(['coast', 'pier', 'river', 'lake'])
export function spotTypeLabel(type: string): string {
  return SPOT_TYPES.has(type) ? t('spottype_' + type) : type
}

export function spotTypeIcon(type: string): string {
  return type === 'pier' ? '⚓' : type === 'coast' ? '🌊'
    : type === 'river' ? '🌿' : type === 'lake' ? '💧' : '📍'
}
