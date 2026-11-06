/**
 * Weather for past days, for scoring logged catches and empty trips.
 *
 * The catch path used to ask the forecast API for `past_days`, which keeps
 * only about 62 days: older hours came back null, scoring read them as calm,
 * clear and stable, and a catch 63–92 days old got a complete-looking score
 * for weather nobody had. Open-Meteo's archive of its own forecasts
 * (historical-forecast-api) answers the same request shape for any date
 * range back to 2022, complete, and a few days cost one request.
 */
import { localDayUTC } from './clock'
import { fetchTides, forecastKey, WEATHER_VARS, MARINE_VARS, hourlyRows, marineRows, tideRangeM, tideSpan } from './weather'
import type { Forecast, HourData, Location, TideData } from './types'

const DAY = 86400000
export const HISTORY_API = 'https://historical-forecast-api.open-meteo.com/v1/forecast'
export const MARINE_API = 'https://marine-api.open-meteo.com/v1/marine'

// ── Shared with the dashboard ────────────────────────────────────────────
// The same variables, row parsers and tide fetch the forecast uses, so a past
// entry is scored from exactly the inputs a dashboard window gets. They were
// mirrored here until the model branch exported them; the copy asked the
// marine archive for waves only, so past catches never got a water
// temperature, and its marineRows skipped the fresh-water / far-sea-cell gate.
// Its tide fetch kept DMI's centimetres as metres: a Dragør tide of a few cm
// read as metres, gave every past entry the full tide factor and rows like
// '1000 cm tidevand', 4–10 points above the card.
export { WEATHER_VARS, MARINE_VARS, hourlyRows, marineRows }

const API_TIMEOUT_MS = 30_000
const deadline = () => (typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(API_TIMEOUT_MS) : undefined)

/** Inclusive span of LOCAL days, each encoded as UTC midnight of the date parts (the app-wide encoding). */
export interface DaySpan { start: number; end: number }

const isoDay = (day: number) => new Date(day).toISOString().slice(0, 10)

/**
 * DMI's page holds 1500 items and cuts past that without a word. A 10-day
 * chunk came back as 1479 — the daily highs and lows come with the 10-minute
 * predictions — so 7 days (about 1040) leaves room, and a full page is split
 * and asked again in case it was cut short.
 */
const TIDE_CHUNK_MS = 7 * DAY
const DMI_PAGE = 1500

async function tideChunk(loc: Location, a: number, b: number): Promise<TideData | null> {
  const d = await fetchTides(loc, a, b) // weather.ts: metres, nearest station within 120 km
  if (!d || d.predictions.length < DMI_PAGE || b - a <= 3600000) return d
  const mid = a + Math.floor((b - a) / 2)
  const [x, y] = await Promise.all([tideChunk(loc, a, mid), tideChunk(loc, mid, b)])
  return x && y ? { ...x, predictions: [...x.predictions, ...y.predictions] } : x ?? y
}

/**
 * Tides over a span, asked in chunks DMI can answer in one page. Any chunk
 * failing means no tides at all: a tide factor on some hours of a trip and
 * not others would move its score for no reason in the water. Fewer than two
 * predictions is no tides too — DMI keeps them for the current calendar year
 * only and answers an earlier date with an empty list — not a failure. The
 * range is left to onDay: it depends on the day scored, not on the span.
 */
async function spanTides(loc: Location, startMs: number, endMs: number): Promise<TideData | null> {
  if (loc.waterType === 'fresh') return null
  const chunks: Promise<TideData | null>[] = []
  for (let a = startMs; a < endMs; a += TIDE_CHUNK_MS) chunks.push(tideChunk(loc, a, Math.min(a + TIDE_CHUNK_MS, endMs)))
  let parts: (TideData | null)[]
  try { parts = await Promise.all(chunks) } catch { return null }
  const found = parts.filter((p): p is TideData => p != null)
  if (!found.length) return null
  const byTime = new Map<number, number>()
  for (const p of found) for (const q of p.predictions) byTime.set(q.time, q.value)
  const predictions = [...byTime].map(([time, value]) => ({ time, value })).sort((a, b) => a.time - b.time)
  return predictions.length < 2 ? null : { stationName: found[0].stationName, distKm: found[0].distKm, predictions }
}

