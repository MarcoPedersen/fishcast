import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SCORE_WEIGHTS, getScoredWindows, isOvernight, isValidWindow, scoreWindow, windowHours } from './scoring'
import type { Forecast, HourData, Location } from './types'
import { t } from './i18n'
import { Solunar } from './solunar'
import { STRINGS } from './strings'

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
    predictions: Array.from({ length: span }, (_, h) => ({
      time: new Date(D.getUTCFullYear(), D.getUTCMonth(), D.getUTCDate(), h).getTime(),
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
   * The total is clamped to 0–100, and nothing used to account for the clamped
   * amount: a storm showed "Samlet score 0" under rows summing to about −100,
   * and a perfect dawn 100 under rows summing to ~140.
   */
  describe('breakdown invariant at the 0–100 limits', () => {
    const storm = () => scoreWindow(LOC, DATE, '12:00', '14:00', makeForecast({
      precipPct: 90, windMs: 12, windDir: 60, pressureAt: (h) => 1030 - 2 * h, waveM: 1.8,
    }), [], 'boat')
    const SPOT: Location = { ...LOC, species: [{ nameEn: 'Sea Trout', months: [6] }] }
    const perfect = () => scoreWindow(SPOT, DATE, '04:00', '05:00', makeForecast({
      pressureAt: (h) => 1000 + 2 * h, cloud: 90, windMs: 2, windDir: 270, waveM: 0.1, tideRising: true,
    }), ['havørred'], 'waders')

    it('adds a balancing row when the total is floored at 0', () => {
      const w = storm()
      expect(w.score).toBe(0)
      expect(sum(w.breakdown!.map((b) => b.points))).toBe(0)
      expect(w.breakdown!.find((b) => b.key === 'bd_floor')!.points).toBeGreaterThan(0)
    })

    it('adds a balancing row when the total is capped at 100', () => {
      const w = perfect()
      expect(w.score).toBe(100)
      expect(sum(w.breakdown!.map((b) => b.points))).toBe(100)
      expect(w.breakdown!.find((b) => b.key === 'bd_ceiling')!.points).toBeLessThan(0)
    })

    it('gives every row a name and an explanation in both languages', () => {
      // DashboardView renders t(key) and t(key + '_why') for every keyed row.
      const keys = [...new Set([storm(), perfect()].flatMap((w) => w.breakdown!.map((b) => b.key!)))]
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
    expect(windPts(w)).toBe(-18)
  })
})

describe('species solunarMajor bonus', () => {
  /**
   * Gedde: pressureStable +5, calm +5, solunarMajor +10. The fixture is stable
   * and calm, so each hour earns 10, or 20 when INSIDE a major period. The
   * approach ramp used to report period 'major' as well, paying the +10 up to
   * 6 h from a major — on 309 of October's 720 hours. "Inside" is read straight
   * off the period bounds here, independent of the label under test.
   */
  it('pays solunarMajor only for hours inside a major period', () => {
    const periods = Solunar.getSolunarPeriods(DATE, LOC.lat, LOC.lon)
    const inside = (h: number) => {
      const t = new Date(DATE.getUTCFullYear(), DATE.getUTCMonth(), DATE.getUTCDate(), h).getTime()
      return periods.majors.some((p: { start: Date; end: Date }) => t >= p.start.getTime() && t <= p.end.getTime())
    }
    let approachOnly = 0
    for (let h = 0; h < 23; h++) {
      const w = scoreWindow(LOC, DATE, `${h}:00`, `${h + 1}:00`, makeForecast(), ['gedde'])
      const sp = w.breakdown!.find((b) => b.key === 'fac_species_name')!.points
      expect({ h, sp }).toEqual({ h, sp: Math.round((20 + 10 * (+inside(h) + +inside(h + 1))) / 2) })
      if (!inside(h) && !inside(h + 1) && w.breakdown!.some((b) => b.key === 'bd_solunar')) approachOnly++
    }
    // Not vacuous: some windows had solunar points from the approach ramp alone.
    expect(approachOnly).toBeGreaterThan(0)
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
    ['bd_wind_why', [W.wind.calm, W.wind.gale]],
    ['bd_precip_why', [W.precip.light, W.precip.heavy, W.precip.thunder]],
    ['bd_wave_why', [W.wave.glassy, W.wave.moderate, W.wave.high, W.wave.danger]],
    ['bd_tide_why', [W.tide.falling, W.tide.rising]],
  ]
  it.each(['da', 'en'])('quote the current SCORE_WEIGHTS (%s)', (lang) => {
    const missing = QUOTES.flatMap(([key, ns]) =>
      ns.filter((n) => !STRINGS[lang][key].includes(pts(n))).map((n) => `${key} ${pts(n)}`))
    expect(missing).toEqual([])
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
  })

  it('rejects unparseable times', () => {
    expect(isValidWindow('', '10:00')).toBe(false)
    expect(isValidWindow('abc', 'xyz')).toBe(false)
  })
})

describe('windowHours', () => {
  const shape = (f: number, t2: number) =>
    windowHours(f, t2).map((h) => `${h.hour}${h.dayOffset ? '+1' : ''}`).join(',')

  it('is unchanged for an ordinary window (inclusive of the end hour)', () => {
    expect(shape(6, 10)).toBe('6,7,8,9,10')
  })

  it('keeps the pre-existing 12-hour cap', () => {
    // 06:00–22:00 covered 6..18 before overnight support; it still does.
    expect(shape(6, 22)).toBe('6,7,8,9,10,11,12,13,14,15,16,17,18')
  })

  it('wraps past midnight onto the next day', () => {
    expect(shape(22, 2)).toBe('22,23,0+1,1+1,2+1')
  })

  it('handles a one-hour wrap', () => {
    expect(shape(23, 0)).toBe('23,0+1')
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
  })
})
