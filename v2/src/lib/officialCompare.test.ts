// Window dates and local-hour anchoring depend on the zone; pin the owner's.
declare const process: { env: Record<string, string | undefined> }
process.env.TZ = 'Europe/Copenhagen'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchForecast, fetchForecasts } from './weather'
import {
  betterOfficial, clearOfficialForecasts, compareCandidates, daysAhead, inheritLightning, loadOfficialForecasts, officialLightning,
  officialWindows, sameReadings, scoreOfficial,
  type Candidate, type OfficialInput,
} from './officialCompare'
import { SCORE_WEIGHTS } from './scoring'
import { DK_SPOTS, locationFromSpot } from './spots'
import type { Shore } from './coast'
import type { Availability, Forecast, HourData, LightningStatus, Location, ScoredWindow } from './types'

// The network stubbed; the pure helpers (takesSeaData…) stay real.
vi.mock('./weather', async (orig) => ({
  ...(await orig<typeof import('./weather')>()), fetchForecasts: vi.fn(), fetchForecast: vi.fn(),
}))

// 12:00 local (CEST) on Monday 15 June 2026 — UTC and local share the date.
const NOW = new Date('2026-06-15T10:00:00Z')
// 19:00 local the same day: today's 14–18 window is over.
const EVENING = new Date('2026-06-15T17:00:00Z')

/** Benign hourly weather from yesterday to +8 days, on the local hour like scoreWindow expects. */
function forecast(windDir = 270): Forecast {
  const hourly: HourData[] = []
  const start = new Date(2026, 5, 14, 0).getTime()
  for (let h = 0; h < 24 * 9; h++) {
    hourly.push({
      time: start + h * 3600000, temp: 14, windMs: 3, windDir, gustMs: 5,
      cloud: 50, precipPct: 0, pressure: 1013,
    })
  }
  return { fetched: Date.now(), hourly, marine: null, tides: null }
}

const OWN: Location = { id: 'x', name: 'Min plads', lat: 55.5, lon: 12.0, waterType: 'salt' }
/** An official spot `km` kilometres due north of OWN. */
const candidate = (id: string, km: number): Candidate => ({
  dist: km,
  loc: { id, name: 'Officiel ' + id, lat: OWN.lat + km / 111.2, lon: OWN.lon, waterType: 'salt' },
})
const EVERY_DAY: Availability[] = [{ id: 'a', days: [0, 1, 2, 3, 4, 5, 6], from: '14:00', to: '18:00', methods: ['shore'] }]
const DANGER: LightningStatus = { level: 'danger', closestKm: 5 }

function input(cands: Candidate[], extra: Partial<OfficialInput> = {}): OfficialInput {
  const forecasts: Record<string, Forecast> = {}
  for (const c of cands) forecasts[c.loc.id] = forecast()
  return {
    candidates: cands, forecasts, own: [OWN], availability: EVERY_DAY,
    targetSpecies: [], lightning: {}, horizon: 7, shores: {}, ...extra,
  }
}

const today = (ws: ScoredWindow[]) => ws.filter((w) => daysAhead(w.date, NOW) === 0)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => { vi.useRealTimers() })

