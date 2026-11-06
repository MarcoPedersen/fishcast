import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { beaufort, currentConditions, safetyRec, type CurrentConditions } from './conditions'
import type { Forecast, HourData, Location } from './types'

const H = 3600_000
const NOW = Date.UTC(2026, 6, 14, 12) // 14:00 in Denmark

const SEA: Pick<Location, 'bottomType' | 'waterType'> = { waterType: 'salt', bottomType: 'sand' }
const LAKE: Pick<Location, 'bottomType' | 'waterType'> = { waterType: 'fresh', bottomType: 'sand' }

/** Hourly rows from NOW − 6 h to NOW + 6 h; `at(offsetH)` may change or blank a row. */
function hours(base: Partial<HourData>, at: (h: number) => Partial<HourData> | null = () => ({})): HourData[] {
  const out: HourData[] = []
  for (let h = -6; h <= 6; h++) {
    const over = at(h)
    if (over === null) continue // no row at all
    out.push({ time: NOW + h * H, temp: 15, windMs: 4, windDir: 270, gustMs: 6, cloud: 40, precipPct: 0, pressure: 1013, ...base, ...over })
  }
  return out
}
const forecast = (hourly: HourData[], waveM: number | null = null): Forecast => ({
  fetched: NOW, hourly, tides: null,
  marine: waveM == null ? null : hourly.map((x) => ({ time: x.time, waveM, wavePeriod: 5, sstC: 16 })),
})
const blank: Partial<HourData> = { temp: null, windMs: null, windDir: null, gustMs: null, pressure: null }

/** Conditions as currentConditions builds them, with what a test sets. */
const cond = (c: Partial<CurrentConditions>): CurrentConditions => ({
  temp: 15, windMs: 4, windDir: 270, gustMs: 6, cloud: 40, precipPct: 0, pressure: 1013, pressureTrend: 'stable',
  waveM: null, wavePeriod: null, sstC: null, tide: null, tideStation: null, tideDistKm: null, ...c,
})

beforeEach(() => { vi.useFakeTimers({ now: NOW, toFake: ['Date'] }) })
afterEach(() => { vi.useRealTimers() })

describe('beaufort', () => {
  it('grades the mean wind', () => {
    expect(beaufort(0.2).bf).toBe(0)
    expect(beaufort(5).bf).toBe(3)
    expect(beaufort(14).bf).toBe(7)
  })
})

/**
 * Safety advice must never read a missing value as calm — scoring.ts already
 * refuses to (emptyHour, threeHoursBefore). A null wind came out as Bft 0
 * ('Stille'), so an hour with no reading between Bft 7 hours gave a green
 * boat 'ideal' and level 'safe'.
 */
describe('safetyRec — a missing wind reading', () => {
  it('is no green verdict when the hour around now has no wind, between Bft 7 hours', () => {
    const f = forecast(hours({ windMs: 14, gustMs: 20 }, (h) => (h === 0 ? blank : {})), 0.4)
    const c = currentConditions(f)!
    expect(c.windMs).toBeNull()
    const r = safetyRec(c, SEA)
    expect([r.boat.ok, r.shore.ok, r.wader.ok]).not.toContain('yes')
    expect(r.boat.labelKey).toBe('rec_wind_unknown')
    expect(r.level).not.toBe('safe')
  })

  it('…inland too', () => {
    const r = safetyRec(cond({ windMs: null, gustMs: null }), LAKE)
    expect([r.boat, r.shore, r.wader].map((x) => [x.ok, x.labelKey])).toEqual([
      ['caution', 'rec_wind_unknown'], ['caution', 'rec_wind_unknown'], ['caution', 'rec_wind_unknown'],
    ])
  })

  it('still says no where the waves alone decide it', () => {
    const r = safetyRec(cond({ windMs: null, waveM: 1.8, wavePeriod: 6 }), SEA)
    expect(r.boat.ok).toBe('no')
    expect(r.wader.ok).toBe('no')
    expect(r.level).toBe('danger')
  })
})

/**
 * A marine outage left a sea spot with no wave height, which took the inland
 * branch: a spot in a 1.8 m swell got boat 'good' and waders 'ideal'.
 */
describe('safetyRec — waves unknown at a sea spot', () => {
  it('says it cannot judge the waves instead of reading flat water', () => {
    const r = safetyRec(cond({ windMs: 4, waveM: null }), SEA)
    expect([r.boat, r.shore, r.wader].map((x) => [x.ok, x.labelKey])).toEqual([
      ['caution', 'rec_waves_unknown'], ['caution', 'rec_waves_unknown'], ['caution', 'rec_waves_unknown'],
    ])
    expect(r.undercurrent).toBe('unknown')
    expect(r.level).toBe('caution')
  })

  it('keeps a no the wind alone gives', () => {
    expect(safetyRec(cond({ windMs: 12, waveM: null }), SEA).boat.ok).toBe('no')
  })

  it('a lake has no sea waves to miss: wind alone, as before', () => {
    const r = safetyRec(cond({ windMs: 4, waveM: null }), LAKE)
    expect(r.boat).toEqual({ ok: 'yes', labelKey: 'rec_boat_good' })
    expect(r.wader.labelKey).toBe('rec_wader_ideal')
    expect(r.undercurrent).toBe('negligible')
    expect(r.level).toBe('safe')
  })

  it('known calm water at a sea spot is still ideal', () => {
    const r = safetyRec(cond({ windMs: 2, gustMs: 3, waveM: 0.1, wavePeriod: 3 }), SEA)
    expect(r.boat).toEqual({ ok: 'yes', labelKey: 'rec_boat_ideal' })
    expect(r.wader.labelKey).toBe('rec_wader_ideal')
    expect(r.level).toBe('safe')
  })
})

