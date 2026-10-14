/**
 * Retrospective bite-score for a logged catch: resolve its saved location,
 * fetch the weather for that date, and run the same scoring engine over the
 * hour it was caught. Returns null when it can't be scored (no time, location
 * not saved with coords, date outside the past-data window, or no data).
 */
import { fetchForecastForDate } from './weather'
import { scoreWindow } from './scoring'
import type { CatchEntry, Forecast, Location } from './types'

const DAY_MS = 86400000
/** Open-Meteo keeps ~92 days of past weather; an older catch can't be scored. */
export const MAX_SCORE_AGE_DAYS = 92

/**
 * The location field is a free-text input with a datalist of saved spots, so the
 * typed name won't always match byte-for-byte — "dragør mole " should still
 * resolve. Case and surrounding whitespace are ignored.
 */
const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase()

export function findCatchLocation(entry: Pick<CatchEntry, 'locationName'>, locations: Location[]): Location | undefined {
  const want = norm(entry.locationName)
  return want ? locations.find((l) => norm(l.name) === want) : undefined
}

/** The catch's LOCAL calendar day, as UTC midnight of its date parts (the app-wide encoding). */
function catchDay(entry: CatchEntry): number | null {
  const [y, m, d] = entry.date.split('-').map(Number)
  return y ? Date.UTC(y, (m || 1) - 1, d || 1) : null
}

/**
 * Why a catch can't be scored, so the UI can say so instead of showing nothing.
 * 'old' comes first: past the weather history nothing the user adds will help,
 * and without it such catches were counted as analysable and then quietly
 * came back "no data".
 */
export type ScoreBlocker = 'old' | 'time' | 'location' | null
export function scoreBlocker(entry: CatchEntry, locations: Location[]): ScoreBlocker {
  const day = catchDay(entry)
  const n = new Date()
  if (day != null && (Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) - day) / DAY_MS > MAX_SCORE_AGE_DAYS) return 'old'
  if (!entry.time) return 'time'
  if (!findCatchLocation(entry, locations)) return 'location'
  return null
}

export function canScoreCatch(entry: CatchEntry, locations: Location[]): boolean {
  return scoreBlocker(entry, locations) === null
}

/**
 * Forecasts shared across one batch of scores, per location id: the day it was
 * fetched for and the (promised) result.
 */
export type ForecastCache = Map<string, { day: number; forecast: Promise<Forecast | null> }>

/**
 * Never ask for a day past UTC today. Between local midnight and 01:00/02:00 a
 * catch dated today is tomorrow in UTC, and fetchForecastForDate measured
 * "today" in UTC, so the catch came back daysAgo = -1 and "no data" for good.
 * The fetch branch fixed the same bug inside fetchForecastForDate (it now takes
 * the local day), so this clamp is a second guard rather than the fix. Kept:
 * the UTC day it asks for still holds the local post-midnight hours.
 */
function fetchDay(day: number): Date {
  const n = new Date()
  return new Date(Math.min(day, Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())))
}

/**
 * Each catch used to fetch its own weather — the same multi-week history again
 * for every catch at a place. With a cache, a fetch serves every catch on that
 * day, and later days too at fresh water (its weather runs from the day up to
 * today, but tides only cover a window around that one day). Score catches
 * oldest first to get the most out of it.
 *
 * Only fresh water, not "a fetch without tides": fetchTides also returns null
 * on a coast when DMI fails, and one such hiccup then scored every later catch
 * at that coast without the tide factor.
 */
async function forecastFor(loc: Location, day: number, cache?: ForecastCache): Promise<Forecast | null> {
  if (!cache) return fetchForecastForDate(loc, fetchDay(day))
  const hit = cache.get(loc.id)
  if (hit?.day === day) return hit.forecast
  if (hit && hit.day < day && loc.waterType === 'fresh') {
    const f = await hit.forecast
    if (f) return f
  }
  const forecast = fetchForecastForDate(loc, fetchDay(day))
  cache.set(loc.id, { day, forecast })
  // A failed fetch must not stick — the next catch (or a retry) fetches again.
  forecast.catch(() => { if (cache.get(loc.id)?.forecast === forecast) cache.delete(loc.id) })
  return forecast
}

export async function scoreCatch(entry: CatchEntry, locations: Location[], cache?: ForecastCache): Promise<number | null> {
  if (!entry.time) return null
  const loc = findCatchLocation(entry, locations)
  if (!loc) return null

  const day = catchDay(entry)
  if (day == null) return null
  const date = new Date(day)

  const h = parseInt(entry.time, 10)
  if (isNaN(h)) return null

  const forecast = await forecastFor(loc, day, cache)
  if (!forecast) return null

  // Score the catch hour (scoreWindow needs from < to, so use a 1-hour window).
  const sw = scoreWindow(loc, date, `${h}:00`, `${h + 1}:00`, forecast, entry.speciesId ? [entry.speciesId] : [], entry.method ?? 'shore')
  return sw.noData ? null : sw.score
}