/** The tide span the dashboard asked DMI for on a local day (app encoding): weather.tideSpan of its noon. */
function dashboardTideSpan(day: number): { start: number; end: number } {
  const d = new Date(day)
  return tideSpan(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12).getTime())
}

/**
 * Archived weather, marine data and tides for a span of local days. Asks a
 * day either side: the first hours' 3-hour look-backs need the day before,
 * and an overnight window runs into the day after. The tides run from the
 * dashboard's tide span for the first day to the one for the last — the
 * range each day is scored with is taken over its own (onDay). Null when the
 * archive has no usable hour; rejects when the weather can't be fetched (the
 * marine data is best effort, as on the dashboard).
 */
export async function fetchHistory(loc: Location, span: DaySpan): Promise<Forecast | null> {
  const first = span.start - DAY
  // The archive holds the forecast days too, but nothing past tomorrow is
  // ever scored: a logged entry and a baseline window both lie in the past.
  const last = Math.min(span.end + DAY, localDayUTC(Date.now(), 1))
  const dates = { start_date: isoDay(first), end_date: isoDay(last), timezone: 'UTC' }
  const at = { latitude: String(loc.lat), longitude: String(loc.lon) }

  const weather = (async () => {
    const params = new URLSearchParams({ ...at, hourly: WEATHER_VARS, wind_speed_unit: 'ms', ...dates })
    const res = await fetch(`${HISTORY_API}?${params}`, { signal: deadline() })
    if (!res.ok) throw new Error(`weather archive ${res.status}`)
    const data = await res.json()
    if (!data?.hourly?.time) return []
    // An hour with no temperature, wind or pressure is a hole in the archive,
    // not a calm, clear, stable hour. Leading and trailing holes go, so the
    // scorer finds no row there. An interior one stays as a row without data:
    // the scorer looks 3 rows back by index, and with the gap dropped the
    // first hour after it compared against an hour from before it, inventing
    // pressure and wind trends. MERGE ORDER: this relies on the scorer reading
    // a null row as missing (model-spec M6). Before M6, scoring.ts reads it as
    // 1013 hPa, calm and clear, and the 3 hours after a gap trend against that
    // 1013 — so this branch must not land ahead of M6. (Rare: a season's
    // archive pull measured 744 of 744 hours non-null.)
    const rows = hourlyRows(data.hourly)
    const has = (h: HourData) => h.temp != null || h.windMs != null || h.pressure != null
    let lead = 0, end = rows.length
    while (lead < end && !has(rows[lead])) lead++
    while (end > lead && !has(rows[end - 1])) end--
    return rows.slice(lead, end)
  })()
  const marine = (async () => {
    try {
      const params = new URLSearchParams({ ...at, hourly: MARINE_VARS, ...dates })
      const res = await fetch(`${MARINE_API}?${params}`, { signal: deadline() })
      return res.ok ? marineRows(await res.json(), loc) : null
    } catch {
      return null
    }
  })()
  const tideFrom = dashboardTideSpan(span.start).start, tideTo = dashboardTideSpan(span.end).end
  const [hourly, marineHours, tides] = await Promise.all([weather, marine, spanTides(loc, tideFrom, tideTo)])
  return hourly.length ? { fetched: Date.now(), hourly, marine: marineHours, tides } : null
}

/**
 * The spans to fetch for a set of entries: each day padded by `padDays`,
 * clipped to the days that can be scored, and merged per location where they
 * overlap or lie at most 2 days apart — two spare days cost less than a
 * request of their own. Sorted by start.
 */