/**
 * The marine model has no waves at all for some sea spots: it answers every
 * hour with a null wave height in the inner Limfjord and Randers Fjord
 * (feggeklit, virksund, livo, hasseris-bugten, randers-fjord: 0 of 216 hours),
 * and marineRows drops the waves of a cell past SST_MAX_SNAP_KM. Read as
 * 'unknown', those spots got a caution that never lifted, even on a dead-calm
 * day. That is no outage and no gap: it is the wind-only verdict a lake gets,
 * which says what it is based on and never 'ideal'.
 */
describe('safetyRec — no wave model for these waters', () => {
  const rows = (hourly: HourData[], waveAt: (h: number) => number | null): Forecast['marine'] =>
    hourly.map((x) => ({ time: x.time, waveM: waveAt((x.time - NOW) / H), wavePeriod: null, sstC: null }))

  it('a marine answer with no wave height at any hour says so', () => {
    const hourly = hours({ windMs: 2, gustMs: 3 })
    const c = currentConditions({ ...forecast(hourly), marine: rows(hourly, () => null) })!
    expect(c.noWaveModel).toBe(true)
    const r = safetyRec(c, SEA)
    expect([r.boat, r.shore].map((x) => [x.ok, x.labelKey])).toEqual([
      ['yes', 'rec_boat_good'], ['yes', 'rec_shore_good'],
    ])
    expect([r.wader.ok, r.wader.labelKey]).toEqual(['yes', 'rec_wader_good']) // not 'ideal': the waves aren't known
    expect(r.wader.notes[0]).toBe('rec_note_no_wave_model')
    expect(r.undercurrent).toBe('unknown')
  })

  it('the wind still decides against it', () => {
    const r = safetyRec(cond({ windMs: 12, waveM: null, noWaveModel: true }), SEA)
    expect(r.boat.ok).toBe('no')
    expect(r.wader.ok).toBe('caution')
  })

  it('a gap at the current hour only is still unknown', () => {
    const hourly = hours({ windMs: 2, gustMs: 3 })
    const c = currentConditions({ ...forecast(hourly), marine: rows(hourly, (h) => (h === 0 ? null : 0.3)) })!
    expect(c.noWaveModel).toBe(false)
    expect(safetyRec(c, SEA).boat).toEqual({ ok: 'caution', labelKey: 'rec_waves_unknown' })
  })

  it('a failed marine request is still unknown', () => {
    const c = currentConditions({ ...forecast(hours({ windMs: 2, gustMs: 3 })), marineFailed: true } as Forecast)!
    expect(c.noWaveModel).toBe(false)
    expect(safetyRec(c, SEA).wader.labelKey).toBe('rec_waves_unknown')
  })
})

/**
 * The verdict read the mean wind only. A small boat or a wader in gusts of
 * Beaufort 7 strength is not 'good', whatever the mean says.
 */
describe('safetyRec — gusts', () => {
  it('gusts of 13.9 m/s and up make boat and waders caution at most', () => {
    const r = safetyRec(cond({ windMs: 7.9, gustMs: 20 }), LAKE)
    expect(r.boat).toEqual({ ok: 'caution', labelKey: 'rec_boat_caution' })
    expect(r.wader.ok).toBe('caution')
    expect(r.level).toBe('caution')
  })

  it('ordinary gusts change nothing', () => {
    const r = safetyRec(cond({ windMs: 7.9, gustMs: 12 }), LAKE)
    expect(r.boat).toEqual({ ok: 'yes', labelKey: 'rec_boat_good' })
    expect(r.level).toBe('safe')
  })
})

describe('currentConditions — pressure trend', () => {
  // A null pressure read as 1013: a steady 1003 with no reading 3 h back
  // came out 'falling', one with no reading now 'rising'.
  it('is unknown, not a trend, when the reading 3 h back is missing', () => {
    const f = forecast(hours({ pressure: 1003 }, (h) => (h === -3 ? { pressure: null } : {})))
    expect(currentConditions(f)!.pressureTrend).toBeNull()
  })

  it('is unknown when the reading now is missing', () => {
    const f = forecast(hours({ pressure: 1003 }, (h) => (h === 0 ? { pressure: null } : {})))
    expect(currentConditions(f)!.pressureTrend).toBeNull()
  })

  // idx − 3 compared against whatever row sat there: after a gap an hour
  // from before it, and in the first hours of a series row 0.
  it('compares against the row 3 hours back by time, not by position', () => {
    const f = forecast(hours({}, (h) => (h === -1 ? null : { pressure: h <= -4 ? 1020 : h === -3 ? 1009 : 1007 })))
    expect(currentConditions(f)!.pressureTrend).toBe('falling') // 1007 vs 1009, not vs 1020
    const late = forecast(hours({}, (h) => (h < -1 ? null : { pressure: h === -1 ? 1030 : 1005 })))
    expect(currentConditions(late)!.pressureTrend).toBeNull() // no row 3 h back
  })

  it('reads a real change', () => {
    const f = forecast(hours({}, (h) => ({ pressure: 1010 + h })))
    expect(currentConditions(f)!.pressureTrend).toBe('rising')
  })
})
