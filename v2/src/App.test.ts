// @vitest-environment vue-dom
/**
 * A new spot gets its forecast at once, however it was added: the list's
 * search, the setup map, the spot finder, the quick start, a shared link, or
 * another device or tab by sync. The app as mounted: the real App, router
 * views and Pinia stores on the in-memory DOM, Leaflet faked
 * (test/fakeLeaflet) and the network mocked.
 *
 * Every rule of the forecast store still holds for them: a fresh forecast is
 * not refetched, a fetch under way is left to itself, offline the spot is
 * marked failed and said so once. The spots there at start are left to the
 * screen opened: the dashboard and the setup map load them, the other screens
 * wait.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import type { User } from '@supabase/supabase-js'
import { installDocument, mount } from '@/test/fakeDom'
import * as FL from '@/test/fakeLeaflet'
import { fakeDb } from '@/test/fakeSupabase'

vi.mock('leaflet', () => import('@/test/fakeLeaflet'))
// The network stubbed per test; forecastKey stays real, so "fresh for this spot" is the real check.
vi.mock('@/lib/weather', async (orig) => {
  const real = await orig<typeof import('@/lib/weather')>()
  return { ...real, fetchForecast: vi.fn(), fetchForecasts: vi.fn(), fetchLightningStatus: vi.fn(), geocode: vi.fn() }
})
// The coast lookups never answer: no worker here, and nothing below depends on a coast.
vi.mock('@/lib/coastClient', () => ({ deriveCoast: vi.fn(() => new Promise(() => {})), terminate: vi.fn() }))
// Both draw what lib/toast and lib/confirm hold, which the tests read directly.
vi.mock('@/components/Toasts.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/ConfirmDialog.vue', () => ({ default: { render: () => null } }))

import { DK_SPOTS, locationFromSpot, type Spot } from '@/lib/spots'
import { fetchForecast, fetchForecasts, fetchLightningStatus, forecastKey, geocode, type FetchedForecast } from '@/lib/weather'
import { dismissToast, toasts } from '@/lib/toast'
import { t } from '@/lib/i18n'
import { shareSetupUrl } from '@/lib/share'
import { savedSpotPins } from '@/lib/setupMapPins'
import { bestTodayByLocation } from '@/lib/upcoming'
import type { Availability, HourData, Location, MarineHour } from '@/lib/types'
import { useAuthStore } from '@/stores/auth'
import { useSetupStore } from '@/stores/setup'
import { useForecastStore } from '@/stores/forecast'
import { useScoredStore } from '@/stores/scored'
import { createSession } from '@/stores/session'
import App from './App.vue'
import WelcomeView from './views/WelcomeView.vue'
import LocationsView from './views/LocationsView.vue'
import MapView from './views/MapView.vue'
import SpotFinderView from './views/SpotFinderView.vue'
import SpeciesView from './views/SpeciesView.vue'
import DashboardView from './views/DashboardView.vue'

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
// Official spots not saved yet.
const NEW_A = SEA[5]
const NEW_B = SEA[6]
// A public place, found by the list's search: no official spot there.
const HORNBAEK = { name: 'Hornbæk', admin1: 'Region Hovedstaden', lat: 56.09027, lon: 12.45693, country: 'Danmark' }
const USER = 'user-a'

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
let router: Router
let setup: ReturnType<typeof useSetupStore>
let fc: ReturnType<typeof useForecastStore>
let scored: ReturnType<typeof useScoredStore>
const errors: unknown[] = []
/** The listeners the app put on window and document, by event type. */
let winOn: Record<string, ((e: unknown) => void)[]>
let docOn: Record<string, ((e: unknown) => void)[]>
const fire = (on: typeof winOn, type: string) => { for (const fn of on[type] ?? []) fn({ type }) }

async function settle() {
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
  }
}

interface Start {
  /** The forecasts cached from before; by default every spot's, 10 min old. */
  cache?: Record<string, FetchedForecast>
  locations?: Location[]
  /** Reminders switched on (notifications granted). */
  reminders?: boolean
}

