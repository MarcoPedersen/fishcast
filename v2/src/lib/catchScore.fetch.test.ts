import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { canScoreCatch, scoreBlocker, scoreCatch, type ForecastCache } from './catchScore'
import type { CatchEntry, Location } from './types'

// Local-calendar-day behaviour around midnight depends on the zone. (No Node
// typings in this project, hence the local declaration.)
declare const process: { env: Record<string, string | undefined> }
process.env.TZ = 'Europe/Copenhagen'

const FRESH: Location = { id: 'lake', name: 'Mossø', lat: 56.0, lon: 9.8, waterType: 'fresh' }
const SALT: Location = { id: 'coast', name: 'Dragør mole', lat: 55.59, lon: 12.68, waterType: 'salt' }
const LOCS = [FRESH, SALT]
const entry = (over: Partial<CatchEntry> = {}): CatchEntry => ({
  id: 'c1', date: '2026-09-20', time: '19:00', speciesId: 'gedde', locationName: 'Mossø', ...over,
})

// Hourly Open-Meteo rows covering the whole test period, whatever is asked.
function hourlyPayload() {
  const time: string[] = []
  const n = (v: number) => Array.from({ length: time.length }, () => v)
  for (let t = Date.UTC(2026, 6, 1); t <= Date.UTC(2026, 9, 3); t += 3600000) {
    time.push(new Date(t).toISOString().slice(0, 16))
  }
  return {
    hourly: {
      time, temperature_2m: n(12), wind_speed_10m: n(3), wind_direction_10m: n(270),
      wind_gusts_10m: n(5), cloud_cover: n(40), precipitation_probability: n(0), surface_pressure: n(1013),
    },
  }
}
const HOURLY = hourlyPayload()

let calls: string[] = []
beforeEach(() => {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url)
    const ok = (data: unknown) => ({ ok: true, json: async () => data })
    if (url.includes('marine-api')) return { ok: false, json: async () => ({}) }
    if (url.includes('api.open-meteo.com')) return ok(HOURLY)
    if (url.includes('tidewaterstation')) {
      return ok({ features: [{ properties: { stationId: 'S1', name: 'Test havn', country: 'DNK' }, geometry: { coordinates: [12.6, 55.6] } }] })
    }
    if (url.includes('tidewater/items')) {
      const features = []
      for (let t = Date.UTC(2026, 6, 1); t <= Date.UTC(2026, 9, 3); t += 600000) {
        features.push({ properties: { predictionTime: new Date(t).toISOString(), value: Math.sin(t / 22357000) } })
      }
      return ok({ features })
    }
    throw new Error('unexpected fetch ' + url)
  }))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
const weatherCalls = () => calls.filter((u) => u.startsWith('https://api.open-meteo.com')).length
const now = (iso: string) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso)) }

describe('scoreCatch after local midnight', () => {
  /**
   * The catch day is the LOCAL date, but the weather fetch measured "today" in
   * UTC: at 00:50 in Denmark a catch dated today was a day in the future, came
   * back daysAgo = -1, and showed "no data" — for every night-time catch.
   */
  it('scores a catch made just after local midnight', async () => {
    now('2026-10-01T00:50:00+02:00')
    const score = await scoreCatch(entry({ date: '2026-10-01', time: '00:30' }), LOCS)
    expect(score).not.toBeNull()
  })
})

describe('catches older than the weather history', () => {
  it('reports them as too old instead of counting them as analysable', () => {
    now('2026-10-06T12:00:00+02:00')
    expect(scoreBlocker(entry({ date: '2026-06-01' }), LOCS)).toBe('old')
    expect(canScoreCatch(entry({ date: '2026-06-01' }), LOCS)).toBe(false)
    expect(scoreBlocker(entry({ date: '2026-09-01' }), LOCS)).toBeNull()
  })
})

describe('scoreCatch with a shared forecast cache', () => {
  it('fetches the weather once for several catches at one place on one day', async () => {
    now('2026-10-06T12:00:00+02:00')
    const cache: ForecastCache = new Map()
    await scoreCatch(entry({ id: 'a', time: '07:00' }), LOCS, cache)
    await scoreCatch(entry({ id: 'b', time: '19:00' }), LOCS, cache)
    expect(weatherCalls()).toBe(1)
  })

  it('reuses an earlier day’s fetch for later days when there are no tides (fresh water)', async () => {
    now('2026-10-06T12:00:00+02:00')
    const cache: ForecastCache = new Map()
    expect(await scoreCatch(entry({ id: 'a', date: '2026-09-10' }), LOCS, cache)).not.toBeNull()
    expect(await scoreCatch(entry({ id: 'b', date: '2026-09-25' }), LOCS, cache)).not.toBeNull()
    expect(weatherCalls()).toBe(1)
  })

  /** Tides are fetched for a window around ONE day — reusing them would drop the tide factor. */
  it('fetches again for another day where tides matter', async () => {
    now('2026-10-06T12:00:00+02:00')
    const cache: ForecastCache = new Map()
    const at = (id: string, date: string) => entry({ id, date, locationName: 'Dragør mole', speciesId: 'havørred' })
    await scoreCatch(at('a', '2026-09-10'), LOCS, cache)
    await scoreCatch(at('b', '2026-09-25'), LOCS, cache)
    expect(weatherCalls()).toBe(2)
    // Same answer as an uncached score of the later catch.
    const cached = await scoreCatch(at('b', '2026-09-25'), LOCS, cache)
    expect(cached).toBe(await scoreCatch(at('b', '2026-09-25'), LOCS))
  })

  /**
   * fetchTides swallows a DMI failure and returns null, so "no tides" on a
   * coast can be a hiccup, not a fact. Reusing that forecast for later days
   * scored every later catch there without the tide factor.
   */
  it('does not let one failed tide fetch strip tides from later days on a coast', async () => {
    now('2026-10-06T12:00:00+02:00')
    const cache: ForecastCache = new Map()
    const real = globalThis.fetch as ReturnType<typeof vi.fn>
    const impl = real.getMockImplementation() as (url: string) => Promise<unknown>
    let dmiDown = true
    real.mockImplementation(async (url: string) => {
      if (dmiDown && url.includes('tidewater')) { calls.push(url); throw new Error('DMI down') }
      return impl(url)
    })
    const at = (id: string, date: string) => entry({ id, date, locationName: 'Dragør mole', speciesId: 'havørred' })
    await scoreCatch(at('a', '2026-09-10'), LOCS, cache)
    dmiDown = false
    const cached = await scoreCatch(at('b', '2026-09-25'), LOCS, cache)
    expect(weatherCalls()).toBe(2)
    expect(cached).toBe(await scoreCatch(at('b', '2026-09-25'), LOCS))
  })

  it('does not keep a failed fetch, so a retry fetches again', async () => {
    now('2026-10-06T12:00:00+02:00')
    const cache: ForecastCache = new Map()
    const real = globalThis.fetch as ReturnType<typeof vi.fn>
    real.mockImplementationOnce(async () => ({ ok: false, status: 503, json: async () => ({}) }))
    await expect(scoreCatch(entry(), LOCS, cache)).rejects.toThrow()
    expect(cache.size).toBe(0)
    expect(await scoreCatch(entry(), LOCS, cache)).not.toBeNull()
    // The retry's result is the one kept: the next catch that day reuses it.
    expect(cache.size).toBe(1)
    await scoreCatch(entry({ id: 'b', time: '07:00' }), LOCS, cache)
    expect(weatherCalls()).toBe(1)
  })
})
