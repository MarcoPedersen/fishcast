import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { canScoreCatch, catchPlaceName, findCatchLocation, linkCatchLocation, scoreBlocker } from './catchScore'

// The fixture date must stay inside the 92-day weather window, whenever the
// suite runs — otherwise every case below turns into 'old'.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-01T12:00:00')) })
afterEach(() => { vi.useRealTimers() })
import type { CatchEntry, Location } from './types'

const LOCS: Location[] = [
  { id: 'l1', name: 'Sydmolen', lat: 55.59, lon: 12.68 },
  { id: 'l2', name: 'Nordmolen', lat: 55.25, lon: 14.83 },
]
const entry = (over: Partial<CatchEntry> = {}): CatchEntry => ({
  id: 'c1', date: '2026-08-22', time: '19:00', speciesId: 'havørred',
  locationName: 'Sydmolen', ...over,
})

describe('catch bite-score preconditions', () => {
  it('scores a catch at a saved location with a time', () => {
    expect(canScoreCatch(entry(), LOCS)).toBe(true)
    expect(scoreBlocker(entry(), LOCS)).toBeNull()
  })

  /**
   * The location field is free text with a datalist, so an exact string compare
   * silently dropped the score for anything typed slightly differently.
   */
  it('matches a saved location despite case and stray whitespace', () => {
    expect(findCatchLocation(entry({ locationName: '  sydMOLEN ' }), LOCS)?.id).toBe('l1')
    expect(canScoreCatch(entry({ locationName: 'SYDMOLEN' }), LOCS)).toBe(true)
  })

  it('does not match a different place', () => {
    expect(findCatchLocation(entry({ locationName: 'Dragør' }), LOCS)).toBeUndefined()
    expect(scoreBlocker(entry({ locationName: 'Dragør' }), LOCS)).toBe('location')
  })

  it('reports which piece is missing, so the UI can explain', () => {
    expect(scoreBlocker(entry({ time: undefined }), LOCS)).toBe('time')
    expect(scoreBlocker(entry({ time: '' }), LOCS)).toBe('time')
    expect(scoreBlocker(entry({ locationName: '' }), LOCS)).toBe('location')
    expect(scoreBlocker(entry({ locationName: 'Nowhere' }), LOCS)).toBe('location')
  })

  it('treats an empty location name as unmatched rather than matching anything', () => {
    expect(findCatchLocation(entry({ locationName: '   ' }), LOCS)).toBeUndefined()
  })
})

/**
 * Catches used to link to their spot by NAME only, so a spot renamed on one
 * device detached every catch the other device logged there until the
 * rename's rewrite reached that log — and a merge could bring back an entry
 * still carrying the old name. A catch now also carries the spot's id.
 */
describe('findCatchLocation — by id', () => {
  it('follows the id when the stored name is out of date (renamed on another device)', () => {
    expect(findCatchLocation(entry({ locationId: 'l1', locationName: 'Strandvejen' }), LOCS)?.id).toBe('l1')
    expect(scoreBlocker(entry({ locationId: 'l1', locationName: 'Strandvejen' }), LOCS)).toBeNull()
  })

  it('prefers the id over a name that now belongs to another spot', () => {
    expect(findCatchLocation(entry({ locationId: 'l2', locationName: 'Sydmolen' }), LOCS)?.id).toBe('l2')
  })

  it('falls back to the name when the linked spot is gone', () => {
    expect(findCatchLocation(entry({ locationId: 'deleted', locationName: 'Nordmolen' }), LOCS)?.id).toBe('l2')
    expect(findCatchLocation(entry({ locationId: 'deleted', locationName: 'Nowhere' }), LOCS)).toBeUndefined()
  })
})

