// @ts-ignore — no @types/node in this project; Node's process exists under vitest
process.env.TZ = 'Europe/Copenhagen'
import { describe, it, expect } from 'vitest'
import { Solunar } from './solunar'

// Copenhagen-ish — the owner's spots are all on Zealand.
const LAT = 55.6, LON = 12.6
const MIN = 60000

/**
 * Reference sunrise / sunset / solar noon (UTC) from the full NOAA solar
 * calculator, computed independently of this module. The module's simplified
 * formulas are good to a couple of minutes; 5 min of slack is plenty, and far
 * below the whole-day error this guards against.
 */
const SUN_REF: [string, number, number, number, [number, number], [number, number], [number, number]][] = [
  // label, y, m (0-based), d, sunrise h:m, sunset h:m, solar noon h:m — all UTC
  ['11 Feb', 2026, 1, 11, [6, 42], [16, 5], [11, 23]],
  ['15 Jun', 2026, 5, 15, [2, 25], [19, 54], [11, 10]],
  ['1 Oct', 2026, 9, 1, [5, 12], [16, 45], [10, 59]],
  ['5 Oct', 2026, 9, 5, [5, 20], [16, 35], [10, 58]],
  ['25 Oct (fall-back day)', 2026, 9, 25, [6, 0], [15, 46], [10, 53]],
  ['15 Dec', 2026, 11, 15, [7, 32], [14, 37], [11, 4]],
  ['21 Dec', 2026, 11, 21, [7, 36], [14, 38], [11, 7]],
]

describe('getSunTimes', () => {
  /**
   * The equation of time used to come out ~1440 min too big whenever the sun's
   * longitude was past 180° (autumn equinox → spring equinox), so every sun
   * time landed exactly one day early — 181 days a year, today included.
   */
  it.each(SUN_REF)('puts sunrise and sunset on the requested day (%s)', (_l, y, m, d, rise, set, noon) => {
    const s = Solunar.getSunTimes(new Date(Date.UTC(y, m, d)), LAT, LON)
    const at = (hm: [number, number]) => Date.UTC(y, m, d, hm[0], hm[1])
    expect(s.sunrise!.getUTCDate()).toBe(d)
    expect(s.sunset!.getUTCDate()).toBe(d)
    expect(Math.abs(s.sunrise!.getTime() - at(rise))).toBeLessThan(5 * MIN)
    expect(Math.abs(s.sunset!.getTime() - at(set))).toBeLessThan(5 * MIN)
    // Solar noon isolates the equation of time from the day-length term.
    expect(Math.abs(s.solarNoon!.getTime() - at(noon))).toBeLessThan(5 * MIN)
  })
})

describe('getMoonPhase', () => {
  /**
   * True new / full moons of 2026 (UTC) from Meeus ch. 49, computed
   * independently — the two eclipses (3 Mar, 12 Aug) pin them to the minute.
   * The phase used to count from J2000 rather than a new moon, running ~5 days
   * ahead: the 10 Oct new moon read "🌒 Tiltagende" and full moon was credited
   * five days early.
   */
  const PHASE_REF: [string, number][] = [
    ['2026-01-03T10:03Z', 0.5],
    ['2026-03-03T11:38Z', 0.5], // total lunar eclipse
    ['2026-08-12T17:37Z', 0], // total solar eclipse
    ['2026-09-26T16:49Z', 0.5],
    ['2026-10-10T15:50Z', 0],
    ['2026-10-26T04:11Z', 0.5],
    ['2026-12-09T00:52Z', 0],
  ]
  // Circular distance, so 0.99 is close to a new moon at 0.
  const off = (p: number, want: number) => Math.abs((((p - want) % 1) + 1.5) % 1 - 0.5)

  it.each(PHASE_REF)('is at the right phase at %s', (iso, want) => {
    // 0.01 of a cycle ≈ 7 h
    expect(off(Solunar.getMoonPhase(new Date(iso)), want)).toBeLessThan(0.01)
  })

  it('labels the day of the October new moon as a new moon', () => {
    expect(Solunar.moonPhaseLabel(Solunar.getMoonPhase(new Date(Date.UTC(2026, 9, 10)))).score).toBe(15)
  })

  it('does not call the moon full five days before it is', () => {
    expect(Solunar.moonPhaseLabel(Solunar.getMoonPhase(new Date(Date.UTC(2026, 8, 21)))).score).toBe(8)
  })
})

describe('getSolunarPeriods', () => {
  /**
   * Upper and lower moon transits (UTC) at LON from a Meeus ch. 47 moon
   * position, computed independently, for local midnight − 2 h to the next
   * local midnight + 2 h. Only the transit nearest UTC noon and the one 12h25m
   * after it used to be modelled, so a lower transit before the upper one —
   * often at dawn — was dropped on most days, and on 27 Oct the iteration
   * jumped to the next day's transit, losing both of that day's.
   */
  const TRANSIT_REF: [string, number, string[]][] = [
    ['5 Oct', 5, ['2026-10-05T06:43Z', '2026-10-05T19:10Z']],
    ['12 Oct', 12, ['2026-10-11T23:49Z', '2026-10-12T12:13Z']],
    ['17 Oct', 17, ['2026-10-17T04:00Z', '2026-10-17T16:25Z']],
    ['27 Oct', 27, ['2026-10-26T23:29Z', '2026-10-27T11:58Z', '2026-10-28T00:29Z']],
  ]

  it.each(TRANSIT_REF)('puts a major period on every moon transit around %s', (_l, d, refs) => {
    const p = Solunar.getSolunarPeriods(new Date(Date.UTC(2026, 9, d)), LAT, LON)
    for (const iso of refs) {
      const ms = Date.parse(iso)
      // Majors are ±1 h, so being inside at ±50 min pins the centre to ±10 min.
      for (const dt of [-50, 0, 50]) {
        const s = Solunar.solunarScore(new Date(ms + dt * MIN), p)
        expect({ iso, dt, score: s.score, period: s.period }).toEqual({ iso, dt, score: 18, period: 'major' })
      }
    }
  })

  it('credits the dawn lower transit on 17 Oct', () => {
    // Lower transit ≈ 06:00 local; the old model's nearest major was 18:24.
    const p = Solunar.getSolunarPeriods(new Date(Date.UTC(2026, 9, 17)), LAT, LON)
    expect(Solunar.solunarScore(new Date(2026, 9, 17, 6), p).score).toBe(18)
  })
})

