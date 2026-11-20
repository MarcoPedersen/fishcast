// @vitest-environment vue-dom
/**
 * The topbar's own controls, as mounted: the real App and welcome page,
 * Pinia stores and router on the in-memory DOM, with the network mocked.
 * The 🔔 reminders and what they need to come.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'
import { STRINGS } from '@/test/strings'

vi.mock('leaflet', () => import('@/test/fakeLeaflet'))
// The network stubbed per test; forecastKey stays real, so "fresh for this spot" is the real check.
vi.mock('@/lib/weather', async (orig) => {
  const real = await orig<typeof import('@/lib/weather')>()
  return { ...real, fetchForecast: vi.fn(), fetchForecasts: vi.fn(), fetchLightningStatus: vi.fn(), geocode: vi.fn() }
})
vi.mock('@/lib/coastClient', () => ({ deriveCoast: vi.fn(() => new Promise(() => {})), terminate: vi.fn() }))
vi.mock('@/components/Toasts.vue', () => ({ default: { render: () => null } }))
vi.mock('@/components/ConfirmDialog.vue', () => ({ default: { render: () => null } }))
// The real scheduler, watched: what the reminders were armed with.
vi.mock('@/lib/notifications', async (orig) => {
  const real = await orig<typeof import('@/lib/notifications')>()
  return { ...real, scheduleWindowNotifications: vi.fn(real.scheduleWindowNotifications) }
})

import { DK_SPOTS, locationFromSpot } from '@/lib/spots'
import { fetchForecasts, fetchLightningStatus, forecastKey, type FetchedForecast } from '@/lib/weather'
import { scheduleWindowNotifications } from '@/lib/notifications'
import { dismissToast, toasts } from '@/lib/toast'
import type { Availability, HourData, Location, MarineHour } from '@/lib/types'
import { useSetupStore } from '@/stores/setup'
import App from './App.vue'
import WelcomeView from './views/WelcomeView.vue'

const mBatch = vi.mocked(fetchForecasts)
const mSchedule = vi.mocked(scheduleWindowNotifications)
const DA = STRINGS.da

// Monday 9 November 2026, 06:00 in Denmark: today's 07–10 window is still to come.
const NOW = Date.UTC(2026, 10, 9, 5, 0)
const H = 3600_000
const AVAIL: Availability[] = [{ id: 'a', days: [0, 1, 2, 3, 4, 5, 6], from: '07:00', to: '10:00', methods: ['shore'] }]
const SEA = DK_SPOTS.filter((s) => s.waterType !== 'fresh')
const LOCS: Location[] = SEA.slice(0, 2).map((s, i) => ({ id: 'L' + i, ...locationFromSpot(s) }))

/** Mild weather from the day before `fetched` to a week ahead, on the local hour. */
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
const cacheOf = (fetched: number) => Object.fromEntries(LOCS.map((l) => [l.id, forecastFor(l, fetched)]))
/** The locations each batched fetch asked for, by id. */
const batchedIds = () => mBatch.mock.calls.map(([locs]) => locs.map((l) => l.id))

/** The browser's notifications: asking grants them, unless a test says otherwise. */
class FakeNotification {
  static permission: NotificationPermission = 'default'
  static requestPermission = vi.fn(async (): Promise<NotificationPermission> => {
    FakeNotification.permission = 'granted'
    return 'granted'
  })
}

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined
const errors: unknown[] = []

async function settle() {
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
  }
}

interface Start {
  /** The forecasts cached from before; none by default. */
  cache?: Record<string, FetchedForecast>
  /** Reminders switched on before (notifications granted). */
  reminders?: boolean
}

