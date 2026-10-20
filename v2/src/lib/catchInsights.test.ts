import { describe, it, expect } from 'vitest'
import {
  CAT_LABEL_KEY, FACTOR_LABEL_KEY, HIGHLIGHT_N, MIN_N, SOLID_N, VERDICT_KEYS,
  baselineWindows, catchTrips, cellDisplay, classifyHour, conditionTable, distinctDays, dominant, highlights,
  modelPointsTable, summariseGroup, verdict,
  type FactorId, type HourConditions, type HourSample, type WindowSample,
} from './catchInsights'
import { Solunar } from './solunar'
import { STRINGS } from './strings'
import type { Availability, BreakdownItem, Forecast, HourData, Location } from './types'

const H = 3600000
const DAY = 86400000
const LOC: Location = { id: 'l1', name: 'Dragør mole', lat: 55.59, lon: 12.68, waterType: 'salt' }
const AT = new Date(2026, 8, 10, 12).getTime() // local noon, 10 Sep 2026

/** Four hourly rows ending at `at`: `before` is 3 h earlier (the trend look-back), `now` the hour itself. */
function fc(now: Partial<HourData>, before: Partial<HourData> = {}, extra: Partial<Forecast> = {}, at = AT): Forecast {
  const row = (time: number, o: Partial<HourData>): HourData => ({ time, temp: 12, windMs: 4, windDir: 270, gustMs: 6, cloud: 50, precipPct: 50, pressure: 1013, ...o })
  const hourly = [-3, -2, -1, 0].map((k) => row(at + k * H, k === -3 ? before : k === 0 ? now : {}))
  return { fetched: 0, hourly, marine: null, tides: null, ...extra }
}
const cls = (f: Forecast, factor: FactorId, at = AT) => classifyHour(f, LOC, at)[factor]

