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
    expect(s.sunrise.getUTCDate()).toBe(d)
    expect(s.sunset.getUTCDate()).toBe(d)
    expect(Math.abs(s.sunrise.getTime() - at(rise))).toBeLessThan(5 * MIN)
    expect(Math.abs(s.sunset.getTime() - at(set))).toBeLessThan(5 * MIN)
    // Solar noon isolates the equation of time from the day-length term.
    expect(Math.abs(s.solarNoon.getTime() - at(noon))).toBeLessThan(5 * MIN)
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
