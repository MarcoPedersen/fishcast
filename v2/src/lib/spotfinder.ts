/**
 * Spot finder ranking — TS port of v1 scoreSpotForSpecies / runLucky / runNearby.
 * Pure: real-time bonus inputs (saved locations + forecast keys) are passed in.
 */
import { SPECIES_PREFS } from './species'
import { DK_SPOTS, findNearbySpots, type NearbySpot, type Spot } from './spots'
import type { Location } from './types'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371, d1 = (lat2 - lat1) * Math.PI / 180, d2 = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(d1 / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(d2 / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

export interface RealtimeCtx {
  locations: Location[]
  forecastIds: Set<string>
}

/** Score one spot for one target species in a given month. Null if species not listed. */
export function scoreSpotForSpecies(
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

  const wtMatch = pref.waterType.includes(spot.waterType) ||
    (spot.waterType === 'brackish' && (pref.waterType.includes('salt') || pref.waterType.includes('fresh')))
  score += wtMatch ? 6 : -12

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

export interface SpotResult { spot: NearbySpot | Spot; score: number }

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

/** Find Nearby: spots within radius of a point, top 8. */
export function findNearbyRanked(
  lat: number, lon: number, radiusKm: number, targetSpecies: string[], month: number, ctx: RealtimeCtx,
): SpotResult[] {
  const out: SpotResult[] = []
  for (const spot of findNearbySpots(lat, lon, radiusKm)) {
    const score = targetSpecies.length
      ? (scoreFor(spot, targetSpecies, month, ctx) ?? scoreSpotGeneral(spot, month))
      : scoreSpotGeneral(spot, month)
    if (score > 0) out.push({ spot, score })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 8)
}

export function spotTypeIcon(type: string): string {
  return type === 'pier' ? '🪝' : type === 'coast' ? '🌊'
    : type === 'river' ? '🌿' : type === 'lake' ? '💧' : '📍'
}
