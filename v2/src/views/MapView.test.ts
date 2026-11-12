// @vitest-environment vue-dom
/**
 * The setup map as mounted: a spot added on it gets its forecast while the
 * map is open, through the forecast store's own rules. The real view, Pinia
 * stores and router; Leaflet faked (test/fakeLeaflet) and the network mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { installDocument, mount } from '@/test/fakeDom'
import * as FL from '@/test/fakeLeaflet'

vi.mock('leaflet', () => import('@/test/fakeLeaflet'))
// The network stubbed per test; forecastKey stays real, so "fresh for this spot" is the real check.
vi.mock('@/lib/weather', async (orig) => {
  const real = await orig<typeof import('@/lib/weather')>()
  return { ...real, fetchForecast: vi.fn(), fetchForecasts: vi.fn(), fetchLightningStatus: vi.fn() }
})
vi.mock('@/lib/toast', () => ({ showToast: vi.fn(() => 1), dismissToast: vi.fn() }))
vi.mock('@/lib/coastClient', () => ({ deriveCoast: vi.fn(), terminate: vi.fn() }))

import { DK_SPOTS, locationFromSpot, type Spot } from '@/lib/spots'
import { fetchForecast, fetchForecasts, fetchLightningStatus, forecastKey, type FetchedForecast } from '@/lib/weather'
import { showToast } from '@/lib/toast'
import { savedSpotPins } from '@/lib/setupMapPins'
import { bestTodayByLocation } from '@/lib/upcoming'
import type { Availability, HourData, Location, MarineHour } from '@/lib/types'
import { useSetupStore } from '@/stores/setup'
import { useForecastStore } from '@/stores/forecast'
import { useScoredStore } from '@/stores/scored'
import MapView from './MapView.vue'

const mBatch = vi.mocked(fetchForecasts)
const mOne = vi.mocked(fetchForecast)
const mLightning = vi.mocked(fetchLightningStatus)

// Monday 9 November 2026, 06:00 in Denmark: today's 07–10 window is still to come.
const NOW = Date.UTC(2026, 10, 9, 5, 0)
const H = 3600_000
const AVAIL: Availability[] = [{ id: 'a', days: [0, 1, 2, 3, 4, 5, 6], from: '07:00', to: '10:00', methods: ['shore'] }]
const TARGETS = ['havørred']
const SEA = DK_SPOTS.filter((s) => s.waterType !== 'fresh')
const LOCS: Location[] = SEA.slice(0, 2).map((s, i) => ({ id: 'L' + i, ...locationFromSpot(s) }))
// Official spots not saved yet, added by tapping their green pin and then Add.
const NEW_A = SEA[5]
const NEW_B = SEA[6]

/** Mild weather from yesterday to a week ahead, on the local hour. */
function forecastFor(loc: Location, fetched = Date.now()): FetchedForecast {
  const d = new Date(fetched)
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime()
  const hourly: HourData[] = []
  const marine: MarineHour[] = []
  for (let h = 0; h < 24 * 9; h++) {
    const time = start + h * H
    hourly.push({ time, temp: 9, windMs: 4, windDir: 250, gustMs: 7, cloud: 70, precipPct: 10, pressure: 1012 })
    marine.push({ time, waveM: 0.5, wavePeriod: 4, sstC: 9 })
  }
  return { fetched, fetchedFor: forecastKey(loc), hourly, marine, tides: null }
}
const cacheOf = (locs: Location[], fetched: number) =>
  Object.fromEntries(locs.map((l) => [l.id, forecastFor(l, fetched)]))
/** The locations each batched fetch asked for, by id. */
const batchedIds = () => mBatch.mock.calls.map(([locs]) => locs.map((l) => l.id))

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined
let setup: ReturnType<typeof useSetupStore>
let fc: ReturnType<typeof useForecastStore>
let scored: ReturnType<typeof useScoredStore>
const errors: unknown[] = []

async function settle() {
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
  }
}

