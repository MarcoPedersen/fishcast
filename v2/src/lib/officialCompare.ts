/**
 * "Compare with official spots" on the dashboard map: which official spots to
 * score, how to fetch their weather, and when one is worth recommending over
 * your own. Kept out of MapTab so the node tests can cover it; only
 * loadOfficialForecasts touches the network.
 *
 * Official spots are scored with the SAME engine as your own, so the numbers
 * are directly comparable — which only holds if they also get the same
 * lightning cap and the same horizon filtering your own windows get on the
 * dashboard. (The dashboard keeps today's finished windows; so do the pins.
 * Only the "spot Y is better" nudge skips them — see betterOfficial.)
 */
import { haversine } from './math'
import { getScoredWindows, isOvernight } from './scoring'
import { findNearbySpots } from './spots'
import { fetchForecasts } from './weather'
import type { Availability, Forecast, LightningStatus, Location, ScoredWindow } from './types'

export const MAX_COMPARE = 8
export const RADIUS_KM = 30
/**
 * How far one of your own spots' lightning reading is trusted for an official
 * spot beside it. Lightning is fetched per saved spot only; an official spot
 * 8 km away is under the same storm.
 */
export const LIGHTNING_INHERIT_KM = 25

export interface Candidate { loc: Location; dist: number }

/** Official spots near the user's spots, closest first, deduped, excluding ones already saved. */
export function compareCandidates(own: Location[]): Candidate[] {
  const seen = new Map<string, Candidate>()
  for (const o of own) {
    for (const s of findNearbySpots(o.lat, o.lon, RADIUS_KM)) {
      const key = s.slug ?? `${s.lat},${s.lon}`
      if (seen.has(key)) continue
      if (own.some((l) => Math.abs(l.lat - s.lat) < 1e-4 && Math.abs(l.lon - s.lon) < 1e-4)) continue
      seen.set(key, {
        dist: s.distKm,
        loc: {
          id: 'off-' + key, name: s.name, lat: s.lat, lon: s.lon,
          waterType: s.waterType, bottomType: s.bottomType, spotSlug: s.slug,
          species: s.species?.map((sp) => ({ nameEn: sp.nameEn, months: sp.months })),
        },
      })
    }
  }
  return [...seen.values()].sort((a, b) => a.dist - b.dist).slice(0, MAX_COMPARE)
}

const DAY_MS = 86400000

/** Whole days from today (local calendar day) to a window's date (UTC midnight of its day). */
export function daysAhead(d: Date, now = new Date()): number {
  return Math.round((d.getTime() - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / DAY_MS)
}

/** When a window ends, as a local instant — anchored the way scoreWindow anchors its hours. */
export function windowEnd(w: Pick<ScoredWindow, 'date' | 'from' | 'to'>): Date {
  const [h, m] = w.to.split(':').map(Number)
  const d = w.date
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + (isOvernight(w.from, w.to) ? 1 : 0), h, m || 0)
}

/**
 * Lightning for each official spot, taken from the nearest of your own spots
 * that has a reading, within LIGHTNING_INHERIT_KM. Without it the official
 * spots were scored uncapped next to your capped ones, and the map said
 * "spot Y (72) is better" for a spot inside the same thunderstorm.
 *
 * The distance in the reading was measured from YOUR spot, so it's dropped
 * rather than shown as if it were this spot's.
 */
export function inheritLightning(
  official: Location[], own: Location[], lightning: Record<string, LightningStatus>,
): Record<string, LightningStatus> {
  const out: Record<string, LightningStatus> = {}
  const withReading = own.filter((l) => lightning[l.id])
  for (const o of official) {
    let nearest: Location | null = null
    let best = Infinity
    for (const l of withReading) {
      const d = haversine(o.lat, o.lon, l.lat, l.lon)
      if (d < best) { best = d; nearest = l }
    }
    if (nearest && best <= LIGHTNING_INHERIT_KM) out[o.id] = { ...lightning[nearest.id], closestKm: null }
  }
  return out
}

export interface OfficialInput {
  candidates: Candidate[]
  forecasts: Record<string, Forecast>
  own: Location[]
  availability: Availability[]
  targetSpecies: string[]
  lightning: Record<string, LightningStatus>
  horizon: number
}

/**
 * Every scoreable official window in the horizon. Pure — a horizon change
 * re-filters the forecasts already fetched instead of fetching them again.
 *
 * Finished windows are kept, exactly as the dashboard keeps your own: dropping
 * them here took every official pin off the map at 19:00 on "I dag", beside
 * your own pins still showing today's 14–18, and said "no official spots
 * within 30 km".
 */