describe('linkCatchLocation (saving the form)', () => {
  it('links the saved spot the typed name matches, by the same rule', () => {
    expect(linkCatchLocation(' sydMOLEN', LOCS)).toBe('l1')
    expect(linkCatchLocation('Somewhere else', LOCS)).toBeUndefined()
    expect(linkCatchLocation('', LOCS)).toBeUndefined()
  })

  it('follows a name changed while editing', () => {
    expect(linkCatchLocation('Nordmolen', LOCS, entry({ locationId: 'l1', locationName: 'Sydmolen' }))).toBe('l2')
    expect(linkCatchLocation('Free text', LOCS, entry({ locationId: 'l1', locationName: 'Sydmolen' }))).toBeUndefined()
  })

  it('keeps the link of an edited entry whose name was left alone, however out of date', () => {
    // The spot was renamed on the phone; this device's copy of the catch still says the old name.
    expect(linkCatchLocation('Strandvejen', LOCS, entry({ locationId: 'l1', locationName: 'Strandvejen' }))).toBe('l1')
    // …and keeps it even when that old name now matches a different spot.
    expect(linkCatchLocation('Nordmolen', LOCS, entry({ locationId: 'l1', locationName: 'Nordmolen' }))).toBe('l1')
  })

  it('does not keep a link to a spot that is gone', () => {
    expect(linkCatchLocation('Strandvejen', LOCS, entry({ locationId: 'deleted', locationName: 'Strandvejen' }))).toBeUndefined()
  })

  // The edit form opens on the linked spot's CURRENT name (catchPlaceName).
  // Re-resolved by that name, the link went to the first spot of that name —
  // not necessarily this catch's — just for opening and saving the entry.
  it("keeps the link when the field shows the linked spot's current name, even one another spot shares", () => {
    const twins = [...LOCS, { id: 'l3', name: 'Sydmolen', lat: 55.6, lon: 12.69 }]
    expect(linkCatchLocation('Sydmolen', twins, entry({ locationId: 'l3', locationName: 'Strandvejen' }))).toBe('l3')
  })
})

/**
 * A catch logged offline under a spot's old name, after another device
 * renamed it, is linked to the spot by id but kept its old name: the rename's
 * rewrite of the log ran before that catch existed. The list said "📍
 * Strandvejen" for a catch that scores at "Sydmolen".
 */
describe('catchPlaceName (what a catch shows as its place)', () => {
  it("shows the linked spot's current name when the stored one is out of date", () => {
    expect(catchPlaceName(entry({ locationId: 'l1', locationName: 'Strandvejen' }), LOCS)).toBe('Sydmolen')
  })

  it('shows the stored text for free text, a name-only link, and a link to a spot that is gone', () => {
    expect(catchPlaceName(entry({ locationName: 'Ved broen' }), LOCS)).toBe('Ved broen')
    expect(catchPlaceName(entry({ locationName: 'sydMOLEN' }), LOCS)).toBe('sydMOLEN')
    expect(catchPlaceName(entry({ locationId: 'deleted', locationName: 'Strandvejen' }), LOCS)).toBe('Strandvejen')
    expect(catchPlaceName(entry({ locationName: '' }), LOCS)).toBe('')
  })
})

// ═══ Empty trips, entry windows and hour samples ═══════════════════════
import {
  MAX_SCORE_AGE_DAYS, bestMethod, catchesInside, entryWindow, isEmptyTrip, sampleWindow, scoreEntry, spotKey, tripSlot, tripsContaining,
} from './catchScore'
import { scoreWindow } from './scoring'
import type { FishingMethod, Forecast, HourData } from './types'

const DAY_MS = 86400000
const trip = (over: Partial<CatchEntry> = {}): CatchEntry => ({
  id: 't1', outcome: 'empty', date: '2026-08-22', from: '06:00', to: '09:30', speciesId: '', count: 0,
  locationName: 'Sydmolen', ...over,
})
const day = (iso: string) => Date.parse(iso + 'T00:00:00Z')

describe('isEmptyTrip', () => {
  it('is the outcome alone — not the count or the species', () => {
    expect(isEmptyTrip(trip())).toBe(true)
    expect(isEmptyTrip(entry())).toBe(false)
    expect(isEmptyTrip(entry({ count: 0, speciesId: '' }))).toBe(false)
    expect(isEmptyTrip(trip({ count: undefined }))).toBe(true) // an old build cleared the count
  })
})