/** Starts the app on `path`, as main.ts does: the stores loaded, then the app mounted. */
async function openApp(path: string, start: Start = {}) {
  const locations = start.locations ?? LOCS
  localStorage.setItem('fc2-forecasts', JSON.stringify(start.cache ?? cacheOf(locations, NOW - 10 * 60_000)))
  if (start.reminders) {
    localStorage.setItem('fc2-notifs', '1')
    const N = class { static permission = 'granted' }
    vi.stubGlobal('Notification', N)
    Object.assign(window, { Notification: N })
  }
  const pinia = createPinia()
  setActivePinia(pinia)
  setup = useSetupStore()
  setup.locations = locations.map((l) => ({ ...l }))
  setup.availability = AVAIL.map((a) => ({ ...a }))
  setup.targetSpecies = [...TARGETS]
  fc = useForecastStore()
  scored = useScoredStore()
  const stub = { render: () => null }
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'welcome', component: WelcomeView },
      { path: '/auth', name: 'auth', component: stub },
      { path: '/setup/availability', name: 'availability', component: stub },
      { path: '/setup/locations', name: 'locations', component: LocationsView },
      { path: '/setup/map', name: 'map', component: MapView },
      { path: '/finder', name: 'finder', component: SpotFinderView },
      { path: '/log', name: 'catchlog', component: stub },
      { path: '/setup/species', name: 'species', component: SpeciesView },
      { path: '/dashboard', name: 'dashboard', component: DashboardView },
    ],
  })
  await router.push(path)
  view = mount(App, (app) => {
    app.use(pinia)
    app.use(router)
    app.config.warnHandler = () => {}
    app.config.errorHandler = (e) => { errors.push(e) }
  })
  await settle()
}

/** Goes to another screen, as a tap on the topbar does. */
async function go(name: string) {
  await router.push({ name })
  await settle()
}

const spotLayer = () => FL.layers[0]
const userLayer = () => FL.layers[1]
/** Your spot's pin on the setup map. */
function pinOf(loc: Location) {
  const pin = [...userLayer().markers].find((m) => m.latlng[0] === loc.lat && m.latlng[1] === loc.lon)
  if (!pin) throw new Error(`no pin for ${loc.id}`)
  return pin
}
/** The pin it should show: today's best score from the app's one scored list. */
const pinWanted = (loc: Location) =>
  savedSpotPins([loc], bestTodayByLocation(scored.windows, scored.today))[0]
/** Whether the app's one scored list has windows for the spot with weather. */
const scoredFor = (loc: Location) => scored.windows.some((w) => w.location.id === loc.id && !w.noData)

/** On the setup map: taps an official spot's green pin, then Add on the sheet. */
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
  winOn = {}
  docOn = {}
  // What the add sheet's dialog (lib/useModal) touches as it opens, and the app's listeners.
  Object.assign(document, {
    body: { style: {} },
    addEventListener: (type: string, fn: (e: unknown) => void) => { (docOn[type] ??= []).push(fn) },
    removeEventListener: (type: string, fn: (e: unknown) => void) => { docOn[type] = (docOn[type] ?? []).filter((f) => f !== fn) },
  })
  Object.assign(document.documentElement, { clientWidth: 1024 })
  vi.stubGlobal('window', {
    innerWidth: 1024,
    addEventListener: (type: string, fn: (e: unknown) => void) => { (winOn[type] ??= []).push(fn) },
    removeEventListener: (type: string, fn: (e: unknown) => void) => { winOn[type] = (winOn[type] ?? []).filter((f) => f !== fn) },
  })
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('location', { origin: 'https://example.test', pathname: '/fishcast/v2/' })
  // The topbar's and the dashboard's tab strips ask (lib/edgeFade): a strip that doesn't scroll.
  vi.stubGlobal('getComputedStyle', () => ({ overflowX: 'visible' }))
  localStorage.clear()
  fakeDb.reset()
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
  for (const x of [...toasts.value]) dismissToast(x.id)
  expect(errors).toEqual([])
  vi.unstubAllGlobals()
  vi.useRealTimers()
  restoreDocument()
})