describe('classifyHour — at every category edge', () => {
  it('wind', () => {
    expect([2.99, 3, 5.5, 5.51, 8, 8.01].map((w) => cls(fc({ windMs: w }), 'wind'))).toEqual(['light', 'gentle', 'gentle', 'fresh', 'fresh', 'strong'])
  })

  /** The scorer's thresholds: a 3-hour fall of exactly 1 hPa is "falling" there (delta > -1 is stable). */
  it('pressure over 3 hours, as the scorer reads it', () => {
    expect([1.01, 1, 0, -0.99, -1, -1.01].map((d) => cls(fc({ pressure: 1013 + d }), 'press'))).toEqual(['rising', 'stable', 'stable', 'stable', 'falling', 'falling'])
  })

  it('wind trend over 3 hours', () => {
    expect([1.01, 1, -1, -1.01].map((d) => cls(fc({ windMs: 4 + d }), 'windtrend'))).toEqual(['rising', 'steady', 'steady', 'falling'])
  })

  it('cloud', () => {
    expect([29, 30, 65, 66].map((c) => cls(fc({ cloud: c }), 'cloud'))).toEqual(['clear', 'partly', 'partly', 'overcast'])
  })

  /** The scorer's bands: "light rain" above 40 %, heavy above 70 %. */
  it('rain chance', () => {
    expect([39, 40, 41, 70, 71].map((p) => cls(fc({ precipPct: p }), 'precip'))).toEqual(['p0', 'p0', 'p1', 'p1', 'p2'])
  })

  it('waves', () => {
    const at = (w: number) => fc({}, {}, { marine: [{ time: AT, waveM: w, wavePeriod: 3 }] })
    expect([0.29, 0.3, 0.6, 1.0].map((w) => cls(at(w), 'wave'))).toEqual(['w0', 'w1', 'w2', 'w3'])
  })

  it('sea temperature, once the marine data carries it', () => {
    const at = (t: number) => fc({}, {}, { marine: [{ time: AT, waveM: 0.2, wavePeriod: 3, sstC: t } as any] })
    expect([3.9, 4, 8, 12, 16].map((t) => cls(at(t), 'sst'))).toEqual(['t0', 't1', 't2', 't3', 't4'])
  })

  it('tide direction at the hour', () => {
    const tides = (rising: boolean) => ({ stationName: 'S', distKm: 2, predictions: [{ time: AT - H, value: rising ? 0 : 10 }, { time: AT + H, value: rising ? 10 : 0 }] })
    expect(cls(fc({}, {}, { tides: tides(true) }), 'tide')).toBe('rising')
    expect(cls(fc({}, {}, { tides: tides(false) }), 'tide')).toBe('falling')
  })

  describe("time of day, with the scorer's bands", () => {
    const day = (y: number, m: number, d: number) => Solunar.getSunTimes(new Date(Date.UTC(y, m, d)), LOC.lat, LOC.lon)
    const tod = (ms: number) => classifyHour(fc({}), LOC, ms).tod
    const MIN = 60000

    it('around a June sunrise and sunset', () => {
      const s = day(2026, 5, 21)
      const sr = s.sunrise!.getTime(), ss = s.sunset!.getTime(), noon = s.solarNoon!.getTime()
      expect([sr - 61 * MIN, sr - 59 * MIN, sr + 119 * MIN, sr + 121 * MIN].map(tod)).toEqual(['night', 'dawn', 'dawn', 'day'])
      expect([ss - 91 * MIN, ss - 89 * MIN, ss + 59 * MIN, ss + 61 * MIN].map(tod)).toEqual(['day', 'dusk', 'dusk', 'night'])
      // The scorer's midday band is daylight here.
      expect(tod(noon)).toBe('day')
    })

    /** In December sunrise + 2 h lies inside noon − 2 h: the scorer calls that dawn, and so must this. */
    it('where dawn and midday overlap in winter', () => {
      const s = day(2026, 11, 21)
      const sr = s.sunrise!.getTime(), noon = s.solarNoon!.getTime()
      const overlap = sr + 110 * MIN
      expect(overlap).toBeGreaterThan(noon - 2 * H)
      expect(tod(overlap)).toBe('dawn')
    })

    /** After midnight an overnight trip's hours are the next day's: its dawn, not the start day's. */
    it("takes the sun from the hour's own local date", () => {
      const next = day(2026, 5, 22)
      expect(tod(next.sunrise!.getTime())).toBe('dawn')
    })
  })

  it('leaves out what it has no data for', () => {
    const c = classifyHour(fc({ pressure: null }), LOC, AT)
    expect(c.press).toBeNull()
    expect(c.wave).toBeNull() // no marine
    expect(c.sst).toBeNull()
    expect(c.tide).toBeNull() // no tides
    // Marine rows from before the sea temperature existed: waves yes, sst no.
    expect(classifyHour(fc({}, {}, { marine: [{ time: AT, waveM: 0.4, wavePeriod: 3 }] }), LOC, AT).sst).toBeNull()
    // No weather row for the hour: only the sky-clock factors.
    const none = classifyHour(fc({}), LOC, AT + 5 * H)
    expect([none.wind, none.press, none.cloud, none.precip]).toEqual([null, null, null, null])
    expect(none.tod).not.toBeNull()
    // The first rows have no 3-hour look-back.
    expect(classifyHour(fc({}), LOC, AT - 3 * H).press).toBeNull()
  })
})

// ── Synthetic samples ────────────────────────────────────────────────────
const hour = (at: number, score: number, cond: HourConditions = {}, breakdown: BreakdownItem[] = []): HourSample => ({ at, score, cond, breakdown })
const win = (score: number, over: { loc?: string; day?: number } = {}) => ({
  location: { ...LOC, id: over.loc ?? LOC.id }, date: new Date(over.day ?? Date.UTC(2026, 8, 10)),
  from: '06:00', to: '09:00', score, noData: false, bestHourStr: null, tags: [],
})
const sample = (score: number, hours: HourSample[], over: { loc?: string; day?: number } = {}): WindowSample => ({ window: win(score, over), hours })
/** A one-hour member whose hour has `cond`. */
const one = (cond: HourConditions, score = 50, over: { loc?: string; day?: number } = {}) => sample(score, [hour(AT, score, cond)], over)
const many = (n: number, cond: HourConditions, over: (i: number) => { loc?: string; day?: number } = () => ({})) =>
  Array.from({ length: n }, (_, i) => one(cond, 50, over(i)))
/** Baseline windows spread over distinct days, so they count as independent. */
const baseOn = (n: number, cond: HourConditions) => many(n, cond, (i) => ({ day: Date.UTC(2026, 6, 1) + i * DAY }))

