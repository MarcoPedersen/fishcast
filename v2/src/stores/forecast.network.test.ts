// The forecast store against the REAL weather.ts, with only fetch stubbed. The
// tide retry only works if both halves agree on what a failed tide request
// looks like, which neither one's own tests can show.
declare const process: { env: Record<string, string | undefined> }
process.env.TZ = 'Europe/Copenhagen'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { Location } from '@/lib/types'

vi.mock('@/lib/toast', () => ({ showToast: vi.fn(), dismissToast: vi.fn() }))

const OM = 'https://api.open-meteo.com/v1/forecast'
const MARINE = 'https://marine-api.open-meteo.com/v1/marine'
const STATIONS = 'https://opendataapi.dmi.dk/v2/oceanObs/collections/tidewaterstation/items'
const TIDES = 'https://opendataapi.dmi.dk/v2/oceanObs/collections/tidewater/items'
const LIGHTNING = 'https://opendataapi.dmi.dk/v2/lightningdata/collections/observation/items'
const T0 = Date.UTC(2026, 5, 15, 12)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function hourly(n = 3) {
  const time = Array.from({ length: n }, (_, i) => `2026-06-15T${String(i).padStart(2, '0')}:00`)
  const v = (x: number) => time.map(() => x)
  return {
    time, temperature_2m: v(14), wind_speed_10m: v(4), wind_direction_10m: v(270), wind_gusts_10m: v(7),
    cloud_cover: v(50), precipitation_probability: v(10), surface_pressure: v(1013),
  }
}
const hornbaek = {
  properties: { stationId: 'S1', name: 'Hornbæk', country: 'DNK' },
  geometry: { coordinates: [12.46, 56.09] },
}
const predictions = {
  features: [0, 1, 2, 3].map((h) => ({ properties: { predictionTime: `2026-06-15T0${h}:00:00Z`, value: h * 10 } })),
}

/** DMI rate-limits the station list until `dmi.limited` is cleared. */
function stubNetwork() {
  const dmi = { limited: true }
  const calls: string[] = []
  const routes: Record<string, () => Response> = {
    [OM]: () => json([{ hourly: hourly() }, { hourly: hourly() }]),
    [MARINE]: () => json([{}, {}]),
    [STATIONS]: () => dmi.limited ? json({ message: 'API rate limit exceeded' }, 429) : json({ features: [hornbaek] }),
    [TIDES]: () => json(predictions),
    [LIGHTNING]: () => json({ features: [] }),
  }
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    for (const [endpoint, route] of Object.entries(routes)) if (url.startsWith(endpoint + '?')) return route()
    throw new TypeError('Failed to fetch')
  }))
  return { dmi, stationRequests: () => calls.filter((u) => u.startsWith(STATIONS + '?')).length }
}

const spot = (id: string, lat: number, lon: number): Location => ({ id, name: id, lat, lon, waterType: 'salt' })
const locs = [spot('a', 56.05, 12.45), spot('b', 56.1, 12.5)]

// weather.ts caches the station list at module level: a fresh copy per test.
let useForecastStore: typeof import('./forecast').useForecastStore
beforeEach(async () => {
  vi.resetModules()
  ;({ useForecastStore } = await import('./forecast'))
  vi.useFakeTimers({ now: T0 })
  localStorage.clear()
  setActivePinia(createPinia())
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('forecast store + weather.ts — a DMI blip at app open', () => {
  it('the next refresh after 15 min asks DMI again and the tides come back', async () => {
    const net = stubNetwork()
    const fc = useForecastStore()
    await fc.fetchAll(locs)
    expect(fc.status).toEqual({ a: 'ok', b: 'ok' }) // the weather itself landed
    expect(fc.forecasts.a.tides).toBeNull()

    net.dmi.limited = false
    vi.setSystemTime(T0 + 5 * 60_000)
    await fc.fetchAll(locs) // a dashboard remount right away doesn't hammer DMI
    expect(net.stationRequests()).toBe(1)

    vi.setSystemTime(T0 + 30 * 60_000)
    await fc.refreshOnResume(locs, { reasonKey: 'toast_refreshing_stale' })
    expect(net.stationRequests()).toBe(2)
    expect(fc.forecasts.a.tides?.stationName).toBe('Hornbæk')
    expect(fc.forecasts.b.tides?.stationName).toBe('Hornbæk')
  })

  it('a reload inside the 3 h does not bring the tide-less copy back as fresh', async () => {
    const net = stubNetwork()
    await useForecastStore().fetchAll(locs)
    await vi.advanceTimersByTimeAsync(1000) // let the cache write land

    net.dmi.limited = false
    vi.setSystemTime(T0 + 30 * 60_000)
    setActivePinia(createPinia()) // a reload: the store starts from localStorage
    const fc = useForecastStore()
    expect(fc.forecasts.a).toBeDefined()
    await fc.fetchAll(locs)
    expect(fc.forecasts.a.tides?.stationName).toBe('Hornbæk')
  })
})