describe('at start, the spots already there are left to the screen opened', () => {
  it('a screen with no scores fetches nothing, stale or never loaded', async () => {
    await openApp('/setup/locations', { cache: cacheOf([LOCS[0]], NOW - 4 * H) })
    await vi.advanceTimersByTimeAsync(5000)
    expect(mBatch).not.toHaveBeenCalled()
    expect(mOne).not.toHaveBeenCalled()
  })

  it('the dashboard loads them in one batch, and nothing else asks again', async () => {
    await openApp('/dashboard', { cache: cacheOf([LOCS[0]], NOW - 4 * H) })
    await vi.advanceTimersByTimeAsync(5000)
    expect(batchedIds()).toEqual([['L0', 'L1']])
    expect(mOne).not.toHaveBeenCalled()
  })

  it('with reminders on, the dashboard and the reminders share that one batch', async () => {
    await openApp('/dashboard', { cache: cacheOf([LOCS[0]], NOW - 4 * H), reminders: true })
    await vi.advanceTimersByTimeAsync(5000)
    expect(batchedIds()).toEqual([['L0', 'L1']])
  })
})

describe('a spot added on the list, in the finder or from the welcome screen', () => {
  it('found by the list\'s search: fetched at once, only it', async () => {
    vi.mocked(geocode).mockResolvedValue([HORNBAEK])
    await openApp('/setup/locations')
    const box = view!.root.byTag('input').find((i) => i.attrs.type === 'search')!
    box.input('Hornbæk')
    await vi.advanceTimersByTimeAsync(400) // the search's debounce
    await settle()
    view!.root.byClass('result')[0].click()
    await settle()
    const added = setup.locations[LOCS.length]
    expect(added).toMatchObject({ lat: HORNBAEK.lat, lon: HORNBAEK.lon })
    expect(batchedIds()).toEqual([[added.id]])
    expect(fc.status[added.id]).toBe('ok')
    // The dashboard, the setup map and the reminders all read this one list.
    expect(scoredFor(added)).toBe(true)
  })

  it('added in the spot finder: fetched at once', async () => {
    await openApp('/finder')
    const add = view!.root.byClass('btn primary sm').find((b) => b.textContent === t('add'))
    if (!add) throw new Error('no Add button in the finder')
    add.click()
    await settle()
    expect(setup.locations).toHaveLength(LOCS.length + 1)
    const added = setup.locations[LOCS.length]
    expect(batchedIds()).toEqual([[added.id]])
    expect(scoredFor(added)).toBe(true)
  })

  it('the quick start: its spots in one batch, and the dashboard it opens asks for nothing more', async () => {
    const batch = deferred<(FetchedForecast | null)[]>()
    mBatch.mockReturnValueOnce(batch.promise)
    await openApp('/', { locations: [], cache: {} })
    setup.availability = []
    await settle()
    view!.root.byClass('quickstart')[0].click()
    await settle()
    expect(router.currentRoute.value.name).toBe('dashboard')
    const picked = setup.locations.map((l) => l.id)
    expect(picked.length).toBeGreaterThan(0)
    // Still under way as the dashboard opened.
    expect(batchedIds()).toEqual([picked])
    batch.resolve(setup.locations.map((l) => forecastFor(l)))
    await settle()
    expect(mBatch).toHaveBeenCalledTimes(1)
    for (const l of setup.locations) expect(fc.status[l.id], l.id).toBe('ok')
  })

  it('a shared setup imported from a link: its spots in one batch, nothing more for the dashboard', async () => {
    const shared = [NEW_A, NEW_B].map((s, i) => ({ id: 'S' + i, ...locationFromSpot(s) }))
    const query = shareSetupUrl(shared, TARGETS, AVAIL).split('?setup=')[1]
    await openApp(`/?setup=${query}`, { locations: [], cache: {} })
    setup.availability = []
    setup.targetSpecies = []
    await settle()
    const importBtn = view!.root.byClass('btn primary sm').find((b) => b.textContent === t('setup_import'))
    if (!importBtn) throw new Error('no import button')
    importBtn.click()
    await settle()
    expect(router.currentRoute.value.name).toBe('dashboard')
    expect(setup.locations.map((l) => l.lat)).toEqual([NEW_A.lat, NEW_B.lat])
    expect(batchedIds()).toEqual([setup.locations.map((l) => l.id)])
    for (const l of setup.locations) expect(fc.status[l.id], l.id).toBe('ok')
  })
})

