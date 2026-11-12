// @vitest-environment vue-dom
/**
 * The dashboard map's "compare with official spots", as mounted: which
 * lightning checks rescore the official spots, and that what the tab shows
 * after each one is what a tab opened afresh would show. The real tab, Pinia
 * stores and scoring; Leaflet faked (test/fakeLeaflet) and the network mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h, nextTick } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'
import * as FL from '@/test/fakeLeaflet'

vi.mock('leaflet', () => import('@/test/fakeLeaflet'))
vi.mock('@/lib/weather', async (orig) => {
  const real = await orig<typeof import('@/lib/weather')>()
  return { ...real, fetchForecast: vi.fn(), fetchForecasts: vi.fn(), fetchLightningStatus: vi.fn() }
})
// The real scoring, counted.
vi.mock('@/lib/scoring', async (orig) => {
  const real = await orig<typeof import('@/lib/scoring')>()
  return { ...real, getScoredWindows: vi.fn(real.getScoredWindows) }
})
vi.mock('@/lib/toast', () => ({ showToast: vi.fn(() => 1), dismissToast: vi.fn() }))
vi.mock('@/lib/coastClient', () => ({ deriveCoast: vi.fn(), terminate: vi.fn() }))

import { DK_SPOTS, locationFromSpot } from '@/lib/spots'
import { fetchForecasts, fetchLightningStatus, forecastKey, type FetchedForecast } from '@/lib/weather'
import { getScoredWindows } from '@/lib/scoring'
import { clearOfficialForecasts, compareCandidates, inheritLightning } from '@/lib/officialCompare'
import type { Availability, HourData, LightningStatus, Location, MarineHour } from '@/lib/types'
import { t } from '@/lib/i18n'
import { useSetupStore } from '@/stores/setup'
import { useForecastStore } from '@/stores/forecast'
import MapTab from './MapTab.vue'

const mBatch = vi.mocked(fetchForecasts)
const mLightning = vi.mocked(fetchLightningStatus)
const mScore = vi.mocked(getScoredWindows)

// Monday 9 November 2026, 06:00 in Denmark: today's windows are all still to come.
const NOW = Date.UTC(2026, 10, 9, 5, 0)
const H = 3600_000
const AVAIL: Availability[] = [
  { id: 'a', days: [0, 1, 2, 3, 4, 5, 6], from: '07:00', to: '10:00', methods: ['shore'] },
  { id: 'b', days: [0, 1, 2, 3, 4, 5, 6], from: '15:00', to: '19:00', methods: ['shore'] },
]
const spot = (slug: string) => {
  const s = DK_SPOTS.find((x) => x.slug === slug)
  if (!s) throw new Error(`no catalogue spot ${slug}`)
  return s
}
// Two of your spots ~23 km apart. The official spots near them are all nearer
// A, so once A has a reading, a reading at B reaches none of them.
const A: Location = { id: 'A', ...locationFromSpot(spot('sletterhage')) }
const B: Location = { id: 'B', ...locationFromSpot(spot('stavns')) }

/** Weather that scores well above the lightning cap, from yesterday to a week ahead. */
function forecastFor(loc: Location, fetched = Date.now()): FetchedForecast {
  const d = new Date(fetched)
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime()
  const hourly: HourData[] = []
  const marine: MarineHour[] = []
  for (let i = 0; i < 24 * 9; i++) {
    const time = start + i * H
    hourly.push({ time, temp: 10, windMs: 4, windDir: 250, gustMs: 7, cloud: 80, precipPct: 10, pressure: 1008 })
    marine.push({ time, waveM: 0.5, wavePeriod: 4, sstC: 10 })
  }
  return { fetched, fetchedFor: forecastKey(loc), hourly, marine, tides: null }
}

const storm = (level: LightningStatus['level'], closestKm: number | null = 6): LightningStatus => ({ level, closestKm })
/** What the next lightning check answers per spot; 'clear' where not set. */
let answers: Record<string, LightningStatus | Error> = {}

let restoreDocument: () => void
let pinia: Pinia
let setup: ReturnType<typeof useSetupStore>
let fc: ReturnType<typeof useForecastStore>
const views: ReturnType<typeof mount>[] = []
const errors: unknown[] = []

async function settle() {
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
  }
}

/** Mounts the map tab for today ("I dag"), and returns its root and its pin layer. */
async function openTab() {
  const layerAt = FL.layers.length
  const view = mount({ render: () => h(MapTab, { windows: [], horizon: 1 }) }, (app) => {
    app.use(pinia)
    app.config.warnHandler = () => {}
    app.config.errorHandler = (e) => { errors.push(e) }
  })
  views.push(view)
  await settle()
  return { root: view.root, layer: FL.layers[layerAt], unmount: () => { view.unmount(); views.splice(views.indexOf(view), 1) } }
}

/** Ticks "compare with official spots" if it isn't (it stays ticked between visits). */
async function compareOn(root: FakeNode) {
  const box = root.byClass('cmp')[0].byTag('input')[0] as FakeNode & { checked: boolean }
  if (!box.checked) {
    box.checked = true
    box.dispatch('change')
  }
  await settle()
}

type Tab = { root: FakeNode; layer: FL.FakeLayer }
/** The pins the tab shows: each one's place, badge and popup. */
const pinsOf = (tab: Tab) =>
  JSON.stringify([...tab.layer.markers].map((m) => [m.latlng.join(','), m.iconHtml, m.popup].join(' | ')).sort())
