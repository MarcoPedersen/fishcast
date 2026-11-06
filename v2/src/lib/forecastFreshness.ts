/**
 * When a fetched forecast is due a refetch, what a refetch keeps from the one
 * before, and when a sea spot's waves are missing: one set of rules for your
 * own spots (stores/forecast.ts) and the map compare's official spots
 * (officialCompare.ts). The compare kept its own copy, 3 h by age alone, while
 * the store learnt to retry an outage within 15 min and to keep the last
 * waves: an official twin fetched during a marine outage then sat without
 * waves for 3 h beside your spot that still had its own, and the map
 * recommended it in a 1.74 m swell your spot was penalised for.
 *
 * No store and no network here, so both sides (and their tests) can share it.
 */
import { localDayUTC } from './clock'
import { takesSeaData, type FetchedForecast } from './weather'
import type { Location } from './types'

// Weather younger than this is reused instead of refetched.
export const FRESH_MS = 3 * 60 * 60 * 1000
// A forecast whose tide or marine request failed (weather.ts tidesFailed,
// marineFailed) is retried after this instead: its "no tides" or "no waves" is
// an outage, and holding it for 3 h kept the tide factor off every coastal
// spot for a whole planning session — and the wave penalty off a spot in a
// dangerous swell, with the safety box reading 'ideal'.
export const PART_RETRY_MS = 15 * 60 * 1000

/**
 * Young enough and fetched today. Fetched on an earlier local day, its tides
 * end 03:00 after THAT day's 7th day (weather.ts tideSpan): after midnight the
 * list's new 7th day had none, and its coastal windows lost up to 12 points.
 * What it was fetched for (forecastKey) is the caller's to check: the store
 * keys by your spot as it is now.
 */
export function freshEnough(f: FetchedForecast | undefined, now = Date.now()): boolean {
  if (!f) return false
  if (localDayUTC(f.fetched) !== localDayUTC(now)) return false
  return now - f.fetched < (f.tidesFailed || f.marineFailed ? PART_RETRY_MS : FRESH_MS)
}

/**
 * The forecast to hold after a refetch: `f`, with the tides and waves `prev`
 * already had where this fetch failed to get them; or null when `prev` is the
 * newer one and stays. Only for a forecast of the same spot (fetchedFor).
 */
export function mergeRefetch(prev: FetchedForecast | undefined, f: FetchedForecast): FetchedForecast | null {
  if (!prev || prev.fetchedFor !== f.fetchedFor) return f
  // After a network failure the service worker may answer from its cache
  // with a copy that keeps its real, older fetch time (weather.ts
  // fetchedAt). Never let that replace a newer forecast for the spot.
  if (prev.fetched > f.fetched) return null
  // Tide predictions are astronomical, so the ones this spot already has
  // still hold for the hours they cover; a DMI blip on a refetch shouldn't
  // throw them away. Still marked failed, so the retry extends them.
  if (f.tidesFailed && prev.tides) f = { ...f, tides: prev.tides }
  // The same for waves: hours-old wave forecasts still describe the coming
  // days far better than none, and none read as calm water.
  if (f.marineFailed && prev.marine) f = { ...f, marine: prev.marine }
  return f
}

/**
 * A sea spot whose marine request failed with no waves from before to keep
 * (mergeRefetch): its windows score with no wave row, which reads as calm
 * water (35 instead of 7 in a 1.8 m swell).
 */
export function wavesNotLoaded(f: FetchedForecast | undefined, loc: Pick<Location, 'waterType'>): boolean {
  return !!f?.marineFailed && !f.marine && takesSeaData(loc)
}
