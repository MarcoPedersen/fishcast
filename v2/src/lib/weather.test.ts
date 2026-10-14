// Window dates and the "today" boundary are local-calendar values; pin the zone
// so the DST-sensitive cases below mean the same thing on every machine.
// (No @types/node in this project — declare just the bit used here.)
declare const process: { env: Record<string, string | undefined> }
process.env.TZ = 'Europe/Copenhagen'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Location } from './types'

const OM = 'https://api.open-meteo.com/v1/forecast'
const MARINE = 'https://marine-api.open-meteo.com/v1/marine'
const STATIONS = 'https://dmigw.govcloud.dk/v2/oceanObs/collections/tidewaterstation/items'
const TIDES = 'https://dmigw.govcloud.dk/v2/oceanObs/collections/tidewater/items'
const LIGHTNING = 'https://dmigw.govcloud.dk/v2/lightningdata/collections/observation/items'

const loc = (id: string, lat: number, lon: number, waterType?: Location['waterType']): Location =>
  ({ id, name: id, lat, lon, waterType })

/** Open-Meteo hourly block: offset-less ISO hours, exactly as the API sends them. */
function hourly(n = 3, temp = 14) {
  const time = Array.from({ length: n }, (_, i) => `2026-06-15T${String(i).padStart(2, '0')}:00`)
  return {
    time,
    temperature_2m: time.map(() => temp),
    wind_speed_10m: time.map(() => 4),
    wind_direction_10m: time.map(() => 270),
    wind_gusts_10m: time.map(() => 7),
    cloud_cover: time.map(() => 50),
    precipitation_probability: time.map(() => 10),
    surface_pressure: time.map(() => 1013),
  }
}
function marineHourly(n = 3) {
  const time = Array.from({ length: n }, (_, i) => `2026-06-15T${String(i).padStart(2, '0')}:00`)
  return { time, wave_height: time.map(() => 0.5), wave_period: time.map(() => 4) }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const station = (id: string, name: string, lat: number, lon: number, country = 'DNK') => ({
  properties: { stationId: id, name, country },
  geometry: { coordinates: [lon, lat] },
})
const predictions = () => ({
  features: [0, 1, 2, 3].map((h) => ({
    properties: { predictionTime: `2026-06-15T0${h}:00:00Z`, value: h * 10 },
  })),
})
const strike = (lat: number, lon: number, type = 0, amp = -12) => ({
  geometry: { coordinates: [lon, lat] },
  properties: { type, amp },
})

type Route = (url: URL) => Response | Promise<Response>
/** Route fetch by endpoint; anything unrouted fails like a dropped connection. */
function stubFetch(routes: Record<string, Route>) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    for (const [endpoint, route] of Object.entries(routes)) {
      if (url.startsWith(endpoint + '?')) return route(new URL(url))
    }
    throw new TypeError('Failed to fetch')
  }))
  return {
    calls,
    count: (endpoint: string) => calls.filter((u) => u.startsWith(endpoint + '?')).length,
  }
}