describe('entryWindow', () => {
  /**
   * A catch was scored as h:00–(h+1):00, two hours averaged with the minutes
   * dropped: 07:50 counted 07:00 and 08:00 alike. Now it is the nearest
   * whole hour, as the one-hour window HH:00–HH:30.
   */
  it('scores a catch at its nearest whole hour', () => {
    const w = (time: string) => entryWindow(entry({ time }))
    expect(w('07:29')).toEqual({ day: day('2026-08-22'), from: '07:00', to: '07:30' })
    expect(w('07:30')).toMatchObject({ from: '08:00', to: '08:30' })
    expect(w('23:45')).toMatchObject({ from: '23:00', to: '23:30' })
  })

  it('scores a trip over its span, past midnight too', () => {
    expect(entryWindow(trip())).toEqual({ day: day('2026-08-22'), from: '06:00', to: '09:30' })
    expect(entryWindow(trip({ from: '22:00', to: '02:00' }))).toMatchObject({ from: '22:00', to: '02:00' })
  })

  it('has no window for a trip without a valid span', () => {
    expect(entryWindow(trip({ to: '06:00' }))).toBeNull()
    expect(entryWindow(trip({ from: undefined }))).toBeNull()
    expect(entryWindow(entry({ time: undefined }))).toBeNull()
  })
})

describe('scoreBlocker — trips', () => {
  it('says what a trip lacks', () => {
    expect(scoreBlocker(trip(), LOCS)).toBeNull()
    expect(canScoreCatch(trip(), LOCS)).toBe(true)
    expect(scoreBlocker(trip({ to: undefined }), LOCS)).toBe('time')
    expect(scoreBlocker(trip({ locationName: 'Ved broen' }), LOCS)).toBe('location')
  })

  /** The archive reaches back to 2022; the app scores the last two years. */
  it('is old only past MAX_SCORE_AGE_DAYS', () => {
    const ago = (n: number) => new Date(Date.UTC(2026, 8, 1) - n * DAY_MS).toISOString().slice(0, 10)
    expect(MAX_SCORE_AGE_DAYS).toBe(730)
    expect(scoreBlocker(entry({ date: ago(730) }), LOCS)).toBeNull()
    expect(scoreBlocker(entry({ date: ago(731) }), LOCS)).toBe('old')
    expect(scoreBlocker(trip({ date: ago(731) }), LOCS)).toBe('old')
  })
})

// A forecast of hourly rows on LOCAL hours from local midnight of `iso`, like scoring.test.ts builds one.
function forecast(iso: string, hours = 48, missing: number[] = [], waveM: number | null = null): Forecast {
  const [y, m, d] = iso.split('-').map(Number)
  const hourly: HourData[] = []
  for (let h = -6; h < hours; h++) {
    if (missing.includes(h)) continue
    hourly.push({ time: new Date(y, m - 1, d, h).getTime(), temp: 12, windMs: 2 + (h % 5), windDir: 270, gustMs: 6, cloud: (h * 13) % 100, precipPct: 0, pressure: 1010 + (h % 7) })
  }
  const marine = waveM == null ? null : hourly.map((r) => ({ time: r.time, waveM, wavePeriod: 3 }))
  return { fetched: 0, hourly, marine, tides: null }
}
const LOC = LOCS[0]