export function officialWindows(i: OfficialInput, now = new Date()): ScoredWindow[] {
  const locs = i.candidates.map((c) => c.loc).filter((l) => i.forecasts[l.id])
  if (!locs.length || !i.availability.length) return []
  const lightning = inheritLightning(locs, i.own, i.lightning)
  return getScoredWindows(locs, i.availability, i.forecasts, i.targetSpecies, lightning)
    .filter((w) => !w.noData && daysAhead(w.date, now) < i.horizon)
}

/** Best window per location. */
export function bestPerLocation(windows: ScoredWindow[]): Map<string, ScoredWindow> {
  const m = new Map<string, ScoredWindow>()
  for (const w of windows) {
    if (w.noData) continue
    const cur = m.get(w.location.id)
    if (!cur || w.score > cur.score) m.set(w.location.id, w)
  }
  return m
}

/**
 * True when strikes are reported at any of your own spots near this window's
 * spot and the window is today. Lightning is a right-now observation, so it
 * only bears on today's windows — the same rule the scoring cap uses.
 */
function lightningNear(
  w: ScoredWindow, own: Location[], lightning: Record<string, LightningStatus>, now: Date,
): boolean {
  if (daysAhead(w.date, now) > 0) return false
  return own.some((l) => {
    const s = lightning[l.id]
    return !!s && s.level !== 'clear'
      && haversine(l.lat, l.lon, w.location.lat, w.location.lon) <= RADIUS_KM
  })
}

/**
 * The official window worth recommending over your own best score, if any.
 * A spot today is never suggested while lightning is reported around your
 * spots near it: the inherited reading is only an estimate for that spot, and
 * "go somewhere else" during a thunderstorm is the one nudge that must not be
 * wrong.
 *
 * A window that is already over is never suggested either — "spot Y scores
 * higher" for a window you can no longer fish helps nobody. `mine` stays the
 * best of your pins as shown, finished windows included: the banner says Y
 * beats "your own spots in this range", so comparing against anything lower
 * than what your pins show could make that false. This way it only ever
 * suggests less, never wrongly.
 */
export function betterOfficial(
  mine: number, windows: ScoredWindow[], own: Location[],
  lightning: Record<string, LightningStatus>, now = new Date(),
): ScoredWindow | null {
  let best: ScoredWindow | null = null
  for (const w of windows) {
    if (w.noData || w.score <= mine) continue
    if (best && w.score <= best.score) continue
    if (windowEnd(w).getTime() <= now.getTime()) continue
    if (lightningNear(w, own, lightning, now)) continue
    best = w
  }
  return best
}

// ── Fetching ───────────────────────────────────────────────────────────────
// Same freshness rule as the forecast store: weather younger than this is reused.
const FRESH_MS = 3 * 60 * 60 * 1000
// Module scope, so it outlives MapTab, which is v-if'd and remounts every time
// you visit the Vinduer tab (the only place the horizon can be changed).
const cache = new Map<string, Forecast>()
let inflight: { key: string; done: Promise<void> } | null = null

/**
 * Forget the cached official forecasts. For "🗑 Ryd vejrdata": without it the
 * cache above outlived the wipe, and compare kept serving the old weather for
 * up to 3 h. (A batch already in flight is new weather, so it may still land.)
 */
export function clearOfficialForecasts(): void {
  cache.clear()
}

/**
 * Forecasts for the candidates, keyed by id. One batched fetchForecasts call
 * (one weather request, one marine request, tides shared per station) for
 * whichever candidates aren't cached and fresh — it used to be one sequential
 * fetchForecast round-trip per spot, repeated on every horizon change.
 *
 * Throws only when the batch itself fails; spots the batch had no weather for
 * are simply missing from the result.
 */
export async function loadOfficialForecasts(candidates: Location[]): Promise<Record<string, Forecast>> {
  const now = Date.now()
  const stale = candidates.filter((c) => {
    const f = cache.get(c.id)
    return !f || now - f.fetched >= FRESH_MS
  })
  if (stale.length) {
    const key = stale.map((c) => c.id).join('|')
    // Toggling compare off and on mid-fetch must not fire a second batch.
    if (inflight?.key !== key) {
      const done = fetchForecasts(stale).then((res) => {
        res.forEach((f, i) => { if (f) cache.set(stale[i].id, f) })
      })
      inflight = { key, done }
      const clear = () => { if (inflight?.done === done) inflight = null }
      done.then(clear, clear)
    }
    await inflight!.done
  }
  const out: Record<string, Forecast> = {}
  for (const c of candidates) {
    const f = cache.get(c.id)
    if (f) out[c.id] = f
  }
  return out
}