describe('dominant', () => {
  it('is the category covering most hours with data', () => {
    expect(dominant([hour(1, 0, { cloud: 'clear' }), hour(2, 0, { cloud: 'overcast' }), hour(3, 0, { cloud: 'overcast' })], 'cloud')).toBe('overcast')
  })
  it('gives a tie to the category of the earliest hour', () => {
    expect(dominant([hour(3, 0, { cloud: 'clear' }), hour(1, 0, { cloud: 'overcast' })], 'cloud')).toBe('overcast')
  })
  it('is null when no hour has data', () => {
    expect(dominant([hour(1, 0, { cloud: null }), hour(2, 0, {})], 'cloud')).toBeNull()
  })
})

describe('summariseGroup', () => {
  it('lists scores but claims no mean below MIN_N', () => {
    const s = summariseGroup([71, 58, 64, 49].map((v) => sample(v, [hour(AT, v)])))
    expect(s).toMatchObject({ n: 4, scores: [49, 58, 64, 71], mean: null, goodShare: null })
  })

  /** One number per entry: the card's score, not the mean of its clamped hours. */
  it('averages the scores the cards show, and takes good hours from the hours', () => {
    const fourHours = sample(52, [50, 60, 70, 80].map((v, i) => hour(AT + i * H, v)))
    const s = summariseGroup([fourHours, ...[40, 50, 60, 70].map((v) => sample(v, [hour(AT, v)]))])
    expect(s.n).toBe(MIN_N)
    expect(s.mean).toBeCloseTo((52 + 40 + 50 + 60 + 70) / 5)
    expect(s.goodShare).toBeCloseTo((0.5 + 0 + 0 + 0 + 1) / 5)
  })
})

describe('catchTrips', () => {
  /** Five fish on one morning are one trip with a catch, not five. */
  it('makes one member of the catches from one outing, with their distinct hours', () => {
    const c = (at: number, score: number) => sample(score, [hour(at, score, { tod: 'dawn' })])
    const trips = catchTrips([
      { key: 'a', sample: c(AT, 60) }, { key: 'a', sample: c(AT, 60) }, { key: 'a', sample: c(AT + H, 70) },
      { key: 'b', sample: c(AT, 40) },
    ])
    expect(trips).toHaveLength(2)
    expect(trips[0].hours.map((h) => h.at)).toEqual([AT, AT + H])
    expect(trips[0].window.score).toBe(65)
    expect(trips[1].window.score).toBe(40)
  })
})