// weather.ts caches the tide-station list at module level, so each test gets a
// fresh copy of the module — otherwise one test's cached list leaks into the next.
let w: typeof import('./weather')
beforeEach(async () => {
  vi.resetModules()
  w = await import('./weather')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('fetchForecasts — batched Open-Meteo response', () => {
  it('reads a single location answered with a bare object, with hours as UTC', async () => {
    stubFetch({
      [OM]: () => json({ hourly: hourly(3) }),
      [MARINE]: () => json({ hourly: marineHourly(3) }),
    })
    const [f] = await w.fetchForecasts([loc('a', 56, 10, 'fresh')])
    expect(f).not.toBeNull()
    expect(f!.hourly).toHaveLength(3)
    // Open-Meteo sends 'YYYY-MM-DDTHH:MM' with no offset for timezone=UTC.
    // Parsed as local time instead, every hour would land 2 h off in summer.
    expect(f!.hourly[0].time).toBe(Date.UTC(2026, 5, 15, 0))
    expect(f!.marine![0].time).toBe(Date.UTC(2026, 5, 15, 0))
  })

  it('keeps each entry aligned with its location for several locations', async () => {
    stubFetch({
      [OM]: () => json([{ hourly: hourly(2, 10) }, { hourly: hourly(2, 20) }]),
      [MARINE]: () => json([{ hourly: marineHourly(2) }, { hourly: marineHourly(2) }]),
    })
    const out = await w.fetchForecasts([loc('a', 56, 10, 'fresh'), loc('b', 55, 11, 'fresh')])
    expect(out.map((f) => f?.hourly[0].temp)).toEqual([10, 20])
  })

  it('gives null only for the location whose entry is missing', async () => {
    stubFetch({
      [OM]: () => json([{ hourly: hourly(2) }, {}]),
      [MARINE]: () => json([{ hourly: marineHourly(2) }, {}]),
    })
    const out = await w.fetchForecasts([loc('a', 56, 10, 'fresh'), loc('b', 55, 11, 'fresh')])
    expect(out[0]).not.toBeNull()
    expect(out[1]).toBeNull()
  })

  it('a failed marine request leaves marine null but keeps the weather', async () => {
    stubFetch({
      [OM]: () => json([{ hourly: hourly(2) }, { hourly: hourly(2) }]),
      [MARINE]: () => json({ reason: 'boom' }, 500),
    })
    const out = await w.fetchForecasts([loc('a', 56, 10, 'fresh'), loc('b', 55, 11, 'fresh')])
    for (const f of out) {
      expect(f!.marine).toBeNull()
      expect(f!.hourly).toHaveLength(2)
    }
  })

  it('a failed weather request rejects, so the store can fall back per location', async () => {
    stubFetch({
      [OM]: () => json({ reason: 'boom' }, 500),
      [MARINE]: () => json({ hourly: marineHourly(2) }),
    })
    await expect(w.fetchForecasts([loc('a', 56, 10, 'fresh')])).rejects.toThrow()
  })

  it('records what each forecast was fetched for', async () => {
    stubFetch({
      [OM]: () => json([{ hourly: hourly(2) }, { hourly: hourly(2) }]),
      [MARINE]: () => json([{}, {}]),
    })
    const a = loc('a', 56, 10, 'fresh'), b = loc('b', 55.5, 11.25, 'fresh')
    const out = await w.fetchForecasts([a, b])
    expect(out.map((f) => f?.fetchedFor)).toEqual([w.forecastKey(a), w.forecastKey(b)])
  })
})

// The service worker answers a failed weather request from its cache and
// stamps what it stores with the real fetch time (vite.config.ts). Stamped
// Date.now() instead, a 5-hour-old copy showed "updated just now" and counted
// as fresh for another 3 h.
describe('fetch time of a service-worker copy', () => {
  const NOW = Date.UTC(2026, 5, 15, 12)
  const stamped = (body: unknown, at: number) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', 'x-fc-fetched-at': String(at) } })

  it('a batch served from the cache keeps the time it was really fetched', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    stubFetch({
      [OM]: () => stamped({ hourly: hourly(2) }, NOW - 5 * 3600_000),
      [MARINE]: () => json({ hourly: marineHourly(2) }),
    })
    const [f] = await w.fetchForecasts([loc('a', 56, 10, 'fresh')])
    expect(f!.fetched).toBe(NOW - 5 * 3600_000)
  })

  it('a single-location fetch does too', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    stubFetch({
      [OM]: () => stamped({ hourly: hourly(2) }, NOW - 4 * 3600_000),
      [MARINE]: () => json({ hourly: marineHourly(2) }),
    })
    const f = await w.fetchForecast(loc('a', 56, 10, 'fresh'))
    expect(f.fetched).toBe(NOW - 4 * 3600_000)
  })

  it('a live answer, or a nonsense stamp, is stamped now', async () => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
    stubFetch({
      [OM]: () => json({ hourly: hourly(2) }),
      [MARINE]: () => json({ hourly: marineHourly(2) }),
    })
    expect((await w.fetchForecast(loc('a', 56, 10, 'fresh'))).fetched).toBe(NOW)
    stubFetch({
      [OM]: () => stamped({ hourly: hourly(2) }, NOW + 3600_000),
      [MARINE]: () => json({ hourly: marineHourly(2) }),
    })
    expect((await w.fetchForecast(loc('a', 56, 10, 'fresh'))).fetched).toBe(NOW)
  })
})

/**
 * Scored days are LOCAL days 0–6, but Open-Meteo counts forecast_days in UTC
 * (timezone=UTC) from the UTC date. With 7, between local midnight and
 * 01:00/02:00 the UTC date is still yesterday, so the 7th local day had data
 * only up to 01:00 — and at any hour an overnight window on the 7th day lost
 * its after-midnight hours.
 */
describe('forecast range', () => {
  /** The last hourly timestamp a request answers for. */
  function lastHourAsked(url: string): number {
    const u = new URL(url)
    expect(u.searchParams.get('timezone')).toBe('UTC')
    const n = new Date()
    return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + Number(u.searchParams.get('forecast_days'))) - 3600_000
  }
  const routes = () => ({
    [OM]: () => json({ hourly: hourly(2) }),
    [MARINE]: () => json({ hourly: marineHourly(2) }),
  })

  it.each([
    // 00:30 on 16 June in DK (22:30 UTC on the 15th): the 7th local day is the
    // 22nd, and its last scored hour is 23:00 local.
    ['just after local midnight', '2026-06-15T22:30:00Z', new Date(2026, 5, 22, 23)],
    // Noon on the 16th: a 22:00–02:00 window on the 22nd ends 02:00 on the 23rd.
    ['an overnight window on day 7', '2026-06-16T10:00:00Z', new Date(2026, 5, 23, 2)],
  ])('covers the 7th local day — %s', async (_l, now, need) => {
    vi.useFakeTimers({ now: new Date(now), toFake: ['Date'] })
    const f = stubFetch(routes())
    await w.fetchForecasts([loc('a', 56, 10, 'fresh')])
    await w.fetchForecast(loc('a', 56, 10, 'fresh')) // the per-location fallback path
    expect(f.calls.length).toBe(4)
    for (const url of f.calls) expect(lastHourAsked(url)).toBeGreaterThanOrEqual(need.getTime())
  })
})