/** Opens the setup map on LOCS, with these forecasts cached from before. */
async function openMap(cache: Record<string, FetchedForecast> = cacheOf(LOCS, NOW - 10 * 60_000)) {
  localStorage.setItem('fc2-forecasts', JSON.stringify(cache))
  const pinia = createPinia()
  setActivePinia(pinia)
  setup = useSetupStore()
  setup.locations = LOCS.map((l) => ({ ...l }))
  setup.availability = AVAIL.map((a) => ({ ...a }))
  setup.targetSpecies = [...TARGETS]
  fc = useForecastStore()
  scored = useScoredStore()
  const stub = { render: () => null }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/setup/map', name: 'map', component: stub },
      { path: '/setup/locations', name: 'locations', component: stub },
      { path: '/dashboard', name: 'dashboard', component: stub },
    ],
  })
  view = mount(MapView, (app) => {
    app.use(pinia)
    app.use(router)
    app.config.warnHandler = () => {}
    app.config.errorHandler = (e) => { errors.push(e) }
  })
  await settle()
}

const spotLayer = () => FL.layers[0]
const userLayer = () => FL.layers[1]
/** Your spot's pin on the map. */
function pinOf(loc: Location) {
  const pin = [...userLayer().markers].find((m) => m.latlng[0] === loc.lat && m.latlng[1] === loc.lon)
  if (!pin) throw new Error(`no pin for ${loc.id}`)
  return pin
}
/** The pin it should show: today's best score from the app's one scored list. */
const pinWanted = (loc: Location) =>
  savedSpotPins([loc], bestTodayByLocation(scored.windows, scored.today))[0]

/** Taps an official spot's green pin, then Add on the sheet, as the user adds it. */
async function addFromMap(spot: Spot): Promise<Location> {
  const pin = [...spotLayer().markers].find((m) => m.latlng[0] === spot.lat && m.latlng[1] === spot.lon)
  if (!pin) throw new Error(`no catalogue pin for ${spot.name}`)
  const before = setup.locations.length
  pin.fire('click')
  await nextTick()
  const add = view!.root.byClass('sheet')[0]?.byClass('btn primary')[0]
  if (!add) throw new Error('the add sheet did not open')
  add.click()
  await nextTick()
  expect(setup.locations).toHaveLength(before + 1)
  return setup.locations[before]
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  restoreDocument = installDocument()
  // What the add sheet's dialog (lib/useModal) touches as it opens.
  Object.assign(document, { body: { style: {} } })
  Object.assign(document.documentElement, { clientWidth: 1024 })
  vi.stubGlobal('window', { innerWidth: 1024 })
  vi.stubGlobal('navigator', { onLine: true })
  localStorage.clear()
  vi.clearAllMocks()
  FL.resetLeaflet()
  errors.length = 0
  mBatch.mockImplementation(async (locs) => locs.map((l) => forecastFor(l)))
  mOne.mockImplementation(async (l) => forecastFor(l))
  mLightning.mockResolvedValue({ level: 'clear', closestKm: null })
})
afterEach(() => {
  view?.unmount()
  view = undefined
  expect(errors).toEqual([])
  vi.unstubAllGlobals()
  vi.useRealTimers()
  restoreDocument()
})

