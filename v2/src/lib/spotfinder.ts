/**
 * Spot finder ranking — TS port of v1 scoreSpotForSpecies / runLucky / runNearby.
 * Pure: real-time bonus inputs (saved locations + forecast keys) are passed in.
 */
import { t } from './i18n'
import { SPECIES_PREFS } from './species'
import { DK_SPOTS, findNearbySpots, type NearbySpot, type Spot } from './spots'
import { clamp, haversine } from './math'
import { waterCompatible } from './waterCompat'
import type { Location } from './types'

interface RealtimeCtx {
  locations: Location[]
  forecastIds: Set<string>
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
 */
export interface SpotResult { spot: NearbySpot | Spot; score: number; unlisted?: boolean }

function scoreFor(spot: Spot, targetSpecies: string[], month: number, ctx: RealtimeCtx): number | null {
  if (!targetSpecies.length) return scoreSpotGeneral(spot, month)
  const scores = targetSpecies
    .map((id) => scoreSpotForSpecies(spot, id, month, ctx))
    .filter((s): s is number => s !== null)
  return scores.length ? Math.max(...scores) : null
}

/** Lucky Cast: best hotspots across all Denmark, region-diversified, top 6. */
export function findLuckySpots(targetSpecies: string[], month: number, ctx: RealtimeCtx): SpotResult[] {
  const candidates = DK_SPOTS
    .map((spot) => {
      const score = scoreFor(spot, targetSpecies, month, ctx)
      return score !== null ? { spot, score } : null
    })
    .filter((c): c is SpotResult => c !== null)
    .sort((a, b) => b.score - a.score)

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
 * fill the 8 slots — they can never push a listed spot out.
 */
export function findNearbyRanked(
  lat: number, lon: number, radiusKm: number, targetSpecies: string[], month: number, ctx: RealtimeCtx,
): SpotResult[] {
  const listed: SpotResult[] = []
  const unlisted: SpotResult[] = []
  for (const spot of findNearbySpots(lat, lon, radiusKm)) {
    // Null only when targets are set and the spot lists none of them.
    const score = scoreFor(spot, targetSpecies, month, ctx)
    if (score !== null) {
      if (score > 0) listed.push({ spot, score })
      continue
    }
    const general = scoreSpotGeneral(spot, month)
    if (general > 0) unlisted.push({ spot, score: general, unlisted: true })
  }
  const byScore = (a: SpotResult, b: SpotResult) => b.score - a.score
  return [...listed.sort(byScore), ...unlisted.sort(byScore)].slice(0, 8)
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
