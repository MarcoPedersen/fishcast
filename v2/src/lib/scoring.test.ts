import { describe, it, expect } from 'vitest'
import { scoreWindow } from './scoring'
import type { Forecast, HourData, Location } from './types'

const LOC: Location = { id: 't1', name: 'Test', lat: 56, lon: 10, waterType: 'salt' }
// UTC-midnight date, exactly how getScoredWindows builds the day.
const DATE = new Date(Date.UTC(2026, 5, 15))

interface FixtureOpts {
  windMs?: number
  windDir?: number
  cloud?: number
  precipPct?: number
  pressureAt?: (h: number) => number
  waveM?: number | null
  tideRising?: boolean
  hours?: boolean // include hourly data at all (default true)
}

// Build a forecast whose hourly timestamps match scoreWindow's local-hour
// anchoring, so findIdx locates them. Covers hours 0..29 (window + look-back +
// end-hour spill).
function makeForecast(o: FixtureOpts = {}): Forecast {
  const hourly: HourData[] = []
  if (o.hours !== false) {
    for (let h = 0; h < 30; h++) {
      const time = new Date(DATE.getUTCFullYear(), DATE.getUTCMonth(), DATE.getUTCDate(), h).getTime()
      hourly.push({
        time,
        temp: 12,
        windMs: o.windMs ?? 2,
        windDir: o.windDir ?? 270,
        gustMs: (o.windMs ?? 2) + 2,
        cloud: o.cloud ?? 40,
        precipPct: o.precipPct ?? 0,
        pressure: o.pressureAt ? o.pressureAt(h) : 1013,
      })
    }
  }
  const marine = o.waveM == null ? null : hourly.map((hd) => ({ time: hd.time, waveM: o.waveM!, wavePeriod: 4 }))
  const tides = o.tideRising == null ? null : {
    stationName: 'S', distKm: 5,
    // Three points around each scored hour so tideAt can interpolate + detect direction.
    predictions: Array.from({ length: 30 }, (_, h) => ({
      time: new Date(DATE.getUTCFullYear(), DATE.getUTCMonth(), DATE.getUTCDate(), h).getTime(),
      value: o.tideRising ? h * 0.1 : 5 - h * 0.1,
    })),
  }
  return { fetched: 0, hourly, marine, tides }
}

const sum = (pts: number[]) => pts.reduce((a, b) => a + b, 0)

describe('scoreWindow', () => {
  it('returns a valid integer score in [0,100] with data present', () => {
    const w = scoreWindow(LOC, DATE, '06:00', '10:00', makeForecast(), [])
    expect(w.noData).toBe(false)
    expect(Number.isInteger(w.score)).toBe(true)
    expect(w.score).toBeGreaterThanOrEqual(0)
    expect(w.score).toBeLessThanOrEqual(100)
  })

  it('reports noData when no forecast is supplied', () => {
    const w = scoreWindow(LOC, DATE, '06:00', '10:00', undefined, [])
    expect(w.noData).toBe(true)
  })

  it('reports noData when the forecast covers none of the window hours', () => {
    const w = scoreWindow(LOC, DATE, '06:00', '10:00', makeForecast({ hours: false }), [])
    expect(w.noData).toBe(true)
  })

  it('rejects an inverted window (from >= to) as a zero, no-data-free result', () => {
    const w = scoreWindow(LOC, DATE, '10:00', '06:00', makeForecast(), [])
    expect(w.score).toBe(0)
    expect(w.noData).toBe(false)
  })

  it('breakdown rows sum exactly to the displayed score (the modal invariant)', () => {
    const w = scoreWindow(LOC, DATE, '06:00', '10:00', makeForecast({ tideRising: true, waveM: 0.2 }), ['havørred'])
    expect(w.breakdown).toBeDefined()
    expect(sum(w.breakdown!.map((b) => b.points))).toBe(w.score)
  })

  it('tags every breakdown row with a stable key (for the explanation list)', () => {
    const w = scoreWindow(LOC, DATE, '06:00', '10:00', makeForecast({ tideRising: true }), [])
    expect(w.breakdown!.every((b) => typeof b.key === 'string' && b.key.length > 0)).toBe(true)
  })

  it('scores rising pressure higher than falling pressure', () => {
    const rising = scoreWindow(LOC, DATE, '06:00', '10:00', makeForecast({ pressureAt: (h) => 1005 + h }), [])
    const falling = scoreWindow(LOC, DATE, '06:00', '10:00', makeForecast({ pressureAt: (h) => 1025 - h }), [])
    expect(rising.score).toBeGreaterThan(falling.score)
  })

  it('penalises a gale versus calm wind', () => {
    const calm = scoreWindow(LOC, DATE, '06:00', '10:00', makeForecast({ windMs: 2 }), [])
    const gale = scoreWindow(LOC, DATE, '06:00', '10:00', makeForecast({ windMs: 14 }), [])
    expect(gale.score).toBeLessThan(calm.score)
  })

  it('adds a positive tide contribution on a rising tide', () => {
    const w = scoreWindow(LOC, DATE, '06:00', '10:00', makeForecast({ tideRising: true }), [])
    const tide = w.breakdown!.find((b) => b.key === 'bd_tide')
    expect(tide).toBeDefined()
    expect(tide!.points).toBeGreaterThan(0)
  })

  it('penalises big waves harder for waders than for boat (method matters)', () => {
    const waders = scoreWindow(LOC, DATE, '06:00', '10:00', makeForecast({ waveM: 1.2 }), [], 'waders')
    const boat = scoreWindow(LOC, DATE, '06:00', '10:00', makeForecast({ waveM: 1.2 }), [], 'boat')
    expect(waders.score).toBeLessThanOrEqual(boat.score)
  })
})