describe('sampleWindow', () => {
  it("is the window's own score, plus one sample per hour", () => {
    const f = forecast('2026-08-22')
    const s = sampleWindow(LOC, day('2026-08-22'), '06:00', '09:30', f, ['havørred'], 'shore')!
    expect(s.window.score).toBe(scoreWindow(LOC, new Date(day('2026-08-22')), '06:00', '09:30', f, ['havørred'], 'shore').score)
    expect(s.hours.map((h) => new Date(h.at).getHours())).toEqual([6, 7, 8, 9])
    expect(s.hours[1].score).toBe(scoreWindow(LOC, new Date(day('2026-08-22')), '07:00', '07:30', f, ['havørred'], 'shore').score)
    expect(s.hours[0].cond.cloud).toBeDefined()
  })

  it('puts the hours after midnight on the next day', () => {
    const s = sampleWindow(LOC, day('2026-08-22'), '22:00', '03:00', forecast('2026-08-22'), [], 'shore')!
    expect(s.hours.map((h) => new Date(h.at).toString().slice(4, 18))).toEqual(['Aug 22 2026 22', 'Aug 22 2026 23', 'Aug 23 2026 00', 'Aug 23 2026 01', 'Aug 23 2026 02'])
  })

  // On 25 Oct 2026 02:00 comes twice. Each sample is its own real hour, read
  // from its own row: re-deriving "02:00–02:30" hit the first one both times.
  it('samples both 02:00 hours of the autumn night, each with its own weather', () => {
    const from = Date.UTC(2026, 9, 24, 0)
    const f: Forecast = {
      fetched: 0, marine: null, tides: null,
      hourly: Array.from({ length: 48 }, (_, i) => ({
        time: from + i * 3600000, temp: 12, windMs: i === 25 ? 2 : 16, windDir: 270, gustMs: 18, cloud: 40, precipPct: 0, pressure: 1013,
      })),
    }
    const s = sampleWindow(LOC, day('2026-10-24'), '22:00', '04:00', f, [], 'shore')!
    expect(s.hours.map((h) => new Date(h.at).toISOString().slice(11, 13))).toEqual(['20', '21', '22', '23', '00', '01', '02'])
    const [first, second] = s.hours.slice(4, 6)
    expect(second.score).toBeGreaterThan(first.score) // calm only at 01:00Z, the second 02:00
  })

  it('drops hours with no data, and is null when none is left', () => {
    const s = sampleWindow(LOC, day('2026-08-22'), '06:00', '10:00', forecast('2026-08-22', 48, [7, 8]), [], 'shore')!
    expect(s.hours.map((h) => new Date(h.at).getHours())).toEqual([6, 9])
    expect(sampleWindow(LOC, day('2026-08-22'), '06:00', '10:00', forecast('2026-08-22', 48, [6, 7, 8, 9]), [], 'shore')).toBeNull()
  })

  /** The spot's coast (onshore spec §2.7): a catch is scored as its card would be, window and hours. */
  it('scores the window and every hour against the coast it is given', () => {
    const f = forecast('2026-08-22') // 2–6 m/s from the west
    const WEST = { mode: 'manual' as const, facing: 270, spread: 180 as const, exposure: 'open' as const, fetchKm: null }
    const s = sampleWindow(LOC, day('2026-08-22'), '06:00', '09:30', f, ['havørred'], 'shore', WEST)!
    expect(s.window.breakdown!.some((b) => b.key === 'bd_shorewind')).toBe(true)
    expect(s.window.score).toBe(scoreWindow(LOC, new Date(day('2026-08-22')), '06:00', '09:30', f, ['havørred'], 'shore', WEST).score)
    expect(s.hours.some((h) => h.breakdown.some((b) => b.key === 'bd_shorewind'))).toBe(true)
    const m = bestMethod(LOC, day('2026-08-22'), '06:00', '09:00', ['waders', 'shore'], forecast('2026-08-22', 48, [], 0.5), ['havørred'], WEST)
    expect(['waders', 'shore']).toContain(m)
  })

  /** The dashboard's species, not the catch's: the old mismatch moved scores by about 17 points. */
  it('scores with the targets it is given', () => {
    const f = forecast('2026-08-22')
    const s = sampleWindow(LOC, day('2026-08-22'), '07:00', '07:30', f, ['makrel'], 'shore')!
    expect(s.window.score).toBe(scoreWindow(LOC, new Date(day('2026-08-22')), '07:00', '07:30', f, ['makrel'], 'shore').score)
  })
})

describe('bestMethod', () => {
  /** As on the dashboard: a slot allowing several methods is scored by its best. */
  it('picks the method that scores best where the waves make them differ', () => {
    const f = forecast('2026-08-22', 48, [], 1.2) // a boat in 1.2 m: −8; waders: −12; shore: 0
    expect(bestMethod(LOC, day('2026-08-22'), '06:00', '09:00', ['waders', 'boat', 'shore'], f, [])).toBe('shore')
    expect(bestMethod(LOC, day('2026-08-22'), '06:00', '09:00', ['waders', 'boat'], f, [])).toBe('boat')
    // Without marine data every method scores alike: the first is kept.
    expect(bestMethod(LOC, day('2026-08-22'), '06:00', '09:00', ['waders', 'boat'], forecast('2026-08-22'), [])).toBe('waders')
  })
})