describe('conditionTable', () => {
  const rowOf = (rows: ReturnType<typeof conditionTable>, f: FactorId) => rows.find((r) => r.factor === f)!
  const cellOf = (rows: ReturnType<typeof conditionTable>, f: FactorId, cat: string) => rowOf(rows, f).cats.find((c) => c.cat === cat)!.cells

  it('counts members by their category, out of those with data', () => {
    const rows = conditionTable({ catch: [one({ cloud: 'clear' }), one({ cloud: 'clear' }), one({ cloud: 'overcast' })], empty: [], base: [] })
    expect(cellOf(rows, 'cloud', 'clear').catch).toMatchObject({ k: 2, nf: 3 })
    expect(cellDisplay(cellOf(rows, 'cloud', 'clear').catch, 'catch')).toEqual({ pct: null, k: 2, n: 3, hours: false })
  })

  it('shows a percentage only from MIN_N members with data — always for your windows', () => {
    const rows = conditionTable({ catch: many(MIN_N, { cloud: 'clear' }), empty: [], base: baseOn(2, { cloud: 'clear' }) })
    expect(cellDisplay(cellOf(rows, 'cloud', 'clear').catch, 'catch').pct).toBe(100)
    expect(cellDisplay(cellOf(rows, 'cloud', 'clear').base, 'base').pct).toBe(100)
  })

  it("says how many have data when some don't", () => {
    const rows = conditionTable({ catch: [one({ wave: 'w1' }), one({ wave: null })], empty: [one({ wave: 'w0' })], base: [] })
    expect(rowOf(rows, 'wave').dataNote).toEqual({ k: 2, n: 3 })
    expect(rowOf(rows, 'wave').cats.find((c) => c.cat === 'w1')!.cells.catch).toMatchObject({ k: 1, nf: 1 })
  })

  it('hides a factor nobody has data for (sea temperature, before it exists)', () => {
    expect(rowOf(conditionTable({ catch: [one({ cloud: 'clear' })], empty: [], base: [] }), 'sst')).toBeUndefined()
  })

  /** A catch is one hour, a window many: for fast-changing factors each hour counts, not the majority. */
  it('splits a member across its hours for the time of day', () => {
    const day10h = sample(50, [hour(AT, 50, { tod: 'dawn' }), ...Array.from({ length: 9 }, (_, i) => hour(AT + (i + 1) * H, 50, { tod: 'day' }))])
    const rows = conditionTable({ catch: [], empty: [], base: [day10h] })
    expect(cellOf(rows, 'tod', 'dawn').base.share).toBeCloseTo(0.1)
    expect(cellOf(rows, 'tod', 'day').base.share).toBeCloseTo(0.9)
  })

  /** Rounded member-weights read "1 af 2" for a quarter of one trip; hours are whole. */
  it('shows an hour-weighted factor in hours while there are few members', () => {
    const trip = (cats: string[]) => sample(50, cats.map((c, i) => hour(AT + i * H, 50, { tod: c })))
    const rows = conditionTable({ catch: [], empty: [trip(['night', 'dawn', 'dawn', 'dawn']), trip(['dusk', 'dusk', 'dusk', 'night'])], base: [] })
    expect(cellDisplay(cellOf(rows, 'tod', 'night').empty, 'empty')).toEqual({ pct: null, k: 2, n: 8, hours: true })
    expect(cellOf(rows, 'tod', 'night').empty.share).toBeCloseTo(0.25)
  })

  describe('highlights', () => {
    const groupsWith = (n: number, kA: number, kB: number, f: HourConditions = { cloud: 'clear' }, other: HourConditions = { cloud: 'overcast' }) => ({
      catch: [...many(kA, f), ...many(n - kA, other)],
      empty: [...many(kB, f), ...many(n - kB, other)],
      base: [],
    })

    it('needs HIGHLIGHT_N members with data in each logged group', () => {
      expect(highlights(conditionTable(groupsWith(HIGHLIGHT_N - 1, HIGHLIGHT_N - 1, 0)))).toEqual([])
      expect(highlights(conditionTable(groupsWith(HIGHLIGHT_N, HIGHLIGHT_N, 0)))).toHaveLength(1)
    })

    /** With 10 + 10, a 50-point gap is still within 2.5 standard errors. */
    it('needs the gap to clear 2.5 standard errors', () => {
      expect(highlights(conditionTable(groupsWith(10, 7, 2)))).toEqual([])
      expect(highlights(conditionTable(groupsWith(10, 8, 2)))).toHaveLength(1)
    })

    it('needs at least 25 points however large the groups', () => {
      expect(highlights(conditionTable(groupsWith(200, 100, 52)))).toEqual([]) // 24 points
      expect(highlights(conditionTable(groupsWith(200, 100, 50)))).toHaveLength(1) // 25 points
    })

    it('counts your windows by their distinct days', () => {
      const catches = many(20, { cloud: 'clear' })
      // 40 windows, every one overcast, but on only 4 days: 4 samples, below MIN_N.
      const fewDays = many(40, { cloud: 'overcast' }, (i) => ({ day: Date.UTC(2026, 6, 1) + (i % 4) * DAY }))
      expect(distinctDays(fewDays)).toBe(4)
      expect(highlights(conditionTable({ catch: catches, empty: [], base: fewDays }))).toEqual([])
      const h = highlights(conditionTable({ catch: catches, empty: [], base: baseOn(40, { cloud: 'overcast' }) }))
      expect(h).toMatchObject([{ factor: 'cloud', vs: 'base' }])
    })

    it('prefers catch vs no catch over catch vs your windows, one per factor', () => {
      const g = { ...groupsWith(20, 20, 2), base: baseOn(40, { cloud: 'overcast' }) }
      const rows = conditionTable(g)
      expect(rows.find((r) => r.factor === 'cloud')!.highlight).toMatchObject({ vs: 'empty', cat: 'clear' })
      expect(highlights(rows)).toHaveLength(1)
    })

    it('says at most three, largest difference first', () => {
      const catchCond = { cloud: 'clear', wind: 'light', press: 'rising', wave: 'w0' }
      const emptyCond = (i: number): HourConditions => ({
        cloud: 'overcast',
        wind: i < 5 ? 'light' : 'strong',
        press: i < 2 ? 'rising' : 'falling',
        wave: i < 8 ? 'w0' : 'w3',
      })
      const g = { catch: many(30, catchCond), empty: Array.from({ length: 30 }, (_, i) => one(emptyCond(i))), base: [] }
      expect(highlights(conditionTable(g)).map((h) => h.factor)).toEqual(['cloud', 'press', 'wind'])
    })
  })
})