describe('official spots inherit your spots\' lightning', () => {
  it('caps an official spot 8 km from a spot under a "danger" reading, as your own is capped', () => {
    const cands = [candidate('off-y', 8)]
    const clear = today(officialWindows(input(cands), NOW))
    expect(clear).toHaveLength(1)
    expect(clear[0].score).toBeGreaterThan(SCORE_WEIGHTS.lightningCap) // otherwise the test proves nothing

    const storm = today(officialWindows(input(cands, { lightning: { x: DANGER } }), NOW))
    expect(storm[0].score).toBe(SCORE_WEIGHTS.lightningCap)
    expect(storm[0].lightning?.level).toBe('danger')
  })

  it('only caps today — lightning is a right-now reading', () => {
    const ws = officialWindows(input([candidate('off-y', 8)], { lightning: { x: DANGER } }), NOW)
    const later = ws.filter((w) => daysAhead(w.date, NOW) > 0)
    expect(later.length).toBeGreaterThan(0)
    expect(later.every((w) => w.score > SCORE_WEIGHTS.lightningCap && !w.lightning)).toBe(true)
  })

  it('does not stretch a reading past 25 km, and drops its distance', () => {
    const near = candidate('off-near', 8).loc
    const far = candidate('off-far', 40).loc
    const got = inheritLightning([near, far], [OWN], { x: DANGER })
    expect(got['off-near']).toEqual({ level: 'danger', closestKm: null })
    expect(got['off-far']).toBeUndefined()
  })

  it('uses the nearest own spot that has a reading', () => {
    const other: Location = { id: 'z', name: 'Z', lat: OWN.lat + 0.3, lon: OWN.lon }
    const c = candidate('off-y', 20).loc // ~20 km from OWN, ~13 km from Z
    const got = inheritLightning([c], [OWN, other], { x: DANGER, z: { level: 'caution', closestKm: 40 } })
    expect(got['off-y'].level).toBe('caution')
  })
})

// MapTab scores the official spots from officialLightning, held in a computed
// that hands back the same object while it is unchanged: the first all-clear
// check after a start, a storm's distance, a reading no official spot takes
// used to rescore every official spot for an identical result.
describe('officialLightning — the readings the official spots are scored with', () => {
  const OTHER: Location = { id: 'z', name: 'Z', lat: OWN.lat + 0.3, lon: OWN.lon } // ~33 km north of OWN
  const near = candidate('off-near', 14) // ~14 km from OWN, ~19 km from Z
  const mid = candidate('off-mid', 22) // ~22 km from OWN, ~11 km from Z
  const far = candidate('off-far', 60) // ~27 km from Z: beyond both
  const cands = [near, mid, far]
  const storm = (level: LightningStatus['level'], closestKm: number | null = 6): LightningStatus => ({ level, closestKm })
  const clear = storm('clear', null)
  const readings = (lightning: Record<string, LightningStatus>) =>
    officialLightning({ ...input(cands, { lightning }), own: [OWN, OTHER] })

  it("leaves 'clear' out, which scores exactly like no reading", () => {
    expect(readings({})).toEqual({})
    expect(readings({ x: clear, z: clear })).toEqual({})
    expect(readings({ x: storm('danger'), z: clear })).toEqual({ 'off-near': storm('danger', null) })
  })

  it('a clear reading at your spot beside it still keeps a farther storm off it', () => {
    // No reading at OWN: off-near takes Z's storm; once OWN reads clear, it doesn't.
    expect(readings({ z: storm('warning') })).toEqual({ 'off-near': storm('warning', null), 'off-mid': storm('warning', null) })
    expect(readings({ x: clear, z: storm('warning') })).toEqual({ 'off-mid': storm('warning', null) })
  })

  it("only for the spots there is something to score: none without weather, or at sea without waves", () => {
    const all = input(cands, { lightning: { x: storm('danger') } })
    expect(Object.keys(officialLightning(all))).toEqual(['off-near', 'off-mid'])
    const i = input(cands, { lightning: { x: storm('danger') } })
    delete i.forecasts['off-near']
    expect(Object.keys(officialLightning(i))).toEqual(['off-mid'])
    const waveless = input(cands, { lightning: { x: storm('danger') } })
    waveless.forecasts['off-near'] = { ...forecast(), marineFailed: true } as Forecast
    expect(Object.keys(officialLightning(waveless))).toEqual(['off-mid'])
  })

  it('scores byte for byte as the inherited readings, clear ones and distances included, did', () => {
    // Every case the brief names: unknown → clear, clear → storm, a storm's
    // distance changing, storm → clear, danger → caution, a reading elsewhere.
    const cases: Record<string, LightningStatus>[] = [
      {}, { x: clear, z: clear }, { x: storm('danger', 6), z: clear }, { x: storm('danger', 3), z: clear },
      { x: clear, z: clear }, { x: storm('caution', null), z: clear }, { x: clear, z: storm('warning', 14) },
      { z: storm('danger', 2) },
    ]
    for (const lightning of cases) {
      const i = { ...input(cands, { lightning }), own: [OWN, OTHER] }
      const locs = cands.map((c) => c.loc)
      // How officialWindows scored before: every inherited reading, 'clear' and all.
      const before = scoreOfficial(i, inheritLightning(locs, i.own, lightning), NOW)
      expect(before.some((w) => w.lightning)).toBe(Object.values(readings(lightning)).length > 0)
      expect(JSON.stringify(scoreOfficial(i, officialLightning(i), NOW))).toBe(JSON.stringify(before))
      expect(JSON.stringify(officialWindows(i, NOW))).toBe(JSON.stringify(before))
    }
  })
})