describe('a catch inside an empty trip', () => {
  const log = (...es: CatchEntry[]) => es

  it('matches the same spot and date, from start to end inclusive', () => {
    const t = trip()
    for (const time of ['06:00', '07:45', '09:30']) expect(tripsContaining(entry({ time }), log(t), LOCS)).toEqual([t])
    for (const time of ['05:59', '09:31']) expect(tripsContaining(entry({ time }), log(t), LOCS)).toEqual([])
    expect(catchesInside(t, log(entry({ time: '07:00' }), entry({ id: 'c2', time: '12:00' })), LOCS).map((e) => e.id)).toEqual(['c1'])
  })

  it('goes past midnight with an overnight trip', () => {
    const t = trip({ from: '22:00', to: '02:00' })
    expect(tripsContaining(entry({ time: '23:10' }), log(t), LOCS)).toEqual([t])
    expect(tripsContaining(entry({ date: '2026-08-23', time: '01:30' }), log(t), LOCS)).toEqual([t])
    expect(tripsContaining(entry({ date: '2026-08-23', time: '03:00' }), log(t), LOCS)).toEqual([])
  })

  it('needs the same spot: by its saved id, else by the typed name', () => {
    const t = trip()
    expect(tripsContaining(entry({ time: '07:00', locationName: 'Nordmolen' }), log(t), LOCS)).toEqual([])
    expect(tripsContaining(entry({ time: '07:00', locationName: 'Strandvejen', locationId: 'l1' }), log(t), LOCS)).toEqual([t])
    const free = trip({ locationName: 'Ved broen' })
    expect(tripsContaining(entry({ time: '07:00', locationName: ' ved BROEN' }), log(free), LOCS)).toEqual([free])
    expect(spotKey(entry({ locationName: '' }), LOCS)).toBeNull()
  })
})

describe('scoreEntry — the archive path', () => {
  // Answers built from what each request asks for (see history.test.ts).
  function hourlyFor(url: URL) {
    const time: string[] = []
    for (let t = Date.parse(url.searchParams.get('start_date') + 'T00:00Z'); t <= Date.parse(url.searchParams.get('end_date') + 'T23:00Z'); t += 3600000) time.push(new Date(t).toISOString().slice(0, 16))
    const n = (v: number) => time.map(() => v)
    return { hourly: { time, temperature_2m: n(12), wind_speed_10m: n(3), wind_direction_10m: n(270), wind_gusts_10m: n(5), cloud_cover: n(40), precipitation_probability: n(0), surface_pressure: n(1013) } }
  }
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (raw: string) => {
      const url = new URL(raw)
      if (url.host.startsWith('historical-forecast-api')) return { ok: true, json: async () => hourlyFor(url) }
      return { ok: false, status: 404, json: async () => ({}) }
    }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  /**
   * The catch day is the LOCAL date: at 00:50 in Denmark a catch dated today
   * was a day in the future by the UTC date, and came back "no data" — every
   * night-time catch.
   */
  it('scores a catch made just after local midnight', async () => {
    vi.setSystemTime(new Date('2026-10-01T00:50:00+02:00'))
    const s = await scoreEntry(entry({ date: '2026-10-01', time: '00:30' }), LOCS, ['havørred'])
    expect(s?.hours).toHaveLength(1)
  })

  /** Past the forecast API's ~62 days the old path scored null hours as calm, clear and stable. */
  it('scores a catch 70 days old from complete archive weather', async () => {
    const s = await scoreEntry(entry({ date: '2026-06-23', time: '19:00' }), LOCS, ['havørred'])
    expect(s).not.toBeNull()
    const urls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('past_days'))).toBe(false)
  })

  it('scores a trip over its hours, and nothing that is blocked', async () => {
    expect((await scoreEntry(trip(), LOCS, []))!.hours).toHaveLength(4)
    expect(await scoreEntry(trip({ locationName: 'Ved broen' }), LOCS, [])).toBeNull()
  })
})