export function planSpans(days: { locId: string; day: number }[], padDays: number, todayDay: number, maxAgeDays: number): Map<string, DaySpan[]> {
  const oldest = todayDay - maxAgeDays * DAY
  const per = new Map<string, DaySpan[]>()
  for (const { locId, day } of days) {
    const span = { start: Math.max(day - padDays * DAY, oldest), end: Math.min(day + padDays * DAY, todayDay) }
    if (span.start > span.end) continue
    per.set(locId, [...(per.get(locId) ?? []), span])
  }
  const out = new Map<string, DaySpan[]>()
  for (const [locId, list] of per) {
    const merged: DaySpan[] = []
    for (const s of list.sort((a, b) => a.start - b.start)) {
      const prev = merged.at(-1)
      if (prev && s.start <= prev.end + 3 * DAY) prev.end = Math.max(prev.end, s.end)
      else merged.push({ ...s })
    }
    out.set(locId, merged)
  }
  return out
}

/**
 * Fetched spans for a session, per location: one fetch serves every entry
 * and baseline window inside its span. Keyed by what the fetch answered for
 * (the coordinates and water type, as forecastKey), so a spot moved since is
 * fetched again. The PROMISE is kept, so two callers never fetch the same span.
 */
export type HistoryCache = Map<string, { span: DaySpan; forecast: Promise<Forecast | null> }[]>

const cacheKey = (loc: Location) => `${loc.id}|${forecastKey(loc)}`

/** Fetch a span into the cache (the analysis plans its spans up front). */
export function loadSpan(loc: Location, span: DaySpan, cache: HistoryCache): Promise<Forecast | null> {
  const key = cacheKey(loc)
  const forecast = fetchHistory(loc, span)
  const item = { span, forecast }
  cache.set(key, [...(cache.get(key) ?? []), item])
  // A failed fetch must not stick: the retry fetches again.
  forecast.catch(() => {
    const list = cache.get(key)?.filter((x) => x !== item)
    if (list?.length) cache.set(key, list)
    else cache.delete(key)
  })
  return forecast
}

/** The cached fetch whose span covers all of `span`, if any — without fetching. */
export function cachedSpan(loc: Location, span: DaySpan, cache: HistoryCache): Promise<Forecast | null> | undefined {
  return cache.get(cacheKey(loc))?.find((x) => x.span.start <= span.start && span.end <= x.span.end)?.forecast
}

const dayViews = new WeakMap<Forecast, Map<number, Forecast>>()

/**
 * A fetched span as the dashboard held it on `day`: the tide range taken over
 * the span the dashboard asked DMI for that day, as weather.fetchTides sets
 * it. Without one, scoring fell back to the range of everything fetched,
 * which grows with the span (max − min), so a past window's tide row did
 * not match the card's. One object per span and day, so rescoring reuses it.
 */
export function onDay(f: Forecast, day: number): Forecast {
  if (!f.tides?.predictions.length) return f
  let views = dayViews.get(f)
  if (!views) dayViews.set(f, (views = new Map()))
  let view = views.get(day)
  if (!view) {
    const { start, end } = dashboardTideSpan(day)
    view = { ...f, tides: { ...f.tides, rangeM: tideRangeM(f.tides.predictions, start, end) } }
    views.set(day, view)
  }
  return view
}

/** The cached fetch whose span covers `day`, as of that day (onDay), if any — without fetching. */
export function cachedHistory(loc: Location, day: number, cache: HistoryCache): Promise<Forecast | null> | undefined {
  return cachedSpan(loc, { start: day, end: day }, cache)?.then((f) => f && onDay(f, day))
}

/** History for `day` (onDay): from a cached span, or a fetch of the day and its neighbours. */
export function historyFor(loc: Location, day: number, cache: HistoryCache): Promise<Forecast | null> {
  return cachedHistory(loc, day, cache)
    ?? loadSpan(loc, { start: day - DAY, end: day + DAY }, cache).then((f) => f && onDay(f, day))
}