describe('forecastKey', () => {
  it('changes with the coordinates and with fresh vs sea water, nothing else', () => {
    const base = loc('a', 56, 10, 'salt')
    expect(w.forecastKey({ ...base, name: 'renamed', waterType: 'brackish' })).toBe(w.forecastKey(base))
    expect(w.forecastKey({ ...base, waterType: undefined })).toBe(w.forecastKey(base))
    expect(w.forecastKey({ ...base, waterType: 'fresh' })).not.toBe(w.forecastKey(base))
    expect(w.forecastKey({ ...base, lat: 56.01 })).not.toBe(w.forecastKey(base))
  })
})

describe('fetchForecasts — DMI tides', () => {
  const healthyWeather = {
    [OM]: () => json([{ hourly: hourly(2) }, { hourly: hourly(2) }]),
    [MARINE]: () => json([{}, {}]),
  }
  const two = () => [loc('a', 56.05, 12.45, 'salt'), loc('b', 56.1, 12.5, 'salt')]

  it('two locations nearest the same station share one prediction request', async () => {
    const f = stubFetch({
      ...healthyWeather,
      [STATIONS]: () => json({ features: [station('S1', 'Hornbæk', 56.09, 12.46)] }),
      [TIDES]: () => json(predictions()),
    })
    const out = await w.fetchForecasts(two())
    expect(f.count(TIDES)).toBe(1)
    expect(out.map((x) => x?.tides?.stationName)).toEqual(['Hornbæk', 'Hornbæk'])
    expect(out[0]!.tides!.predictions).toHaveLength(4)
  })

  // Regression: a 429 with a JSON body parsed to "no stations", and that empty
  // list was cached for the whole session — every spot lost its tides until a
  // reload, and "Update all" couldn't bring them back.
  it('a rate-limited station list is retried on the next refresh, not cached as empty', async () => {
    let limited = true
    const f = stubFetch({
      ...healthyWeather,
      [STATIONS]: () => limited
        ? json({ message: 'API rate limit exceeded' }, 429)
        : json({ features: [station('S1', 'Hornbæk', 56.09, 12.46)] }),
      [TIDES]: () => json(predictions()),
    })
    const first = await w.fetchForecasts(two())
    expect(first.map((x) => x?.tides)).toEqual([null, null])

    limited = false
    const second = await w.fetchForecasts(two())
    expect(f.count(STATIONS)).toBe(2)
    expect(second.map((x) => x?.tides?.stationName)).toEqual(['Hornbæk', 'Hornbæk'])
  })

  it('a station list with no Danish stations is not cached either', async () => {
    let empty = true
    stubFetch({
      ...healthyWeather,
      [STATIONS]: () => json({ features: empty ? [station('X', 'Kiel', 54.3, 10.1, 'DEU')] : [station('S1', 'Hornbæk', 56.09, 12.46)] }),
      [TIDES]: () => json(predictions()),
    })
    await w.fetchForecasts(two())
    empty = false
    const second = await w.fetchForecasts(two())
    expect(second[0]?.tides?.stationName).toBe('Hornbæk')
  })

  it('a thrown station request is retried on the next refresh', async () => {
    let down = true
    stubFetch({
      ...healthyWeather,
      [STATIONS]: () => { if (down) throw new TypeError('Failed to fetch'); return json({ features: [station('S1', 'Hornbæk', 56.09, 12.46)] }) },
      [TIDES]: () => json(predictions()),
    })
    await w.fetchForecasts(two())
    down = false
    const second = await w.fetchForecasts(two())
    expect(second[0]?.tides?.stationName).toBe('Hornbæk')
  })

  // An error body used to become `predictions: []` — a "successful" tide-less
  // forecast that then counted as fresh for 3 h.
  it('a failed prediction request gives no tides rather than an empty prediction list', async () => {
    stubFetch({
      ...healthyWeather,
      [STATIONS]: () => json({ features: [station('S1', 'Hornbæk', 56.09, 12.46)] }),
      [TIDES]: () => json({ message: 'Service unavailable' }, 503),
    })
    const out = await w.fetchForecasts(two())
    expect(out.map((x) => x?.tides)).toEqual([null, null])
    expect(out[0]!.hourly).toHaveLength(2) // the weather itself still lands
  })

  it('skips tides entirely for fresh water', async () => {
    const f = stubFetch({
      [OM]: () => json({ hourly: hourly(2) }),
      [MARINE]: () => json({}),
    })
    const [out] = await w.fetchForecasts([loc('lake', 56.2, 9.5, 'fresh')])
    expect(out!.tides).toBeNull()
    expect(f.count(STATIONS)).toBe(0)
  })
})

