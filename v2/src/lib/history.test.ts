import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  DMI_TIDES, DMI_TIDE_STN, HISTORY_API, MARINE_API, MARINE_VARS, WEATHER_VARS,
  cachedSpan, fetchHistory, historyFor, loadSpan, planSpans, type HistoryCache,
} from './history'
import { classifyHour } from './catchInsights'
import type { Location } from './types'

const DAY = 86400000
const FRESH: Location = { id: 'lake', name: 'Mossø', lat: 56.0, lon: 9.8, waterType: 'fresh' }
const SALT: Location = { id: 'coast', name: 'Dragør mole', lat: 55.59, lon: 12.68, waterType: 'salt' }
/** A local calendar day in the app's encoding: UTC midnight of the date parts. */
const day = (iso: string) => Date.parse(iso + 'T00:00:00Z')
const now = (iso: string) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso)) }

// Answers built from what each request asks for, so a wrong date shows up as
// missing hours rather than as data the test happened to pre-bake.
const hours = (start: string, end: string) => {
  const out: string[] = []
  for (let t = Date.parse(start + 'T00:00Z'); t <= Date.parse(end + 'T23:00Z'); t += 3600000) out.push(new Date(t).toISOString().slice(0, 16))
  return out
}
const fill = (n: number, v: number | null) => Array.from({ length: n }, () => v)
function weatherBody(url: URL, nullFrom?: number, nullTo = Infinity) {
  const time = hours(url.searchParams.get('start_date')!, url.searchParams.get('end_date')!)
  // The archive's habit the old path fell into: hours with every value null.
  const isNull = (iso: string) => nullFrom != null && Date.parse(iso + 'Z') >= nullFrom && Date.parse(iso + 'Z') < nullTo
  const v = (x: number) => time.map((iso) => (isNull(iso) ? null : x))
  return {
    hourly: {
      time, temperature_2m: v(12), wind_speed_10m: v(3), wind_direction_10m: v(270),
      wind_gusts_10m: v(5), cloud_cover: v(40), precipitation_probability: v(0), surface_pressure: v(1013),
    },
  }
}
function marineBody(url: URL) {
  const time = hours(url.searchParams.get('start_date')!, url.searchParams.get('end_date')!)
  return { hourly: { time, wave_height: fill(time.length, 0.4), wave_period: fill(time.length, 3) } }
}
function tideBody(url: URL) {
  const [a, b] = url.searchParams.get('datetime')!.split('/').map((s) => Date.parse(s))
  const features = []
  for (let t = a; t <= b; t += tideStepMs) features.push({ properties: { predictionTime: new Date(t).toISOString(), value: Math.sin(t / 22357000) * 20 } })
  // DMI cuts a page at `limit` without a word.
  return { features: features.slice(0, Number(url.searchParams.get('limit'))) }
}
const STATIONS = { features: [{ properties: { stationId: 'S1', name: 'Dragør', country: 'DNK' }, geometry: { coordinates: [12.68, 55.59] } }] }

let calls: URL[] = []
let fail: (u: URL) => number | null = () => null
let tidesEmpty = false
let nullFrom: number | undefined
let nullTo: number | undefined
let tideStepMs = 600000
beforeEach(() => {
  calls = []
  fail = () => null
  tidesEmpty = false
  nullFrom = undefined
  nullTo = undefined
  tideStepMs = 600000
  vi.stubGlobal('fetch', vi.fn(async (raw: string) => {
    const url = new URL(raw)
    calls.push(url)
    const status = fail(url)
    if (status) return { ok: false, status, json: async () => ({ reason: 'down' }) }
    const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data })
    if (raw.startsWith(HISTORY_API)) return ok(weatherBody(url, nullFrom, nullTo))
    if (raw.startsWith(MARINE_API)) return ok(marineBody(url))
    if (raw.startsWith(DMI_TIDE_STN)) return ok(STATIONS)
    if (raw.startsWith(DMI_TIDES)) return ok(tidesEmpty ? { features: [] } : tideBody(url))
    throw new Error('unexpected fetch ' + raw)
  }))
  now('2026-10-19T12:00:00+02:00')
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
const to = (prefix: string) => calls.filter((u) => u.href.startsWith(prefix))
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10)

