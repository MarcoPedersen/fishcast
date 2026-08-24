/**
 * Retrospective bite-score for a logged catch: resolve its saved location,
 * fetch the weather for that date, and run the same scoring engine over the
 * hour it was caught. Returns null when it can't be scored (no time, location
 * not saved with coords, date outside the past-data window, or no data).
 */
import { fetchForecastForDate } from './weather'
import { scoreWindow } from './scoring'
import type { CatchEntry, Location } from './types'

/**
 * The location field is a free-text input with a datalist of saved spots, so the
 * typed name won't always match byte-for-byte — "dragør mole " should still
 * resolve. Case and surrounding whitespace are ignored.
 */
const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase()

export function findCatchLocation(entry: CatchEntry, locations: Location[]): Location | undefined {
  const want = norm(entry.locationName)
  return want ? locations.find((l) => norm(l.name) === want) : undefined
}

/** Why a catch can't be scored, so the UI can say so instead of showing nothing. */
export type ScoreBlocker = 'time' | 'location' | null
export function scoreBlocker(entry: CatchEntry, locations: Location[]): ScoreBlocker {
  if (!entry.time) return 'time'
  if (!findCatchLocation(entry, locations)) return 'location'
  return null
}

export function canScoreCatch(entry: CatchEntry, locations: Location[]): boolean {
  return scoreBlocker(entry, locations) === null
}

export async function scoreCatch(entry: CatchEntry, locations: Location[]): Promise<number | null> {
  if (!entry.time) return null
  const loc = findCatchLocation(entry, locations)
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
