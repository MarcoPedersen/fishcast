import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
// A fresh module per test: the fetched history is kept for the session.
let run: typeof import('./insightRun')
import { summariseGroup, type WindowSample } from './catchInsights'
import type { Availability, CatchEntry, Location } from './types'

const DRAGOR: Location = { id: 'drg', name: 'Sydmolen', lat: 55.59, lon: 12.68, waterType: 'salt' }
const KALUNDBORG: Location = { id: 'kal', name: 'Slæbestedet', lat: 55.68, lon: 11.09, waterType: 'salt' }
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
/** Where the scores are kept on the device (insightSaved): each test starts with none. */
const KEPT = 'fc2-insight-results'
beforeEach(async () => {
  localStorage.removeItem(KEPT)
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
    // The dashboard's tide span for each span's first day to the one for its
    // last: 26 and 29 days of tides, ≤ 7 days a request.
    expect(dmi).toHaveLength(9)
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
    // The merged span is 06:00–10:00: its hours run up to, not including, 10:00.
    expect(dragor.hours.map((h) => new Date(h.at).getHours())).toEqual([6, 7, 8, 9])
  })
})

/**
 * Every entry is scored for the dashboard's targets, so a skrubbe at night
 * would count as a trip with a catch for a score computed for havørred and
 * makrel. Left out and counted; an unknown species ('') stays in.
 */
it('leaves catches of species outside the targets out of the trips with a catch, and counts them', async () => {
  const log = [...LOG, { ...fish('s1', '2026-10-08', '23:10', KALUNDBORG), speciesId: 'skrubbe' }, { ...fish('u1', '2026-10-09', '06:30', DRAGOR), speciesId: '' }]
  await run.runAnalysis(log, LOCS, AVAIL, TARGETS)
  const g = run.insightGroups(log, LOCS, TARGETS, run.insight.run!.base)
  expect(g.groups.catch).toHaveLength(3) // c1 + c2, c3, u1
  expect(g.otherSpecies).toBe(1)
  expect(run.countsAsCatch(log.at(-2)!, TARGETS)).toBe(false)
  expect(run.countsAsCatch(log.at(-1)!, TARGETS)).toBe(true)
  // The card still has its score: only the grouping depends on the species.
  expect(run.resultFor(log.at(-2)!, LOCS, TARGETS)).toMatchObject({ hours: expect.any(Array) })
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

  /**
   * A cached catch score depends on the spot's coast (onshore spec §2.7), but
   * a coast that lands, or is picked, after the score is no change to the
   * entry. The score used to vanish: the background coast queue landed while
   * a card's "Beregn bid-score" was fetching, and the card fell back to its
   * button with no reason given (review C9). Now the score stays, marked as
   * computed with an older coast; another spot's coast doesn't mark it.
   */
  it("keeps a result when its spot's coast changes, marked as from an older coast", async () => {
    const W = { mode: 'manual' as const, facing: 270, spread: 180 as const, exposure: 'open' as const, fetchKm: null }
    const [c1] = LOG
    const here = LOCS[0].id, there = LOCS[1].id
    await run.runAnalysis(LOG, LOCS, AVAIL, TARGETS, { [here]: W })
    expect(run.resultFor(c1, LOCS, TARGETS)).toMatchObject({ hours: expect.any(Array) })
    expect(run.coastOutdated(c1, LOCS, TARGETS, { [here]: W })).toBe(false)
    expect(run.coastOutdated(c1, LOCS, TARGETS, { [here]: W, [there]: { ...W, facing: 90 } })).toBe(false)
    expect(run.coastOutdated(c1, LOCS, TARGETS, { [here]: { ...W, facing: 90 } })).toBe(true)
    expect(run.coastOutdated(c1, LOCS, TARGETS, {})).toBe(true)
    expect(run.resultFor(c1, LOCS, TARGETS)).toMatchObject({ hours: expect.any(Array) })
    // No result for what the entry is now: nothing to mark.
    expect(run.coastOutdated({ ...c1, time: '08:00' }, LOCS, TARGETS, {})).toBe(false)
    // "Beregn igen" scores it with the coast it has now.
    await run.scoreOne(c1, LOCS, TARGETS, {})
    expect(run.coastOutdated(c1, LOCS, TARGETS, {})).toBe(false)
  })

  /**
   * The panel's state. A coast landing during or after "Analysér" is no
   * changed log: the results stay, and the panel says the coast moved
   * (insight_coast_stale), not "Loggen er ændret siden sidste analyse".
   */
  it('tells a coast that landed after the run apart from a changed log', async () => {
    const W = { mode: 'manual' as const, facing: 270, spread: 180 as const, exposure: 'open' as const, fetchKm: null }
    const landed = { [LOCS[0].id]: W }
    expect(run.runState(LOG, LOCS, AVAIL, TARGETS, {})).toBe('none')
    // The run starts before the background queue has derived either spot…
    await run.runAnalysis(LOG, LOCS, AVAIL, TARGETS, {})
    expect(run.runState(LOG, LOCS, AVAIL, TARGETS, {})).toBe('fresh')
    // …and the first spot's coast lands while it fetches, or just after.
    expect(run.runState(LOG, LOCS, AVAIL, TARGETS, landed)).toBe('coast')
    expect(run.insightGroups(LOG, LOCS, TARGETS, run.insight.run!.base).groups.catch).toHaveLength(2)
    // A spot none of the analysed entries uses changes nothing.
    expect(run.runState(LOG, LOCS, AVAIL, TARGETS, { elsewhere: W })).toBe('fresh')
    // A changed log is still one, coast or not.
    expect(run.runState(LOG.slice(1), LOCS, AVAIL, TARGETS, {})).toBe('stale')
    expect(run.runState(LOG.slice(1), LOCS, AVAIL, TARGETS, landed)).toBe('stale')
    // Analysing again with the landed coast makes it fresh.
    await run.runAnalysis(LOG, LOCS, AVAIL, TARGETS, landed)
    expect(run.runState(LOG, LOCS, AVAIL, TARGETS, landed)).toBe('fresh')
    expect(LOG.every((e) => !run.coastOutdated(e, LOCS, TARGETS, landed))).toBe(true)
  })

  /**
   * Review: only a species with a shore-wind table reads the coast (havørred:
   * bd_shorewind, and its windOrChop standing down). For targets without one
   * a landing coast changed no score, yet every card offered "Beregn igen"
   * and the panel "Analysér igen" — a re-run gave the same numbers.
   */
  it('a coast that cannot move the score for these targets is no change', async () => {
    const W = { mode: 'manual' as const, facing: 270, spread: 180 as const, exposure: 'open' as const, fetchKm: null }
    const landed = { [LOCS[0].id]: W }
    const NO_SHORE = ['makrel']
    await run.runAnalysis(LOG, LOCS, AVAIL, NO_SHORE, {})
    expect(run.coastOutdated(LOG[0], LOCS, NO_SHORE, landed)).toBe(false)
    expect(run.runState(LOG, LOCS, AVAIL, NO_SHORE, landed)).toBe('fresh')
    await run.scoreOne(LOG[0], LOCS, NO_SHORE, {})
    expect(run.coastOutdated(LOG[0], LOCS, NO_SHORE, landed)).toBe(false)
    // With havørred among the targets the same coast is one.
    await run.runAnalysis(LOG, LOCS, AVAIL, TARGETS, {})
    expect(run.runState(LOG, LOCS, AVAIL, TARGETS, landed)).toBe('coast')
    expect(run.coastOutdated(LOG[0], LOCS, TARGETS, landed)).toBe(true)
  })

  it('makes a run stale when the time windows or the analysable entries change', () => {
    const fp = run.runFingerprint(LOG, LOCS, AVAIL, TARGETS)
    expect(run.runFingerprint(LOG.map((e) => ({ ...e, notes: 'x' })), LOCS, AVAIL, TARGETS)).toBe(fp)
    expect(run.runFingerprint(LOG.slice(1), LOCS, AVAIL, TARGETS)).not.toBe(fp)
    expect(run.runFingerprint(LOG, LOCS, AVAIL.slice(1), TARGETS)).not.toBe(fp)
  })
})

