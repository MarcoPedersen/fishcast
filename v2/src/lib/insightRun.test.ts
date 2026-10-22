import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
// A fresh module per test: the fetched history is kept for the session.
let run: typeof import('./insightRun')
import { summariseGroup } from './catchInsights'
import type { Availability, CatchEntry, Location } from './types'

const DRAGOR: Location = { id: 'drg', name: 'Dragør mole', lat: 55.59, lon: 12.68, waterType: 'salt' }
const KALUNDBORG: Location = { id: 'kal', name: 'Kalundborg slæbested', lat: 55.68, lon: 11.09, waterType: 'salt' }
const LOCS = [DRAGOR, KALUNDBORG]
const TARGETS = ['havørred', 'makrel']
const AVAIL: Availability[] = [
  { id: 'we', days: [0, 6], from: '06:00', to: '10:00', methods: ['shore'] },
  { id: 'wed', days: [3], from: '17:00', to: '20:00', methods: ['shore', 'waders'] },
]
const fish = (id: string, date: string, time: string, loc: Location): CatchEntry => ({ id, date, time, speciesId: 'havørred', locationName: loc.name, locationId: loc.id, method: 'shore' })
const trip = (id: string, date: string, from: string, to: string, loc: Location): CatchEntry => ({ id, outcome: 'empty', date, from, to, speciesId: '', count: 0, locationName: loc.name, locationId: loc.id, method: 'shore' })
// 3 catches (two of them one morning) and 2 empty trips, at 2 spots, within a month.
const LOG = [
  fish('c1', '2026-09-28', '06:40', DRAGOR), fish('c2', '2026-09-28', '07:10', DRAGOR), fish('c3', '2026-10-05', '19:20', KALUNDBORG),
  trip('t1', '2026-10-02', '06:00', '09:00', DRAGOR), trip('t2', '2026-10-12', '17:00', '20:00', KALUNDBORG),
]

// Weather that changes hour by hour, built from what each request asks for.
function body(url: URL) {
  const time: string[] = []
  for (let t = Date.parse(url.searchParams.get('start_date') + 'T00:00Z'); t <= Date.parse(url.searchParams.get('end_date') + 'T23:00Z'); t += 3600000) time.push(new Date(t).toISOString().slice(0, 16))
  const at = (f: (h: number) => number) => time.map((iso) => Math.round(f(Date.parse(iso + 'Z') / 3600000) * 100) / 100)
  if (url.host.startsWith('marine')) return { hourly: { time, wave_height: at((h) => 0.5 + 0.4 * Math.sin(h / 9)), wave_period: at(() => 4) } }
  return {
    hourly: {
      time, temperature_2m: at(() => 12), wind_speed_10m: at((h) => 5 + 4 * Math.sin(h / 7)), wind_direction_10m: at((h) => (h * 17) % 360),
      wind_gusts_10m: at(() => 9), cloud_cover: at((h) => 50 + 49 * Math.sin(h / 5)), precipitation_probability: at((h) => 40 + 39 * Math.sin(h / 11)),
      surface_pressure: at((h) => 1012 + 8 * Math.sin(h / 13)),
    },
  }
}
function tides(url: URL) {
  const [a, b] = url.searchParams.get('datetime')!.split('/').map((s) => Date.parse(s))
  const features = []
  for (let t = a; t <= b; t += 600000) features.push({ properties: { predictionTime: new Date(t).toISOString(), value: 15 * Math.sin(t / 22357000) } })
  return { features }
}
const STATIONS = { features: [
  { properties: { stationId: 'drg', name: 'Dragør', country: 'DNK' }, geometry: { coordinates: [12.68, 55.59] } },
  { properties: { stationId: 'kal', name: 'Kalundborg', country: 'DNK' }, geometry: { coordinates: [11.09, 55.68] } },
] }