describe('fetchLightningStatus', () => {
  const here = loc('a', 56, 12, 'salt')

  // Regression (safety): every failure used to resolve 'clear', which lifted
  // the danger cap and removed the ⚡ tag from a spot with a strike 6 km away.
  it('rejects on a DMI error instead of reporting clear', async () => {
    stubFetch({ [LIGHTNING]: () => json({ message: 'API rate limit exceeded' }, 429) })
    await expect(w.fetchLightningStatus(here)).rejects.toThrow()
  })

  it('rejects when the request itself fails (offline)', async () => {
    stubFetch({})
    await expect(w.fetchLightningStatus(here)).rejects.toThrow()
  })

  it('rejects on a body that is not a feature collection', async () => {
    stubFetch({ [LIGHTNING]: () => new Response('<html>Bad gateway</html>', { status: 200 }) })
    await expect(w.fetchLightningStatus(here)).rejects.toThrow()
    stubFetch({ [LIGHTNING]: () => json({}) })
    await expect(w.fetchLightningStatus(here)).rejects.toThrow()
  })

  it('reports clear only for a real empty answer', async () => {
    stubFetch({ [LIGHTNING]: () => json({ features: [] }) })
    await expect(w.fetchLightningStatus(here)).resolves.toEqual({ level: 'clear', closestKm: null })
  })

  it('grades the closest strike', async () => {
    stubFetch({ [LIGHTNING]: () => json({ features: [strike(56.054, 12), strike(56.4, 12)] }) })
    await expect(w.fetchLightningStatus(here)).resolves.toEqual({ level: 'danger', closestKm: 6 })
  })

  // A big storm fills the page, and the closest strike may be in the part DMI
  // didn't return. A full page is followed by a query of the box around the
  // spot itself, which is all that decides 'danger'.
  it('a full page also asks the near box, so a close strike cannot hide in the cut-off tail', async () => {
    const f = stubFetch({
      [LIGHTNING]: (url) => {
        const limit = Number(url.searchParams.get('limit'))
        const [w0, , e0] = url.searchParams.get('bbox')!.split(',').map(Number)
        const wide = e0 - w0 > 1
        // Wide box: a full page of strikes ~40 km out. Near box: one at ~5 km.
        return json({
          features: wide
            ? Array.from({ length: limit }, () => strike(56.36, 12))
            : [strike(56.045, 12)],
        })
      },
    })
    const s = await w.fetchLightningStatus(here)
    expect(f.count(LIGHTNING)).toBe(2)
    expect(s).toEqual({ level: 'danger', closestKm: 5 })
  })

  it('does not ask the near box when the first page was not full', async () => {
    const f = stubFetch({ [LIGHTNING]: () => json({ features: [strike(56.36, 12)] }) })
    await expect(w.fetchLightningStatus(here)).resolves.toEqual({ level: 'caution', closestKm: 40 })
    expect(f.count(LIGHTNING)).toBe(1)
  })
})

describe('fetchForecastForDate', () => {
  // The catch date is a local calendar day (UTC midnight of the local date
  // parts). "Today" used the UTC date, so for the first two hours after local
  // midnight a catch logged today counted as one day in the future → null.
  it('treats a catch from today as today in the first hours after local midnight', async () => {
    vi.useFakeTimers({ now: new Date('2026-06-15T22:30:00Z'), toFake: ['Date'] }) // 00:30 on 16 June in DK
    const f = stubFetch({
      [OM]: () => json({ hourly: hourly(2) }),
      [MARINE]: () => json({ hourly: marineHourly(2) }),
    })
    const out = await w.fetchForecastForDate(loc('lake', 56.2, 9.5, 'fresh'), new Date(Date.UTC(2026, 5, 16)))
    expect(out).not.toBeNull()
    expect(f.count(OM)).toBe(1)
  })

  it('still refuses a date that is really in the future', async () => {
    vi.useFakeTimers({ now: new Date('2026-06-15T22:30:00Z'), toFake: ['Date'] })
    stubFetch({})
    await expect(w.fetchForecastForDate(loc('lake', 56.2, 9.5, 'fresh'), new Date(Date.UTC(2026, 5, 17)))).resolves.toBeNull()
  })
})