describe('a spot that arrives by sync while another screen is open', () => {
  /** The account's row, as another device left it. */
  function remoteHolds(locations: Location[], at: string) {
    fakeDb.seed('setups', {
      user_id: USER,
      setup: { locations, targetSpecies: TARGETS, availability: AVAIL, lang: 'da' },
      updated_at: at,
    })
  }

  it('from the account: fetched once pulled, and the spots already there are not', async () => {
    remoteHolds(LOCS, '2026-11-09T04:00:00.000Z')
    await openApp('/setup/species')
    const auth = useAuthStore()
    auth.user = { id: USER } as User
    fakeDb.session = { user: { id: USER } }
    const session = createSession()
    await session.hydrate(USER) // the start's pull: the same spots, as new objects
    await settle()
    expect(mBatch).not.toHaveBeenCalled()
    const other = { id: 'D2', ...locationFromSpot(NEW_A) }
    remoteHolds([...LOCS, other], '2026-11-09T04:30:00.000Z') // added on the phone
    await session.resync() // as on focus
    await settle()
    expect(setup.locations.map((l) => l.id)).toEqual(['L0', 'L1', 'D2'])
    expect(batchedIds()).toEqual([['D2']])
    expect(fc.status.D2).toBe('ok')
  })

  it('with the dashboard open from the start: fetched beside its own load, and nothing twice', async () => {
    // Added on the phone since this device last pulled; the spots here are 4 h old.
    const other = { id: 'D2', ...locationFromSpot(NEW_A) }
    remoteHolds([...LOCS, other], '2026-11-09T04:30:00.000Z')
    const load = deferred<(FetchedForecast | null)[]>()
    mBatch.mockReturnValueOnce(load.promise)
    await openApp('/dashboard', { cache: cacheOf(LOCS, NOW - 4 * H) })
    expect(batchedIds()).toEqual([['L0', 'L1']]) // the dashboard's, still under way
    useAuthStore().user = { id: USER } as User
    fakeDb.session = { user: { id: USER } }
    await createSession().hydrate(USER) // the start's pull, as main.ts runs it
    await settle()
    expect(batchedIds()).toEqual([['L0', 'L1'], ['D2']])
    load.resolve(LOCS.map((l) => forecastFor(l)))
    await settle()
    expect(mBatch).toHaveBeenCalledTimes(2)
    for (const l of setup.locations) expect(fc.status[l.id], l.id).toBe('ok')
    expect(scoredFor(other)).toBe(true)
  })

  it('from another tab: fetched at once while this one is shown, and on coming back while it is hidden', async () => {
    await openApp('/setup/species')
    const session = createSession()
    const otherTab = (locations: Location[]) => {
      localStorage.setItem('fc2-setup', JSON.stringify({ locations, targetSpecies: TARGETS, availability: AVAIL }))
      session.onStorage({ key: 'fc2-setup' })
    }
    const a = { id: 'T1', ...locationFromSpot(NEW_A) }
    otherTab([...LOCS, a])
    await settle()
    expect(batchedIds()).toEqual([['T1']])
    // Hidden, the tab that added it fetches it; this one waits.
    Object.assign(document, { hidden: true, visibilityState: 'hidden' })
    const b = { id: 'T2', ...locationFromSpot(NEW_B) }
    otherTab([...LOCS, a, b])
    await settle()
    expect(batchedIds()).toEqual([['T1']])
    Object.assign(document, { hidden: false, visibilityState: 'visible' })
    fire(docOn, 'visibilitychange')
    await settle()
    expect(batchedIds()).toEqual([['T1'], ['T2']])
    expect(fc.status.T2).toBe('ok')
  })
})