/**
 * A reload lost every bite-score: each card asked "Beregn bid-score" again,
 * and scoring it fetched the weeks of history again. They are kept on the
 * device now (insightSaved), and come back under the rules they always had.
 */
describe('bite-scores kept on the device', () => {
  /** A reload: the module, and so the store, starts again from what the device kept. */
  const reload = async () => { vi.resetModules(); run = await import('./insightRun') }
  const W = { mode: 'manual' as const, facing: 270, spread: 180 as const, exposure: 'open' as const, fetchKm: null }

  it('a card’s score is there again after a reload, as it was, with nothing fetched', async () => {
    await run.scoreOne(LOG[0], LOCS, TARGETS)
    const before = run.resultFor(LOG[0], LOCS, TARGETS)
    expect(before).toMatchObject({ hours: [expect.any(Object)] })
    await reload()
    const n = calls.length
    const after = run.resultFor(LOG[0], LOCS, TARGETS) as WindowSample
    expect(after).toEqual(before)
    expect(after.window.date).toBeInstanceOf(Date)
    expect(run.coastOutdated(LOG[0], LOCS, TARGETS, {})).toBe(false)
    expect(calls.length).toBe(n)
  })

  // A score is the model's output. The fingerprint holds the entry, its spot
  // and the targets, not the code: an update that scores differently kept the
  // old number on the card, which offers no "compute again" for a score it
  // holds. In memory a score never outlived the app version that computed it.
  it('only for the build of the app that scored them: an update may score them differently', async () => {
    vi.stubGlobal('__FC_BUILD__', 'build-1')
    await reload()
    await run.scoreOne(LOG[0], LOCS, TARGETS)
    await reload()
    expect(run.resultFor(LOG[0], LOCS, TARGETS)).toMatchObject({ hours: expect.any(Array) })
    vi.stubGlobal('__FC_BUILD__', 'build-2')
    await reload()
    expect(run.resultFor(LOG[0], LOCS, TARGETS)).toBeUndefined()
    expect(run.insight.results.size).toBe(0)
  })

  it('a run’s scores too, and the panel groups them from the store the cards read', async () => {
    await run.runAnalysis(LOG, LOCS, AVAIL, TARGETS)
    const base = run.insight.run!.base
    const before = run.insightGroups(LOG, LOCS, TARGETS, base)
    await reload()
    for (const e of LOG) expect(run.resultFor(e, LOCS, TARGETS), e.id).toMatchObject({ hours: expect.any(Array) })
    expect(run.insightGroups(LOG, LOCS, TARGETS, base)).toEqual(before)
    // The run itself — hundreds of baseline windows — is not kept: the panel offers to run it.
    expect(run.runState(LOG, LOCS, AVAIL, TARGETS, {})).toBe('none')
  })

  it('only while the entry, its spot and the targets are as scored — and an older coast is said', async () => {
    const c1 = LOG[0], here = { [DRAGOR.id]: W }
    await run.scoreOne(c1, LOCS, TARGETS, here)
    await reload()
    expect(run.resultFor({ ...c1, notes: 'from the phone' }, LOCS, TARGETS)).toMatchObject({ hours: expect.any(Array) })
    expect(run.resultFor({ ...c1, time: '08:00' }, LOCS, TARGETS)).toBeUndefined()
    expect(run.resultFor(c1, [{ ...DRAGOR, lat: 55.6 }, KALUNDBORG], TARGETS)).toBeUndefined()
    expect(run.resultFor(c1, LOCS, ['makrel'])).toBeUndefined()
    expect(run.coastOutdated(c1, LOCS, TARGETS, here)).toBe(false)
    expect(run.coastOutdated(c1, LOCS, TARGETS, { [DRAGOR.id]: { ...W, facing: 90 } })).toBe(true)
  })

  it('keeps no failed fetch, no "no data" and no loading state', async () => {
    offline = true
    await run.scoreOne(LOG[1], LOCS, TARGETS)
    expect(run.resultFor(LOG[1], LOCS, TARGETS)).toBe('failed')
    offline = false
    // No weather for that hour, as scoreEntry gives it: the card offers no retry, a reload does.
    run.insight.results.set(LOG[2].id, { fp: run.entryFingerprint(LOG[2], LOCS, TARGETS), coast: '', result: null })
    run.insight.loading.add(LOG[3].id)
    await run.scoreOne(LOG[0], LOCS, TARGETS)
    await reload()
    expect(run.resultFor(LOG[0], LOCS, TARGETS)).toMatchObject({ hours: expect.any(Array) })
    expect(run.resultFor(LOG[1], LOCS, TARGETS)).toBeUndefined()
    expect(run.resultFor(LOG[2], LOCS, TARGETS)).toBeUndefined()
    expect(run.insight.loading.size).toBe(0)
  })

  it('drops the scores of entries that are gone', async () => {
    await run.scoreOne(LOG[0], LOCS, TARGETS)
    await run.scoreOne(LOG[2], LOCS, TARGETS)
    run.pruneResults(new Set([LOG[2].id]))
    await reload()
    expect([...run.insight.results.keys()]).toEqual([LOG[2].id])
  })

  it('starts empty from corrupt or older-format data, and still scores and keeps', async () => {
    localStorage.setItem(KEPT, '{not json')
    await reload()
    expect(run.insight.results.size).toBe(0)
    await run.scoreOne(LOG[0], LOCS, TARGETS)
    await reload()
    expect(run.resultFor(LOG[0], LOCS, TARGETS)).toMatchObject({ hours: expect.any(Array) })
  })

  it('scores for the visit where the browser blocks storage', async () => {
    const blocked = () => { throw new DOMException('blocked', 'SecurityError') }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
    await reload()
    await run.scoreOne(LOG[0], LOCS, TARGETS)
    expect(run.resultFor(LOG[0], LOCS, TARGETS)).toMatchObject({ hours: expect.any(Array) })
  })

  /** Logout: the next user on this device sees none of them — not even one landing after it. */
  it('forgets them all at logout, and a score still on its way stays out', async () => {
    await run.scoreOne(LOG[0], LOCS, TARGETS)
    const { forgetAccountData } = await import('./forgetOnLogout')
    const late = run.scoreOne(LOG[3], LOCS, TARGETS)
    forgetAccountData()
    await late
    expect(run.insight.results.size).toBe(0)
    expect(localStorage.getItem(KEPT)).toBeNull()
    await reload()
    expect(run.insight.results.size).toBe(0)
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
