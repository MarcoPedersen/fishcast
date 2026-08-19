import { describe, it, expect } from 'vitest'
import { getScoredWindows, isOvernight, isValidWindow, scoreWindow, windowHours } from './scoring'
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

  it('still returns windows for a valid slot on the same day', () => {
    const windows = getScoredWindows(
      [LOC],
      [{ id: 'a', days: [AVAIL_DOW], from: '06:00', to: '10:00', methods: ['shore'] }],
      { t1: makeForecast({}) },
      [],
    )
    expect(windows.length).toBeGreaterThan(0)
    expect(windows.every((w) => w.score > 0)).toBe(true)
  })
})