describe('tripSlot — the span a new empty trip is prefilled with', () => {
  const av = (days: number[], from: string, to: string, methods: FishingMethod[] = ['shore']) => ({ id: from + to + days.join(), days, from, to, methods })
  const at = (iso: string) => new Date(iso).getTime() // local wall-clock times (TZ is Copenhagen)
  // Saturday 22 Aug 2026.
  const SAT = 6

  it('takes the window being fished now, up to now', () => {
    expect(tripSlot([av([SAT], '06:00', '10:00')], at('2026-08-22T08:15:00'))).toEqual({ date: '2026-08-22', from: '06:00', to: '08:15', methods: ['shore'] })
  })

  it('takes a window that ended within the last 3 hours, whole', () => {
    expect(tripSlot([av([SAT], '06:00', '10:00')], at('2026-08-22T12:59:00'))).toMatchObject({ from: '06:00', to: '10:00' })
    expect(tripSlot([av([SAT], '06:00', '10:00')], at('2026-08-22T13:01:00'))).toBeNull()
    expect(tripSlot([av([SAT], '14:00', '18:00')], at('2026-08-22T12:00:00'))).toBeNull() // not started
  })

  it('prefers the latest when two qualify, and merges same-hours rows with their methods', () => {
    const s = tripSlot([av([SAT], '05:00', '08:00'), av([SAT], '09:00', '12:00'), av([SAT, 0], '09:00', '12:00', ['boat'])], at('2026-08-22T10:30:00'))
    expect(s).toEqual({ date: '2026-08-22', from: '09:00', to: '10:30', methods: ['shore', 'boat'] })
  })

  /** After midnight, last night's 22:00–02:00 is the trip — dated the day it started. */
  it('places an overnight window on the day it started', () => {
    expect(tripSlot([av([5], '22:00', '02:00')], at('2026-08-22T01:30:00'))).toEqual({ date: '2026-08-21', from: '22:00', to: '01:30', methods: ['shore'] })
    expect(tripSlot([av([5], '22:00', '02:00')], at('2026-08-22T04:00:00'))).toMatchObject({ date: '2026-08-21', to: '02:00' })
  })

  it('ignores invalid rows and rows for other days', () => {
    expect(tripSlot([av([SAT], '06:00', '06:00'), av([1], '06:00', '10:00')], at('2026-08-22T08:00:00'))).toBeNull()
  })
})

// ═══ The trip form's checks ════════════════════════════════════════════
import { catchesMaybeInside, fishlessOutings, overlappingTrips, tripFormIssues, tripOutings } from './catchScore'

describe('tripFormIssues — what stops a trip from being saved', () => {
  const at = (iso: string) => new Date(iso).getTime() // local wall-clock times
  const NOW = at('2026-08-22T12:00:00')
  const issues = (over: Partial<CatchEntry>, entries: CatchEntry[] = [], now = NOW) => tripFormIssues(trip({ id: '', ...over }), entries, LOCS, now)

  it('has nothing to say about a finished trip at a spot', () => {
    expect(issues({})).toEqual([])
  })

  it('needs a place and a date', () => {
    expect(issues({ locationName: '  ' })).toEqual(['location'])
    // A cleared date picker: stored as '', the trip could never be analysed.
    expect(issues({ date: '' })).toEqual(['date'])
  })

  /** "Start and end must differ" was shown for an emptied field too. */
  it('tells a missing time apart from equal times', () => {
    expect(issues({ from: '' })).toEqual(['times'])
    expect(issues({ to: '' })).toEqual(['times'])
    expect(issues({ to: '06:00' })).toEqual(['same'])
  })

  /**
   * The form's clock ticks once a minute, so it can be up to 59 s behind the
   * minute the prefill took as the end: at 10:02:10 against a tick at
   * 10:01:40, 08:02–10:02 read as ending in the future and Save stayed
   * disabled. An end inside the current minute is allowed.
   */
  it('allows an end in the current minute against a clock that ticked up to a minute ago', () => {
    const tick = at('2026-08-22T10:01:40')
    expect(issues({ from: '08:02', to: '10:02' }, [], tick)).toEqual([])
    expect(issues({ from: '08:02', to: '10:03' }, [], tick)).toEqual(['future'])
    expect(issues({ date: '2026-08-23', from: '06:00', to: '07:00' })).toEqual(['future'])
    // Overnight: ends tomorrow.
    expect(issues({ from: '22:00', to: '02:00' })).toEqual(['future'])
  })

  it('refuses a trip with a catch inside it', () => {
    expect(issues({}, [entry({ time: '07:00' })])).toEqual(['catch'])
  })

  /** Save twice and the second copy counted as a second trip without a catch. */
  it('refuses a trip overlapping another one at the same spot, but not itself', () => {
    const t1 = trip()
    expect(issues({}, [t1])).toEqual(['trip'])
    expect(issues({ id: 't1' }, [t1])).toEqual([]) // editing t1 itself
  })
})