describe('modelPointsTable', () => {
  const bd = (key: string, points: number): BreakdownItem => ({ icon: '•', factor: key, label: '', points, key })

  it('lists every factor the model scored, by key — including one it gains later', () => {
    const s = sample(50, [hour(AT, 50, {}, [bd('bd_base', 20), bd('bd_future', 4), bd('bd_ceiling', -3), bd('bd_floor', 2)])])
    expect(modelPointsTable({ catch: [s], empty: [], base: [] }).map((r) => r.key)).toEqual(['bd_future'])
  })

  it('counts a missing row as 0 points, and hides rows that are 0 everywhere', () => {
    const a = sample(50, [hour(AT, 50, {}, [bd('bd_wind', 6)]), hour(AT + H, 50, {}, [])])
    const b = sample(50, [hour(AT, 50, {}, [bd('bd_wind', 0), bd('bd_cloud', 0)])])
    const rows = modelPointsTable({ catch: [a, b], empty: [], base: [] })
    expect(rows.map((r) => r.key)).toEqual(['bd_wind'])
    expect(rows[0].values).toEqual({ catch: 1.5, empty: null, base: null })
  })

  /** DMI keeps tides for this year only: last year's entries have no tide row, which isn't 0 points. */
  it('averages the tide points only over hours that had tide data', () => {
    const thisYear = sample(50, [hour(AT, 50, { tide: 'rising' }, [bd('bd_tide', 12)])])
    const lastYear = sample(50, [hour(AT, 50, { tide: null }, [])])
    expect(modelPointsTable({ catch: [thisYear, lastYear], empty: [], base: [] })[0].values.catch).toBe(12)
  })
})

describe('verdict', () => {
  const g = (scores: number[], spread = 0) => scores.map((v, i) => sample(v + (i % 2 ? spread : -spread), [hour(AT, v)]))
  const flat = (n: number, v: number) => g(Array(n).fill(v))
  const keys = (s: ReturnType<typeof verdict>) => s.map((x) => x.key)
  const base = baseOn(30, {})

  it('says nothing but "too few" below MIN_N in both', () => {
    expect(keys(verdict({ catch: flat(4, 60), empty: flat(4, 50), base }))).toEqual(['insight_thin'])
  })
  it('compares catches with your windows while there are too few empty trips', () => {
    const v = verdict({ catch: flat(5, 60), empty: flat(4, 50), base })
    expect(keys(v)).toEqual(['insight_vs_base', 'insight_caveat_one', 'insight_need_empty'])
    expect(v[0].params).toEqual({ f: 60, b: 50 })
  })
  it('only states the catch mean without windows to compare with', () => {
    expect(keys(verdict({ catch: flat(5, 60), empty: [], base: [] }))).toEqual(['insight_catch_mean', 'insight_need_empty'])
  })
  it('has nothing to compare empty trips with below MIN_N catches', () => {
    expect(keys(verdict({ catch: flat(4, 60), empty: flat(5, 50), base }))).toEqual(['insight_thin_catch'])
  })

  it('says the model separates them from 8 points (with no spread)', () => {
    expect(keys(verdict({ catch: flat(5, 58), empty: flat(5, 50), base }))).toEqual(['insight_both', 'insight_sep_yes', 'insight_caveat_small'])
    expect(keys(verdict({ catch: flat(5, 57.9), empty: flat(5, 50), base }))[1]).toBe('insight_sep_no')
    expect(keys(verdict({ catch: flat(5, 50), empty: flat(5, 58), base }))[1]).toBe('insight_sep_rev')
  })

  /** 5 + 5 scores spread by ±20: a 10-point gap is well inside the noise. */
  it('needs twice the standard error of the difference too', () => {
    const v = verdict({ catch: g(Array(5).fill(60), 20), empty: g(Array(5).fill(50), 20), base })
    expect(keys(v)[1]).toBe('insight_sep_no')
  })

  it('softens the caveat from SOLID_N, and never follows "no clear difference" with "a pattern"', () => {
    expect(keys(verdict({ catch: flat(SOLID_N - 1, 60), empty: flat(SOLID_N, 50), base })).at(-1)).toBe('insight_caveat_small')
    expect(keys(verdict({ catch: flat(SOLID_N, 60), empty: flat(SOLID_N, 50), base })).at(-1)).toBe('insight_caveat_mid')
    expect(keys(verdict({ catch: flat(SOLID_N, 50), empty: flat(SOLID_N, 50), base }))).toEqual(['insight_both', 'insight_sep_no'])
  })

  it('notes a thin baseline — fewer than 10 distinct days', () => {
    const few = baseOn(9, {})
    expect(keys(verdict({ catch: flat(5, 58), empty: flat(5, 50), base: few })).at(-1)).toBe('insight_base_few')
    expect(keys(verdict({ catch: flat(5, 58), empty: flat(5, 50), base: baseOn(10, {}) }))).not.toContain('insight_base_few')
  })

  it('leaves your windows out of the sentence while there are too few of them', () => {
    expect(verdict({ catch: flat(5, 58), empty: flat(5, 50), base: baseOn(4, {}) })[0].key).toBe('insight_both_nobase')
  })
})

