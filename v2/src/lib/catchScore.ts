/**
 * Retrospective bite-score for a logged catch: resolve its saved location,
 * fetch the weather for that date, and run the same scoring engine over the
 * hour it was caught. Returns null when it can't be scored (no time, location
 * not saved with coords, date outside the past-data window, or no data).
 */
import { fetchForecastForDate } from './weather'
import { scoreWindow } from './scoring'
import type { CatchEntry, Location } from './types'

export function canScoreCatch(entry: CatchEntry, locations: Location[]): boolean {
  return !!entry.time && locations.some((l) => l.name === entry.locationName)
}

export async function scoreCatch(entry: CatchEntry, locations: Location[]): Promise<number | null> {
  if (!entry.time) return null
  const loc = locations.find((l) => l.name === entry.locationName)
  if (!loc) return null

  const [y, m, d] = entry.date.split('-').map(Number)
  if (!y) return null
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1))

  const h = parseInt(entry.time, 10)
  if (isNaN(h)) return null

  const forecast = await fetchForecastForDate(loc, date)
  if (!forecast) return null

  // Score the catch hour (scoreWindow needs from < to, so use a 1-hour window).
  const sw = scoreWindow(loc, date, `${h}:00`, `${h + 1}:00`, forecast, entry.speciesId ? [entry.speciesId] : [], entry.method ?? 'shore')
  return sw.noData ? null : sw.score
}