describe('overlappingTrips', () => {
  const t1 = trip() // 06:00–09:30, Sydmolen, 22 Aug

  it('finds a trip at the same spot whose span overlaps', () => {
    expect(overlappingTrips(trip({ id: 'n', from: '08:00', to: '11:00' }), [t1], LOCS)).toEqual([t1])
    expect(overlappingTrips(trip({ id: 'n', from: '05:00', to: '06:30', locationName: 'sydMOLEN' }), [t1], LOCS)).toEqual([t1])
  })

  it('leaves out back-to-back spans, other spots, other days and catches', () => {
    expect(overlappingTrips(trip({ id: 'n', from: '09:30', to: '11:00' }), [t1], LOCS)).toEqual([])
    expect(overlappingTrips(trip({ id: 'n', locationName: 'Nordmolen' }), [t1], LOCS)).toEqual([])
    expect(overlappingTrips(trip({ id: 'n', date: '2026-08-23' }), [t1], LOCS)).toEqual([])
    expect(overlappingTrips(trip({ id: 'n' }), [entry({ time: '07:00' })], LOCS)).toEqual([])
  })

  it('goes past midnight with an overnight trip', () => {
    const night = trip({ id: 'n1', from: '22:00', to: '02:00' })
    expect(overlappingTrips(trip({ id: 'n', date: '2026-08-23', from: '01:00', to: '03:00' }), [night], LOCS)).toEqual([night])
    expect(overlappingTrips(trip({ id: 'n', date: '2026-08-23', from: '02:00', to: '03:00' }), [night], LOCS)).toEqual([])
  })
})

/**
 * The trip form judged the trip against every entry at every keystroke
 * (catchesInside, overlappingTrips): about 10 ms a keystroke at 300 entries
 * in node, several times that on a phone. Only entries at the trip's spot
 * within a day of its span can clash, so the form hands over just those.
 */
import { tripNeighbours } from './catchScore'