describe('baselineWindows', () => {
  const MON = Date.UTC(2026, 8, 7) // Monday 7 Sep 2026, in the app's day encoding
  const av = (days: number[], from: string, to: string, methods: Availability['methods'] = ['shore']): Availability => ({ id: from + to, days, from, to, methods })
  const LATER = new Date(2026, 9, 1).getTime()
  const fmt = (ws: ReturnType<typeof baselineWindows>) => ws.map((w) => `${new Date(w.day).toISOString().slice(5, 10)} ${w.from}-${w.to} ${w.methods.join('+')}`)

  it("takes the weekday from the day's encoding, and merges same-hours rows with their methods", () => {
    const ws = baselineWindows([{ locId: 'l1', day: MON }], [av([1], '06:00', '09:00'), av([1, 2], '06:00', '09:00', ['boat']), av([2], '17:00', '20:00')], LATER, { padDays: 0 })
    expect(fmt(ws)).toEqual(['09-07 06:00-09:00 shore+boat'])
  })

  it('drops invalid rows and keeps an overnight window on the day it starts', () => {
    const ws = baselineWindows([{ locId: 'l1', day: MON }], [av([1], '05:00', '05:00'), av([1], '22:00', '02:00')], LATER, { padDays: 0 })
    expect(fmt(ws)).toEqual(['09-07 22:00-02:00 shore'])
  })

  it('drops windows that have not ended yet', () => {
    const now = new Date(2026, 8, 7, 8).getTime() // Monday 08:00
    const ws = baselineWindows([{ locId: 'l1', day: MON }], [av([1], '05:00', '07:00'), av([1], '06:00', '10:00'), av([0], '22:00', '02:00')], now, { padDays: 7 })
    // A week back both Monday windows are over; today the 06–10 one is still running.
    expect(fmt(ws)).toEqual(['08-31 05:00-07:00 shore', '08-31 06:00-10:00 shore', '09-06 22:00-02:00 shore', '09-07 05:00-07:00 shore'])
  })

  it('covers ±7 days around each entry at its spot, once', () => {
    const every = [av([0, 1, 2, 3, 4, 5, 6], '06:00', '08:00')]
    const ws = baselineWindows([{ locId: 'l1', day: MON }, { locId: 'l1', day: MON + 5 * DAY }, { locId: 'l2', day: MON }], every, LATER)
    expect(ws.filter((w) => w.locId === 'l1')).toHaveLength(20) // 31 Aug … 19 Sep
    expect(new Set(ws.map((w) => `${w.locId}|${w.day}`)).size).toBe(ws.length)
    expect(ws.filter((w) => w.locId === 'l2')).toHaveLength(15)
  })

  it('stops at the oldest day scored', () => {
    const ws = baselineWindows([{ locId: 'l1', day: MON }], [av([0, 1, 2, 3, 4, 5, 6], '06:00', '08:00')], LATER, { oldestDay: MON - 2 * DAY })
    expect(ws).toHaveLength(10)
  })
})

describe('the insight strings', () => {
  /**
   * The panel shows t(key) for keys these maps and verdict() hand it; t()
   * renders a missing key as its name, and strings.test.ts only sees keys
   * passed to t() directly.
   */
  it('exist in both languages for every factor, category and verdict', () => {
    const keys = [...Object.values(FACTOR_LABEL_KEY), ...Object.values(CAT_LABEL_KEY).flatMap((m) => Object.values(m)), ...VERDICT_KEYS]
    expect(keys.flatMap((k) => ['da', 'en'].filter((l) => !STRINGS[l][k]).map((l) => `${l}.${k}`))).toEqual([])
  })
})