let calls: URL[] = []
let offline = false
beforeEach(async () => {
  vi.resetModules()
  run = await import('./insightRun')
  calls = []
  offline = false
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-19T12:00:00+02:00'))
  vi.stubGlobal('fetch', vi.fn(async (raw: string) => {
    const url = new URL(raw)
    calls.push(url)
    if (offline) throw new TypeError('Failed to fetch')
    const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data })
    if (url.pathname.includes('tidewaterstation')) return ok(STATIONS)
    if (url.pathname.includes('tidewater')) return ok(tides(url))
    return ok(body(url))
  }))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('runAnalysis', () => {
  /** Test plan 8.2: the requests one "Analysér" sends for this log. */
  it('fetches each spot’s weeks once, in planned spans', async () => {
    await run.runAnalysis(LOG, LOCS, AVAIL, TARGETS)
    const weather = calls.filter((u) => u.host === 'historical-forecast-api.open-meteo.com')
    const marine = calls.filter((u) => u.host === 'marine-api.open-meteo.com')
    const dmi = calls.filter((u) => u.pathname.endsWith('/tidewater/items'))
    expect(weather.map((u) => `${u.searchParams.get('latitude')} ${u.searchParams.get('start_date')}..${u.searchParams.get('end_date')}`).sort())
      .toEqual(['55.59 2026-09-20..2026-10-10', '55.68 2026-09-27..2026-10-20'])
    expect(marine).toHaveLength(2)
    expect(dmi).toHaveLength(6) // 21 and 24 days of tides, ≤ 10 days a request
    expect(calls.filter((u) => u.host === 'api.open-meteo.com' || u.searchParams.has('past_days'))).toEqual([])
  })

  it('scores every analysable entry, and your windows around them', async () => {
    await run.runAnalysis(LOG, LOCS, AVAIL, TARGETS)
    for (const e of LOG) expect(run.resultFor(e, LOCS, TARGETS)).toMatchObject({ hours: expect.any(Array) })
    const { groups } = run.insightGroups(LOG, LOCS, TARGETS, run.insight.run!.base)
    expect(groups.catch).toHaveLength(2) // c1 + c2 are one outing
    expect(groups.empty).toHaveLength(2)
    // Weekend mornings and Wednesday evenings, ±7 days at each spot, finished by now.
    expect(groups.base.length).toBeGreaterThan(10)
    expect(groups.base.every((s) => s.window.date.getTime() <= Date.UTC(2026, 9, 19))).toBe(true)
  })

  it('reuses what it fetched: a second run sends nothing', async () => {
    await run.runAnalysis(LOG, LOCS, AVAIL, TARGETS)
    const n = calls.length
    await run.runAnalysis(LOG, LOCS, AVAIL, TARGETS)
    expect(calls.length).toBe(n)
  })

  it('marks entries whose weather failed, and retries them later', async () => {
    offline = true
    await run.runAnalysis(LOG, LOCS, AVAIL, TARGETS)
    expect(LOG.map((e) => run.resultFor(e, LOCS, TARGETS))).toEqual(Array(5).fill('failed'))
    expect(run.insightGroups(LOG, LOCS, TARGETS, run.insight.run!.base).failed).toBe(5)
    offline = false
    await run.scoreOne(LOG[0], LOCS, TARGETS)
    expect(run.resultFor(LOG[0], LOCS, TARGETS)).toMatchObject({ hours: [expect.any(Object)] })
  })

  it('leaves out an empty trip with a catch inside it', async () => {
    const log = [...LOG, fish('c4', '2026-10-02', '07:30', DRAGOR)]
    await run.runAnalysis(log, LOCS, AVAIL, TARGETS)
    const g = run.insightGroups(log, LOCS, TARGETS, run.insight.run!.base)
    expect(g.overlapping).toBe(1)
    expect(g.groups.empty).toHaveLength(1)
  })

  /** A fish logged with its time cleared, at that spot that day, may lie inside the trip. */
  it('leaves out an empty trip when a catch without a time was logged at its spot that day', async () => {
    const log = [...LOG, { ...fish('c4', '2026-10-02', '', DRAGOR), time: undefined }]
    await run.runAnalysis(log, LOCS, AVAIL, TARGETS)
    const g = run.insightGroups(log, LOCS, TARGETS, run.insight.run!.base)
    expect(g.overlapping).toBe(1)
    expect(g.groups.empty).toHaveLength(1)
  })

  /** Two devices logging one trip offline both keep theirs: one outing, one sample. */
  it('counts the same trip logged twice as one trip without a catch', async () => {
    const log = [...LOG, trip('t1b', '2026-10-02', '06:00', '09:00', DRAGOR), trip('t1c', '2026-10-02', '08:00', '10:00', DRAGOR)]
    await run.runAnalysis(log, LOCS, AVAIL, TARGETS)
    const { groups } = run.insightGroups(log, LOCS, TARGETS, run.insight.run!.base)
    expect(groups.empty).toHaveLength(2)
    const dragor = groups.empty.find((s) => s.window.location.id === DRAGOR.id)!
    expect(dragor.hours.map((h) => new Date(h.at).getHours())).toEqual([6, 7, 8, 9, 10])
  })
})

describe('results follow their inputs', () => {
  it('drops a result when the entry, its spot or the targets change — not for a note', async () => {
    await run.runAnalysis(LOG, LOCS, AVAIL, TARGETS)
    const c1 = LOG[0]
    expect(run.resultFor({ ...c1, notes: 'from the phone' }, LOCS, TARGETS)).toBeDefined()
    expect(run.resultFor({ ...c1, time: '08:00' }, LOCS, TARGETS)).toBeUndefined()
    expect(run.resultFor(c1, [{ ...DRAGOR, lat: 55.6 }, KALUNDBORG], TARGETS)).toBeUndefined()
    expect(run.resultFor(c1, LOCS, ['makrel'])).toBeUndefined()
  })

  it('makes a run stale when the time windows or the analysable entries change', () => {
    const fp = run.runFingerprint(LOG, LOCS, AVAIL, TARGETS)
    expect(run.runFingerprint(LOG.map((e) => ({ ...e, notes: 'x' })), LOCS, AVAIL, TARGETS)).toBe(fp)
    expect(run.runFingerprint(LOG.slice(1), LOCS, AVAIL, TARGETS)).not.toBe(fp)
    expect(run.runFingerprint(LOG, LOCS, AVAIL.slice(1), TARGETS)).not.toBe(fp)
  })
})

describe('the fixture, as the panel would summarise it', () => {
  it('has thin groups, so no means are claimed', async () => {
    await run.runAnalysis(LOG, LOCS, AVAIL, TARGETS)
    const { groups } = run.insightGroups(LOG, LOCS, TARGETS, run.insight.run!.base)
    expect(summariseGroup(groups.catch).mean).toBeNull()
    expect(summariseGroup(groups.empty).mean).toBeNull()
    expect(summariseGroup(groups.base).mean).not.toBeNull()
  })
})