describe('tripNeighbours — the entries a trip form can clash with', () => {
  // Seeded, so every run checks the same "random" logs and forms.
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const NOW = new Date('2026-08-26T12:00:00').getTime()
  const p2 = (n: number) => String(n).padStart(2, '0')
  // Garbled clocks and dates a synced row can hold: the form never writes them, nothing validates them.
  const ODD_TIMES = ['', '7:5', '24:30', '23:99', '-1:00', 'xx', '07:30x', '1e3:00']
  const ODD_DATES = ['', 'garbage', '2026-8-3', '2026-08-31T22:00', '2026-02-30']
  const PLACES: Partial<CatchEntry>[] = [
    { locationName: 'Sydmolen' }, { locationName: ' sydMOLEN ' }, { locationName: 'Gammelt navn', locationId: 'l1' },
    { locationName: 'Nordmolen', locationId: 'l2' }, { locationName: 'Et sted uden navn' }, { locationName: '' },
    { locationName: 'Sydmolen', locationId: 'slettet' },
  ]
  function randomEntry(r: () => number, id: string, kind: 'catch' | 'trip'): CatchEntry {
    const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)]
    const clock = () => (r() < 0.12 ? pick(ODD_TIMES) : `${p2(Math.floor(r() * 24))}:${p2(Math.floor(r() * 4) * 15)}`)
    const date = r() < 0.06 ? pick(ODD_DATES) : `2026-08-${p2(18 + Math.floor(r() * 8))}`
    const where = pick(PLACES)
    return kind === 'trip'
      ? { id, outcome: 'empty', date, from: clock(), to: clock(), speciesId: '', count: 0, locationName: '', ...where }
      : { id, date, time: r() < 0.08 ? undefined : clock(), speciesId: 'havørred', locationName: '', ...where }
  }
  const ids = (es: CatchEntry[]) => es.map((e) => e.id)
  const judge = (t: CatchEntry, es: CatchEntry[]) =>
    [tripFormIssues(t, es, LOCS, NOW), ids(catchesInside(t, es, LOCS)), ids(overlappingTrips(t, es, LOCS))]

  // 40 logs of 40 forms: 1600 forms, 425 with a catch inside and 574 with
  // a trip over them. At 120 logs it took 2 s alone, and over the 5 s limit
  // with the suite running beside it.
  it('finds exactly the clashes the whole log has, for random trips against random logs', () => {
    const r = rng(20261112)
    const found = { catch: 0, trip: 0, forms: 0 }
    for (let l = 0; l < 40; l++) {
      const log = Array.from({ length: Math.floor(r() * 80) }, (_, i) => randomEntry(r, 'e' + i, r() < 0.4 ? 'trip' : 'catch'))
      const near = tripNeighbours(log, LOCS)
      for (let f = 0; f < 40; f++) {
        // A new trip, or one of the log's open for editing.
        const form = { ...randomEntry(r, '', 'trip'), id: log.length && r() < 0.3 ? log[Math.floor(r() * log.length)].id : '' }
        const whole = judge(form, log)
        expect(judge(form, near(form)), JSON.stringify(form)).toEqual(whole)
        found.forms++
        if (whole[0].includes('catch')) found.catch++
        if (whole[0].includes('trip')) found.trip++
      }
    }
    // Not a vacuous pass: plenty of the forms do clash.
    expect(found.catch).toBeGreaterThan(300)
    expect(found.trip).toBeGreaterThan(300)
  })

  it('hands over the entries at the trip’s spot within a day of it, not the whole log', () => {
    const daily = Array.from({ length: 365 }, (_, i) => {
      const d = new Date(2026, 0, 1 + i)
      return entry({ id: 'c' + i, date: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`, time: '07:00' })
    })
    const weekly = Array.from({ length: 52 }, (_, i) => trip({ id: 't' + i, date: daily[i * 7].date }))
    const log = [...daily, ...weekly, entry({ id: 'there', locationName: 'Nordmolen' })]
    const form = trip({ id: '', date: '2026-08-20' }) // a Thursday, like weekly[33]
    const near = tripNeighbours(log, LOCS)(form)
    expect(near.length).toBeLessThanOrEqual(6)
    expect(judge(form, near)).toEqual(judge(form, log))
    expect(judge(form, log)[0]).toEqual(['catch', 'trip'])
    // At a spot the log never fished: nothing to judge against.
    expect(tripNeighbours(log, LOCS)(trip({ id: '', locationName: 'Et sted uden navn' }))).toEqual([])
  })
})

describe('tripOutings', () => {
  /** A trip saved twice — a double tap, or two devices offline — is one outing. */
  it('groups trips at the same spot whose spans overlap, transitively', () => {
    const a = trip({ id: 'a', from: '06:00', to: '08:00' })
    const b = trip({ id: 'b', from: '07:30', to: '09:00' })
    const c = trip({ id: 'c', from: '08:30', to: '10:00' })
    const evening = trip({ id: 'd', from: '17:00', to: '20:00' })
    const tejn = trip({ id: 'e', locationName: 'Nordmolen' })
    const ids = tripOutings([evening, c, tejn, a, b], LOCS).map((o) => o.map((t) => t.id).sort().join('+')).sort()
    expect(ids).toEqual(['a+b+c', 'd', 'e'])
  })
})

describe('catchesMaybeInside', () => {
  it('adds the catches logged without a time at the spot that day — the next day too, overnight', () => {
    const timeless = entry({ id: 'c9', time: undefined })
    expect(catchesMaybeInside(trip(), [timeless, entry({ id: 'c8', time: '12:00' })], LOCS).map((e) => e.id)).toEqual(['c9'])
    expect(catchesMaybeInside(trip(), [entry({ id: 'c9', time: '', locationName: 'Nordmolen' })], LOCS)).toEqual([])
    expect(catchesMaybeInside(trip(), [entry({ id: 'c9', date: '2026-08-23', time: undefined })], LOCS)).toEqual([])
    expect(catchesMaybeInside(trip({ from: '22:00', to: '02:00' }), [entry({ id: 'c9', date: '2026-08-23', time: undefined })], LOCS)).toHaveLength(1)
  })
})

/**
 * The log's "Ture uden fangst" tile counted every entry marked empty, and the
 * Modeltjek count line every analysable one: a trip kept after "Nej" to the
 * delete question showed as 1 trip without a catch next to a table with none.
 */
describe('fishlessOutings', () => {
  it('counts one outing per trip logged twice, and none that may hold a catch', () => {
    const a = trip({ id: 'a', from: '06:00', to: '09:00' })
    const copy = trip({ id: 'b', from: '06:30', to: '09:00' })
    expect(fishlessOutings([a, copy], [a, copy], LOCS)).toHaveLength(1)
    const caught = [a, copy, entry({ id: 'c1', time: '07:10' })]
    expect(fishlessOutings(caught, caught, LOCS)).toEqual([])
    // Only the trips passed are counted; every entry is searched for a catch.
    const timeless = entry({ id: 'c2', time: undefined })
    expect(fishlessOutings([a], [a, timeless], LOCS)).toEqual([])
  })
})