/**
 * The transit scan made getSolunarPeriods ~3.5x slower (113 vs 32 µs), and
 * scoreWindow asks for it once per window and method — twice for an overnight
 * window — so 18 spots x 2 slots x 7 days spent most of their time recomputing
 * the same few hundred days.
 */
describe('getSolunarPeriods memo', () => {
  const day = (d: number) => new Date(Date.UTC(2026, 9, d))

  it('hands back the same result for the same local day and place', () => {
    const a = Solunar.getSolunarPeriods(day(5), LAT, LON)
    expect(Solunar.getSolunarPeriods(day(5), LAT, LON)).toBe(a)
    // Any instant on that UTC date is the same day to this function.
    expect(Solunar.getSolunarPeriods(new Date(Date.UTC(2026, 9, 5, 13, 7)), LAT, LON)).toBe(a)
  })

  it('keys on the day and on the place, rounded to ~100 m', () => {
    const a = Solunar.getSolunarPeriods(day(6), LAT, LON)
    expect(Solunar.getSolunarPeriods(day(7), LAT, LON)).not.toBe(a)
    expect(Solunar.getSolunarPeriods(day(6), LAT + 0.01, LON)).not.toBe(a)
    expect(Solunar.getSolunarPeriods(day(6), LAT, LON + 0.01)).not.toBe(a)
    expect(Solunar.getSolunarPeriods(day(6), LAT + 0.0002, LON - 0.0002)).toBe(a)
  })

  it('is read-only, so one caller cannot change what the next one gets', () => {
    const p = Solunar.getSolunarPeriods(day(8), LAT, LON)
    expect(Object.isFrozen(p)).toBe(true)
    expect(Object.isFrozen(p.majors)).toBe(true)
  })

  it('stays bounded, dropping the least recently used day', () => {
    const first = Solunar.getSolunarPeriods(day(9), LAT, LON)
    const kept = Solunar.getSolunarPeriods(day(10), LAT, LON)
    for (let i = 0; i < Solunar.PERIODS_CACHE_MAX; i++) {
      Solunar.getSolunarPeriods(day(10), LAT, LON) // keep this one in use
      Solunar.getSolunarPeriods(day(11), 54 + i / 1000, LON)
    }
    expect(Solunar.getSolunarPeriods(day(10), LAT, LON)).toBe(kept)
    expect(Solunar.getSolunarPeriods(day(9), LAT, LON)).not.toBe(first)
  })
})

describe('solunarScore approach ramp', () => {
  const T = Date.UTC(2026, 9, 12, 18)
  const major = (centreH: number) => ({
    start: new Date(T + centreH * 3600000 - 3600000), end: new Date(T + centreH * 3600000 + 3600000), kind: 'upper',
  })
  const periods = (...majors: ReturnType<typeof major>[]) =>
    ({ majors, major1: majors[0], major2: null, minor1: null, minor2: null })

  it('reports an approach as approach-major, not major', () => {
    const s = Solunar.solunarScore(new Date(T), periods(major(3)))
    expect(s.score).toBeGreaterThan(0)
    expect(s.period).toBe('approach-major')
  })

  it('takes the closest period, not the first one listed', () => {
    // 5 h from the first major (ramp ≈ 1) but 1.5 h from the second (≈ 5)
    const s = Solunar.solunarScore(new Date(T), periods(major(-5), major(1.5)))
    expect(s.score).toBe(5)
  })

  it('gives no label when the ramp rounds to 0, so no tag is shown', () => {
    const s = Solunar.solunarScore(new Date(T), periods(major(5.9)))
    expect(s).toEqual({ score: 0, label: null, period: null })
  })
})

describe('timeOfDayScore', () => {
  // Window hours are anchored as LOCAL wall-clock hours, exactly as scoreWindow
  // builds them.
  const period = (y: number, m: number, d: number, localHour: number) =>
    Solunar.timeOfDayScore(new Date(y, m, d, localHour), Solunar.getSunTimes(new Date(Date.UTC(y, m, d)), LAT, LON)).period

  it('scores the sunrise hour as dawn in October', () => {
    // 5 Oct: sunrise ≈ 07:20 local
    expect(period(2026, 9, 5, 7)).toBe('dawn')
  })

  it('scores the sunrise hour as dawn in December', () => {
    // 15 Dec: sunrise ≈ 08:32 local
    expect(period(2026, 11, 15, 8)).toBe('dawn')
  })

  it('scores the sunset hour as dusk and midday as midday in October', () => {
    // 5 Oct: sunset ≈ 18:35 local, solar noon ≈ 12:58 local
    expect(period(2026, 9, 5, 18)).toBe('dusk')
    expect(period(2026, 9, 5, 13)).toBe('midday')
  })

  it('still scores late evening as night', () => {
    expect(period(2026, 9, 5, 23)).toBe('night')
    expect(period(2026, 11, 15, 22)).toBe('night')
  })
})