/** Starts the app on the welcome page with a setup, as main.ts does: the stores loaded, then the app mounted. */
async function openApp(start: Start = {}) {
  localStorage.setItem('fc2-forecasts', JSON.stringify(start.cache ?? {}))
  if (start.reminders) {
    localStorage.setItem('fc2-notifs', '1')
    FakeNotification.permission = 'granted'
  }
  const pinia = createPinia()
  setActivePinia(pinia)
  const setup = useSetupStore()
  setup.locations = LOCS.map((l) => ({ ...l }))
  setup.availability = AVAIL.map((a) => ({ ...a }))
  setup.targetSpecies = ['havørred']
  const stub = { render: () => null }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'welcome', component: WelcomeView },
      ...['auth', 'availability', 'locations', 'finder', 'catchlog', 'species', 'dashboard']
        .map((name) => ({ path: '/' + name, name, component: stub })),
    ],
  })
  await router.push('/')
  view = mount(App, (app) => {
    app.use(pinia)
    app.use(router)
    app.config.warnHandler = () => {}
    app.config.errorHandler = (e) => { errors.push(e) }
  })
  await settle()
}

/** The topbar's 🔔, whichever way it reads. */
function bell(): FakeNode {
  const b = view!.root.byTag('button').find((x) => [DA.notif_enable, DA.notif_enabled].includes(String(x.attrs['aria-label'])))
  if (!b) throw new Error('no 🔔 in the topbar')
  return b
}
/** The windows the reminders were last armed with. */
const armedWith = () => mSchedule.mock.calls.at(-1)?.[0] ?? []

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  restoreDocument = installDocument()
  Object.assign(document, { body: { style: {} } })
  Object.assign(document.documentElement, { clientWidth: 1024 })
  FakeNotification.permission = 'default'
  vi.stubGlobal('Notification', FakeNotification)
  vi.stubGlobal('window', { innerWidth: 1024, Notification: FakeNotification, addEventListener() {}, removeEventListener() {} })
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('location', { origin: 'https://example.test', pathname: '/fishcast/v2/' })
  // The topbar's tab strip asks (lib/edgeFade): a strip that doesn't scroll.
  vi.stubGlobal('getComputedStyle', () => ({ overflowX: 'visible' }))
  localStorage.clear()
  vi.clearAllMocks()
  errors.length = 0
  mBatch.mockImplementation(async (locs) => locs.map((l) => forecastFor(l)))
  vi.mocked(fetchLightningStatus).mockResolvedValue({ level: 'clear', closestKm: null })
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

/**
 * Only the dashboard and the setup map load the weather. The reminders
 * fetched what they need only when the app started with them on, so 🔔
 * tapped on the welcome page (where the installed app opens) said
 * "Påmindelser er slået til" and armed them with no weather at all, or with
 * the day-old weather the cache keeps for an offline start. Nothing came,
 * or a reminder for yesterday's forecast, until a screen with scores was
 * opened. Switched on, they fetch what they need, as at a start.
 */
describe('reminders switched on before any screen has loaded the weather', () => {
  it('fetch it for every spot, and are armed with it', async () => {
    await openApp()
    bell().click()
    await settle()
    expect(bell().attrs['aria-label']).toBe(DA.notif_enabled)
    expect(batchedIds()).toEqual([['L0', 'L1']])
    expect(armedWith().length).toBeGreaterThan(0)
    expect(armedWith().every((w) => !w.noData)).toBe(true)
  })

  it('fetch afresh where the cache holds day-old weather', async () => {
    await openApp({ cache: cacheOf(NOW - 20 * H) })
    bell().click()
    await settle()
    expect(batchedIds()).toEqual([['L0', 'L1']])
  })

  it('fetch nothing where the weather is fresh', async () => {
    await openApp({ cache: cacheOf(NOW - 10 * 60_000) })
    bell().click()
    await settle()
    expect(bell().attrs['aria-label']).toBe(DA.notif_enabled)
    expect(mBatch).not.toHaveBeenCalled()
    expect(armedWith().length).toBeGreaterThan(0)
  })

  it('fetch nothing when the browser does not allow them', async () => {
    FakeNotification.requestPermission.mockImplementationOnce(async () => 'denied')
    await openApp()
    bell().click()
    await settle()
    expect(bell().attrs['aria-label']).toBe(DA.notif_enable)
    expect(mBatch).not.toHaveBeenCalled()
  })
})