describe('sameReadings', () => {
  const s = (level: LightningStatus['level'], closestKm: number | null = null): LightningStatus => ({ level, closestKm })
  it('the same spots with the same levels and distances', () => {
    expect(sameReadings({}, {})).toBe(true)
    expect(sameReadings({ a: s('danger', 5) }, { a: s('danger', 5) })).toBe(true)
  })
  it('anything else: a spot more or less, another level or distance', () => {
    expect(sameReadings({}, { a: s('danger') })).toBe(false)
    expect(sameReadings({ a: s('danger') }, {})).toBe(false)
    expect(sameReadings({ a: s('danger') }, { b: s('danger') })).toBe(false)
    expect(sameReadings({ a: s('danger') }, { a: s('caution') })).toBe(false)
    expect(sameReadings({ a: s('danger', 5) }, { a: s('danger', 4) })).toBe(false)
  })
})

describe('betterOfficial', () => {
  const w = (id: string, day: number, score: number, lat = OWN.lat + 0.07): ScoredWindow => ({
    location: { id, name: id, lat, lon: OWN.lon },
    date: new Date(Date.UTC(2026, 5, 15 + day)), from: '14:00', to: '18:00',
    score, noData: false, bestHourStr: null, tags: [],
  })

  it('recommends the best official window that beats yours', () => {
    expect(betterOfficial(50, [w('a', 0, 60), w('b', 1, 72)], [OWN], {}, NOW)?.location.id).toBe('b')
    expect(betterOfficial(80, [w('a', 0, 60)], [OWN], {}, NOW)).toBeNull()
  })

  it('never suggests another spot today while lightning is reported at your spots nearby', () => {
    const warning = { x: { level: 'warning', closestKm: 15 } as LightningStatus }
    expect(betterOfficial(30, [w('a', 0, 72)], [OWN], warning, NOW)).toBeNull()
    // A later day is unaffected, and so is a spot beyond the radius.
    expect(betterOfficial(30, [w('a', 0, 72), w('b', 2, 60)], [OWN], warning, NOW)?.location.id).toBe('b')
    expect(betterOfficial(30, [w('far', 0, 72, OWN.lat + 0.6)], [OWN], warning, NOW)?.location.id).toBe('far')
  })

  it('never suggests a window that is already over', () => {
    expect(betterOfficial(50, [w('a', 0, 80)], [OWN], {}, EVENING)).toBeNull()
    expect(betterOfficial(50, [w('a', 0, 80), w('b', 1, 60)], [OWN], {}, EVENING)?.location.id).toBe('b')
    // An overnight window that started today runs until 02:00 tomorrow.
    const night = { ...w('n', 0, 70), from: '22:00', to: '02:00' }
    expect(betterOfficial(50, [night], [OWN], {}, EVENING)?.location.id).toBe('n')
  })
})

