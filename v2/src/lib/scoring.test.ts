import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { COND_LABEL_KEY, SCORE_WEIGHTS, SPECIES_CONDITIONS, availDays, curveAt, availMethods, getScoredWindows, isOvernight, isValidWindow, scoreWindow, scoreWindowBest, shoreRelation, shoreWeights, softCeiling, sstPreference, tideAt, windowHours, type SpeciesConditions } from './scoring'
import { resolveShore, type Shore } from './coast'
import { deriveFromFeatures, type CoastFeature, type FeatureKind } from './coastGeometry'
import { SPOT_COAST } from './spotCoast.gen'
import { SPECIES_PREFS } from './species'
import { speciesEntry } from './locationSpecies'
import { currentConditions } from './conditions'
import type { Availability, FishingMethod, Forecast, HourData, Location, ScoredWindow } from './types'
import { t } from './i18n'
import { Solunar } from './solunar'
import { STRINGS } from './strings'

const LOC: Location = { id: 't1', name: 'Test', lat: 56, lon: 10, waterType: 'salt' }
// UTC-midnight date, exactly how getScoredWindows builds the day.
const DATE = new Date(Date.UTC(2026, 5, 15))

interface FixtureOpts {
  windMs?: number | null
  windDir?: number
  cloud?: number
  precipPct?: number
  pressureAt?: (h: number) => number | null
  waveM?: number | null
  tideRising?: boolean
  /** An M2 sinusoid of this range (cm) at 10-minute steps, in metres; rising 12–13, falling 06–07. */
  tideRangeCm?: number
  /** Sea temperature on every marine hour; given (even null) it makes a marine series without waves. */
  sstC?: number | null
  /** Sets tides.rangeM, as fetchTides does; absent, the scorer computes it from the predictions. */
  rangeM?: number | null
  /** Hours whose temperature, wind and pressure are all missing. */
  nullHours?: number[]
  hours?: boolean // include hourly data at all (default true)
  date?: Date // UTC-midnight day the fixture covers (default DATE)
  span?: number // hours covered from local midnight of `date` (default 30)
}

// Build a forecast whose hourly timestamps match scoreWindow's local-hour
// anchoring, so findIdx locates them. Covers hours 0..29 (window + look-back +
// end-hour spill) unless `span` says otherwise.
function makeForecast(o: FixtureOpts = {}): Forecast {
  const D = o.date ?? DATE
  const span = o.span ?? 30
  const hourly: HourData[] = []
  if (o.hours !== false) {
    for (let h = 0; h < span; h++) {
      const time = new Date(D.getUTCFullYear(), D.getUTCMonth(), D.getUTCDate(), h).getTime()
      const gone = o.nullHours?.includes(h)
      const windMs = o.windMs === undefined ? 2 : o.windMs
      hourly.push({
        time,
        temp: gone ? null : 12,
        windMs: gone ? null : windMs,
        windDir: o.windDir ?? 270,
        gustMs: windMs == null ? null : windMs + 2,
        cloud: o.cloud ?? 40,
        precipPct: o.precipPct ?? 0,
        pressure: gone ? null : o.pressureAt ? o.pressureAt(h) : 1013,
      })
    }
  }
  const marine = o.waveM == null && o.sstC === undefined ? null
    : hourly.map((hd) => ({ time: hd.time, waveM: o.waveM ?? null, wavePeriod: 4, ...(o.sstC !== undefined && { sstC: o.sstC }) }))
  const local = (h: number, min = 0) => new Date(D.getUTCFullYear(), D.getUTCMonth(), D.getUTCDate(), h, min).getTime()
  const tides = o.tideRangeCm != null ? {
    stationName: 'S', distKm: 5,
    predictions: Array.from({ length: span * 6 }, (_, i) => ({
      time: local(0, i * 10),
      value: (o.tideRangeCm! / 200) * Math.sin((2 * Math.PI * i) / 6 / 12.42),
    })),
  } : o.tideRising == null ? null : {
    stationName: 'S', distKm: 5,
    // Three points around each scored hour so tideAt can interpolate + detect
    // direction. 10 cm an hour is a 3 m range over the fixture, so the tide
    // row counts in full.
    predictions: Array.from({ length: span }, (_, h) => ({
      time: local(h),
      value: o.tideRising ? h * 0.1 : 5 - h * 0.1,
    })),
  }
  if (tides && o.rangeM !== undefined) (tides as Forecast['tides'] & {}).rangeM = o.rangeM
  return { fetched: 0, hourly, marine, tides }
}

/** A row's points in a window, 0 when it has no row. */
const rowPts = (w: ScoredWindow, key: string) => w.breakdown!.find((b) => b.key === key)?.points ?? 0
const hasRow = (w: ScoredWindow, key: string) => w.breakdown!.some((b) => b.key === key)