describe('a spot added on the setup map', () => {
  it('gets its forecast while the map is open: its score badge and popup, and a place in the shared list', async () => {
    await openApp('/setup/map')
    expect(mBatch).not.toHaveBeenCalled() // every spot here was fresh
    const checked = mLightning.mock.calls.length
    const added = await addFromMap(NEW_A)
    await settle()

    expect(batchedIds()).toEqual([[added.id]])
    expect(fc.status[added.id]).toBe('ok')
    expect(scoredFor(added)).toBe(true)
    const want = pinWanted(added)
    expect(bestTodayByLocation(scored.windows, scored.today).get(added.id)).toBeGreaterThan(0)
    expect(pinOf(added).iconHtml).toBe(want.icon.html)
    expect(pinOf(added).popup).toBe(want.popup)
    // ...and its lightning is checked, as for any spot fetched.
    expect(mLightning.mock.calls.slice(checked).map(([l]) => l.id)).toEqual([added.id])
  })

  it('fetches only the new spot: not the spots already there, and nothing for a rename', async () => {
    // L1 is stale, so the map's own load on opening fetches it; then nothing else may.
    await openApp('/setup/map', { cache: { ...cacheOf([LOCS[0]], NOW - 10 * 60_000), ...cacheOf([LOCS[1]], NOW - 4 * H) } })
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
    await openApp('/setup/map', { cache: cacheOf([LOCS[0]], NOW - 10 * 60_000) })
    await vi.advanceTimersByTimeAsync(5000) // L1's per-spot retries run out
    expect(fc.status.L1).toBe('error')
    mBatch.mockImplementation(async (locs) => locs.map((l) => forecastFor(l)))
    const a = await addFromMap(NEW_A)
    await settle()
    expect(batchedIds()).toEqual([['L1'], [a.id]])
    expect(fc.status[a.id]).toBe('ok')
  })

  it('offline: nothing is sent, the spot is marked failed and it is said once; back online it is fetched', async () => {
    await openApp('/setup/map')
    vi.stubGlobal('navigator', { onLine: false })
    const a = await addFromMap(NEW_A)
    await settle()
    expect(mBatch).not.toHaveBeenCalled()
    expect(mOne).not.toHaveBeenCalled()
    expect(fc.status[a.id]).toBe('error')
    expect(fc.lightningUnchecked(a.id)).toBe(true)
    expect(toasts.value.filter((x) => x.type === 'error')).toHaveLength(1)
    expect(pinOf(a).iconHtml).toBe(savedSpotPins([a], new Map())[0].icon.html)

    vi.stubGlobal('navigator', { onLine: true })
    fire(winOn, 'online')
    await settle()
    expect(batchedIds()).toEqual([[a.id]])
    expect(fc.status[a.id]).toBe('ok')
    expect(toasts.value.filter((x) => x.type === 'error')).toEqual([]) // taken down
    expect(pinOf(a).iconHtml).toBe(pinWanted(a).icon.html)
  })

  it('a fetch already under way is left to it: the opening load, and an earlier add', async () => {
    const opening = deferred<(FetchedForecast | null)[]>()
    const first = deferred<(FetchedForecast | null)[]>()
    mBatch.mockReturnValueOnce(opening.promise).mockReturnValueOnce(first.promise)
    await openApp('/setup/map', { cache: {} }) // nothing cached: both spots load on opening
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
    await openApp('/setup/map')
    const moved = setup.locations[1]
    moved.lat += 0.01
    await settle()
    expect(batchedIds()).toEqual([['L1']])
    expect(fc.forecasts.L1.fetchedFor).toBe(forecastKey(moved))
  })

  it('a spot that comes back while its forecast is still fresh is not fetched again', async () => {
    // A sync merge with no base can bring back a spot deleted here (stores/setup.ts):
    // the same id and place, and the forecast it had is still young. New to the
    // app, but fetchAll's freshness rule holds; force would refetch it.
    await openApp('/setup/map')
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

  it('a spot added after leaving the map is still fetched, by the app', async () => {
    await openApp('/setup/map')
    await go('locations')
    setup.locations.push({ id: 'N1', ...locationFromSpot(NEW_A) })
    await settle()
    expect(batchedIds()).toEqual([['N1']])
  })
})
