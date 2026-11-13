// @vitest-environment vue-dom
/**
 * The setup map as mounted: its own load on opening, and the bottom type of
 * a spot added on it. A spot added while it is open gets its forecast from
 * the app, as one added anywhere else (App.test.ts). The real view, Pinia
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
import type { Availability, HourData, Location, MarineHour } from '@/lib/types'
import { useSetupStore } from '@/stores/setup'
import { useForecastStore } from '@/stores/forecast'
import { bottomGuessed } from '@/lib/waterGuess'
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
// An official spot not saved yet, added by tapping its green pin and then Add.
const NEW_A = SEA[5]

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

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined
let setup: ReturnType<typeof useSetupStore>
let fc: ReturnType<typeof useForecastStore>
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

describe('the setup map on opening', () => {
  it('loads the spots that need it, in one batch', async () => {
    // L1 is stale: the map's own load fetches it, and only it.
    await openMap({ ...cacheOf([LOCS[0]], NOW - 10 * 60_000), ...cacheOf([LOCS[1]], NOW - 4 * H) })
    expect(batchedIds()).toEqual([['L1']])
    expect(fc.status.L1).toBe('ok')
  })
})

/**
 * A tapped point's bottom type is a guess from the official spots near it
 * (geo.ts inferBottomType), and the spot card says so until the user picks
 * one (LocationsView). An official spot's is its own.
 */
describe('the bottom type of a spot added on the setup map', () => {
  it('a tapped point is saved with the guess, marked as one; an official spot with its own', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') })) // the place name: the coordinates
    await openMap()
    FL.maps[0].fire('click', { latlng: { lat: 55.99078, lng: 12.55296 } }) // Espergærde
    await settle()
    view!.root.byClass('sheet')[0].byClass('btn primary')[0].click()
    await nextTick()
    const tapped = setup.locations[LOCS.length]
    expect(tapped).toMatchObject({ lat: 55.99078, lon: 12.55296, waterType: 'brackish', bottomType: 'stone' })
    expect(bottomGuessed(tapped.id)).toBe(true)
    const official = await addFromMap(NEW_A)
    expect(official.bottomType).toBe(NEW_A.bottomType)
    expect(bottomGuessed(official.id)).toBe(false)
  })
})