describe('compareCandidates', () => {
  // Scored with the same engine as your own spots, so they need the same
  // facts: an official spot's depth decides torsk's 'deep' bonus.
  it('carries each official spot\'s depth into the candidate', () => {
    const deep = DK_SPOTS.find((s) => s.depth === 'deep')!
    const near: Location = { id: 'mine', name: 'Mine', lat: deep.lat + 0.05, lon: deep.lon }
    const c = compareCandidates([near]).find((x) => x.loc.spotSlug === deep.slug)
    expect(c?.loc.depth).toBe('deep')
  })

  /**
   * Excluding the spots you already have: a copy of Helsingør Kysten saved
   * before it moved to Kronborg Pynten sits at the old pin, 2.3 km off. Offered
   * as a twin, the map would recommend the very spot it is, a few points apart.
   */
  it('leaves out an official spot you saved before it moved', () => {
    const hk = DK_SPOTS.find((s) => s.slug === 'helsingore-kysten')!
    for (const old of [
      { id: 'map', name: hk.name, lat: 56.0350, lon: 12.5890 },
      { id: 'finder', name: hk.name, lat: 56.0350, lon: 12.5890, spotSlug: hk.slug },
    ]) {
      const slugs = compareCandidates([old]).map((c) => c.loc.spotSlug)
      expect(slugs, old.id).not.toContain('helsingore-kysten')
      expect(slugs.length, old.id).toBeGreaterThan(0) // the others nearby still come
    }
  })
})

/**
 * Official twins and the coast (onshore spec §2.7). Twins carry the
 * precomputed catalogue coast; your own pin carries its own. The map must
 * never recommend a twin for data your own pin beside it still lacks, so
 * twins only get a coast once every coastal spot of yours has a known one —
 * and not near a spot where you switched the wind direction off (critique
 * suggestion 8).
 */
describe('official twins and the coast', () => {
  const TEJN = DK_SPOTS.find((s) => s.slug === 'tejn-havn')!
  const twin: Candidate = { dist: 3, loc: { id: 'off-tejn-havn', ...locationFromSpot(TEJN) } }
  const NEAR: Location = { id: 'n', name: 'Ved Tejn', lat: TEJN.lat + 0.02, lon: TEJN.lon, waterType: 'salt' }
  const LAKE: Location = { id: 'lake', name: 'Sø', lat: 55.2, lon: 14.9, waterType: 'fresh' }
  const NE: Shore = { mode: 'manual', facing: 45, spread: 180, exposure: 'open', fetchKm: null }
  // Wind off the twin's open water (NE), where its row is plainly not 0: a
  // W wind across its harbour nets about 0, and a 0 row is left out, so it
  // could not tell "scored with the coast" from "scored without".
  const rowAt = (i: OfficialInput) => today(officialWindows({ ...i, forecasts: { [twin.loc.id]: forecast(45) }, targetSpecies: ['havørred'] }, NOW))
    .some((w) => w.breakdown!.some((b) => b.key === 'bd_shorewind'))

  it('scores twins with the catalogue once every coastal spot of yours is known', () => {
    expect(rowAt(input([twin], { own: [NEAR], shores: { n: NE } }))).toBe(true)
  })

  it('scores them without while one of your coastal spots is still unknown', () => {
    expect(rowAt(input([twin], { own: [NEAR], shores: {} }))).toBe(false)
  })

  it('is not held back by a fresh-water spot of yours', () => {
    expect(rowAt(input([twin], { own: [NEAR, LAKE], shores: { n: NE } }))).toBe(true)
  })

  it('leaves the coast out near a spot of yours where it is switched off', () => {
    expect(rowAt(input([twin], { own: [NEAR], shores: { n: null } }))).toBe(false)
  })

  // A spot waiting for your pick is null too (stores/coast.ts shoreById): it
  // holds back only the twins beside it, not every twin for as long as you don't answer.
  it('scores twins far from a spot of yours that is unscored (null)', () => {
    const FAR: Location = { id: 'f', name: 'Kalundborg', lat: 55.67, lon: 11.10, waterType: 'salt' }
    expect(rowAt(input([twin], { own: [NEAR, FAR], shores: { n: NE, f: null } }))).toBe(true)
  })
})