describe('fetchHistory — the archive request', () => {
  /**
   * The old path asked the forecast API for past_days, which holds about 62
   * days: older hours came back null, were read as calm, clear and stable,
   * and a catch 63–92 days old got a complete-looking made-up score.
   */
  it('asks the historical-forecast archive for the dashboard variables, a day either side', async () => {
    const span = { start: day('2026-08-01'), end: day('2026-08-03') }
    await fetchHistory(SALT, span)
    const [w] = to(HISTORY_API)
    expect(w.host).toBe('historical-forecast-api.open-meteo.com')
    expect(w.searchParams.get('hourly')).toBe(WEATHER_VARS)
    expect(w.searchParams.get('wind_speed_unit')).toBe('ms')
    expect(w.searchParams.get('timezone')).toBe('UTC')
    expect(w.searchParams.get('start_date')).toBe('2026-07-31')
    expect(w.searchParams.get('end_date')).toBe('2026-08-04')
    expect(calls.some((u) => u.host === 'api.open-meteo.com' || u.searchParams.has('past_days'))).toBe(false)
  })

  it('asks the marine archive for the dashboard variables over the same dates', async () => {
    await fetchHistory(SALT, { start: day('2026-08-01'), end: day('2026-08-03') })
    const [m] = to(MARINE_API)
    expect(m.searchParams.get('hourly')).toBe(MARINE_VARS)
    expect(m.searchParams.get('timezone')).toBe('UTC')
    expect([m.searchParams.get('start_date'), m.searchParams.get('end_date')]).toEqual(['2026-07-31', '2026-08-04'])
  })

  it('never asks past tomorrow (the archive stops there)', async () => {
    await fetchHistory(SALT, { start: day('2026-10-18'), end: day('2026-10-19') })
    expect(to(HISTORY_API)[0].searchParams.get('end_date')).toBe('2026-10-20')
  })

  it('keeps the weather when the marine archive fails', async () => {
    fail = (u) => (u.href.startsWith(MARINE_API) ? 502 : null)
    const f = await fetchHistory(SALT, { start: day('2026-08-01'), end: day('2026-08-01') })
    expect(f!.marine).toBeNull()
    expect(f!.hourly.length).toBe(72)
  })

  it('rejects when the weather archive fails, so the UI can offer a retry', async () => {
    fail = (u) => (u.href.startsWith(HISTORY_API) ? 500 : null)
    await expect(fetchHistory(SALT, { start: day('2026-08-01'), end: day('2026-08-01') })).rejects.toThrow()
  })

  /**
   * The scorer looks 3 rows back by index: with a gap dropped, the first hour
   * after it compared against an hour from before the gap, and invented
   * pressure and wind trends. An interior gap stays, as rows with no data.
   */
  it('keeps an all-null gap inside the span, so a 3-hour look-back never jumps it', async () => {
    nullFrom = Date.parse('2026-08-01T06:00Z')
    nullTo = Date.parse('2026-08-01T12:00Z')
    const f = await fetchHistory(SALT, { start: day('2026-08-01'), end: day('2026-08-01') })
    expect(f!.hourly.length).toBe(72) // 31 Jul 00:00 – 2 Aug 23:00, the gap included
    const i = f!.hourly.findIndex((h) => h.time === Date.parse('2026-08-01T12:00Z'))
    expect(f!.hourly[i - 3].pressure).toBeNull()
    expect(classifyHour(f!, SALT, Date.parse('2026-08-01T12:00Z')).press).toBeNull()
  })

  it('drops the trailing hours whose temperature, wind and pressure are all null', async () => {
    nullFrom = Date.parse('2026-08-01T12:00Z')
    const f = await fetchHistory(SALT, { start: day('2026-08-01'), end: day('2026-08-01') })
    expect(f!.hourly.length).toBe(36) // 31 Jul 00:00 – 1 Aug 11:00
    expect(f!.hourly.every((h) => h.temp != null)).toBe(true)
  })

  it('answers null when no hour is left', async () => {
    nullFrom = 0
    expect(await fetchHistory(SALT, { start: day('2026-08-01'), end: day('2026-08-01') })).toBeNull()
  })
})

