// Window dates and local-hour anchoring depend on the zone; pin the owner's.
declare const process: { env: Record<string, string | undefined> }
process.env.TZ = 'Europe/Copenhagen'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchForecast, fetchForecasts } from './weather'
import {
  betterOfficial, clearOfficialForecasts, compareCandidates, daysAhead, inheritLightning, loadOfficialForecasts, officialWindows,
  type Candidate, type OfficialInput,
} from './officialCompare'
import { SCORE_WEIGHTS } from './scoring'
import { DK_SPOTS } from './spots'
import type { Availability, Forecast, HourData, LightningStatus, Location, ScoredWindow } from './types'

vi.mock('./weather', () => ({ fetchForecasts: vi.fn(), fetchForecast: vi.fn() }))

// 12:00 local (CEST) on Monday 15 June 2026 — UTC and local share the date.
const NOW = new Date('2026-06-15T10:00:00Z')
// 19:00 local the same day: today's 14–18 window is over.
const EVENING = new Date('2026-06-15T17:00:00Z')

/** Benign hourly weather from yesterday to +8 days, on the local hour like scoreWindow expects. */
function forecast(): Forecast {
  const hourly: HourData[] = []
  const start = new Date(2026, 5, 14, 0).getTime()
  for (let h = 0; h < 24 * 9; h++) {
    hourly.push({
      time: start + h * 3600000, temp: 14, windMs: 3, windDir: 270, gustMs: 5,
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
    targetSpecies: [], lightning: {}, horizon: 7, ...extra,
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
})

describe('officialWindows filtering', () => {
  it('follows the horizon from the same forecasts, without fetching', () => {
    const i = input([candidate('off-h', 8)])
    const days = (h: number) => new Set(officialWindows({ ...i, horizon: h }, NOW).map((x) => daysAhead(x.date, NOW)))
    expect([...days(1)]).toEqual([0])
    expect([...days(3)].sort()).toEqual([0, 1, 2])
    expect(fetchForecasts).not.toHaveBeenCalled()
  })

  it("keeps today's windows after they end, as the dashboard keeps your own", () => {
    // 19:00 on "I dag": dropping the finished 14–18 window here took every
    // official pin off the map, beside your own pins still showing it, and
    // said there were no official spots within 30 km.
    vi.setSystemTime(EVENING)
    const ws = officialWindows(input([candidate('off-e', 8)], { horizon: 1 }), EVENING)
    expect(ws).toHaveLength(1)
    expect(daysAhead(ws[0].date, EVENING)).toBe(0)
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
})
