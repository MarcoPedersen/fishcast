/**
 * "Compare with official spots" on the dashboard map: which official spots to
 * score, how to fetch their weather, and when one is worth recommending over
 * your own. Kept out of MapTab so the node tests can cover it; only
 * loadOfficialForecasts touches the network.
 *
 * Official spots are scored with the SAME engine as your own, so the numbers
 * are directly comparable — which only holds if they also get the same
 * lightning cap and the same horizon and ended-window filtering your own
 * windows get on the dashboard (leadDays / useNotEnded there; daysAhead and
 * windowEndMs here, on the same local-day encoding).
 */
import { localDayUTC } from './clock'
import { freshEnough, mergeRefetch, wavesNotLoaded } from './forecastFreshness'
import { haversine } from './math'
import { officialCache as cache, clearOfficialForecasts } from './officialCache'
import { getScoredWindows } from './scoring'
import { findNearbySpots, locationFromSpot } from './spots'
import { SPOT_COAST } from './spotCoast.gen'
import { resolveShore, type ShoreMap } from './coast'
import { windowEndMs } from './upcoming'
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
      // The same fields a saved copy of this spot gets — depth included, or
      // the official twin and your saved copy of one spot would score apart.
      seen.set(key, { dist: s.distKm, loc: { id: 'off-' + key, ...locationFromSpot(s) } })
    }
  }
  return [...seen.values()].sort((a, b) => a.dist - b.dist).slice(0, MAX_COMPARE)
}

const DAY_MS = 86400000

/**
 * Whole days from today (local calendar day) to a window's date (UTC midnight
 * of its day) — the dashboard's leadDays, from the same localDayUTC. -1 is
 * last night's overnight window while it still runs; it counts as today.
 */
export function daysAhead(d: Date, now = new Date()): number {
  return Math.round((d.getTime() - localDayUTC(now.getTime())) / DAY_MS)
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
  /** Your own spots' resolved coasts (stores/coast.ts shoreById), for the parity rule. */
  shores: ShoreMap
}

/**
 * The coast of each official twin: its precomputed catalogue value, on one
 * condition — every coastal spot of yours already has a known coast. Until
 * then the twins get none, or the map would recommend an official spot for
 * the very data your own pin beside it is still waiting for. A twin within
 * RADIUS_KM of a spot of yours whose coast is known to be off ('none', no
 * sea found, or waiting for your pick) gets none either: the map must not
 * recommend it for a reason your own spot there isn't scored on (critique
 * suggestion 8).
 */
export function twinShores(candidates: Candidate[], own: Location[], shores: ShoreMap): ShoreMap {
  const out: ShoreMap = {}
  const coastal = own.filter((l) => l.waterType !== 'fresh')
  if (!coastal.every((l) => l.id in shores)) return out
  const off = coastal.filter((l) => shores[l.id] === null)
  for (const c of candidates) {
    if (off.some((l) => haversine(l.lat, l.lon, c.loc.lat, c.loc.lon) <= RADIUS_KM)) { out[c.loc.id] = null; continue }
    const e = c.loc.spotSlug ? SPOT_COAST[c.loc.spotSlug] : undefined
    out[c.loc.id] = resolveShore(c.loc, e && { ...e, at: 0 }) ?? null
  }
  return out
}

/**
 * Every scoreable official window in the horizon that hasn't ended. Pure — a
 * horizon change re-filters the forecasts already fetched instead of fetching
 * them again.
 *
 * Finished windows go, exactly as the dashboard drops your own. The map branch
 * kept them while the dashboard still kept yours; once the dashboard started
 * dropping them (useNotEnded), 19:00 on "I dag" showed your pins unscored
 * beside official pins still scored for a 14–18 that was over. MapTab runs
 * the result through useNotEnded too, so pins also drop as windows end.
 *
 * A sea spot whose waves failed to load (wavesNotLoaded) is left out until
 * they come: scored with no wave row it reads as calm water, and beside your
 * spot that kept its waves the map recommended it in a 1.74 m swell.
 */
export function officialWindows(i: OfficialInput, now = new Date()): ScoredWindow[] {
  const locs = i.candidates.map((c) => c.loc)
    .filter((l) => i.forecasts[l.id] && !wavesNotLoaded(i.forecasts[l.id], l))
  if (!locs.length || !i.availability.length) return []
  const lightning = inheritLightning(locs, i.own, i.lightning)
  return getScoredWindows(locs, i.availability, i.forecasts, i.targetSpecies, lightning, twinShores(i.candidates, i.own, i.shores ?? {}))
    .filter((w) => !w.noData && daysAhead(w.date, now) < i.horizon && windowEndMs(w) > now.getTime())
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
 * higher" for a window you can no longer fish helps nobody. (officialWindows
 * already drops them; this keeps the rule true for any list it's handed.)
 * `mine` is the best of your pins as shown: the banner says Y beats "your own
 * spots in this range", so it must be measured against exactly those.
 */
export function betterOfficial(
  mine: number, windows: ScoredWindow[], own: Location[],
  lightning: Record<string, LightningStatus>, now = new Date(),
): ScoredWindow | null {
  let best: ScoredWindow | null = null
  for (const w of windows) {
    if (w.noData || w.score <= mine) continue
    if (best && w.score <= best.score) continue
    if (windowEndMs(w) <= now.getTime()) continue
    if (lightningNear(w, own, lightning, now)) continue
    best = w
  }
  return best
}

// ── Fetching ───────────────────────────────────────────────────────────────
// The same freshness rule as the forecast store (forecastFreshness.ts): 3 h,
// 15 min after a failed tide or marine request, and never past local midnight.
// The cache itself lives in officialCache.ts, so the forecast store can clear
// it without importing this module (and the spot catalogue with it).
let inflight: { key: string; done: Promise<void> } | null = null
export { clearOfficialForecasts }

/**
 * Forecasts for the candidates, keyed by id. One batched fetchForecasts call
 * (one weather request, one marine request, tides shared per station) for
 * whichever candidates aren't cached and fresh — it used to be one sequential
 * fetchForecast round-trip per spot, repeated on every horizon change. A
 * refetch keeps the tides and waves a spot had where it failed to get them,
 * as your own spots do (mergeRefetch).
 *
 * Throws only when the batch itself fails; spots the batch had no weather for
 * are simply missing from the result.
 */
export async function loadOfficialForecasts(candidates: Location[]): Promise<Record<string, Forecast>> {
  const now = Date.now()
  const stale = candidates.filter((c) => !freshEnough(cache.get(c.id), now))
  if (stale.length) {
    const key = stale.map((c) => c.id).join('|')
    // Toggling compare off and on mid-fetch must not fire a second batch.
    if (inflight?.key !== key) {
      const done = fetchForecasts(stale).then((res) => {
        res.forEach((f, i) => {
          const kept = f && mergeRefetch(cache.get(stale[i].id), f)
          if (kept) cache.set(stale[i].id, kept)
        })
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