describe('fetchHistory — tides', () => {
  /**
   * DMI's page holds 1500 items, and a 10-day chunk is 1479 — the daily highs
   * and lows come too — with a silent cut past that: 7-day chunks.
   */
  it('asks DMI in chunks of at most 7 days, and merges them in order without duplicates', async () => {
    const f = await fetchHistory(SALT, { start: day('2026-08-01'), end: day('2026-08-15') })
    const chunks = to(DMI_TIDES)
    expect(chunks).toHaveLength(3)
    for (const c of chunks) {
      const [a, b] = c.searchParams.get('datetime')!.split('/').map((s) => Date.parse(s))
      expect(b - a).toBeLessThanOrEqual(7 * DAY)
    }
    const times = f!.tides!.predictions.map((p) => p.time)
    expect(times).toEqual([...new Set(times)].sort((a, b) => a - b))
    // One per 10 minutes from the day before the span to the end of the day after it.
    expect(times[0]).toBe(day('2026-07-31'))
    expect(times.at(-1)).toBe(day('2026-08-17'))
    expect(times.length).toBe(17 * 144 + 1)
  })

  it('splits a chunk that came back as a full page, which DMI may have cut short', async () => {
    tideStepMs = 300000 // twice as dense: a 7-day chunk overflows the page
    const f = await fetchHistory(SALT, { start: day('2026-08-01'), end: day('2026-08-05') })
    const times = f!.tides!.predictions.map((p) => p.time)
    expect(times[0]).toBe(day('2026-07-31'))
    expect(times.at(-1)).toBe(day('2026-08-07'))
    expect(times.length).toBe(7 * 288 + 1)
  })

  it('has no tides when any chunk fails — never a partial set', async () => {
    let n = 0
    fail = (u) => (u.href.startsWith(DMI_TIDES) && n++ === 1 ? 503 : null)
    const f = await fetchHistory(SALT, { start: day('2026-08-01'), end: day('2026-08-15') })
    expect(f!.tides).toBeNull()
    expect(f!.hourly.length).toBeGreaterThan(0)
  })

  /**
   * DMI keeps predictions for the current calendar year only, and answers an
   * earlier date with HTTP 200 and no features. That is no tide data, not a
   * failure — and not a tide table to score against.
   */
  it('has no tides for a date DMI holds no predictions for', async () => {
    tidesEmpty = true
    const f = await fetchHistory(SALT, { start: day('2025-12-28'), end: day('2025-12-30') })
    expect(f!.tides).toBeNull()
    expect(f!.hourly.length).toBeGreaterThan(0)
  })

  it('does not ask DMI for fresh water', async () => {
    const f = await fetchHistory(FRESH, { start: day('2026-08-01'), end: day('2026-08-15') })
    expect(f!.tides).toBeNull()
    expect(calls.filter((u) => u.host === new URL(DMI_TIDES).host)).toEqual([])
  })

  /** The station list is 220 features; at limit=100 it was cut off after "Kastrup Havn". */
  it('asks for the whole station list', async () => {
    // A fresh module: the station list is fetched once per session.
    vi.resetModules()
    const fresh = await import('./history')
    await fresh.fetchHistory(SALT, { start: day('2026-08-01'), end: day('2026-08-01') })
    expect(Number(to(DMI_TIDE_STN)[0].searchParams.get('limit'))).toBeGreaterThanOrEqual(300)
  })
})