describe('officialWindows filtering', () => {
  it('follows the horizon from the same forecasts, without fetching', () => {
    const i = input([candidate('off-h', 8)])
    const days = (h: number) => new Set(officialWindows({ ...i, horizon: h }, NOW).map((x) => daysAhead(x.date, NOW)))
    expect([...days(1)]).toEqual([0])
    expect([...days(3)].sort()).toEqual([0, 1, 2])
    expect(fetchForecasts).not.toHaveBeenCalled()
  })

  /**
   * Integration: the map branch kept finished windows here "exactly as the
   * dashboard keeps your own", and the dashboard branch then started dropping
   * your own (useNotEnded). Merged, 19:00 on "I dag" showed your pins with no
   * score beside official pins still scored for the 14–18 that was over. Both
   * sides now drop a window once it ends.
   */
  it("drops today's windows once they end, as the dashboard drops your own", () => {
    vi.setSystemTime(EVENING)
    expect(officialWindows(input([candidate('off-e', 8)], { horizon: 1 }), EVENING)).toEqual([])
    // ...but not one still running at that moment: 18:00–22:00 at 19:00.
    const late = { availability: [{ ...EVERY_DAY[0], from: '18:00', to: '22:00' }], horizon: 1 }
    expect(officialWindows(input([candidate('off-e', 8)], late), EVENING)).toHaveLength(1)
  })

  // 00:30 local is still yesterday in UTC, and last night's 22:00–02:00 (dated
  // yesterday) is being fished: it belongs in "I dag", as on the dashboard.
  it("keeps last night's overnight window in today's horizon while it runs", () => {
    const AFTER_MIDNIGHT = new Date('2026-06-15T22:30:00Z') // 00:30 on 16 June in DK
    vi.setSystemTime(AFTER_MIDNIGHT)
    const night = { availability: [{ ...EVERY_DAY[0], from: '22:00', to: '02:00' }], horizon: 1 }
    const ws = officialWindows(input([candidate('off-n', 8)], night), AFTER_MIDNIGHT)
    expect(ws.map((w) => w.date.getTime()).sort()).toEqual([Date.UTC(2026, 5, 15), Date.UTC(2026, 5, 16)])
  })

  /**
   * Integration: a failed marine request leaves a sea spot with no wave row,
   * which reads as calm water. Your own spots keep the waves they had
   * (stores/forecast.ts putForecast) and say "bølger ikke hentet"; an official
   * twin fetched during the outage had neither, so in a 1.74 m swell it
   * scored 24 to your spot's 1 and the map said it was the better spot.
   */
  it('leaves out a sea spot whose waves failed to load, so it is never recommended for it', () => {
    const sea = candidate('off-w', 8)
    const lake: Candidate = { dist: 9, loc: { ...candidate('off-l', 9).loc, waterType: 'fresh' } }
    const i = input([sea, lake], { horizon: 1 })
    i.forecasts['off-w'] = { ...forecast(), marineFailed: true } as Forecast
    // A lake takes no sea data: its marine: null is no outage.
    i.forecasts['off-l'] = { ...forecast(), marineFailed: true } as Forecast
    const ws = officialWindows(i, NOW)
    expect(ws.some((w) => w.location.id === 'off-w')).toBe(false)
    expect(ws.some((w) => w.location.id === 'off-l')).toBe(true)
    expect(betterOfficial(0, ws, [OWN], {}, NOW)?.location.id).toBe('off-l')
    // With its waves back it is compared again.
    i.forecasts['off-w'] = forecast()
    expect(officialWindows(i, NOW).some((w) => w.location.id === 'off-w')).toBe(true)
  })
})

