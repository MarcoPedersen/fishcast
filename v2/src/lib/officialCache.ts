/**
 * The map compare's official-spot forecasts, by candidate id. A module of its
 * own so the forecast store can clear it ("🗑 Ryd vejrdata", logout) without
 * importing officialCompare: that import pulled the whole spot catalogue
 * (spots.ts) into the main bundle, which the app otherwise loads lazily.
 *
 * Module scope, so it outlives MapTab, which is v-if'd and remounts every time
 * you visit the Vinduer tab (the only place the horizon can be changed).
 */
import type { Forecast } from './types'

export const officialCache = new Map<string, Forecast>()

/**
 * Forget the cached official forecasts. Without it the cache outlived "Ryd
 * vejrdata" and logout, and compare kept serving the old weather for up to
 * 3 h. (A batch already in flight is new weather, so it may still land.)
 */
export function clearOfficialForecasts(): void {
  officialCache.clear()
}