describe('planSpans', () => {
  const today = day('2026-10-19')
  const spans = (items: { locId: string; day: number }[], pad: number, maxAge = 730) =>
    Object.fromEntries([...planSpans(items, pad, today, maxAge)].map(([k, v]) => [k, v.map((s) => `${iso(s.start)}..${iso(s.end)}`)]))

  it('pads each day and merges spans that overlap or nearly touch (a gap of up to 2 days)', () => {
    expect(spans([
      { locId: 'a', day: day('2026-08-10') },
      { locId: 'a', day: day('2026-08-01') },
      { locId: 'a', day: day('2026-08-20') }, // 08-10 + 3 = 08-13 … 08-17: 3 days apart
      { locId: 'b', day: day('2026-08-10') },
    ], 3)).toEqual({
      a: ['2026-07-29..2026-08-13', '2026-08-17..2026-08-23'],
      b: ['2026-08-07..2026-08-13'],
    })
    // A gap of exactly 2 days still merges.
    expect(spans([{ locId: 'a', day: day('2026-08-01') }, { locId: 'a', day: day('2026-08-04') }], 0)).toEqual({ a: ['2026-08-01..2026-08-04'] })
    expect(spans([{ locId: 'a', day: day('2026-08-01') }, { locId: 'a', day: day('2026-08-05') }], 0)).toEqual({ a: ['2026-08-01..2026-08-01', '2026-08-05..2026-08-05'] })
  })

  it('clips at today and at the oldest day scored', () => {
    expect(spans([{ locId: 'a', day: day('2026-10-17') }], 7)).toEqual({ a: ['2026-10-10..2026-10-19'] })
    expect(spans([{ locId: 'a', day: today - 730 * DAY }], 7)).toEqual({ a: [`${iso(today - 730 * DAY)}..${iso(today - 723 * DAY)}`] })
  })

  it('merges the ±7-day neighbourhoods of entries a week or two apart into one span', () => {
    expect(spans([{ locId: 'a', day: day('2026-09-01') }, { locId: 'a', day: day('2026-09-12') }], 7)).toEqual({ a: ['2026-08-25..2026-09-19'] })
  })
})

describe('the history cache', () => {
  it('serves a day inside a loaded span without fetching again', async () => {
    const cache: HistoryCache = new Map()
    await loadSpan(SALT, { start: day('2026-08-01'), end: day('2026-08-15') }, cache)
    const n = calls.length
    const f = await historyFor(SALT, day('2026-08-09'), cache)
    expect(f!.hourly.length).toBeGreaterThan(0)
    expect(calls.length).toBe(n)
  })

  it('finds a loaded span that covers a whole planned one, whichever fetch it was', async () => {
    const cache: HistoryCache = new Map()
    await historyFor(SALT, day('2026-08-09'), cache) // a card's 3 days first
    await loadSpan(SALT, { start: day('2026-08-01'), end: day('2026-08-15') }, cache)
    expect(cachedSpan(SALT, { start: day('2026-08-05'), end: day('2026-08-12') }, cache)).toBeDefined()
    expect(cachedSpan(SALT, { start: day('2026-08-05'), end: day('2026-08-16') }, cache)).toBeUndefined()
  })

  it('fetches the day and its neighbours for a day no span covers', async () => {
    const cache: HistoryCache = new Map()
    await historyFor(SALT, day('2026-08-09'), cache)
    expect([to(HISTORY_API)[0].searchParams.get('start_date'), to(HISTORY_API)[0].searchParams.get('end_date')]).toEqual(['2026-08-07', '2026-08-11'])
    await historyFor(SALT, day('2026-08-10'), cache)
    expect(to(HISTORY_API)).toHaveLength(1)
  })

  it('does not keep a failed fetch, so a retry fetches again', async () => {
    const cache: HistoryCache = new Map()
    fail = (u) => (u.href.startsWith(HISTORY_API) ? 503 : null)
    await expect(historyFor(SALT, day('2026-08-09'), cache)).rejects.toThrow()
    fail = () => null
    expect(await historyFor(SALT, day('2026-08-09'), cache)).not.toBeNull()
    expect(to(HISTORY_API)).toHaveLength(2)
  })

  it('refetches a spot whose coordinates changed', async () => {
    const cache: HistoryCache = new Map()
    await historyFor(SALT, day('2026-08-09'), cache)
    await historyFor({ ...SALT, lat: 55.7 }, day('2026-08-09'), cache)
    expect(to(HISTORY_API)).toHaveLength(2)
  })
})