describe('loadOfficialForecasts', () => {
  beforeEach(() => {
    vi.mocked(fetchForecasts).mockReset()
    vi.mocked(fetchForecasts).mockImplementation(async (locs) => locs.map(() => forecast()))
  })

  it('fetches all candidates in ONE batched call, never per spot', async () => {
    const locs = ['off-1', 'off-2', 'off-3'].map((id, i) => candidate(id, 5 + i).loc)
    const got = await loadOfficialForecasts(locs)
    expect(Object.keys(got).sort()).toEqual(['off-1', 'off-2', 'off-3'])
    expect(fetchForecasts).toHaveBeenCalledTimes(1)
    expect(vi.mocked(fetchForecasts).mock.calls[0][0]).toHaveLength(3)
    expect(fetchForecast).not.toHaveBeenCalled()
  })

  it('reuses fresh forecasts — a remount or second toggle fetches nothing', async () => {
    const locs = [candidate('off-c1', 5).loc, candidate('off-c2', 6).loc]
    await loadOfficialForecasts(locs)
    await loadOfficialForecasts(locs)
    expect(fetchForecasts).toHaveBeenCalledTimes(1)
    // A new candidate only fetches itself.
    await loadOfficialForecasts([...locs, candidate('off-c3', 7).loc])
    expect(fetchForecasts).toHaveBeenCalledTimes(2)
    expect(vi.mocked(fetchForecasts).mock.calls[1][0].map((l) => l.id)).toEqual(['off-c3'])
  })

  it('shares one in-flight batch between overlapping loads', async () => {
    const locs = [candidate('off-p1', 5).loc]
    const [a, b] = await Promise.all([loadOfficialForecasts(locs), loadOfficialForecasts(locs)])
    expect(fetchForecasts).toHaveBeenCalledTimes(1)
    expect(a['off-p1']).toBeDefined()
    expect(b['off-p1']).toBeDefined()
  })

  it('leaves out spots the batch had no weather for, and refetches after 3 h', async () => {
    vi.mocked(fetchForecasts).mockImplementationOnce(async (locs) => locs.map((_, i) => (i === 0 ? forecast() : null)))
    const locs = [candidate('off-s1', 5).loc, candidate('off-s2', 6).loc]
    expect(Object.keys(await loadOfficialForecasts(locs))).toEqual(['off-s1'])
    vi.setSystemTime(NOW.getTime() + 3 * 3600000 + 1)
    await loadOfficialForecasts(locs)
    expect(vi.mocked(fetchForecasts).mock.calls[1][0].map((l) => l.id)).toEqual(['off-s1', 'off-s2'])
  })

  it('fetches again after the weather data is cleared', async () => {
    const locs = [candidate('off-r1', 5).loc]
    await loadOfficialForecasts(locs)
    clearOfficialForecasts()
    await loadOfficialForecasts(locs)
    expect(fetchForecasts).toHaveBeenCalledTimes(2)
  })

  /**
   * The compare kept its own 3 h rule while the forecast store gained the
   * outage rules (refine/data): a forecast whose marine request failed was
   * held without waves for 3 h with the marine API long back, and the next
   * refetch would have thrown away waves it had.
   */
  it('retries a forecast whose marine request failed after 15 min, and a failed retry keeps the waves it had', async () => {
    const WAVES = [{ time: NOW.getTime(), waveM: 1.74, wavePeriod: 6, sstC: 6 }]
    const locs = [candidate('off-m1', 5).loc]
    vi.mocked(fetchForecasts).mockImplementationOnce(async (ls) => ls.map(() => ({ ...forecast(), marine: WAVES })))
    await loadOfficialForecasts(locs)
    vi.setSystemTime(NOW.getTime() + 3 * 3600000 + 1)
    vi.mocked(fetchForecasts).mockImplementationOnce(async (ls) => ls.map(() => ({ ...forecast(), marineFailed: true })))
    const failed = await loadOfficialForecasts(locs)
    expect(fetchForecasts).toHaveBeenCalledTimes(2)
    expect(failed['off-m1'].marine).toEqual(WAVES)
    vi.setSystemTime(NOW.getTime() + 3 * 3600000 + 10 * 60000)
    await loadOfficialForecasts(locs)
    expect(fetchForecasts).toHaveBeenCalledTimes(2) // within the 15 min
    vi.setSystemTime(NOW.getTime() + 3 * 3600000 + 16 * 60000)
    await loadOfficialForecasts(locs)
    expect(fetchForecasts).toHaveBeenCalledTimes(3)
  })

  it('refetches a forecast from before local midnight after it, as your own spots do', async () => {
    vi.setSystemTime(new Date(2026, 5, 15, 23, 30))
    const locs = [candidate('off-d1', 5).loc]
    await loadOfficialForecasts(locs)
    vi.setSystemTime(new Date(2026, 5, 16, 0, 30))
    await loadOfficialForecasts(locs)
    expect(fetchForecasts).toHaveBeenCalledTimes(2)
  })
})