/** Everything the tab shows: the pins, and the "better" banner. */
const shown = (tab: Tab) => JSON.stringify({ pins: pinsOf(tab), better: tab.root.byClass('better')[0]?.textContent ?? '' })
/** What a tab opened now shows, for the same stores. */
async function shownAfresh(): Promise<string> {
  const fresh = await openTab()
  const s = shown(fresh)
  fresh.unmount()
  return s
}

/** One lightning check of both your spots, answered from `answers`. */
async function check() {
  await fc.refreshLightning(setup.locations, true)
  await settle()
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  restoreDocument = installDocument()
  localStorage.clear()
  vi.clearAllMocks()
  FL.resetLeaflet()
  clearOfficialForecasts()
  errors.length = 0
  answers = {}
  mBatch.mockImplementation(async (locs) => locs.map((l) => forecastFor(l)))
  mLightning.mockImplementation(async (l) => {
    const a = answers[l.id]
    if (a instanceof Error) throw a
    return a ?? storm('clear', null)
  })
  pinia = createPinia()
  setActivePinia(pinia)
  setup = useSetupStore()
  setup.locations = [{ ...A }, { ...B }]
  setup.availability = AVAIL.map((a) => ({ ...a }))
  setup.targetSpecies = ['havørred']
  fc = useForecastStore()
})
afterEach(() => {
  for (const v of [...views]) v.unmount()
  views.length = 0
  expect(errors).toEqual([])
  vi.unstubAllGlobals()
  vi.useRealTimers()
  restoreDocument()
})

describe('compare with official spots: a lightning check rescores them only when one of their readings changes', () => {
  it('the spots this relies on: every official spot takes A\'s reading, and none B\'s once A has one', () => {
    const official = compareCandidates(setup.locations).map((c) => c.loc)
    expect(official.length).toBeGreaterThanOrEqual(4)
    expect(Object.keys(inheritLightning(official, setup.locations, { A: storm('danger') }))).toHaveLength(official.length)
    const withB = inheritLightning(official, setup.locations, { A: storm('clear', null), B: storm('danger') })
    expect(Object.values(withB).every((s) => s.level === 'clear')).toBe(true)
  })

  it('the first all-clear check after a start: none', async () => {
    const tab = await openTab()
    await compareOn(tab.root)
    expect(mBatch).toHaveBeenCalledTimes(1) // the official spots' weather
    expect(mScore).toHaveBeenCalledTimes(1)
    const before = shown(tab)
    expect(before).toContain(`(${t('map_official')})`) // compare is showing official pins
    await check()
    expect(fc.lightning).toEqual({ A: storm('clear', null), B: storm('clear', null) })
    expect(mScore).toHaveBeenCalledTimes(1)
    expect(shown(tab)).toBe(before)
    expect(shown(tab)).toBe(await shownAfresh())
  })

  it('a storm, and the all-clear after it, rescore; its distance changing, or a reading at B, do not', async () => {
    const tab = await openTab()
    await compareOn(tab.root)
    await check() // all clear
    const runs = () => mScore.mock.calls.length
    let last = runs()
    const quiet = pinsOf(tab)

    answers = { B: storm('danger', 3) } // a reading at your other spot, which no official spot takes
    await check()
    expect(fc.scoringLightning).toEqual({ B: storm('danger', 3) }) // your own spots' lists do rescore
    expect(runs()).toBe(last)
    expect(pinsOf(tab)).toBe(quiet)
    // The banner may change (no spot near a storm at yours is suggested today), from the
    // readings themselves, without scoring anything: as a tab opened now shows it.
    expect(shown(tab)).toBe(await shownAfresh())
    last = runs()

    answers = { A: storm('danger', 6), B: storm('danger', 3) } // clear → storm at A
    await check()
    expect(runs()).toBe(last + 1)
    const stormy = pinsOf(tab)
    expect(stormy).not.toBe(quiet) // capped and flagged: otherwise this proves nothing
    expect(shown(tab)).toBe(await shownAfresh())
    last = runs()

    answers = { A: storm('danger', 4), B: storm('danger', 3) } // the same storm, nearer A
    await check()
    expect(fc.lightning.A).toEqual(storm('danger', 4))
    expect(runs()).toBe(last)
    expect(pinsOf(tab)).toBe(stormy)
    expect(shown(tab)).toBe(await shownAfresh())
    last = runs()

    answers = { B: storm('danger', 3) } // storm → clear at A
    await check()
    expect(runs()).toBe(last + 1)
    expect(pinsOf(tab)).toBe(quiet)
    expect(shown(tab)).toBe(await shownAfresh())
  })

  it('a danger that ages into an unconfirmed "keep watch" after 2 h rescores', async () => {
    const tab = await openTab()
    await compareOn(tab.root)
    answers = { A: storm('danger', 6) }
    await check()
    const runs = mScore.mock.calls.length
    const danger = pinsOf(tab)
    answers = { A: new TypeError('Failed to fetch'), B: new TypeError('Failed to fetch') }
    vi.setSystemTime(NOW + 121 * 60_000)
    await check()
    expect(fc.lightning.A).toEqual(storm('caution', null))
    expect(mScore.mock.calls.length).toBe(runs + 1)
    expect(pinsOf(tab)).not.toBe(danger)
    expect(shown(tab)).toBe(await shownAfresh())
  })
})