const sum = (pts: number[]) => pts.reduce((a, b) => a + b, 0)
/** A window's rows before the floor and the ceiling: what the factors add up to. */
const preCeiling = (w: ScoredWindow) => sum(w.breakdown!.filter((b) => b.key !== 'bd_ceiling' && b.key !== 'bd_floor').map((b) => b.points))

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

  it('rejects a zero-length window as a zero, no-data-free result', () => {
    const w = scoreWindow(LOC, DATE, '10:00', '10:00', makeForecast(), [])
    expect(w.score).toBe(0)
    expect(w.noData).toBe(false)
  })

  it('scores an overnight window, reaching into the following morning', () => {
    const w = scoreWindow(LOC, DATE, '22:00', '02:00', makeForecast(), [])
    expect(w.noData).toBe(false)
    expect(w.score).toBeGreaterThan(0)
    // The best hour may legitimately fall on either side of midnight; what
    // matters is that post-midnight hours were scored at all.
    expect(w.bestHourStr).toMatch(/^(22|23|00|01|02):00$/)
  })

  /**
   * The decisive one: hours after midnight must actually be scored. The fixture
   * indexes hour h as `new Date(y, m, d, h)`, so 24/25/26 are 00/01/02 the next
   * day. Blow a gale into exactly those and the score has to move — if the
   * post-midnight hours were skipped, both windows would score identically.
   */
  it('includes hours after midnight in the score', () => {
    const calm = makeForecast({ windMs: 2 })
    const galeAfterMidnight = makeForecast({ windMs: 2 })
    for (const h of [24, 25, 26]) galeAfterMidnight.hourly[h].windMs = 16
    const a = scoreWindow(LOC, DATE, '22:00', '02:00', calm, [])
    const b = scoreWindow(LOC, DATE, '22:00', '02:00', galeAfterMidnight, [])
    expect(b.score).toBeLessThan(a.score)
  })

  /**
   * Post-midnight hours belong to the NEXT day's sunrise. They used to be scored
   * against the start day's sun times, which put a 04:00 June dawn after the
   * start day's sunset, i.e. in the 'night' branch, so "night fishing until
   * dawn" never got the dawn bonus. A gale through the night makes the calm
   * 04–05 dawn hours the clear best hour, so their label is the one shown.
   */
  it('scores the post-midnight hours of an overnight window against the next dawn', () => {
    const f = makeForecast({ windMs: 2 })
    for (let h = 22; h <= 27; h++) f.hourly[h].windMs = 16
    const w = scoreWindow(LOC, DATE, '22:00', '06:00', f, ['havørred'])
    expect(w.bestHourStr).toMatch(/^0[45]:00$/)
    expect(w.breakdown!.find((b) => b.key === 'bd_timeofday')!.label).toContain(t('tod_dawn'))
  })

  it('an overnight window and its mirror image are not the same window', () => {
    const night = scoreWindow(LOC, DATE, '22:00', '02:00', makeForecast(), [])
    const day = scoreWindow(LOC, DATE, '02:00', '22:00', makeForecast(), [])
    expect(night.score).not.toBe(0)
    expect(day.score).not.toBe(0)
    expect(night.score).not.toBe(day.score)
  })

  it('breakdown rows sum exactly to the displayed score (the modal invariant)', () => {
    const w = scoreWindow(LOC, DATE, '06:00', '10:00', makeForecast({ tideRising: true, waveM: 0.2 }), ['havørred'])
    expect(w.breakdown).toBeDefined()
    expect(sum(w.breakdown!.map((b) => b.points))).toBe(w.score)
  })

  /**
   * The total is floored at 0 and eased towards 100 above 85 (softCeiling),
   * and nothing used to account for the difference: a storm showed "Samlet
   * score 0" under rows summing to about −100, and a perfect dawn 100 under
   * rows summing to ~140.
   */
  describe('breakdown invariant at the 0–100 limits', () => {
    const storm = () => scoreWindow(LOC, DATE, '12:00', '14:00', makeForecast({
      precipPct: 90, windMs: 12, windDir: 60, pressureAt: (h) => 1030 - 2 * h, waveM: 1.8,
    }), [], 'boat')
    const SPOT: Location = { ...LOC, species: [{ nameEn: 'Sea Trout', months: [6] }] }
    const perfect = () => scoreWindow(SPOT, DATE, '04:00', '05:00', makeForecast({
      pressureAt: (h) => 1000 + 2 * h, cloud: 90, windMs: 2, windDir: 270, waveM: 0.1, tideRising: true,
    }), ['havørred'], 'waders')
    // Fires the model-v3 rows: water temperature and the species row.
    const warmSummerNight = () => scoreWindow(LOC, DATE, '23:00', '23:30', makeForecast({
      sstC: 18, waveM: 0.5, windMs: 6, tideRangeCm: 40,
    }), ['havørred', 'makrel'])
    // …and the coast row: the keys above come only from what fixtures produce.
    const onshoreMorning = () => scoreWindow({ ...LOC, coast: { facing: 270, spread: 180, exposure: 'open' } }, DATE, '07:00', '08:00', makeForecast({
      sstC: 10, waveM: 0.5, windMs: 6, windDir: 260,
    }), ['havørred'])

    it('adds a balancing row when the total is floored at 0', () => {
      const w = storm()
      expect(w.score).toBe(0)
      expect(sum(w.breakdown!.map((b) => b.points))).toBe(0)
      expect(w.breakdown!.find((b) => b.key === 'bd_floor')!.points).toBeGreaterThan(0)
    })

    it('eases a total over 100 and accounts for it with a row of its own', () => {
      const w = perfect()
      expect(preCeiling(w)).toBeGreaterThan(100)
      expect(w.score).toBe(softCeiling(preCeiling(w)))
      expect(sum(w.breakdown!.map((b) => b.points))).toBe(w.score)
      expect(w.breakdown!.find((b) => b.key === 'bd_ceiling')!.points).toBe(w.score - preCeiling(w))
    })

    // The clamp at 100 left a total of 85–100 alone, with no row.
    it('eases a total between 85 and 100 too, with the same row', () => {
      const w = scoreWindow(LOC, DATE, '03:00', '07:00', makeForecast({
        pressureAt: (h) => 1000 + 2 * h, cloud: 90, windMs: 2, windDir: 270, waveM: 0.1, tideRising: true,
      }), ['havørred'], 'waders')
      expect(preCeiling(w)).toBeGreaterThanOrEqual(90)
      expect(preCeiling(w)).toBeLessThan(100)
      expect(w.score).toBe(softCeiling(preCeiling(w)))
      expect(w.score).toBeLessThan(preCeiling(w))
      expect(sum(w.breakdown!.map((b) => b.points))).toBe(w.score)
      expect(w.breakdown!.find((b) => b.key === 'bd_ceiling')!.points).toBe(w.score - preCeiling(w))
    })

    it('gives every row a name and an explanation in both languages', () => {
      // DashboardView renders t(key) and t(key + '_why') for every keyed row.
      const night = warmSummerNight()
      expect(hasRow(night, 'bd_watertemp') && hasRow(night, 'fac_species_name')).toBe(true)
      const shore = onshoreMorning()
      expect(hasRow(shore, 'bd_shorewind')).toBe(true)
      const keys = [...new Set([storm(), perfect(), night, shore].flatMap((w) => w.breakdown!.map((b) => b.key!)))]
      const missing = (['da', 'en'] as const).flatMap((l) =>
        keys.flatMap((k) => [k, k + '_why']).filter((k) => !STRINGS[l][k]).map((k) => `${l}.${k}`))
      expect(missing).toEqual([])
    })
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

  // bd_pressure_why gives +15 to "fast-rising" pressure, so the row that
  // shows +15 must not call it "weakly rising".
  it('labels a fast rise or fall as fast, and a slow one as slow', () => {
    const label = (perHour: number) => scoreWindow(LOC, DATE, '12:00', '12:30', makeForecast({ pressureAt: (h) => 1013 + perHour * h }), [])
      .breakdown!.find((b) => b.key === 'bd_pressure')!.label
    const keys = ['press_rising_fast', 'press_rising', 'press_falling', 'press_falling_fast']
    expect([2, 0.5, -0.5, -2].map(label)).toEqual(keys.map((k) => t(k)))
    // The key is built at runtime, so the strings test can't see the _fast ones.
    expect(keys.flatMap((k) => (['da', 'en'] as const).filter((l) => !STRINGS[l][k]).map((l) => `${l}.${k}`))).toEqual([])
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

  // Half the year the sun times used to land a day early, so every hour of an
  // autumn or winter window scored '🌙 Nat +5' and the dawn bonus never fired.
  it.each([
    ['October', new Date(Date.UTC(2026, 9, 5))],
    ['December', new Date(Date.UTC(2026, 11, 15))],
  ])('credits dawn, not night, to a morning window in %s', (_m, date) => {
    const w = scoreWindow(LOC, date, '07:00', '09:00', makeForecast({ date }), [])
    const tod = w.breakdown!.find((b) => b.key === 'bd_timeofday')!
    expect(tod.label).toContain(t('tod_dawn'))
    expect(tod.points).toBeGreaterThan(5)
  })

  it('penalises big waves harder for waders than for boat (method matters)', () => {
    const waders = scoreWindow(LOC, DATE, '06:00', '10:00', makeForecast({ waveM: 1.2 }), [], 'waders')
    const boat = scoreWindow(LOC, DATE, '06:00', '10:00', makeForecast({ waveM: 1.2 }), [], 'boat')
    const methodPts = (w: ReturnType<typeof scoreWindow>) => w.breakdown!.find((b) => b.key === 'bd_method')?.points
    expect(methodPts(waders)).toBe(SCORE_WEIGHTS.method.wadersBig)
    expect(methodPts(boat)).toBe(SCORE_WEIGHTS.method.boatMod)
    expect(waders.score).toBeLessThan(boat.score)
  })
})

/**
 * Above SCORE_WEIGHTS.ceilingFrom the factors' sum is eased towards 100, not
 * cut at it. Cut at 100, November 07–09 sea-trout windows and single hours
 * tied at 100: a very good morning and an exceptional one looked the same.
 * Up to 89 nothing changes, so 'Fremragende' (80+) is as frequent as before.
 */
describe('the soft ceiling', () => {
  it('leaves a sum up to 85 as it is, floored at 0', () => {
    expect([-40, 0, 12, 50, 84, 85].map(softCeiling)).toEqual([0, 0, 12, 50, 84, 85])
  })

  it('eases a sum above 85 towards 100: 85 + 15·(1 − e^(−(sum − 85)/15))', () => {
    expect([86, 90, 100, 115, 130, 150].map(softCeiling)).toEqual([86, 89, 94, 98, 99, 100])
  })

  it('never falls as the sum rises, and never passes 100', () => {
    const s = Array.from({ length: 401 }, (_, i) => softCeiling(i / 2 - 50))
    expect(s.every((v, i) => i === 0 || v >= s[i - 1])).toBe(true)
    expect(Math.max(...s, softCeiling(1e6))).toBe(100)
  })

  // Cut at 100, a June dawn's 04:00 and 05:00 both scored 100, and 04:00 was
  // the best hour although 05:00 summed higher.
  it('picks the best hour on the eased scale, not the first hour to reach 100', () => {
    const SPOT: Location = { ...LOC, species: [{ nameEn: 'Sea Trout', months: [6] }] }
    const f = makeForecast({ pressureAt: (h) => 1000 + 2 * h, cloud: 90, windMs: 2, windDir: 270, waveM: 0.1, tideRising: true })
    const alone = windowHours(DATE, '03:00', '07:00').map((h) => scoreWindow(SPOT, DATE, '03:00', '07:00', f, ['havørred'], 'waders', undefined, [h]))
    const sums = alone.map(preCeiling)
    expect(sums.filter((s) => s > 100).length).toBeGreaterThanOrEqual(2)
    for (const w of alone) expect(w.score).toBe(softCeiling(preCeiling(w)))
    const w = scoreWindow(SPOT, DATE, '03:00', '07:00', f, ['havørred'], 'waders')
    expect(w.bestHourStr).toBe(alone[sums.indexOf(Math.max(...sums))].bestHourStr)
  })
})

/**
 * The best hour is the one whose factors sum highest. Read off the hour
 * scores, it was the first of several hours the floor had lifted to 0: on a
 * July evening 17:00 (−16) was the best hour although 19:00 summed −1, and the
 * lure and the tags followed 17:00.
 */
describe('the best hour', () => {
  it('is the hour that sums highest when every hour floors at 0', () => {
    const f = makeForecast({ windMs: 16, precipPct: 90, waveM: 2, pressureAt: (h) => 1030 - 3 * h, tideRising: false })
    const alone = windowHours(DATE, '03:00', '07:00').map((h) => scoreWindow(LOC, DATE, '03:00', '07:00', f, ['havørred'], 'shore', undefined, [h]))
    const sums = alone.map(preCeiling)
    expect(sums.every((s) => s < 0)).toBe(true)
    // Not vacuous: the hours differ, and the first of them is not the highest.
    expect(sums.indexOf(Math.max(...sums))).toBeGreaterThan(0)
    const w = scoreWindow(LOC, DATE, '03:00', '07:00', f, ['havørred'], 'shore')
    expect(w.score).toBe(0)
    expect(w.bestHourStr).toBe(alone[sums.indexOf(Math.max(...sums))].bestHourStr)
  })
})

/**
 * Availability hours are local wall-clock times. The fixtures above build their
 * timestamps with the same local constructor scoreWindow uses, so a regression
 * to Date.UTC anchoring would shift fixture and code together and pass. Here the
 * forecast sits at true UTC instants (as Open-Meteo returns it) and a gale blows
 * only at LOCAL 06–07 — under Date.UTC anchoring the window would read 08–09
 * (summer) and find calm air. Relies on the TZ pin in test-setup.ts.
 */
describe('local-hour anchoring', () => {
  function galeAtLocal(y: number, m: number, d: number, localHours: number[]): Forecast {
    const hourly: HourData[] = []
    for (let h = -24; h < 48; h++) {
      const time = Date.UTC(y, m, d, h)
      const lt = new Date(time)
      const gale = lt.getDate() === d && localHours.includes(lt.getHours())
      hourly.push({ time, temp: 12, windMs: gale ? 14 : 2, windDir: 270, gustMs: 4, cloud: 40, precipPct: 0, pressure: 1013 })
    }
    return { fetched: 0, hourly, marine: null, tides: null }
  }
  const windPts = (w: ReturnType<typeof scoreWindow>) => w.breakdown!.find((b) => b.key === 'bd_wind')!.points

  it.each([
    ['a summer day (CEST)', 2026, 5, 15],
    ['the spring-forward day', 2026, 2, 29],
    ['the fall-back day', 2026, 9, 25],
    ['a winter day (CET)', 2026, 11, 15],
  ])('scores 06:00–07:00 against local 06–07 on %s', (_label, y, m, d) => {
    const w = scoreWindow(LOC, new Date(Date.UTC(y, m, d)), '06:00', '07:00', galeAtLocal(y, m, d, [6, 7]), [])
    expect(windPts(w)).toBe(SCORE_WEIGHTS.wind.gale)
  })
})

describe('solunar row', () => {
  /**
   * The only rigorous test of solunar periods (Quigley et al. 2023) found no
   * link with catches, so the row is cut to moon-phase scale. Inside a major
   * period it pays the major weight; the approach ramp pays at most the
   * approach weight, scaled by how far along the ramp the hour is. "Inside"
   * is read straight off the period bounds, independent of the code under test.
   */
  it('pays the major weight inside a major period and at most the approach weight outside', () => {
    const periods = Solunar.getSolunarPeriods(DATE, LOC.lat, LOC.lon)
    type P = { start: Date; end: Date }
    const inPeriod = (h: number) => {
      const t = new Date(DATE.getUTCFullYear(), DATE.getUTCMonth(), DATE.getUTCDate(), h).getTime()
      const all = [...periods.majors, periods.minor1, periods.minor2].filter(Boolean) as P[]
      return { major: periods.majors.some((p: P) => t >= +p.start && t <= +p.end), any: all.some((p) => t >= +p.start && t <= +p.end) }
    }
    let majors = 0, approaches = 0
    for (let h = 0; h < 24; h++) {
      const pts = rowPts(scoreWindow(LOC, DATE, `${h}:00`, `${h}:30`, makeForecast(), []), 'bd_solunar')
      const p = inPeriod(h)
      if (p.major) { expect({ h, pts }).toEqual({ h, pts: SCORE_WEIGHTS.solunar.major }); majors++ }
      else if (!p.any) { expect(pts).toBeLessThanOrEqual(SCORE_WEIGHTS.solunar.approachMajor); if (pts > 0) approaches++ }
    }
    // Not vacuous: the day has hours inside a major and hours on a ramp.
    expect(majors).toBeGreaterThan(0)
    expect(approaches).toBeGreaterThan(0)
  })

  it('stays smaller than the water-temperature row, which has the stronger evidence', () => {
    expect(SCORE_WEIGHTS.solunar.major).toBeLessThan(SCORE_WEIGHTS.waterTemp)
  })
})

/**
 * waveLight, pressureHigh and deep were defined in SPECIES_PREFS but never
 * read: torsk's species row was always 0 and pighvar's light-surf preference
 * (half its bonus, promised in its tip) never reached the score.
 */
describe('species bonuses', () => {
  const spPts = (w: ReturnType<typeof scoreWindow>) => w.breakdown!.find((b) => b.key === 'fac_species_name')?.points ?? 0

  it('has a scoring rule for every bonus a species lists', () => {
    const dead = Object.values(SPECIES_PREFS).flatMap((sp) =>
      Object.keys(sp.bonuses).filter((k) => !SPECIES_CONDITIONS[k]).map((k) => `${sp.id}.${k}`))
    expect(dead).toEqual([])
  })

  it('pays pighvar its light-surf bonus at 0.4 m, but not in rough water', () => {
    // Falling tide, so the tide bonus (rising only) stays out of it. The
    // daylight bonus pays in both, so the light-surf one is the difference.
    const light = scoreWindow(LOC, DATE, '07:00', '10:00', makeForecast({ waveM: 0.4, tideRising: false }), ['pighvar'])
    const rough = scoreWindow(LOC, DATE, '07:00', '10:00', makeForecast({ waveM: 0.9, tideRising: false }), ['pighvar'])
    expect(spPts(light) - spPts(rough)).toBe(SPECIES_PREFS.pighvar.bonuses.waveLight)
    expect(spPts(rough)).toBe(SPECIES_PREFS.pighvar.bonuses.daylight)
  })

  // Pressure has no support in any source (K§1.4); torsk's season is its
  // temperature: mainly 2–10 °C, away from warm summer shallows.
  it('scores torsk higher in 6 °C than in 18 °C water', () => {
    const at = (sstC: number) => scoreWindow(LOC, DATE, '06:00', '10:00', makeForecast({ sstC }), ['torsk']).score
    expect(at(6)).toBeGreaterThan(at(18))
  })

  // One source claim — onshore wind with some chop — that used to be two
  // conditions firing together, because wind waves follow the wind.
  it('pays havørred once for wind and chop together', () => {
    const w = scoreWindow(LOC, DATE, '12:00', '12:30', makeForecast({ windMs: 6, waveM: 0.5, sstC: 12 }), ['havørred'])
    expect(spPts(w)).toBe(SPECIES_PREFS.havørred.bonuses.windOrChop)
  })

  it('names the conditions that paid in the species row', () => {
    const w = scoreWindow(LOC, DATE, '05:00', '05:30', makeForecast({ windMs: 6, sstC: 12 }), ['havørred'])
    const label = w.breakdown!.find((b) => b.key === 'fac_species_name')!.label
    expect(label).toContain(t('bd_cond_dawn'))
    expect(label).toContain(t('bd_cond_windOrChop'))
  })

  // Depth comes from the official spot a location was saved from; a custom
  // location has none, so 'deep' can't pay there.
  it('pays the deep-water bonus only where the depth is known to be deep', () => {
    const deepSpot: Location = { ...LOC, spotSlug: 'fornaes-fyr', depth: 'deep' }
    const at = (loc: Location) => spPts(scoreWindow(loc, DATE, '06:00', '10:00', makeForecast(), ['torsk']))
    expect(at(deepSpot)).toBe(SPECIES_PREFS.torsk.bonuses.deep)
    expect(at(LOC)).toBe(0)
  })
})

/**
 * The direction used to come from the PREVIOUS sample pair, so it lagged one
 * interval at every turn: half an hour after a 12:00 high water still read
 * "↑ Stigende" (+12). The Conditions tab ran its own copy of the scan, without
 * interpolation, so it could show a different level for the same moment.
 */
describe('tide at a turning point', () => {
  const at = (h: number, min = 0) => new Date(2026, 5, 15, h, min).getTime()
  // High water at 12:00, in cm (DMI's unit): 2.4 m either side of it.
  const HW = Array.from({ length: 30 }, (_, h) => ({ time: at(h), value: 120 - 20 * Math.abs(h - 12) }))

  it('reads the direction of the interval the moment falls in', () => {
    const before = tideAt(HW, at(11, 30))!, after = tideAt(HW, at(12, 30))!
    expect(before.rising).toBe(true)
    expect(after.rising).toBe(false)
    expect(before.value).toBeCloseTo(110)
    expect(after.value).toBeCloseTo(110)
  })

  it('covers the first interval too', () => {
    expect(tideAt(HW.slice(0, 2), at(0, 30))?.rising).toBe(true)
  })

  it('scores the hours after high water as falling', () => {
    const f = makeForecast()
    f.tides = { stationName: 'S', distKm: 5, predictions: HW }
    const tide = scoreWindow(LOC, DATE, '12:00', '13:00', f, []).breakdown!.find((b) => b.key === 'bd_tide')!
    // A 2.4 m range: the tide weight is 1, so the falling weight in full.
    expect(tide.points).toBe(SCORE_WEIGHTS.tide.falling)
  })

  it('gives the Conditions tab the same interpolated reading', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at(12, 30))
    try {
      const f = makeForecast()
      f.tides = { stationName: 'S', distKm: 5, predictions: HW }
      const tide = currentConditions(f)!.tide!
      expect(tide.rising).toBe(false)
      expect(tide.value).toBeCloseTo(110) // not the 12:00 sample's 120
    } finally {
      vi.useRealTimers()
    }
  })

  // The tab shows the sea temperature the water-temperature row scores.
  it('gives the Conditions tab the sea temperature of the nearest marine hour', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(at(12, 20))
    try {
      const f = makeForecast({ sstC: 9 })
      f.marine![12].sstC = 12.4
      expect(currentConditions(f)!.sstC).toBe(12.4)
      expect(currentConditions(makeForecast({ waveM: 0.3 }))!.sstC).toBeNull()
      expect(currentConditions(makeForecast())!.sstC).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

/**
 * The hour and the tide are found by position where the series is in time
 * order, and must find what a scan from the start finds: the first row within
 * half an hour, the first interval holding the moment, also after a gap, past
 * a duplicate, or in a series out of order.
 */
describe('finding the hour and the tide', () => {
  const at = (h: number, min = 0) => new Date(2026, 5, 15, h, min).getTime()
  const scanTide = (p: { time: number; value: number }[], ms: number) => {
    for (let i = 0; i < p.length - 1; i++) {
      if (p[i].time <= ms && p[i + 1].time > ms) {
        const frac = (ms - p[i].time) / (p[i + 1].time - p[i].time)
        return { value: p[i].value + frac * (p[i + 1].value - p[i].value), rising: p[i + 1].value > p[i].value }
      }
    }
    return null
  }

  it('reads the tide a scan reads, in order, with gaps, duplicates and out of order', () => {
    const even = Array.from({ length: 60 }, (_, i) => ({ time: at(0, i * 10), value: Math.sin(i / 7) }))
    const lists = {
      even,
      gaps: even.filter((_, i) => i % 4 !== 1),
      dupes: [...even.slice(0, 21), { time: even[20].time, value: 9 }, ...even.slice(21)],
      unordered: [...even.slice(30), ...even.slice(0, 30)],
      swapped: [...even.slice(0, 10), even[11], even[10], ...even.slice(12)],
    }
    for (const [name, p] of Object.entries(lists)) {
      for (let min = -20; min < 620; min += 5) expect(tideAt(p, at(0, min)), `${name} ${min}`).toEqual(scanTide(p, at(0, min)))
      expect(tideAt(p, NaN), name).toBeNull()
    }
  })

  it('scores an hour missing from the series like an hour with no weather', () => {
    const gap = makeForecast()
    gap.hourly.splice(7, 1)
    expect(scoreWindow(LOC, DATE, '05:00', '12:00', gap, ['havørred'])).toEqual(
      scoreWindow(LOC, DATE, '05:00', '12:00', makeForecast({ nullHours: [7] }), ['havørred']))
  })

  it('takes the first of two rows for one hour, and reads a series out of order as in order', () => {
    const f = makeForecast({ waveM: 0.5, sstC: 12, tideRangeCm: 40, pressureAt: (h) => 1000 + h })
    const want = scoreWindow(LOC, DATE, '04:00', '14:00', f, ['havørred', 'makrel'], 'waders')
    // A second 08:00 with other cloud and rain (the 3-hour look-backs read only its wind and pressure).
    const dupe = { ...f, hourly: [...f.hourly.slice(0, 9), { ...f.hourly[8], cloud: 95, precipPct: 90 }, ...f.hourly.slice(9)] }
    expect(scoreWindow(LOC, DATE, '04:00', '14:00', dupe, ['havørred', 'makrel'], 'waders')).toEqual(want)
    const reversed = { ...f, hourly: [...f.hourly].reverse(), marine: [...f.marine!].reverse() }
    expect(scoreWindow(LOC, DATE, '04:00', '14:00', reversed, ['havørred', 'makrel'], 'waders')).toEqual(want)
  })
})

describe('target-species relevance', () => {
  // The card's "🎯 1/2 active here" tag can be opened, so the window has to
  // carry which species matched and which didn't — not just the count.
  const SPOT: Location = {
    ...LOC,
    species: [
      { nameEn: 'Sea Trout', months: [6] },   // active in June (DATE)
      { nameEn: 'Mackerel', months: [8, 9] }, // listed here, but not in June
    ],
  }

  it('splits target species into active and inactive for the window month', () => {
    const w = scoreWindow(SPOT, DATE, '06:00', '10:00', makeForecast({}), ['havørred', 'makrel'])
    expect(w.relevance).toEqual({ activeIds: ['havørred'], inactiveIds: ['makrel'] })
  })

  it('labels the tag with the active count and marks it expandable', () => {
    const w = scoreWindow(SPOT, DATE, '06:00', '10:00', makeForecast({}), ['havørred', 'makrel'])
    const tag = w.tags.find((t) => t.key === 'relevance')
    expect(tag).toBeDefined()
    expect(tag!.label).toContain('1/2')
  })

  it('omits relevance entirely when no target species is active here', () => {
    const w = scoreWindow(SPOT, DATE, '06:00', '10:00', makeForecast({}), ['makrel'])
    expect(w.relevance).toBeUndefined()
    expect(w.tags.find((t) => t.key === 'relevance')).toBeUndefined()
  })

  /**
   * A visitor the water keeps away all window (the visitor gate) is not
   * "active here", whatever the spot's months say: a January mackerel at
   * Fornæs Fyr got "🎯 1/1 aktive her" and +15 beside a −12 water row.
   * Unknown water gates nothing, so the spot's months still count then.
   */
  it('counts a visitor the cold water keeps away as not active here', () => {
    const LISTED: Location = { ...LOC, species: [{ nameEn: 'Mackerel', months: [6] }, { nameEn: 'Sea Trout', months: [6] }] }
    const cold = scoreWindow(LISTED, DATE, '06:00', '10:00', makeForecast({ sstC: 5 }), ['makrel', 'havørred'])
    expect(cold.relevance).toEqual({ activeIds: ['havørred'], inactiveIds: ['makrel'] })
    expect(scoreWindow(LISTED, DATE, '06:00', '10:00', makeForecast({ sstC: 5 }), ['makrel']).relevance).toBeUndefined()
    expect(scoreWindow(LISTED, DATE, '06:00', '10:00', makeForecast({ sstC: 16 }), ['makrel']).relevance?.activeIds).toEqual(['makrel'])
    expect(scoreWindow(LISTED, DATE, '06:00', '10:00', makeForecast({}), ['makrel']).relevance?.activeIds).toEqual(['makrel'])
  })

  /**
   * A spot the user adds lists its species in their open months, all 12 for
   * fjæsing (speciesEntry). Fjæsing's curve gates it below 10 °C (99ab0ce),
   * but the tag counted it from the months alone, so a January window read
   * "🎯 1/1 aktive her" with +15 beside a species row that paid it nothing.
   * The tag, the bonus and the species row now agree: gated in every hour,
   * it is not active here (492a65f). With the sea temperature unknown
   * nothing is gated, so all three count it.
   */
  it('counts fjæsing as active in cold January water at a spot the user added only when the water is unknown', () => {
    const JAN = new Date(Date.UTC(2026, 0, 15))
    const ids = ['havørred', 'fjaesing', 'makrel']
    const ADDED: Location = { ...LOC, species: ids.map((id) => speciesEntry(id, 'salt')!) }
    expect(ADDED.species!.find((s) => s.nameEn === 'Greater Weever')!.months).toHaveLength(12)
    const spot = (w: ScoredWindow) => rowPts(w, 'fac_spot_name')
    const chip = (w: ScoredWindow) => w.tags.find((tg) => tg.key === 'relevance')?.label

    for (const sstC of [3, 9.9]) {
      const cold = makeForecast({ date: JAN, sstC, waveM: 0.3 })
      const alone = scoreWindow(ADDED, JAN, '16:00', '22:00', cold, ['fjaesing'])
      expect(alone.relevance).toBeUndefined()
      expect(chip(alone)).toBeUndefined()
      expect(spot(alone)).toBe(0)
      expect(rowPts(alone, 'fac_species_name')).toBe(0)
      const three = scoreWindow(ADDED, JAN, '16:00', '22:00', cold, ids)
      expect(three.relevance).toEqual({ activeIds: ['havørred'], inactiveIds: ['fjaesing', 'makrel'] })
      expect(chip(three)).toContain('1/3')
      expect(spot(three)).toBe(Math.round(SCORE_WEIGHTS.relevanceMax / 3))
    }

    // Unknown water gates nothing: no marine data, or a marine series without a temperature.
    for (const unknown of [makeForecast({ date: JAN }), makeForecast({ date: JAN, sstC: null, waveM: 0.3 })]) {
      const alone = scoreWindow(ADDED, JAN, '16:00', '22:00', unknown, ['fjaesing'])
      expect(alone.relevance?.activeIds).toEqual(['fjaesing'])
      expect(spot(alone)).toBe(SCORE_WEIGHTS.relevanceMax)
      expect(rowPts(alone, 'fac_species_name')).toBeGreaterThan(0) // the night bonus
    }
  })
})

/**
 * The modal's "Why these points?" list quotes point values next to the rows
 * built from SCORE_WEIGHTS, and they had drifted: rain said −20 beside a −12
 * row (the −20 is the separate thunder row), and 0.1–0.5 m waves were called
 * ideal although only < 0.3 m earns anything.
 */
describe('score explanations', () => {
  const pts = (n: number) => (n > 0 ? `+${n}` : `−${-n}`)
  const W = SCORE_WEIGHTS
  const QUOTES: [string, number[]][] = [
    ['bd_pressure_why', [W.pressure.strongRise, W.pressure.strongFall]],
    ['bd_cloud_why', [W.cloud]],
    ['bd_wind_why', [W.wind.calm, W.wind.brisk, W.wind.gale]],
    ['bd_precip_why', [W.precip.light, W.precip.heavy]],
    ['bd_timeofday_why', [W.timeOfDay.dawnPeak, W.timeOfDay.duskPeak, W.timeOfDay.night, W.timeOfDay.midday]],
    ['bd_windtrend_why', [W.windTrend.strongFall, W.windTrend.strongRise]],
    ['fac_species_name_why', [W.speciesMax]],
    ['fac_spot_name_why', [W.relevanceMax]],
    ['bd_wave_why', [W.wave.glassy, W.wave.moderate, W.wave.high, W.wave.danger]],
    ['bd_tide_why', [W.tide.falling, W.tide.rising]],
    ['bd_solunar_why', [W.solunar.major, W.solunar.minor]],
    ['bd_watertemp_why', [W.waterTemp, -W.waterTemp]],
    // The sea-trout table: best onshore, best side, worst offshore, strong onshore.
    ...(() => {
      const sw = SPECIES_PREFS.havørred.shoreWind!
      const ys = (c: [number, number][]) => c.map(([, y]) => y)
      return [['bd_shorewind_why', [Math.max(...ys(sw.on)), Math.max(...ys(sw.side)), Math.min(...ys(sw.off)), Math.min(...ys(sw.on))]]] as [string, number[]][]
    })(),
  ]
  it.each(['da', 'en'])('quote the current SCORE_WEIGHTS (%s)', (lang) => {
    const missing = QUOTES.flatMap(([key, ns]) =>
      ns.filter((n) => !STRINGS[lang][key].includes(pts(n))).map((n) => `${key} ${pts(n)}`))
    expect(missing).toEqual([])
  })

  it.each(['da', 'en'])('state the current base (%s)', (lang) => {
    expect(STRINGS[lang].bd_base_why).toContain(String(W.base))
  })

  it.each(['da', 'en'])('state where the soft ceiling starts (%s)', (lang) => {
    expect(STRINGS[lang].bd_ceiling_why).toContain(String(W.ceilingFrom))
  })
})

describe('isValidWindow / isOvernight', () => {
  it('accepts a window that ends after it starts', () => {
    expect(isValidWindow('06:00', '22:00')).toBe(true)
    expect(isOvernight('06:00', '22:00')).toBe(false)
  })

  // Changed deliberately: an end hour before the start is a NIGHT window, not a
  // mistake. Night fishing is a core use case, so it has to be expressible.
  it('accepts a window that crosses midnight, and flags it as overnight', () => {
    expect(isValidWindow('22:00', '02:00')).toBe(true)
    expect(isOvernight('22:00', '02:00')).toBe(true)
  })

  it('still rejects a zero-length window', () => {
    expect(isValidWindow('10:00', '10:00')).toBe(false)
    expect(isValidWindow('17:45', '17:45')).toBe(false)
  })

  // Only the hours used to be compared, so a short after-work slot was
  // "zero-length" and the editor said start and end must differ — they do.
  it('accepts a window inside one hour when the minutes differ', () => {
    expect(isValidWindow('17:00', '17:45')).toBe(true)
    expect(isOvernight('17:00', '17:45')).toBe(false)
  })

  it('treats an end minute before the start in the same hour as overnight', () => {
    expect(isValidWindow('05:30', '05:15')).toBe(true)
    expect(isOvernight('05:30', '05:15')).toBe(true)
  })

  it('rejects unparseable times', () => {
    expect(isValidWindow('', '10:00')).toBe(false)
    expect(isValidWindow('abc', 'xyz')).toBe(false)
  })
})

describe('windowHours', () => {
  const hh = (n: number) => String(n).padStart(2, '0')
  const shape = (from: string, to: string, date = DATE) =>
    windowHours(date, from, to).map((h) => `${hh(h.hour)}:${hh(h.minute)}${h.dayOffset ? '+1' : ''}`).join(',')

  // The hours of [from, to): the end is when the user leaves, so 10:00 is
  // not an hour of 06:00–10:00.
  it('covers the whole hours from the start up to the end', () => {
    expect(shape('06:00', '10:00')).toBe('06:00,07:00,08:00,09:00')
  })

  // A 12-hour cap cut 06:00–22:00 at 18 and 18:00→08:00 at 06: the dusk of
  // a long day and the dawn a night session ends in were never scored.
  it('covers every hour of a long window', () => {
    expect(windowHours(DATE, '06:00', '22:00').map((h) => h.hour)).toEqual(Array.from({ length: 16 }, (_, i) => 6 + i))
    expect(shape('18:00', '08:00')).toBe('18:00,19:00,20:00,21:00,22:00,23:00,00:00+1,01:00+1,02:00+1,03:00+1,04:00+1,05:00+1,06:00+1,07:00+1')
  })

  it('wraps past midnight onto the next day', () => {
    expect(shape('22:00', '02:00')).toBe('22:00,23:00,00:00+1,01:00+1')
  })

  it('handles a one-hour wrap', () => {
    expect(shape('23:00', '00:00')).toBe('23:00')
  })

  // parseInt dropped the minutes: 05:30–07:00 was scored from 05:00 and could
  // name "Bedste time 05:00", half an hour before the user can be there.
  it('starts at the first whole hour inside the window', () => {
    expect(shape('05:30', '07:00')).toBe('06:00')
    expect(shape('06:45', '07:15')).toBe('07:00')
    expect(shape('05:30', '08:20')).toBe('06:00,07:00,08:00')
    expect(shape('23:30', '00:15')).toBe('00:00+1')
  })

  it('covers the hour a window sits in when no whole hour is inside it, named by its start', () => {
    expect(shape('17:00', '17:45')).toBe('17:00')
    expect(shape('17:15', '17:45')).toBe('17:15')
    expect(shape('17:15', '18:00')).toBe('17:15')
    expect(windowHours(DATE, '17:15', '17:45')[0].at).toBe(new Date(2026, 5, 15, 17).getTime())
  })

  it('treats a wrap to just before the start as a full day', () => {
    expect(windowHours(DATE, '05:30', '05:15').map((h) => h.hour)).toEqual([...Array.from({ length: 18 }, (_, i) => 6 + i), 0, 1, 2, 3, 4, 5])
  })

  it('has no hours for a zero-length or unparseable window', () => {
    expect(windowHours(DATE, '10:00', '10:00')).toEqual([])
    expect(windowHours(DATE, 'abc', '10:00')).toEqual([])
  })
})

describe('the best hour lies inside the window', () => {
  // Calm in one hour, a gale in every other: that hour is the best one.
  const calmAt = (h: number) => {
    const f = makeForecast({ windMs: 16 })
    f.hourly[h].windMs = 2
    return f
  }

  it('never names an hour before the start', () => {
    const w = scoreWindow(LOC, DATE, '05:30', '07:00', calmAt(5), [])
    expect(w.bestHourStr).toBe('06:00')
  })

  it('never names the closing hour', () => {
    const w = scoreWindow(LOC, DATE, '18:00', '20:00', calmAt(20), [])
    expect(['18:00', '19:00']).toContain(w.bestHourStr)
  })

  it('names a short window by its start', () => {
    expect(scoreWindow(LOC, DATE, '17:15', '17:45', makeForecast(), []).bestHourStr).toBe('17:15')
  })
})

/**
 * Daylight-saving nights in Copenhagen. Building each hour from its wall-clock
 * label scored 03:00 twice on 28 Mar 2027 (02:00 doesn't exist and rolls on to
 * 03:00) and could name "Bedste time 02:00"; on 25 Oct 2026 it never scored
 * the second 02:00 (CET). The hours are real hours, one after another.
 */
describe('daylight-saving nights', () => {
  const SPRING = new Date(Date.UTC(2027, 2, 27)) // Sat → Sun 28 Mar, 02:00 → 03:00
  const FALL = new Date(Date.UTC(2026, 9, 24)) // Sat → Sun 25 Oct, 03:00 → 02:00
  const iso = (ms: number) => new Date(ms).toISOString().slice(11, 13) + 'Z'
  // Real hourly rows, as the forecast APIs give them: one per UTC hour.
  const utcForecast = (from: number, calmAtMs: number): Forecast => ({
    fetched: 0, marine: null, tides: null,
    hourly: Array.from({ length: 48 }, (_, i) => {
      const time = from + i * 3600000
      return { time, temp: 12, windMs: time === calmAtMs ? 2 : 16, windDir: 270, gustMs: 18, cloud: 40, precipPct: 0, pressure: 1013 }
    }),
  })

  it('skips the hour that does not exist in spring', () => {
    const hs = windowHours(SPRING, '22:00', '04:00')
    expect(hs.map((h) => h.hour)).toEqual([22, 23, 0, 1, 3])
    expect(hs.map((h) => iso(h.at))).toEqual(['21Z', '22Z', '23Z', '00Z', '01Z'])
  })

  it('scores both 02:00 hours in autumn', () => {
    const hs = windowHours(FALL, '22:00', '04:00')
    expect(hs.map((h) => h.hour)).toEqual([22, 23, 0, 1, 2, 2, 3])
    expect(hs.map((h) => iso(h.at))).toEqual(['20Z', '21Z', '22Z', '23Z', '00Z', '01Z', '02Z'])
    expect(hs.map((h) => h.dayOffset)).toEqual([0, 0, 1, 1, 1, 1, 1])
  })

  it('names the best hour by its real wall-clock time', () => {
    const at = Date.UTC(2027, 2, 28, 1) // 03:00 CEST
    const w = scoreWindow(LOC, SPRING, '22:00', '04:00', utcForecast(Date.UTC(2027, 2, 27, 0), at), [])
    expect(w.bestHourStr).toBe('03:00')
  })

  // 02:30 on 28 Mar doesn't exist, and JS reads it an hour on, as 03:30: a
  // window ending then took in 03:00 and could name it, after its own end.
  it('ends a window at the jump when its end is in the skipped hour', () => {
    const SUN = new Date(Date.UTC(2027, 2, 28))
    expect(windowHours(SPRING, '22:00', '02:30').map((h) => h.hour)).toEqual([22, 23, 0, 1])
    expect(windowHours(SUN, '00:00', '02:15').map((h) => h.hour)).toEqual([0, 1])
    expect(windowHours(SPRING, '03:15', '02:15').map((h) => h.hour).slice(-3)).toEqual([23, 0, 1])
    // A window wholly inside the skipped hour is the hour it would sit in.
    expect(windowHours(SUN, '02:15', '02:45').map((h) => [h.hour, h.minute, iso(h.at)])).toEqual([[2, 15, '01Z']])
    const w = scoreWindow(LOC, SPRING, '22:00', '02:30', utcForecast(Date.UTC(2027, 2, 27, 0), Date.UTC(2027, 2, 28, 1)), [])
    expect(w.bestHourStr).not.toBe('03:00')
  })

  it('counts the second 02:00 in autumn', () => {
    const at = Date.UTC(2026, 9, 25, 1) // 02:00 CET
    const calm = scoreWindow(LOC, FALL, '22:00', '04:00', utcForecast(Date.UTC(2026, 9, 24, 0), at), [])
    const gale = scoreWindow(LOC, FALL, '22:00', '04:00', utcForecast(Date.UTC(2026, 9, 24, 0), 0), [])
    expect(calm.bestHourStr).toBe('02:00')
    expect(calm.score).toBeGreaterThan(gale.score)
  })
})

/**
 * A night session through to dawn (18:00 → 09:00 in October, sunrise about
 * 07:50) is set up for the dawn it ends in. Under the 12-hour cap the window
 * stopped at 06:00, so its best hour was a dusk or night hour.
 */
describe('a long window', () => {
  const OCT = new Date(Date.UTC(2026, 9, 15))

  it('finds the dawn at the end of an overnight window', () => {
    const w = scoreWindow(LOC, OCT, '18:00', '09:00', makeForecast({ date: OCT, span: 40 }), [])
    expect(w.bestHourStr).toMatch(/^0[78]:00$/)
    expect(w.breakdown!.find((b) => b.key === 'bd_timeofday')!.label).toContain(t('tod_dawn'))
  })

  it('scores the evening hours of a long day window', () => {
    // A gale all day, calm from 19:00: only the hours after 18 can be best.
    const f = makeForecast({ windMs: 16 })
    for (let h = 19; h < 30; h++) f.hourly[h].windMs = 2
    const w = scoreWindow(LOC, DATE, '06:00', '21:00', f, [])
    expect(Number(w.bestHourStr!.slice(0, 2))).toBeGreaterThanOrEqual(19)
  })
})

/**
 * Tags were set hour by hour, so the LAST hour that crossed a threshold won:
 * a waders window opening in a 1.8 m swell that dies to 0.2 m showed a green
 * "🌊 Blik 0.2m" and no red tag. For safety signals the worst hour decides.
 */
describe('window tags reflect the worst hour', () => {
  const tagFor = (w: ReturnType<typeof scoreWindow>, cls: string, text: string) =>
    w.tags.find((tg) => tg.cls === cls && tg.label.includes(text))

  it('shows a red wave tag at the peak height when the swell is dying down', () => {
    const f = makeForecast({ waveM: 0.2 })
    for (let h = 6; h <= 16; h++) f.marine![h].waveM = +(1.8 - (h - 6) * 0.16).toFixed(2)
    const w = scoreWindow(LOC, DATE, '06:00', '17:00', f, [], 'waders')
    expect(tagFor(w, 'tag-red', '1.80m')).toBeDefined()
    expect(w.tags.find((tg) => tg.cls === 'tag-green' && tg.label.includes(t('wave_calm_lbl')))).toBeUndefined()
    // The modal row spans the window rather than quoting the best hour alone.
    expect(w.breakdown!.find((b) => b.key === 'bd_wave')!.label).toBe('0.20–1.80m')
  })

  it('only calls the water glassy when every hour is', () => {
    const f = makeForecast({ waveM: 0.2 })
    f.marine![6].waveM = 0.4
    const w = scoreWindow(LOC, DATE, '06:00', '08:00', f, [])
    expect(w.tags.find((tg) => tg.label.includes(t('wave_calm_lbl')))).toBeUndefined()
    const calm = scoreWindow(LOC, DATE, '06:00', '08:00', makeForecast({ waveM: 0.2 }), [])
    expect(tagFor(calm, 'tag-green', '0.20m')).toBeDefined()
  })

  it('shows a strong-wind tag, not a light-wind one, when any hour blows a gale', () => {
    const f = makeForecast({ windMs: 2 })
    f.hourly[6].windMs = 14
    const w = scoreWindow(LOC, DATE, '06:00', '10:00', f, [])
    expect(tagFor(w, 'tag-red', t('tag_wind_strong'))).toBeDefined()
    expect(w.tags.find((tg) => tg.label === t('tag_wind_light'))).toBeUndefined()
  })

  it('warns of falling pressure even if it recovers by the last hour', () => {
    // Strong fall at 06–09, rising again at 10.
    const p = [1030, 1027, 1024, 1021, 1018, 1015, 1012, 1009, 1006, 1009, 1012]
    const w = scoreWindow(LOC, DATE, '06:00', '10:00', makeForecast({ pressureAt: (h) => p[h] ?? 1012 }), [])
    // 9 hPa in 3 hours: the tag says how fast, like the row (it read "weakly falling").
    expect(tagFor(w, 'tag-orange', t('press_falling_fast'))).toBeDefined()
    expect(w.tags.find((tg) => tg.label.includes(t('press_rising')) || tg.label.includes(t('press_rising_fast')))).toBeUndefined()
  })

  // The tag tested `score <= -12`, which with the smaller pressure weights is
  // only a strong fall (> 3 hPa in 3 h): the orange tag all but vanished.
  it('warns of an ordinary fall of 2 hPa in 3 hours', () => {
    const w = scoreWindow(LOC, DATE, '06:00', '10:00', makeForecast({ pressureAt: (h) => 1020 - (2 / 3) * h }), [])
    expect(tagFor(w, 'tag-orange', t('press_falling'))).toBeDefined()
  })

  it('keeps the tags in their usual order', () => {
    // A slow rise (1.5 hPa in 3 h), so the tag reads press_rising.
    const w = scoreWindow(LOC, DATE, '06:00', '10:00', makeForecast({ waveM: 0.2, pressureAt: (h) => 1000 + 0.5 * h, tideRising: true }), [])
    const order = w.tags.map((tg) => tg.label)
    expect(order.indexOf('↑ ' + t('press_rising'))).toBe(0)
    expect(order.indexOf(t('tag_wind_light'))).toBeLessThan(order.findIndex((l) => l.includes(t('wave_calm_lbl'))))
    expect(order.findIndex((l) => l.includes(t('wave_calm_lbl')))).toBeLessThan(order.indexOf(t('tide_rising')))
  })
})

/**
 * The card and the score breakdown describe the same hours. The descriptive
 * tags were set hour by hour, so the last hour won: a 06–13 card read
 * "Faldende tidevand", "Midt på dagen" and the last hour's sea temperature
 * beside "Bedste time 08:00", whose rows said rising, dawn and 10.0 °C.
 */
describe("the card's tags agree with the breakdown", () => {
  const NOV = new Date(Date.UTC(2026, 10, 7)) // sunrise about 07:40
  // A gale except at 08:00; the tide rises to 10:00, then falls; the sea
  // warms through the morning; cloud and rain only in the last hour.
  // Pressure falls into 06:00 and rises fast after.
  const morning = () => {
    const f = makeForecast({ date: NOV, windMs: 16, pressureAt: (h) => (h <= 5 ? 1020 - 2 * h : 1010 + 3 * (h - 5)), tideRising: true, sstC: 10 })
    f.hourly[8].windMs = 2
    f.hourly[12].cloud = 90
    f.hourly[12].precipPct = 80
    f.tides!.predictions = f.tides!.predictions.map((p, h) => ({ ...p, value: h <= 10 ? h * 0.1 : 1 - (h - 10) * 0.1 }))
    f.marine!.forEach((m, h) => { m.sstC = 9 + 0.5 * (h - 6) })
    return scoreWindow(LOC, NOV, '06:00', '13:00', f, ['havørred'])
  }
  const row = (w: ScoredWindow, key: string) => w.breakdown!.find((b) => b.key === key)!.label
  const labels = (w: ScoredWindow) => w.tags.map((tg) => tg.label)

  it('takes the tide, time of day, sea temperature, cloud and rain tags from the best hour', () => {
    const w = morning()
    expect(w.bestHourStr).toBe('08:00')
    expect(row(w, 'bd_tide')).toContain(t('tide_rising_word'))
    expect(labels(w)).toContain(t('tide_rising'))
    expect(labels(w)).not.toContain(t('tide_falling'))
    expect(row(w, 'bd_timeofday')).toContain(t('tod_dawn'))
    expect(labels(w)).toContain(row(w, 'bd_timeofday'))
    expect(labels(w).some((l) => l.includes(t('tod_midday')))).toBe(false)
    expect(labels(w)).toContain(`💧 ${row(w, 'bd_watertemp')}`)
    expect(labels(w)).not.toContain(t('tag_overcast'))
    expect(labels(w)).not.toContain(t('bd_tag_rain'))
  })

  // These tags warn about the window's worst hour, so their rows span the
  // window as the wave row does, rather than quote only the best hour.
  it('spans the pressure and wind rows over the hours their tags warn about', () => {
    const w = morning()
    expect(labels(w)).toContain('↓ ' + t('press_falling'))
    expect(row(w, 'bd_pressure')).toContain(t('press_falling'))
    expect(row(w, 'bd_pressure')).toContain(t('press_rising_fast'))
    expect(labels(w)).toContain(t('tag_wind_strong'))
    expect(row(w, 'bd_wind')).toBe('2.0–16.0 m/s')
  })
})

/**
 * A wave label never reads across the threshold it names. Rounded to one
 * decimal, 1.46 m read "Høj sø 1.5m" beside a 1.50 m "Farlig sø 1.5m", and
 * 0.29 m a green "Blik 0.3m" although Blik is under 0.3 m.
 */
describe('wave labels stay on their side of the threshold', () => {
  const wave = (m: number) => scoreWindow(LOC, DATE, '06:00', '07:00', makeForecast({ waveM: m }), [])
  const waveTag = (w: ScoredWindow) => w.tags.find((tg) => tg.label.startsWith('🌊') && !tg.label.includes(t('tide_rising')))?.label
  const waveRow = (w: ScoredWindow) => w.breakdown!.find((b) => b.key === 'bd_wave')?.label

  it('tells a high sea from a dangerous one', () => {
    expect(waveTag(wave(1.46))).toBe(`🌊 ${t('wave_high')} 1.46m`)
    expect(waveTag(wave(1.5))).toBe(`🌊 ${t('wave_danger')} 1.50m`)
  })

  it('never calls the water glassy at 0.3 m', () => {
    expect(waveTag(wave(0.29))).toBe(`🌊 ${t('wave_calm_lbl')} 0.29m`)
  })

  it('cuts a finer reading rather than rounding it over the line', () => {
    expect(waveTag(wave(1.499))).toBe(`🌊 ${t('wave_high')} 1.49m`)
    expect(waveRow(wave(1.499))).toBe('1.49m')
    expect(waveTag(wave(0.999))).toBeUndefined()
    expect(waveRow(wave(0.999))).toBe('0.99m')
  })
})

describe('a window inside one hour', () => {
  it('is scored on its start hour', () => {
    const w = scoreWindow(LOC, DATE, '17:00', '17:45', makeForecast(), [])
    expect(w.noData).toBe(false)
    expect(w.score).toBeGreaterThan(0)
    expect(w.bestHourStr).toBe('17:00')
  })
})

describe('getScoredWindows', () => {
  const AVAIL_DOW = DATE.getDay()

  it('drops a zero-length window instead of scoring it 0', () => {
    // A zero-length slot used to yield one score-0 card per location, which reads
    // as "bad conditions" rather than "your setup is wrong".
    const windows = getScoredWindows(
      [LOC],
      [{ id: 'a', days: [AVAIL_DOW], from: '10:00', to: '10:00', methods: ['shore'] }],
      { t1: makeForecast({}) },
      [],
    )
    expect(windows).toHaveLength(0)
  })

  // normalize.ts repairs rows on load and pull, but one that slips past it (a
  // future writer, another app version on the same account) must not take the
  // whole dashboard down: `avail.days.includes` threw on a row without days.
  it('skips a malformed row instead of throwing, and still scores the good ones', () => {
    const bad = [
      { id: 'u', days: undefined, from: '06:00', to: '10:00', methods: ['shore'] },
      { id: 'n', days: null, from: '06:00', to: '10:00', methods: ['shore'] },
      { id: 's', days: '0123456', from: '07:00', to: '11:00', methods: ['shore'] },
      { id: 'o', days: { 0: 1, length: 1 }, from: '08:00', to: '12:00', methods: ['shore'] },
      { id: 't', days: [0, 1, 2, 3, 4, 5, 6], from: undefined, to: 7, methods: ['shore'] },
    ] as unknown as Availability[]
    const good: Availability = { id: 'g', days: [0, 1, 2, 3, 4, 5, 6], from: '05:00', to: '09:00', methods: ['shore'] }
    let windows: ScoredWindow[] = []
    expect(() => { windows = getScoredWindows([LOC], [...bad, good], { t1: makeForecast({}) }, []) }).not.toThrow()
    expect(windows.length).toBeGreaterThan(0)
    expect(windows.every((w) => w.from === '05:00' && w.to === '09:00')).toBe(true)
  })

  it('treats a methods field that is not a list as shore', () => {
    const row = { id: 'm', days: [0, 1, 2, 3, 4, 5, 6], from: '05:00', to: '09:00', methods: 'boat' } as unknown as Availability
    expect(() => getScoredWindows([LOC], [row], { t1: makeForecast({ waveM: 1.2 }) }, [])).not.toThrow()
    expect(availMethods(row)).toEqual(['shore'])
    expect(availDays(row)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(availDays({ ...row, days: 'x' } as unknown as Availability)).toEqual([])
  })

  /**
   * NB: getScoredWindows builds its days from `new Date()`, so this fixture's
   * forecast (anchored to DATE) never matches and the windows come back noData.
   * That's fine here — the subject is whether the slot is KEPT or DROPPED.
   * Overnight scoring itself is covered above, where the date is explicit.
   */
  it('keeps an overnight window rather than discarding it', () => {
    const windows = getScoredWindows(
      [LOC],
      [{ id: 'a', days: [0, 1, 2, 3, 4, 5, 6], from: '22:00', to: '02:00', methods: ['shore'] }],
      { t1: makeForecast({}) },
      [],
    )
    expect(windows.length).toBeGreaterThan(0)
    expect(windows.every((w) => w.from === '22:00' && w.to === '02:00')).toBe(true)
  })

  /**
   * Everything below runs with the clock on the fixture day. Under the real
   * clock the fixture never matches "today", so every window came back noData
   * at the base 20, and the lightning cap and method choice went untested:
   * disabling the cap or keeping the WORST method both left the suite green.
   */
  describe('with the clock on the fixture day', () => {
    // 06:00 local on Mon 15 June — DATE is day 0.
    beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.UTC(2026, 5, 15, 4)) })
    afterEach(() => { vi.useRealTimers() })

    const DAILY = [0, 1, 2, 3, 4, 5, 6]
    const DANGER = { t1: { level: 'danger' as const, closestKm: 4 } }
    const SPOT: Location = { ...LOC, species: [{ nameEn: 'Sea Trout', months: [6] }] }
    // Scores ~140 before the 0–100 clamp, so the cap has something to take off.
    const great = (span = 30) => makeForecast({
      pressureAt: (h) => 1000 + 2 * h, cloud: 90, windMs: 2, windDir: 270, waveM: 0.1, tideRising: true, span,
    })
    const onDay = (ws: ReturnType<typeof getScoredWindows>, dayOffset: number) =>
      ws.find((w) => w.date.getTime() === Date.UTC(2026, 5, 15 + dayOffset))!

    it('scores a valid slot with real data', () => {
      const windows = getScoredWindows(
        [LOC],
        [{ id: 'a', days: [AVAIL_DOW], from: '06:00', to: '10:00', methods: ['shore'] }],
        { t1: makeForecast({}) },
        [],
      )
      expect(windows).toHaveLength(1)
      expect(windows[0].noData).toBe(false)
      expect(windows[0].score).toBeGreaterThan(0)
    })

    it('keeps a short slot inside one hour', () => {
      const windows = getScoredWindows(
        [LOC], [{ id: 'a', days: [AVAIL_DOW], from: '17:00', to: '17:45', methods: ['shore'] }],
        { t1: makeForecast({}) }, [],
      )
      expect(windows.map((w) => [w.noData, w.bestHourStr])).toEqual([[false, '17:00']])
    })

    it('caps a window today to 15 under lightning danger, keeping the rows summing to it', () => {
      const windows = getScoredWindows(
        [SPOT], [{ id: 'a', days: DAILY, from: '04:00', to: '05:00', methods: ['waders'] }],
        { t1: great() }, ['havørred'], DANGER,
      )
      const w = onDay(windows, 0)
      expect(w.score).toBe(SCORE_WEIGHTS.lightningCap)
      expect(sum(w.breakdown!.map((b) => b.points))).toBe(SCORE_WEIGHTS.lightningCap)
      expect(w.tags[0].cls).toBe('tag-red')
      expect(w.lightning).toEqual(DANGER.t1)
    })

    it('leaves later days alone — the strike is now, not tomorrow', () => {
      const windows = getScoredWindows(
        [SPOT], [{ id: 'a', days: DAILY, from: '04:00', to: '05:00', methods: ['waders'] }],
        { t1: great(54) }, ['havørred'], DANGER,
      )
      const w = onDay(windows, 1)
      expect(w.noData).toBe(false)
      expect(w.score).toBeGreaterThan(SCORE_WEIGHTS.lightningCap)
      expect(w.lightning).toBeUndefined()
      expect(w.tags.some((tg) => tg.label.startsWith('⚡'))).toBe(false)
    })

    /**
     * Days are LOCAL calendar days. They used to be the UTC date of now, which
     * lags Copenhagen until 01:00/02:00: at 00:30 on Tuesday, "today" was
     * Monday, Monday's long-finished dawn window took the lightning cap, and
     * the 7th day was dropped.
     */
    describe('just after local midnight', () => {
      // 00:30 on Tue 16 June in Copenhagen (CEST) — still Monday in UTC.
      beforeEach(() => { vi.setSystemTime(Date.UTC(2026, 5, 15, 22, 30)) })
      const week = () => makeForecast({ span: 24 * 9 })
      const dates = (ws: ReturnType<typeof getScoredWindows>) =>
        ws.map((w) => w.date.getTime()).sort((a, b) => a - b)

      it('starts the week on the local day', () => {
        const ws = getScoredWindows([LOC], [{ id: 'a', days: DAILY, from: '06:00', to: '10:00', methods: ['shore'] }], { t1: week() }, [])
        expect(dates(ws)).toEqual(Array.from({ length: 7 }, (_, i) => Date.UTC(2026, 5, 16 + i)))
      })

      it("caps today's window under lightning, not yesterday's", () => {
        const ws = getScoredWindows([LOC], [{ id: 'a', days: DAILY, from: '06:00', to: '10:00', methods: ['shore'] }], { t1: week() }, [], DANGER)
        expect(ws.filter((w) => w.lightning).map((w) => w.date.getTime())).toEqual([Date.UTC(2026, 5, 16)])
      })

      // Monday's 22:00–02:00 is the window being fished right now, so taking
      // the local day must not drop it, and it is the one a strike matters to.
      it("keeps yesterday's overnight window while it is still running", () => {
        const ws = getScoredWindows([LOC], [{ id: 'a', days: DAILY, from: '22:00', to: '02:00', methods: ['shore'] }], { t1: week() }, [], DANGER)
        expect(dates(ws)).toEqual(Array.from({ length: 8 }, (_, i) => Date.UTC(2026, 5, 15 + i)))
        expect(ws.find((w) => w.date.getTime() === Date.UTC(2026, 5, 15))!.lightning).toEqual(DANGER.t1)
      })

      it("drops yesterday's overnight window once it has ended", () => {
        vi.setSystemTime(Date.UTC(2026, 5, 16, 0, 30)) // 02:30 local
        const ws = getScoredWindows([LOC], [{ id: 'a', days: DAILY, from: '22:00', to: '02:00', methods: ['shore'] }], { t1: week() }, [])
        expect(dates(ws)[0]).toBe(Date.UTC(2026, 5, 16))
      })
    })

    // An every-day waders slot and a Monday-only boat slot at the same hours:
    // the dedupe key skipped the second entry, so boat was never scored.
    it('merges the methods of entries with the same hours on the same day', () => {
      const ws = getScoredWindows(
        [LOC],
        [
          { id: 'a', days: DAILY, from: '06:00', to: '10:00', methods: ['waders'] },
          { id: 'b', days: [AVAIL_DOW], from: '06:00', to: '10:00', methods: ['boat'] },
        ],
        { t1: makeForecast({ waveM: 1.2 }) }, [],
      )
      const today = ws.filter((w) => w.date.getTime() === DATE.getTime())
      expect(today).toHaveLength(1)
      expect(today[0].breakdown!.find((b) => b.key === 'bd_method')?.points).toBe(SCORE_WEIGHTS.method.boatMod)
    })

    // Both orders put the better method second, so neither "always the first
    // method" nor "the worst method" can pass.
    it.each([
      ['waders, boat', ['waders', 'boat'] as const, 1.2, SCORE_WEIGHTS.method.boatMod],
      ['boat, waders', ['boat', 'waders'] as const, 0.1, SCORE_WEIGHTS.method.wadersGlassy],
    ])('keeps the best of the allowed methods (%s)', (_l, methods, waveM, want) => {
      const [w] = getScoredWindows(
        [LOC], [{ id: 'a', days: [AVAIL_DOW], from: '06:00', to: '10:00', methods: [...methods] }],
        { t1: makeForecast({ waveM }) }, [],
      )
      expect(w.breakdown!.find((b) => b.key === 'bd_method')?.points).toBe(want)
    })

    // The whole window, not just its method row: score, best hour, tags, lure and rows.
    it('keeps the whole window of the best method, the first of them on a tie', () => {
      const f = makeForecast({ waveM: 0.5, sstC: 12, tideRangeCm: 40 })
      f.marine!.forEach((m, h) => { m.waveM = h < 8 ? 1.2 : 0.1 })
      for (const methods of [['shore', 'waders', 'boat'], ['boat', 'shore'], ['waders', 'boat']] as FishingMethod[][]) {
        const [w] = getScoredWindows([LOC], [{ id: 'a', days: [AVAIL_DOW], from: '05:00', to: '12:00', methods }], { t1: f }, ['havørred'])
        expect(w, methods.join()).toEqual(bestOf(LOC, '05:00', '12:00', f, ['havørred'], methods))
      }
    })
  })
})

/** What getScoredWindows has always kept: scoreWindow per method, the first of the highest scores. */
function bestOf(loc: Location, from: string, to: string, f: Forecast, targets: string[], methods: FishingMethod[]): ScoredWindow {
  let w = scoreWindow(loc, DATE, from, to, f, targets, methods[0])
  for (const m of methods.slice(1)) {
    const alt = scoreWindow(loc, DATE, from, to, f, targets, m)
    if (alt.score > w.score) w = alt
  }
  return w
}

/**
 * The method moves only its own row, so the hours are scored once and each
 * method adds its row. The window kept must be the one scoring each method
 * whole would keep: the best hour, the tags and lure that follow it, and the
 * method row in the place it takes among the rows.
 */
describe('scoring every method in one pass', () => {
  const ORDERS: FishingMethod[][] = [['shore', 'waders', 'boat'], ['boat', 'shore'], ['waders', 'boat', 'shore'], ['boat', 'waders'], ['waders']]
  const SPOT: Location = { ...LOC, species: [{ nameEn: 'Sea Trout', months: [6] }, { nameEn: 'Mackerel', months: [6] }] }

  it('keeps the window of the best method, the first on a tie, in every wave band', () => {
    for (const waveM of [0.1, 0.25, 0.5, 0.7, 0.9, 1.2, 1.8]) for (const methods of ORDERS) for (const targets of [[], ['havørred', 'makrel']]) {
      const f = makeForecast({ waveM, sstC: 12, pressureAt: (h) => 1000 + h, tideRangeCm: 40 })
      expect(scoreWindowBest(SPOT, DATE, '04:00', '14:00', f, targets, methods), `${waveM} ${methods}`)
        .toEqual(bestOf(SPOT, '04:00', '14:00', f, targets, methods))
    }
  })

  it('keeps its best hour, tags, lure and row order when the sea changes across the window', () => {
    const swells: [string, (h: number) => number][] = [
      ['dying', (h) => Math.max(0.05, 1.9 - 0.15 * h)],
      ['rising', (h) => 0.05 + 0.12 * h],
      ['one rough hour', (h) => (h === 9 ? 1.6 : 0.3)],
    ]
    for (const [name, wave] of swells) {
      const f = makeForecast({ waveM: 1, sstC: 12, tideRangeCm: 40, cloud: 80, pressureAt: (h) => 1010 - (h % 5) })
      f.marine!.forEach((m, h) => { m.waveM = wave(h) })
      for (const methods of ORDERS) for (const [from, to] of [['00:00', '12:00'], ['05:00', '09:00'], ['08:00', '18:00'], ['22:00', '02:00']]) {
        expect(scoreWindowBest(SPOT, DATE, from, to, f, ['havørred', 'makrel'], methods), `${name} ${methods} ${from}`)
          .toEqual(bestOf(SPOT, from, to, f, ['havørred', 'makrel'], methods))
      }
    }
  })

  it('scores no method row without waves, so the first method stands', () => {
    const f = makeForecast({ sstC: 12 })
    expect(scoreWindowBest(LOC, DATE, '05:00', '09:00', f, [], ['boat', 'waders'])).toEqual(scoreWindow(LOC, DATE, '05:00', '09:00', f, [], 'boat'))
    expect(scoreWindowBest(LOC, DATE, '05:00', '09:00', undefined, [], ['boat', 'waders'])).toEqual(scoreWindow(LOC, DATE, '05:00', '09:00', undefined, [], 'boat'))
  })
})

/**
 * Model v2 (model-spec): water temperature, a real thunderstorm signal, tides
 * weighted by their size, species rules from the research, and missing data
 * left out instead of read as calm, stable or zero.
 */
describe('model v3', () => {
  const W = SCORE_WEIGHTS
  const tag = (w: ScoredWindow, text: string) => w.tags.find((tg) => tg.label.includes(text))
  const one = (from: string, targets: string[], o: FixtureOpts = {}) =>
    scoreWindow(LOC, DATE, from, from.replace(':00', ':30'), makeForecast(o), targets)

  describe('water temperature row', () => {
    const at = (sstC: number | null | undefined, targets: string[], o: FixtureOpts = {}) => one('12:00', targets, { ...o, sstC })

    it('pays havørred in its 8–12 °C band, and reads the curve elsewhere', () => {
      expect(rowPts(at(10, ['havørred']), 'bd_watertemp')).toBe(W.waterTemp)
      expect(rowPts(at(18, ['havørred']), 'bd_watertemp')).toBe(-5)
      expect(rowPts(at(3, ['havørred']), 'bd_watertemp')).toBe(-1)
    })

    it('takes the full −12 for makrel in water it is absent from', () => {
      expect(rowPts(at(6, ['makrel']), 'bd_watertemp')).toBe(-W.waterTemp)
    })

    // Onshore spec §2.9: fjæsing's curve is 0 up to 8 °C and reaches the
    // visitor gate's 0.2 at 10 °C, so late May and November water (8–10 °C)
    // reads the ramp. The gate tests pin only where it crosses, and the
    // model-check sea touches the band only at 8.0–8.2 °C (22 of 1800 April
    // marine hours).
    it('reads fjæsing on its cold ramp: the full −12 up to 8 °C, then −10 at 9 °C and −7 at 10 °C', () => {
      expect([5, 8, 9, 10].map((sst) => rowPts(at(sst, ['fjaesing']), 'bd_watertemp'))).toEqual([-W.waterTemp, -W.waterTemp, -10, -7])
    })

    it('counts only the targets that have a curve', () => {
      expect(rowPts(at(10, ['havørred', 'gedde']), 'bd_watertemp')).toBe(W.waterTemp)
    })

    // Critique M1: a plain mean let the absent makrel pull havørred's spring
    // water down a second time (its bonuses are gated, its relevance halved).
    it('weights the targets by presence, so an absent visitor does not drag down the one that is there', () => {
      expect(rowPts(at(4, ['havørred', 'makrel']), 'bd_watertemp')).toBe(rowPts(at(4, ['havørred']), 'bd_watertemp'))
      expect(Math.abs(rowPts(at(9.99, ['havørred', 'makrel']), 'bd_watertemp') - rowPts(at(10, ['havørred', 'makrel']), 'bd_watertemp'))).toBeLessThanOrEqual(1)
      // Every target absent is still the full penalty.
      expect(rowPts(at(5, ['makrel', 'hornfisk']), 'bd_watertemp')).toBe(-W.waterTemp)
    })

    it('has no row without a target that has a curve', () => {
      expect(hasRow(at(10, []), 'bd_watertemp')).toBe(false)
      expect(hasRow(at(10, ['gedde']), 'bd_watertemp')).toBe(false)
    })

    it('has no row and no tag without a sea temperature', () => {
      for (const sst of [null, undefined]) {
        const w = at(sst, ['havørred'])
        expect(hasRow(w, 'bd_watertemp')).toBe(false)
        expect(tag(w, '💧')).toBeUndefined()
      }
    })

    it('labels the row with the temperature and tags a clear verdict', () => {
      const good = at(10, ['havørred'])
      expect(good.breakdown!.find((b) => b.key === 'bd_watertemp')!.label).toBe('10.0 °C')
      expect(tag(good, '💧')).toEqual({ label: '💧 10.0 °C', cls: 'tag-green' })
      expect(tag(at(6, ['makrel']), '💧')?.cls).toBe('tag-gray')
      // +4 at 5 °C is no reason for a tag.
      expect(tag(at(5, ['havørred']), '💧')).toBeUndefined()
    })

    it('reads each curve piecewise-linearly and flat beyond its ends', () => {
      const c: [number, number][] = [[4, 0.5], [8, 1]]
      expect([sstPreference(c, 0), sstPreference(c, 4), sstPreference(c, 6), sstPreference(c, 8), sstPreference(c, 30)]).toEqual([0.5, 0.5, 0.75, 1, 1])
    })
  })

  describe('visitor gate', () => {
    const sp = (sstC: number | null) => rowPts(one('05:00', ['makrel'], { sstC }), 'fac_species_name')

    // A January dawn paid makrel its dawn bonus for a fish that isn't there.
    it('pays a visitor no bonus while the water is too cold for it, and pays as before when unknown', () => {
      expect(sp(9)).toBe(0)
      expect(sp(12)).toBe(SPECIES_PREFS.makrel.bonuses.dawn)
      expect(sp(null)).toBe(SPECIES_PREFS.makrel.bonuses.dawn)
    })

    // Onshore spec §2.9: fjæsing's curve began flat at 0.2, which the strict
    // gate never undercuts, so a January night paid +13 for a fish fasting in
    // 16–25 m of water (Bagge 2004). Its cold end now crosses the gate at
    // 10 °C, where makrel's does.
    const night = (sstC: number | null) => rowPts(one('01:00', ['fjaesing'], { sstC }), 'fac_species_name')

    it('gates fjæsing just below 10 °C and lets it in at 10 °C', () => {
      expect(night(9.9)).toBe(0)
      expect(night(10)).toBe(SPECIES_PREFS.fjaesing.bonuses.night)
    })

    it('pays a gated fjæsing no night bonus, and pays it as before when the water is unknown', () => {
      expect(night(5)).toBe(0)
      expect(night(null)).toBe(SPECIES_PREFS.fjaesing.bonuses.night)
    })

    it('leaves the makrel and hornfisk gates where they were', () => {
      expect([sp(9.9), sp(10)]).toEqual([0, SPECIES_PREFS.makrel.bonuses.dawn])
      const day = (sstC: number) => rowPts(one('13:00', ['hornfisk'], { sstC }), 'fac_species_name')
      expect([day(8.6), day(8.7)]).toEqual([0, SPECIES_PREFS.hornfisk.bonuses.daylight])
    })

    // The kind of curve behind §2.9: one that starts at or above the gate never closes it.
    it('closes every visitor at the cold end of its curve', () => {
      const open = Object.values(SPECIES_PREFS).filter((s) => s.visitor && s.sst![0][1] >= W.visitorMinPref).map((s) => s.id)
      expect(open).toEqual([])
    })
  })

  describe('day feeders', () => {
    const tod = (from: string, targets: string[], o: FixtureOpts = {}) => rowPts(one(from, targets, o), 'bd_timeofday')

    it('counts midday as ordinary daytime for a day feeder', () => {
      expect(tod('13:00', ['hornfisk'])).toBe(W.timeOfDay.day)
    })

    it('does so for havørred only in water under 10 °C', () => {
      expect(tod('13:00', ['havørred'], { sstC: 9.9 })).toBe(W.timeOfDay.day)
      expect(tod('13:00', ['havørred'], { sstC: 10 })).toBe(W.timeOfDay.midday)
      expect(tod('13:00', ['havørred'], { sstC: null })).toBe(W.timeOfDay.midday)
    })

    it('in proportion to their share of the targets', () => {
      expect(tod('13:00', ['havørred', 'makrel'], { sstC: 8 })).toBe(Math.round(W.timeOfDay.midday * 0.5 + W.timeOfDay.day * 0.5))
    })

    // Critique M2: hornfisk "isn't here" in January for its bonuses, so it
    // must not lift the midday penalty either.
    it('does not count a visitor that the water keeps away', () => {
      expect(tod('13:00', ['hornfisk', 'makrel'], { sstC: 3 })).toBe(W.timeOfDay.midday)
      expect(tod('13:00', ['havørred', 'hornfisk'], { sstC: 3 })).toBe(Math.round(W.timeOfDay.midday * 0.5 + W.timeOfDay.day * 0.5))
    })

    // Critique M3: the winter-coast source says the morning lasts longer "if
    // it's overcast", so cold-water havørred keep the overcast bonus.
    it('drops the overcast bonus for sun-and-daylight feeders only', () => {
      expect(hasRow(one('13:00', ['hornfisk'], { cloud: 90 }), 'bd_cloud')).toBe(false)
      expect(rowPts(one('13:00', [], { cloud: 90 }), 'bd_cloud')).toBe(W.cloud)
      expect(rowPts(one('13:00', ['havørred'], { cloud: 90, sstC: 5 }), 'bd_cloud')).toBe(W.cloud)
    })

    it('leaves dawn alone: a day feeder at sunrise still gets the dawn peak', () => {
      expect(tod('05:00', ['hornfisk'])).toBe(tod('05:00', []))
      expect(tod('05:00', ['hornfisk'])).toBeGreaterThan(W.timeOfDay.dawnBase)
    })

    it('says so on the midday row', () => {
      expect(one('13:00', ['hornfisk']).breakdown!.find((b) => b.key === 'bd_timeofday')!.label).toContain(t('bd_tod_dayfeeders'))
    })

    it('makes a sunny midday better than an overcast one for hornfisk', () => {
      const total = (cloud: number) => one('13:00', ['hornfisk'], { cloud }).score
      expect(total(10)).toBeGreaterThan(total(90))
    })
  })

  describe('rain, not thunder', () => {
    // The −20 "lightning" row fired on rain probability alone.
    it('reads heavy rain as rain', () => {
      const w = one('12:00', [], { precipPct: 90 })
      expect(rowPts(w, 'bd_precip')).toBe(W.precip.heavy)
      expect(hasRow(w, 'bd_lightning') || hasRow(w, 'bd_thunder')).toBe(false)
      expect(w.tags.find((tg) => tg.label === t('bd_tag_rain'))?.cls).toBe('tag-orange')
    })
  })

  describe('missing data', () => {
    it('skips an hour with no weather at all', () => {
      const w = scoreWindow(LOC, DATE, '06:00', '08:00', makeForecast({ nullHours: [7] }), [])
      // Two hours of calm, not three hours with one of them worth nothing.
      expect(rowPts(w, 'bd_wind')).toBe(W.wind.calm)
    })

    it('reports no data when no hour has any', () => {
      expect(one('07:00', [], { nullHours: [7] }).noData).toBe(true)
    })

    // Critique M6a: skipping in the scoring loop left the hour scores out of
    // step with the hours, and the best hour, its lure and labels came from
    // the wrong one.
    it('takes the best hour from the hours that were scored', () => {
      const w = scoreWindow(LOC, DATE, '06:00', '09:00', makeForecast({ nullHours: [6], pressureAt: (h) => (h >= 8 ? 1020 : 1013) }), [])
      expect(w.bestHourStr).toBe('08:00')
    })

    // Critique M6b: a past-weather series drops all-null rows, and an index
    // look-back then read an hour from before the gap as "3 hours ago".
    it('looks back 3 hours by time, not by index', () => {
      const f = makeForecast({ pressureAt: (h) => (h < 6 ? 1000 : 1013) })
      const midnight = new Date(DATE.getUTCFullYear(), DATE.getUTCMonth(), DATE.getUTCDate()).getTime()
      f.hourly = f.hourly.filter((h) => { const hr = (h.time - midnight) / 3600000; return hr < 6 || hr > 11 })
      expect(hasRow(scoreWindow(LOC, DATE, '12:00', '12:30', f, []), 'bd_pressure')).toBe(false)
    })

    // The forecast store's hourly array is a Vue reactive proxy, so every
    // element read is a proxy get. Finding the row 3 hours back by scanning
    // from index 0, once for pressure and once for wind, tripled the reads per
    // scored hour: the new model's main cost on an 18-spot dashboard.
    it('reads the row 3 hours back directly when it sits there, not by rescanning', () => {
      const f = makeForecast({ span: 200, pressureAt: (h) => 1000 + h })
      let reads = 0
      const hourly = new Proxy(f.hourly, {
        get(target, key, recv) {
          if (typeof key === 'string' && /^\d+$/.test(key)) reads++
          return Reflect.get(target, key, recv)
        },
      })
      // Day 7, 12:00: index 180 of the fixture.
      const day7 = new Date(Date.UTC(DATE.getUTCFullYear(), DATE.getUTCMonth(), DATE.getUTCDate() + 7))
      const w = scoreWindow(LOC, day7, '12:00', '12:30', { ...f, hourly }, [])
      expect(rowPts(w, 'bd_pressure')).toBe(W.pressure.rise)
      // One scan to find the hour itself (181 reads), plus a handful.
      expect(reads).toBeLessThan(200)
    })

    it('leaves the wind out, with the species wind rules and the light-wind tag, when it is missing', () => {
      const w = scoreWindow(LOC, DATE, '12:00', '13:00', makeForecast({ windMs: null }), ['sild', 'gedde'])
      expect(hasRow(w, 'bd_wind') || hasRow(w, 'bd_windtrend')).toBe(false)
      expect(w.tags.find((tg) => tg.label === t('tag_wind_light'))).toBeUndefined()
    })

    it('leaves the pressure out when it is missing', () => {
      const w = scoreWindow(LOC, DATE, '12:00', '13:00', makeForecast({ pressureAt: () => null }), [])
      expect(hasRow(w, 'bd_pressure')).toBe(false)
      expect(w.noData).toBe(false)
    })
  })

  describe('tide weighted by its size', () => {
    const at = (rangeCm: number, from: string, to: string, targets: string[] = [], o: FixtureOpts = {}) =>
      scoreWindow(LOC, DATE, from, to, makeForecast({ tideRangeCm: rangeCm, ...o }), targets)

    it('gives a 5 cm tide almost nothing, and no tag', () => {
      expect(rowPts(at(5, '12:00', '13:00'), 'bd_tide')).toBe(Math.round(W.tide.rising * 0.1))
      expect(tag(at(5, '12:00', '13:00'), t('tide_rising'))).toBeUndefined()
    })

    it("gives Kalundborg's 39 cm most of it, with the tag", () => {
      expect(rowPts(at(39, '12:00', '13:00'), 'bd_tide')).toBe(9)
      expect(rowPts(at(39, '06:00', '07:00'), 'bd_tide')).toBe(4)
      expect(tag(at(39, '12:00', '13:00'), t('tide_rising'))).toBeDefined()
    })

    it('gives a tide of half a metre or more the full weights', () => {
      expect(rowPts(at(60, '12:00', '13:00'), 'bd_tide')).toBe(W.tide.rising)
      expect(rowPts(at(60, '06:00', '07:00'), 'bd_tide')).toBe(W.tide.falling)
    })

    it('reads the range fetchTides set, and computes it only for an old cache', () => {
      expect(rowPts(at(5, '12:00', '13:00', [], { rangeM: 0.6 }), 'bd_tide')).toBe(W.tide.rising)
      expect(hasRow(at(60, '12:00', '13:00', [], { rangeM: null }), 'bd_tide')).toBe(true)
    })

    it('says how big the tide is, in cm', () => {
      expect(at(60, '12:00', '13:00').breakdown!.find((b) => b.key === 'bd_tide')!.label).toContain('60 cm')
    })

    it('pays the species tide bonus only where the tide is real', () => {
      // Skrubbe at midday: only its tide rule can pay.
      expect(rowPts(at(20, '12:00', '13:00', ['skrubbe']), 'fac_species_name')).toBe(0)
      expect(rowPts(at(30, '12:00', '13:00', ['skrubbe']), 'fac_species_name')).toBe(SPECIES_PREFS.skrubbe.bonuses.tide)
    })
  })

  describe('species conditions', () => {
    const base: SpeciesConditions = {
      timeOfDay: 'day', windMs: 2, cloud: 50, tideRising: false, tideWeight: 0,
      waveM: null, depth: null, sstC: null, shoreKnown: false,
    }
    const fires = (key: string, o: Partial<SpeciesConditions>) => SPECIES_CONDITIONS[key]({ ...base, ...o })

    it('windOrChop: 4–8 m/s, or 0.3–0.9 m of waves', () => {
      expect([3.9, 4, 8, 8.1].map((windMs) => fires('windOrChop', { windMs, waveM: null }))).toEqual([false, true, true, false])
      expect([0.29, 0.3, 0.9, 0.91].map((waveM) => fires('windOrChop', { windMs: null, waveM }))).toEqual([false, true, true, false])
    })

    it('breeze: 4–8 m/s', () => {
      expect([3.9, 4, 8, 8.1, null].map((windMs) => fires('breeze', { windMs }))).toEqual([false, true, true, false, false])
    })

    it('sunny: under 30 % cloud in daylight', () => {
      expect([29, 30].map((cloud) => fires('sunny', { cloud }))).toEqual([true, false])
      expect(fires('sunny', { cloud: 0, timeOfDay: 'midday' })).toBe(true)
      expect(fires('sunny', { cloud: 0, timeOfDay: 'dawn' })).toBe(false)
    })

    it('nightWarm: night in water of 15 °C and up', () => {
      expect([14.9, 15, null].map((sstC) => fires('nightWarm', { timeOfDay: 'night', sstC }))).toEqual([false, true, false])
    })

    it("daylight: 'day' and 'midday', not dawn", () => {
      expect((['day', 'midday', 'dawn', null] as const).map((timeOfDay) => fires('daylight', { timeOfDay }))).toEqual([true, true, false, false])
    })

    // Beaufort 3, 'let vind' (3.4–5.4 m/s): the band the global wind row
    // leaves neutral, between calm (< 3) and brisk (> 5.5).
    it('lightWind: 3–5.5 m/s, and needs a wind reading', () => {
      expect([2.9, 3, 5.5, 5.6, null].map((windMs) => fires('lightWind', { windMs }))).toEqual([false, true, true, false, false])
    })

    // fishingindenmark: herring "gerne bagende sol og let vind". The old calm
    // rule (< 3 m/s, "stille vejr") paid dead calm and nothing in let vind.
    it('pays sild in a light breeze, not in dead calm', () => {
      const sild = (windMs: number) => rowPts(scoreWindow(LOC, DATE, '12:00', '12:30', makeForecast({ windMs, cloud: 80 }), ['sild']), 'fac_species_name')
      expect([2, 4.5, 6.5].map(sild)).toEqual([0, SPECIES_PREFS.sild.bonuses.lightWind, 0])
    })

    it('tide: rising, and big enough to count', () => {
      expect(([[true, 0.5], [true, 0.49], [false, 1]] as const).map(([tideRising, tideWeight]) =>
        fires('tide', { tideRising, tideWeight }))).toEqual([true, false, false])
    })

    // strings.test.ts only sees keys passed to t() as literals, so a missing
    // label key would render raw with every test green.
    it('has a label for every condition, in both languages', () => {
      expect(Object.keys(SPECIES_CONDITIONS).filter((k) => !COND_LABEL_KEY[k])).toEqual([])
      const missing = Object.values(COND_LABEL_KEY).flatMap((k) =>
        (['da', 'en'] as const).filter((l) => !STRINGS[l][k]).map((l) => `${l}.${k}`))
      expect(missing).toEqual([])
    })
  })

  describe('invariant', () => {
    it('rows sum to the score on a warm summer night that fires the water-temperature row', () => {
      const w = scoreWindow(LOC, DATE, '23:00', '02:00', makeForecast({ sstC: 16, waveM: 0.4, tideRangeCm: 40 }), ['havørred', 'makrel'])
      expect(hasRow(w, 'bd_watertemp')).toBe(true)
      expect(sum(w.breakdown!.map((b) => b.points))).toBe(w.score)
    })
  })

  describe('removed factors', () => {
    // The global compass bonus is gone; the direction now counts only against
    // a spot's own coast (bd_shorewind), and LOC has none.
    it('has no bd_winddir row, and no shore row without a coast', () => {
      for (const windDir of [0, 90, 180, 270]) {
        for (const [from, to] of [['06:00', '10:00'], ['12:00', '12:30'], ['22:00', '02:00']]) {
          const w = scoreWindow(LOC, DATE, from, to, makeForecast({ windDir, windMs: 6 }), ['havørred'])
          expect(hasRow(w, 'bd_winddir')).toBe(false)
          expect(hasRow(w, 'bd_shorewind')).toBe(false)
        }
      }
    })
  })

  describe('species table', () => {
    it('has well-formed temperature curves', () => {
      const bad = Object.values(SPECIES_PREFS).filter((sp) => sp.sst).filter((sp) => {
        const c = sp.sst!
        return c.length < 2 || c.some(([x, y], i) => y < 0 || y > 1 || (i > 0 && x <= c[i - 1][0]))
      }).map((sp) => sp.id)
      expect(bad).toEqual([])
    })

    it('gates only visitors with a curve, and gives day feeders a numeric threshold', () => {
      expect(Object.values(SPECIES_PREFS).filter((sp) => sp.visitor).map((sp) => sp.id).sort()).toEqual(['fjaesing', 'hornfisk', 'makrel'])
      expect(Object.values(SPECIES_PREFS).filter((sp) => sp.visitor && !sp.sst)).toEqual([])
      const bad = Object.values(SPECIES_PREFS).filter((sp) => sp.dayFeeder != null && sp.dayFeeder !== true && typeof sp.dayFeeder.belowSst !== 'number')
      expect(bad).toEqual([])
    })

    // Total ban for recreational anglers since 17 January 2025, continued in 2026.
    it('marks stenbider as banned', () => {
      expect(SPECIES_PREFS.stenbider.banned).toBe(true)
    })

    // The Council's 2026 Baltic agreement keeps recreational cod banned in the
    // whole Baltic, Bornholm (ICES 24 and 25) included. The warning used to
    // ban 22–24 only and leave Bornholm "to check".
    it('warns that the 2026 cod ban covers the whole Baltic, Bornholm included', () => {
      const { warningText, warningTextEn } = SPECIES_PREFS.torsk
      expect(warningText).toContain('hele Østersøen')
      expect(warningTextEn).toContain('whole Baltic')
      expect(`${warningText} ${warningTextEn}`).not.toMatch(/tjek, om det gælder|check whether that applies/)
    })

    // Regression guard on the research: no source supports pressure or
    // solunar periods, and the tips must not promise them.
    it('promises no pressure or solunar effect in any tip', () => {
      const bad = Object.values(SPECIES_PREFS).filter((sp) =>
        /solunar|lufttryk|air pressure/i.test(`${sp.tip} ${sp.tipEn ?? ''}`)).map((sp) => sp.id)
      expect(bad).toEqual([])
    })
  })
})

/**
 * Onshore wind per spot (onshore spec §2, with the critique's R3, R4 and R9).
 * Model v3 removed a global compass bonus (W/NW +5, E/NE −5) because it
 * ignored which way each coast faces: west wind is onshore at Kalundborg and
 * offshore at Dragør. The direction now counts against the spot's own coast.
 */
describe('coast-relative wind', () => {
  const WEST: Shore = { mode: 'manual', facing: 270, spread: 180, exposure: 'open', fetchKm: null }
  const manual = (o: Partial<Shore> = {}): Shore => ({ ...WEST, ...o })
  const at = (o: FixtureOpts = {}, shore: Shore | null = WEST, targets = ['havørred'], loc = LOC) =>
    scoreWindow(loc, DATE, '12:00', '12:30', makeForecast({ sstC: 9, waveM: 0.5, ...o }), targets, 'shore', shore)
  const row = (w: ScoredWindow) => w.breakdown!.find((b) => b.key === 'bd_shorewind')
  const pts = (w: ScoredWindow) => row(w)?.points ?? 0
  // What coastGeometry derives for a straight coast with the sea to the west
  // (coastGeometry.test.ts G1): along-shore N and S get 25 km too, from the
  // rays a few degrees seaward of exactly along the coast.
  const G1 = [25, 0.2, 0.1, 0.1, 0, 0.1, 0.1, 0.2, 25, 25, 25, 25, 25, 25, 25, 25]
  const auto = (fetchKm: number[], exposure: Shore['exposure'] = 'open'): Shore => ({ mode: 'auto', facing: 270, spread: 180, exposure, fetchKm })
  // Synthetic coastlines for the derived cases, drawn in metres (x east,
  // y north) as coastGeometry.test.ts draws them; no map data.
  const LAT0 = 55.6, LON0 = 12.6, BIG = 30000
  const KX = Math.cos((LAT0 * Math.PI) / 180) * 111320, KY = 110540
  const ring = (p: [number, number][]) => Float64Array.from(p.flatMap(([x, y]) => [LON0 + x / KX, LAT0 + y / KY]))
  const poly = (kind: FeatureKind, p: [number, number][]): CoastFeature => ({ kind, rings: [ring([...p, p[0]])] })
  const rect = (kind: FeatureKind, x0: number, y0: number, x1: number, y1: number) => poly(kind, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]])
  /** What the app derives and scores for a pin at (x, y) m. */
  const derivedShore = (feats: CoastFeature[], x: number, y: number) => {
    const lat = LAT0 + y / KY, lon = LON0 + x / KX
    const auto = { ...deriveFromFeatures(lat, lon, feats, feats), at: 0, src: 'versatiles' as const }
    return { auto, shore: resolveShore({ ...LOC, lat, lon }, auto)! }
  }

  it('1: onshore 6 m/s pays sea trout the most, labelled with the relation and speed', () => {
    const w = at({ windDir: 270, windMs: 6 })
    expect(pts(w)).toBe(8)
    expect(row(w)!.label).toBe(`${t('shore_on')} · 6.0 m/s`)
  })

  it('2: offshore costs a little, and nothing in cold water', () => {
    expect(pts(at({ windDir: 90, windMs: 6 }))).toBe(-3)
    expect(row(at({ windDir: 90, windMs: 6, sstC: 3 }))).toBeUndefined()
    expect(pts(at({ windDir: 90, windMs: 6, sstC: 5 }))).toBe(-1) // −1.5, JS rounding
  })

  it('3: side wind along the coast, and the blend into offshore', () => {
    expect(pts(at({ windDir: 0, windMs: 6 }))).toBe(5)
    expect(pts(at({ windDir: 10, windMs: 6 }))).toBe(1)
  })

  it('4: no step at the class edges', () => {
    for (const [a, b] of [[44, 46], [99, 101]]) {
      expect(Math.abs(pts(at({ windDir: 270 + a, windMs: 6 })) - pts(at({ windDir: 270 + b, windMs: 6 })))).toBeLessThanOrEqual(1)
    }
  })

  it('5: below 1.5 m/s the direction does not count', () => {
    for (const windDir of [0, 90, 180, 270]) expect(row(at({ windDir, windMs: 1 }))).toBeUndefined()
  })

  it('6: strong onshore wind muddies the water; in a rough sea bd_wave already prices it', () => {
    expect(pts(at({ windDir: 270, windMs: 12, waveM: 0.8 }))).toBe(-4)
    expect(row(at({ windDir: 270, windMs: 12, waveM: 1.2 }))).toBeUndefined()
  })

  it('7–8: exposure scales it; offshore is neutral in sheltered water', () => {
    expect(pts(at({ windDir: 270, windMs: 6 }, manual({ exposure: 'sheltered' })))).toBe(3)
    expect(row(at({ windDir: 90, windMs: 6 }, manual({ exposure: 'sheltered' })))).toBeUndefined()
    expect(pts(at({ windDir: 270, windMs: 6 }, manual({ exposure: 'semi' })))).toBe(6)
    expect(pts(at({ windDir: 90, windMs: 6 }, manual({ exposure: 'semi' })))).toBe(-1)
  })

  /**
   * Water all round used to be onshore from anywhere: +8 for every wind,
   * whatever facing the user picked, so the facing did not matter. A pier
   * head or an islet still has a front, the water the user fishes, but the
   * user has said there is water behind them too: a wind from behind crosses
   * water, so it is side wind, never "fralandsvind" with the gray tag. (Gap
   * answers no longer inherit 360: pickedCoast maps it to 270.)
   */
  it('9: a mole is onshore over a wider arc; water all round still has a front, and no land behind', () => {
    expect(pts(at({ windDir: 330, windMs: 6 }, manual({ spread: 270 })))).toBe(8)
    const round = manual({ facing: 0, spread: 360 })
    expect(pts(at({ windDir: 90, windMs: 6 }, round))).toBe(8) // 90° off still blows over water onto the spot
    expect(shoreRelation(180, 6, round)).toBe('side')
    for (let d = 0; d < 360; d += 5) expect(shoreRelation(d, 6, round)).not.toBe('off')
    const back = at({ windDir: 180, windMs: 6 }, round)
    expect(pts(back)).toBe(5)
    expect(back.tags.find((tg) => tg.label === t('tag_shore_off'))).toBeUndefined()
    expect(pts(at({ windDir: 0, windMs: 6 }, round))).toBeGreaterThan(pts(back))
  })

  it('10: the FROM convention — wind from the sea is onshore (v1 had it inverted)', () => {
    expect(shoreRelation(100, 6, manual({ facing: 105 }))).toBe('on') // Dragør-like
    expect(shoreRelation(100, 6, manual({ facing: 270 }))).toBe('off') // Kalundborg-like
    expect(shoreRelation(100, 1, manual({ facing: 105 }))).toBeNull()
    expect(shoreRelation(null, 6, WEST)).toBeNull()
    expect(shoreRelation(100, 6, null)).toBeNull()
  })

  /**
   * Critique R3: auto and manual disagreed by up to 3.0 on a straight coast —
   * every ray with any seaward component has 25 km of fetch, so auto paid +8
   * out to ~67° off. The old test checked 0°, 90° and 180°, the three angles
   * where the two coincide. Now: every 5°, both ways round.
   */
  it('11: auto equals manual on a straight coast within 2 points, every 5°', () => {
    let worst = 0
    for (let off = -180; off <= 180; off += 5) {
      const windDir = (270 + off + 360) % 360
      worst = Math.max(worst, Math.abs(pts(at({ windDir, windMs: 6 }, auto(G1))) - pts(at({ windDir, windMs: 6 }))))
    }
    expect(worst).toBeLessThanOrEqual(2)
    expect([270, 90, 0].map((windDir) => pts(at({ windDir, windMs: 6 }, auto(G1))))).toEqual([8, -3, 5])
  })

  it('12: an auto mole — wind from the harbour side is offshore', () => {
    const mole = Array.from({ length: 16 }, (_, k) => (k >= 6 && k <= 10 ? 0.1 : 25))
    expect(pts(at({ windDir: 180, windMs: 6 }, auto(mole)))).toBe(-3)
  })

  it('13: an auto fjord pays onshore by the stretch of open water upwind', () => {
    const fjord = Array.from({ length: 16 }, (_, k) => (k >= 8 || k === 0 ? 1.5 : 0))
    expect(pts(at({ windDir: 270, windMs: 6 }, auto(fjord, 'semi')))).toBe(3) // 8 × 0.4
  })

  /**
   * A mole facing SE with a 0.5 km marina basin behind it to the W (a
   * common harbour layout): a W wind crosses the basin, then
   * the mole, and blows off it onto the open water. The basin counted as
   * water upwind, so `off` was 0 and the rest paid the full side table: +4
   * 'sidevind' at such a mole, where the same facing set by hand gives −3.
   */
  it('12b: wind from a short basin behind a mole is offshore for the open side', () => {
    // N–NNE land, NE–SW open sea, WSW land, W a basin of `km`, WNW–NNW land.
    const mole = (km: number): Shore => ({ mode: 'auto', facing: 135, spread: 270, exposure: 'open', fetchKm: [0.1, 0.1, 25, 25, 25, 25, 25, 25, 25, 25, 25, 0.1, km, 0.1, 0.1, 0.1] })
    for (const km of [0.5, 1]) {
      expect(pts(at({ windDir: 270, windMs: 6 }, mole(km))), `${km} km`).toBeLessThanOrEqual(0)
      expect(shoreRelation(270, 6, mole(km)), `${km} km`).toBe('off')
    }
    // A wider basin counts partly as open water (basinKm), so its wind is
    // partly side wind — paid by the water it crossed, never by the open sea
    // it blows onto: that read +2 'sidevind' at 1.2 km and +3 at 1.5 km.
    for (const km of [1.2, 1.5]) expect(pts(at({ windDir: 270, windMs: 6 }, mole(km))), `${km} km`).toBeLessThanOrEqual(1)
    expect(pts(at({ windDir: 135, windMs: 6 }, mole(0.5)))).toBe(8) // the open side is untouched
  })

  /**
   * The same layout as a catalogue harbour mole has it: a mole facing ESE,
   * the harbour basin 0.7 km to the WSW, land W–N. A WSW wind crosses the
   * basin and the mole: it read +1 (once labelled 'fralandsvind') where the
   * same facing set by hand gives −3.
   */
  it('12h: wind across a harbour basin onto the open side does not pay', () => {
    const harbour: Shore = { mode: 'auto', facing: 111, spread: 270, exposure: 'open', fetchKm: [0.3, 15.7, 20.4, 8.3, 17.1, 25, 25, 25, 14.2, 4.8, 3.7, 0.7, 0.1, 0.1, 0.1, 0.2] }
    for (const windDir of [245, 248, 250, 252, 255]) expect(pts(at({ windDir, windMs: 6 }, harbour)), `${windDir}°`).toBeLessThanOrEqual(0)
    expect(shoreRelation(250, 6, harbour)).toBe('off')
    expect(pts(at({ windDir: 250, windMs: 6 }, harbour))).toBeLessThan(0)
  })

  /**
   * Side wind paid the spot's exposure whatever the water upwind, while
   * onshore over the same water was cut to ×0.25 at 0.5 km: a narrow 0.5 km
   * slot upwind paid +5 as side wind, a wide 0.5 km stretch +2 as onshore.
   */
  it('12c: a narrow slot of short water pays no more than a wide stretch of it', () => {
    const S = (fetchKm: number[]) => pts(at({ windDir: 180, windMs: 6 }, { mode: 'auto', facing: 180, spread: 180, exposure: 'open', fetchKm }))
    const wide = S(Array.from({ length: 16 }, (_, k) => (k >= 4 && k <= 12 ? 0.5 : 0)))
    expect(wide).toBe(2) // 8 × 0.25: onshore over half a km of water
    expect(S(Array.from({ length: 16 }, (_, k) => (k === 8 ? 0.5 : 0)))).toBeLessThanOrEqual(wide)
  })

  /**
   * The basin rule looked only at the bin upwind (short water) and the one
   * downwind (open water), never at where they lie against the open sector.
   * Along a beach, the water up to a mole or headland 0.7–0.8 km away is
   * short too, and the other way along the beach is open: a wind straight
   * along the beach scored −2 "fralandsvind" with the gray tag, where the
   * same facing set by hand gives +5 side wind. A basin is behind the spot.
   */
  it('12d: water along the shore up to a mole or headland is not a basin', () => {
    const sea = rect('sea', -BIG, 0, BIG, BIG) // a straight beach facing N; the pin 5 m up it
    for (const end of [rect('land', 700, -5, 720, 250), poly('land', [[700, -5], [1100, -5], [900, 350]])]) {
      const { auto, shore } = derivedShore([sea, end], 0, -5)
      expect(auto.fetchKm[4]).toBeLessThan(1) // E: short water up to the mole or headland
      expect(auto.fetchKm[12]).toBe(25) // W: open the other way along the beach
      const east = at({ windDir: 90, windMs: 6 }, shore)
      expect(shoreRelation(90, 6, shore)).toBe('side')
      expect(pts(east)).toBeGreaterThanOrEqual(4)
      expect(east.tags.find((tg) => tg.label === t('tag_shore_off'))).toBeUndefined()
      expect(pts(at({ windDir: 270, windMs: 6 }, shore))).toBeGreaterThanOrEqual(4)
    }
  })

  /**
   * Where "behind" is comes from the profile's own open water, not from the
   * facing: at a mole the derived facing can swing 60–120° when the pin
   * moves 50 m while the open water it sees stays put, and with the facing
   * the basin rule swung too — the jitter check's largest row change at
   * moles rose from 1–3 to 4–7. An automatic coast is scored by its profile.
   */
  it('12g: an automatic coast scores by its profile, whatever its facing says', () => {
    const fetchKm = [0.1, 0.1, 25, 25, 25, 25, 25, 25, 25, 25, 25, 0.1, 0.5, 0.1, 0.1, 0.1] // 12b's mole
    const rows = [135, 25, 90, 200].map((facing) => [0, 45, 90, 135, 180, 225, 270, 315].map((windDir) =>
      pts(at({ windDir, windMs: 6 }, { mode: 'auto', facing, spread: 270, exposure: 'open', fetchKm }))))
    for (const r of rows) expect(r).toEqual(rows[0])
    expect(rows[0][6]).toBeLessThanOrEqual(0) // W, across the basin
  })

  /**
   * Side wind was capped by the one bin upwind, the ray straight along the
   * shore. A pin more than ~54 m up a straight open beach sees no water that
   * way (its own rays meet the sea far out, its jitter points look 50 m), so
   * N and S winds over 25 km of sea dropped from +5 to +1 'sidevind' over
   * 5 m, with no prompt, and a wind a little off the land read 'sidevind' at
   * −1. The cap reads the open water across the wind's sector instead.
   */
  it('12e: side wind does not depend on how far up a straight beach the pin is', () => {
    const sea = [rect('sea', -BIG, -BIG, 0, BIG)] // open sea to the W of x = 0
    const rows: number[][] = []
    for (const x of [3, 30, 50, 55, 60, 80, 100, 140]) {
      const { auto, shore } = derivedShore(sea, x, 0)
      expect(auto.issues).not.toContain('far') // all short of the 'far' prompt
      const r = [0, 180].map((windDir) => pts(at({ windDir, windMs: 6 }, shore)))
      r.forEach((p, i) => expect(Math.abs(p - pts(at({ windDir: [0, 180][i], windMs: 6 }))), `${x} m`).toBeLessThanOrEqual(1))
      if (rows.length) r.forEach((p, i) => expect(Math.abs(p - rows[rows.length - 1][i]), `${x} m`).toBeLessThanOrEqual(1))
      rows.push(r)
      for (const windDir of [330, 340, 350, 355, 0, 5, 10, 15, 20, 160, 165, 170, 175, 180, 185, 190, 200, 210]) {
        const w = at({ windDir, windMs: 6 }, shore)
        if (shoreRelation(windDir, 6, shore) === 'side') expect(pts(w), `${x} m, ${windDir}°`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  /**
   * 'sidevind' with negative points: a mostly-side wind whose side share was
   * capped at ×0.25 by short water straight upwind, plus an offshore share
   * at −3. On a coast that curves, the water along the shore runs out within
   * a km while the bay in front of it is open.
   */
  it('12f: no catalogue spot reads "sidevind" with negative points at 6 m/s', () => {
    const tb = SPECIES_PREFS.havørred.shoreWind!
    const T = { on: curveAt(tb.on, 6), side: curveAt(tb.side, 6), off: curveAt(tb.off, 6) }
    // The row for havørred alone at 6 m/s in 9 °C water and 0.5 m waves, without a scoreWindow per degree.
    const rowAt = (windDir: number, s: Shore) => {
      const w = shoreWeights(windDir, s)
      const p = Math.round(w.mOn * w.on * T.on + w.mSide * w.side * T.side + w.mOff * w.off * T.off) || 0 // no −0
      return shoreRelation(windDir, 6, s) === 'off' && w.mOff > 0 ? Math.min(p, 0) : p // as the hour loop (12i)
    }
    const bad: string[] = []
    let checked = 0
    for (const [id, e] of Object.entries(SPOT_COAST)) {
      const s = resolveShore({ ...LOC, id }, { ...e, at: 0 })
      if (!s) continue
      checked++
      for (let d = 0; d < 360; d++) if (shoreRelation(d, 6, s) === 'side' && rowAt(d, s) < 0) bad.push(`${id} ${d}°`)
      for (const d of [0, 100, 200, 300]) expect(rowAt(d, s)).toBe(pts(at({ windDir: d, windMs: 6 }, s)))
    }
    expect(checked).toBeGreaterThan(30)
    expect(bad).toEqual([])
  })

  /**
   * The mirror of 12f: 'fralandsvind' with positive points. A wind half off
   * the land and half along it paid its side share by the open sea across
   * the wind, which outweighed the offshore share: "fralandsvind" +1 at an
   * open coast. Offshore costs there, so a row labelled offshore never pays
   * (sheltered spots are exempt: offshore is neutral there).
   */
  it('12i: no open or semi catalogue spot reads "fralandsvind" with positive points', () => {
    const bad: string[] = []
    let checked = 0
    for (const [id, e] of Object.entries(SPOT_COAST)) {
      const s = resolveShore({ ...LOC, id }, { ...e, at: 0 })
      if (!s || s.exposure === 'sheltered') continue
      for (const windMs of [3, 6]) {
        for (let d = 0; d < 360; d++) {
          if (shoreRelation(d, windMs, s) !== 'off') continue
          checked++
          const p = pts(at({ windDir: d, windMs }, s))
          if (p > 0) bad.push(`${id} ${d}° ${windMs} m/s: +${p}`)
        }
      }
    }
    expect(checked).toBeGreaterThan(1000)
    expect(bad).toEqual([])
  })

  it('14: a visitor the water keeps away does not dilute the row', () => {
    expect(pts(at({ windDir: 270, windMs: 6, sstC: 7 }, WEST, ['havørred', 'makrel']))).toBe(8)
  })

  // Onshore spec §2.9: fjæsing is gated below 10 °C like makrel, so at 7 °C
  // havørred is the only target present and the row is its full +8, as in 14.
  it('14b: the user’s three targets at 7 °C: both visitors are gated (§2.9)', () => {
    expect(pts(at({ windDir: 270, windMs: 6, sstC: 7 }, WEST, ['havørred', 'fjaesing', 'makrel']))).toBe(8)
  })

  it('15: all three present in summer water', () => {
    expect(pts(at({ windDir: 270, windMs: 6, sstC: 16 }, WEST, ['havørred', 'fjaesing', 'makrel']))).toBe(3)
  })

  it('16: missing data leaves the row out, never throws', () => {
    expect(row(at({ windDir: 270, windMs: 6 }, null))).toBeUndefined()
    const noDir = makeForecast({ windMs: 6, sstC: 9, waveM: 0.5 })
    noDir.hourly.forEach((h) => { h.windDir = null })
    expect(row(scoreWindow(LOC, DATE, '12:00', '12:30', noDir, ['havørred'], 'shore', WEST))).toBeUndefined()
    expect(row(at({ windDir: 270, windMs: null }))).toBeUndefined()
    // No shore argument: the location's own override is read (resolveShore).
    const f = makeForecast({ windDir: 270, windMs: 6, sstC: 9, waveM: 0.5 })
    expect(pts(scoreWindow({ ...LOC, coast: { facing: 270, spread: 180, exposure: 'open' } }, DATE, '12:00', '12:30', f, ['havørred']))).toBe(8)
    expect(row(scoreWindow({ ...LOC, coast: 'none' }, DATE, '12:00', '12:30', f, ['havørred']))).toBeUndefined()
    expect(row(scoreWindow({ ...LOC, waterType: 'fresh', coast: { facing: 270, spread: 180, exposure: 'open' } }, DATE, '12:00', '12:30', f, ['havørred']))).toBeUndefined()
    expect(row(at({ windDir: 270, windMs: 6 }, WEST, []))).toBeUndefined()
  })

  describe('17: getScoredWindows reads the per-spot shores', () => {
    beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.UTC(2026, 5, 15, 4)) })
    afterEach(() => { vi.useRealTimers() })
    it('uses the shore given for a location, and the manual coast of one without', () => {
      const A: Location = { ...LOC, id: 'a' }
      const B: Location = { ...LOC, id: 'b', coast: { facing: 90, spread: 180, exposure: 'open' } }
      const C: Location = { ...LOC, id: 'c' }
      const f = makeForecast({ windDir: 270, windMs: 6, sstC: 9, waveM: 0.5 })
      const ws = getScoredWindows([A, B, C], [{ id: 'w', days: [DATE.getDay()], from: '12:00', to: '12:30', methods: ['shore'] }],
        { a: f, b: f, c: f }, ['havørred'], {}, { a: WEST })
      const by = (id: string) => ws.find((w) => w.location.id === id && w.date.getTime() === DATE.getTime())!
      expect(pts(by('a'))).toBe(8)
      expect(pts(by('b'))).toBe(-3) // its own override: facing E, wind from W
      expect(row(by('c'))).toBeUndefined()
    })
  })

  /**
   * Critique R4: a tag at a window mean of ≥ +5 / ≤ −3 could never show for
   * havørred, fjæsing and makrel together — divided by the three targets
   * present in summer water, their row tops out at +3. The tag follows the
   * best hour's relation instead. (Below 10 °C both visitors are gated and
   * havørred's row counts in full, §2.9.)
   */
  it('18: tags the relation of the best hour, also for the owner’s three targets', () => {
    const tag = (w: ScoredWindow) => w.tags.find((tg) => tg.label.startsWith('🧭'))
    const THREE = ['havørred', 'fjaesing', 'makrel']
    expect(tag(at({ windDir: 270, windMs: 6 }, WEST, THREE))).toEqual({ label: t('tag_shore_on'), cls: 'tag-green' })
    expect(tag(at({ windDir: 90, windMs: 6 }, WEST, THREE))).toEqual({ label: t('tag_shore_off'), cls: 'tag-gray' })
    expect(tag(at({ windDir: 0, windMs: 6 }, WEST, THREE))).toBeUndefined() // side wind
    expect(tag(at({ windDir: 270, windMs: 11 }, WEST, THREE))).toBeUndefined() // muddying, not praised
    expect(tag(at({ windDir: 90, windMs: 6, sstC: 3 }, WEST, THREE))).toBeUndefined() // offshore costs nothing in cold water
    // Summer water, all three present: the row is a third of havørred's, the tag the same.
    expect(tag(at({ windDir: 270, windMs: 6, sstC: 16 }, WEST, THREE))).toEqual({ label: t('tag_shore_on'), cls: 'tag-green' })
    expect(tag(at({ windDir: 90, windMs: 6, sstC: 16 }, WEST, THREE))).toEqual({ label: t('tag_shore_off'), cls: 'tag-gray' })
  })

  it('has its row name and explanation in both languages', () => {
    const w = at({ windDir: 270, windMs: 6 })
    for (const l of ['da', 'en'] as const) for (const k of ['bd_shorewind', 'bd_shorewind_why', 'shore_on', 'shore_side', 'shore_off', 'tag_shore_on', 'tag_shore_off', 'bd_wind_windy']) expect(STRINGS[l][k]).toBeTruthy()
    expect(sum(w.breakdown!.map((b) => b.points))).toBe(w.score)
  })

  it('keeps the shore weights a partition, continuous in direction', () => {
    for (const shore of [WEST, manual({ spread: 270 }), manual({ spread: 360 }), auto(G1), auto([0.1, 0.1, 25, 25, 25, 25, 25, 25, 25, 25, 25, 0.1, 0.5, 0.1, 0.1, 0.1])]) {
      for (let d = 0; d < 360; d += 7) {
        const w = shoreWeights(d, shore)
        expect(w.on + w.side + w.off).toBeLessThanOrEqual(1 + 1e-9)
        const n = shoreWeights(d + 1, shore)
        expect(Math.abs(w.on - n.on) + Math.abs(w.off - n.off)).toBeLessThan(0.2)
      }
    }
  })
})

/**
 * The calm-and-glassy fix (onshore spec §2.4): sea trout want "pålandsvind og
 * gang i vandet", and "spejlblankt, krystalklart vand er sjældent godt". The
 * calm (+4) and glassy (+3) bonuses out-scored onshore chop for them, and the
 * brisk −5 sat on their best band. Pike catch more in high wind (Kuparinen
 * et al. 2010). For the windy species' share of the present targets those
 * three don't apply. The gale −22 stays for everyone.
 */
describe('windy species', () => {
  const W = SCORE_WEIGHTS
  const WEST: Shore = { mode: 'manual', facing: 270, spread: 180, exposure: 'open', fetchKm: null }
  const spLabel = (w: ScoredWindow) => w.breakdown!.find((b) => b.key === 'fac_species_name')?.label ?? ''

  it('19: with the coast known, windOrChop does not pay', () => {
    const w = scoreWindow(LOC, DATE, '12:00', '12:30', makeForecast({ windMs: 6, waveM: 0.5, sstC: 12, windDir: 270 }), ['havørred'], 'shore', WEST)
    expect(spLabel(w)).not.toContain(t('bd_cond_windOrChop'))
    expect(rowPts(w, 'fac_species_name')).toBe(0)
  })

  // +2: the mean bd_shorewind over the fixture hours where the old rule fired
  // (onshore.check.ts "Fallback value": 2.19 with the basin rule kept to wind
  // from behind the spot and side wind capped by the water along and across
  // it; 1.87 before that, 2.60 before basin winds scored offshore), so an
  // unknown coast is neither rewarded nor penalised against a known one.
  it('20: with the coast unknown, windOrChop is the +2 fallback', () => {
    const w = scoreWindow(LOC, DATE, '12:00', '12:30', makeForecast({ windMs: 6, waveM: 0.5, sstC: 12 }), ['havørred'])
    expect(SPECIES_PREFS.havørred.bonuses.windOrChop).toBe(2)
    expect(rowPts(w, 'fac_species_name')).toBe(2)
  })

  // Review: the label said "kystretning ukendt", but the fallback also pays
  // where the direction is known and not scored — "Se bort fra vindretningen
  // her", a lake, fresh water — and contradicted the user's own choice.
  it("20b: the fallback's label doesn't claim the coast is unknown", () => {
    const w = scoreWindow({ ...LOC, coast: 'none' }, DATE, '12:00', '12:30', makeForecast({ windMs: 6, waveM: 0.5, sstC: 12, windDir: 270 }), ['havørred'])
    expect(spLabel(w)).toContain(t('bd_cond_windOrChop'))
    expect(STRINGS.da.bd_cond_windOrChop).not.toMatch(/ukendt/)
    expect(STRINGS.en.bd_cond_windOrChop).not.toMatch(/unknown/)
  })

  it('21: sea trout alone in calm, glassy water: no calm or glassy points, no green tags', () => {
    const w = scoreWindow(LOC, DATE, '12:00', '12:30', makeForecast({ windMs: 2, waveM: 0.2, sstC: 9 }), ['havørred'])
    expect(hasRow(w, 'bd_wind')).toBe(false)
    expect(hasRow(w, 'bd_wave')).toBe(false)
    expect(w.tags.find((tg) => tg.label === t('tag_wind_light'))).toBeUndefined()
    expect(w.tags.find((tg) => tg.label.includes(t('wave_calm_lbl')))).toBeUndefined()
    expect(sum(w.breakdown!.map((b) => b.points))).toBe(w.score)
  })

  it('22: sea trout alone at 6.5 m/s: no brisk penalty', () => {
    expect(hasRow(scoreWindow(LOC, DATE, '12:00', '12:30', makeForecast({ windMs: 6.5 }), ['havørred']), 'bd_wind')).toBe(false)
  })

  it('23: sea trout + makrel in summer water: half the calm bonus, and the row says why', () => {
    const w = scoreWindow(LOC, DATE, '12:00', '12:30', makeForecast({ windMs: 2, sstC: 16 }), ['havørred', 'makrel'])
    expect(rowPts(w, 'bd_wind')).toBe(Math.round(W.wind.calm / 2))
    expect(w.breakdown!.find((b) => b.key === 'bd_wind')!.label).toContain(t('bd_wind_windy'))
  })

  it('24: a gale still costs everyone', () => {
    expect(rowPts(scoreWindow(LOC, DATE, '12:00', '12:30', makeForecast({ windMs: 9 }), ['havørred']), 'bd_wind')).toBe(W.wind.gale)
  })

  // The window's row spans its wind, but kept the calm best hour's "doesn't
  // count for species that want wind" when the other hours blew a gale,
  // which counts for every species.
  it('24b: a wind row that reaches a gale does not say it skips the windy species', () => {
    const f = makeForecast({ windMs: 16, sstC: 16 })
    f.hourly[8].windMs = 2
    const w = scoreWindow(LOC, DATE, '06:00', '13:00', f, ['havørred', 'makrel'])
    expect(w.bestHourStr).toBe('08:00')
    expect(w.breakdown!.find((b) => b.key === 'bd_wind')!.label).toBe('2.0–16.0 m/s')
  })

  it('24c: it still says so when every hour that scores the wind left them out', () => {
    const f = makeForecast({ windMs: 2, sstC: 16 })
    f.hourly[10].windMs = 4
    const w = scoreWindow(LOC, DATE, '06:00', '13:00', f, ['havørred', 'makrel'])
    expect(w.breakdown!.find((b) => b.key === 'bd_wind')!.label).toBe(`2.0–4.0 m/s · ${t('bd_wind_windy')}`)
  })

  // Pike catch more in high wind (Kuparinen et al. 2010). Critique R9 kept it
  // out of the onshore change, where test 25 pinned the calm bonus; it lands
  // on its own here. A lake has no coast (shore null), so there only the calm,
  // brisk and glassy points move; 25d covers pike at a coast.
  const lake: Location = { ...LOC, waterType: 'fresh' }
  const onLake = (o: FixtureOpts, targets: string[]) => scoreWindow(lake, DATE, '12:00', '12:30', makeForecast(o), targets)

  it('25: pike alone: no calm bonus or green light-wind tag, no brisk penalty, the gale still costs', () => {
    const calm = onLake({ windMs: 2 }, ['gedde'])
    expect(hasRow(calm, 'bd_wind')).toBe(false)
    expect(calm.tags.find((tg) => tg.label === t('tag_wind_light'))).toBeUndefined()
    expect(hasRow(onLake({ windMs: 6.5 }, ['gedde']), 'bd_wind')).toBe(false)
    expect(rowPts(onLake({ windMs: 9 }, ['gedde']), 'bd_wind')).toBe(W.wind.gale)
  })

  // weather.ts no longer gives a lake sea waves (takesSeaData), but scoring
  // pays the glassy bonus wherever a forecast has a wave height, so this
  // pins the windy share on its own.
  it('25b: pike alone in glassy water: no glassy bonus and no green "Blik" tag', () => {
    const w = onLake({ windMs: 2, waveM: 0.2 }, ['gedde'])
    expect(hasRow(w, 'bd_wave')).toBe(false)
    expect(w.tags.find((tg) => tg.label.includes(t('wave_calm_lbl')))).toBeUndefined()
    expect(sum(w.breakdown!.map((b) => b.points))).toBe(w.score)
  })

  it('25c: pike + aborre: half the calm, brisk and glassy points, and the row says why', () => {
    const calm = onLake({ windMs: 2, waveM: 0.2 }, ['gedde', 'aborre'])
    expect(rowPts(calm, 'bd_wind')).toBe(Math.round(W.wind.calm / 2))
    expect(calm.breakdown!.find((b) => b.key === 'bd_wind')!.label).toContain(t('bd_wind_windy'))
    expect(rowPts(calm, 'bd_wave')).toBe(Math.round(W.wave.glassy / 2))
    const brisk = onLake({ windMs: 6.5 }, ['gedde', 'aborre'])
    expect(rowPts(brisk, 'bd_wind')).toBe(Math.round(W.wind.brisk / 2))
    expect(brisk.breakdown!.find((b) => b.key === 'bd_wind')!.label).toContain(t('bd_wind_windy'))
    // Aborre alone is not windy: the full calm bonus, no note.
    const perch = onLake({ windMs: 2 }, ['aborre'])
    expect(rowPts(perch, 'bd_wind')).toBe(W.wind.calm)
    expect(perch.breakdown!.find((b) => b.key === 'bd_wind')!.label).not.toContain(t('bd_wind_windy'))
  })

  // The target species are one list for every spot, and scoring doesn't
  // filter them by water type, so a user who fishes a lake for pike carries
  // gedde to every coast, salt included. There it is a present target (no
  // sea-temperature gate) without a direction table: it takes its share of
  // the calm, brisk and glassy points, and of bd_shorewind's denominator like
  // any target without a table, and adds no direction points of its own.
  it('25d: pike at a coast with a known shore: no calm, brisk or glassy points, and no direction points of its own', () => {
    for (const waterType of ['brackish', 'salt'] as const) {
      const onCoast = (o: FixtureOpts, targets: string[]) =>
        scoreWindow({ ...LOC, waterType }, DATE, '12:00', '12:30', makeForecast({ sstC: 12, windDir: 270, ...o }), targets, 'shore', WEST)
      for (const targets of [['gedde'], ['havørred', 'gedde']]) {
        const glassy = onCoast({ windMs: 2, waveM: 0.2 }, targets)
        expect([hasRow(glassy, 'bd_wind'), hasRow(glassy, 'bd_wave')]).toEqual([false, false])
        expect(hasRow(onCoast({ windMs: 6.5, waveM: 0.5 }, targets), 'bd_wind')).toBe(false)
      }
      // Onshore at 6 m/s: no row for pike alone; with sea trout, half its
      // points, the same as with aborre (no table, not windy).
      const shore = (targets: string[]) => onCoast({ windMs: 6, waveM: 0.5 }, targets)
      expect(hasRow(shore(['gedde']), 'bd_shorewind')).toBe(false)
      expect(rowPts(shore(['havørred']), 'bd_shorewind')).toBe(8)
      expect(rowPts(shore(['havørred', 'gedde']), 'bd_shorewind')).toBe(4)
      expect(rowPts(shore(['havørred', 'aborre']), 'bd_shorewind')).toBe(4)
    }
  })

  // The windy flag (25–25d) and the breeze bonus cite the same finding
  // (Kuparinen et al. 2010). At +10 the study was paid twice: pike alone
  // scored 10 better in a brisk breeze than in a calm, glassy hour, where it
  // was −2 before the flag (calm +4, glassy +3 against brisk −5, breeze +10).
  // Literal 5s: reading SPECIES_PREFS would pass whatever the value.
  it('25e: pike alone: the breeze bonus is +5 at 4–8 m/s, so a breezy hour leads a calm, glassy one by 5', () => {
    const species = (windMs: number) => rowPts(onLake({ windMs }, ['gedde']), 'fac_species_name')
    expect([3.9, 4, 5.5, 6.5, 8, 8.1].map(species)).toEqual([0, 5, 5, 5, 5, 0])
    const calm = onLake({ windMs: 2, waveM: 0.2 }, ['gedde'])
    expect(['bd_wind', 'bd_wave', 'fac_species_name'].map((k) => rowPts(calm, k))).toEqual([0, 0, 0])
    for (const [windMs, waveM] of [[4.5, 0.4], [6.5, 0.5]]) expect(onLake({ windMs, waveM }, ['gedde']).score - calm.score).toBe(5)
  })

  it('26: the rows sum to the score with the windy share, clamp rows included', () => {
    for (const windMs of [1, 2, 4, 6.5, 9, 14]) for (const waveM of [0.1, 0.5, 1.2]) {
      for (const targets of [['havørred'], ['havørred', 'makrel'], ['havørred', 'fjaesing', 'makrel'], ['gedde'], ['gedde', 'aborre']]) {
        const w = scoreWindow(LOC, DATE, '05:00', '08:00', makeForecast({ windMs, waveM, sstC: 12, windDir: 250 }), targets, 'shore', WEST)
        expect(sum(w.breakdown!.map((b) => b.points))).toBe(w.score)
      }
    }
  })

  it('the shore-wind tables start at (1.5, 0) and rise strictly in m/s', () => {
    const bad = Object.values(SPECIES_PREFS).filter((sp) => sp.shoreWind).flatMap((sp) =>
      (['on', 'side', 'off'] as const).filter((k) => {
        const c = sp.shoreWind![k]
        return c[0][0] !== 1.5 || c[0][1] !== 0 || c.some(([x], i) => i > 0 && x <= c[i - 1][0])
      }).map((k) => `${sp.id}.${k}`))
    expect(bad).toEqual([])
    // Sea trout (onshore spec §2.4) and pike (Kuparinen et al. 2010).
    expect(Object.values(SPECIES_PREFS).filter((sp) => sp.windy).map((sp) => sp.id)).toEqual(['havørred', 'gedde'])
  })

  // The explanations named sea trout alone after pike turned windy too. The
  // 🧭 sentence names only the species with a direction table: pike have none.
  it('the wind and wave explanations name every windy species, the coast sentence only those with a table', () => {
    const named = (text: string, name: string) => new RegExp(`(^|[^\\p{L}])${name}([^\\p{L}]|$)`, 'iu').test(text)
    for (const [l, name] of [['da', 'name'], ['en', 'nameEn']] as const) {
      for (const k of ['bd_wind_why', 'bd_wave_why']) {
        expect(Object.values(SPECIES_PREFS).filter((sp) => sp.windy && !named(STRINGS[l][k], sp[name])).map((sp) => `${l}.${k}: ${sp.id}`)).toEqual([])
      }
      const coast = STRINGS[l].bd_wind_why.split(/(?<=\.)\s+/).filter((s) => s.includes('🧭'))
      expect(coast).toHaveLength(1)
      expect(Object.values(SPECIES_PREFS).filter((sp) => named(coast[0], sp[name])).map((sp) => sp.id))
        .toEqual(Object.values(SPECIES_PREFS).filter((sp) => sp.shoreWind).map((sp) => sp.id))
    }
  })
})