describe('a spot added on the setup map', () => {
  it('gets its forecast while the map is open: its score badge and popup, and a place in the shared list', async () => {
    await openMap()
    expect(mBatch).not.toHaveBeenCalled() // every spot here was fresh
    const checked = mLightning.mock.calls.length
    const added = await addFromMap(NEW_A)
    await settle()

    expect(batchedIds()).toEqual([[added.id]])
    expect(fc.status[added.id]).toBe('ok')
    // The dashboard, the setup map and the reminders all read this one list.
    expect(scored.windows.some((w) => w.location.id === added.id && !w.noData)).toBe(true)
    const want = pinWanted(added)
    expect(bestTodayByLocation(scored.windows, scored.today).get(added.id)).toBeGreaterThan(0)
    expect(pinOf(added).iconHtml).toBe(want.icon.html)
    expect(pinOf(added).popup).toBe(want.popup)
    // ...and its lightning is checked, as for any spot fetched.
    expect(mLightning.mock.calls.slice(checked).map(([l]) => l.id)).toEqual([added.id])
  })

  it('fetches only the new spot: not the spots already there, and nothing for a rename', async () => {
    // L1 is stale, so the map's own load on opening fetches it; then nothing else may.
    await openMap({ ...cacheOf([LOCS[0]], NOW - 10 * 60_000), ...cacheOf([LOCS[1]], NOW - 4 * H) })
    expect(batchedIds()).toEqual([['L1']])
    const a = await addFromMap(NEW_A)
    await settle()
    setup.locations[0].name = 'Nyt navn'
    await settle()
    const b = await addFromMap(NEW_B)
    await settle()
    expect(batchedIds()).toEqual([['L1'], [a.id], [b.id]])
    expect(pinOf(b).iconHtml).toBe(pinWanted(b).icon.html)
  })

  it('leaves a spot whose fetch failed to its Retry and the reconnect, not to the next add', async () => {
    mBatch.mockImplementation(async (locs) => locs.map(() => null))
    mOne.mockRejectedValue(new TypeError('Failed to fetch'))
    vi.spyOn(console, 'error').mockImplementation(() => {}) // "Forecast failed: …"
    await openMap({ ...cacheOf([LOCS[0]], NOW - 10 * 60_000) })
    await vi.advanceTimersByTimeAsync(5000) // L1's per-spot retries run out
    expect(fc.status.L1).toBe('error')
    mBatch.mockImplementation(async (locs) => locs.map((l) => forecastFor(l)))
    const a = await addFromMap(NEW_A)
    await settle()
    expect(batchedIds()).toEqual([['L1'], [a.id]])
    expect(fc.status[a.id]).toBe('ok')
  })

  it('offline: nothing is sent, the spot is marked failed for the reconnect and it is said once', async () => {
    await openMap()
    vi.stubGlobal('navigator', { onLine: false })
    const a = await addFromMap(NEW_A)
    await settle()
    expect(mBatch).not.toHaveBeenCalled()
    expect(mOne).not.toHaveBeenCalled()
    expect(fc.status[a.id]).toBe('error') // what refreshOnResume refetches on 'online'
    expect(fc.lightningUnchecked(a.id)).toBe(true)
    expect(vi.mocked(showToast)).toHaveBeenCalledTimes(1)
    expect(pinOf(a).iconHtml).toBe(savedSpotPins([a], new Map())[0].icon.html)
  })

  it('a fetch already under way is left to it: the opening load, and an earlier add', async () => {
    const opening = deferred<(FetchedForecast | null)[]>()
    const first = deferred<(FetchedForecast | null)[]>()
    mBatch.mockReturnValueOnce(opening.promise).mockReturnValueOnce(first.promise)
    await openMap({}) // nothing cached: both spots load on opening
    const a = await addFromMap(NEW_A)
    await settle()
    const b = await addFromMap(NEW_B)
    await settle()
    expect(batchedIds()).toEqual([['L0', 'L1'], [a.id], [b.id]])
    opening.resolve(LOCS.map((l) => forecastFor(l)))
    first.resolve([forecastFor(a)])
    await settle()
    expect(mBatch).toHaveBeenCalledTimes(3)
    for (const l of [...LOCS, a, b]) expect(fc.status[l.id], l.id).toBe('ok')
    expect(pinOf(a).iconHtml).toBe(pinWanted(a).icon.html)
  })

  it('a spot moved by an edit from elsewhere is fetched for its new place', async () => {
    await openMap()
    const moved = setup.locations[1]
    moved.lat += 0.01
    await settle()
    expect(batchedIds()).toEqual([['L1']])
    expect(fc.forecasts.L1.fetchedFor).toBe(forecastKey(moved))
  })

  it('a spot that comes back while its forecast is still fresh is not fetched again', async () => {
    // A sync merge with no base can bring back a spot deleted here (stores/setup.ts):
    // the same id and place, and the forecast it had is still young. New to the
    // map, but fetchAll's freshness rule holds; force would refetch it.
    await openMap()
    const back = { ...setup.locations[1] }
    setup.locations = setup.locations.filter((l) => l.id !== back.id)
    await settle()
    setup.locations = [...setup.locations, back]
    await settle()
    expect(mBatch).not.toHaveBeenCalled()
    expect(mOne).not.toHaveBeenCalled()
    expect(pinOf(back).iconHtml).toBe(pinWanted(back).icon.html)
    expect(bestTodayByLocation(scored.windows, scored.today).get(back.id)).toBeGreaterThan(0)
  })

  it('a spot added after leaving the map is not fetched by it', async () => {
    await openMap()
    view!.unmount()
    view = undefined
    setup.locations.push({ id: 'N1', ...locationFromSpot(NEW_A) })
    await settle()
    expect(mBatch).not.toHaveBeenCalled()
  })
})
