// @vitest-environment vue-dom
/**
 * The setup map's "Gå til dashboard →", as mounted. It went to the dashboard
 * unchecked, and the dashboard sends a visit with no setup back to the
 * welcome page: round R's browser check, with no time windows yet, tapped it
 * and landed on Velkommen. With no setup yet it now starts one, as Find
 * pladser's button has since round T and Målarter's does; with a setup it
 * goes to the dashboard as before. Leaflet faked (test/fakeLeaflet); the
 * forecasts never arrive, as the button does not wait for them.
 *
 * Round V: it goes to the first step the setup lacks. The usual first visit
 * here has the time windows made and no spot yet, and "Start opsætning"
 * sent it back to step 1. There the missing step is a spot added on this
 * map, so the button is gone, and "← Lokationsliste" is the way on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'
import * as FL from '@/test/fakeLeaflet'

vi.mock('leaflet', () => import('@/test/fakeLeaflet'))
vi.mock('@/lib/weather', async (orig) => {
  const real = await orig<typeof import('@/lib/weather')>()
  const never = () => new Promise<never>(() => {})
  return { ...real, fetchForecast: vi.fn(never), fetchForecasts: vi.fn(never), fetchLightningStatus: vi.fn(never) }
})
vi.mock('@/lib/toast', () => ({ showToast: vi.fn(() => 1), dismissToast: vi.fn() }))
vi.mock('@/lib/coastClient', () => ({ deriveCoast: vi.fn(), terminate: vi.fn() }))

import { DK_SPOTS, locationFromSpot } from '@/lib/spots'
import { useSetupStore } from '@/stores/setup'
import { STRINGS } from '@/test/strings'
import MapView from './MapView.vue'

const da = STRINGS.da

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined
let router: Router
const errors: unknown[] = []

beforeEach(() => {
  restoreDocument = installDocument()
  Object.assign(document.documentElement, { clientWidth: 1024 })
  vi.stubGlobal('window', { innerWidth: 1024 })
  vi.stubGlobal('navigator', { onLine: true })
  localStorage.clear()
  FL.resetLeaflet()
  errors.length = 0
})
afterEach(() => {
  view?.unmount()
  view = undefined
  expect(errors).toEqual([])
  vi.unstubAllGlobals()
  restoreDocument()
})

/** The setup map, and the dashboard as the app's router guards it: no setup, back to the welcome page. */
async function openMap(prepare: (s: ReturnType<typeof useSetupStore>) => void): Promise<FakeNode> {
  const pinia = createPinia()
  setActivePinia(pinia)
  prepare(useSetupStore())
  const page = { render: () => null }
  router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', name: 'welcome', component: page },
    { path: '/setup/availability', name: 'availability', component: page },
    { path: '/setup/locations', name: 'locations', component: page },
    { path: '/setup/map', name: 'map', component: page },
    { path: '/dashboard', name: 'dashboard', component: page, beforeEnter: () => (useSetupStore().hasSetup() ? true : { name: 'welcome' }) },
  ] })
  await router.push('/setup/map')
  view = mount(MapView, (app) => {
    app.use(pinia)
    app.use(router)
    app.config.warnHandler = () => {}
    app.config.errorHandler = (e) => { errors.push(e) }
  })
  await nextTick()
  return view.root
}

/** The head's buttons: back to the list first, then the way on, if any. */
const headButtons = (root: FakeNode) => root.byClass('head')[0].byTag('button')
/** The head's second button, the way on: the first goes back to the list. */
const onward = (root: FakeNode) => headButtons(root)[1]
/** The navigation a click starts, done. */
const settle = () => new Promise((r) => setTimeout(r, 0))
const spot = { id: 'l1', ...locationFromSpot(DK_SPOTS[0]) }
const window1 = { id: 'a1', days: [6], from: '06:00', to: '10:00', methods: ['shore' as const] }

describe("the setup map's way on", () => {
  // The first visit as the setup leads here: windows made, no spot yet.
  // Adding one on this map is the step missing, not step 1 again.
  it('with time windows but no spot yet, shows none: the spot is the step missing, and the list is the way on', async () => {
    const root = await openMap((s) => { s.availability = [window1] })
    expect(headButtons(root).map((b) => b.textContent)).toEqual([`← ${da.map_back_list}`])
    expect(root.textContent).not.toContain(da.setup_start)
    expect(root.textContent).not.toContain(da.goto_dash)
  })

  it('with nothing set up yet, starts the setup at the time windows', async () => {
    const root = await openMap(() => {})
    expect(onward(root).textContent).toBe(da.setup_start)
    onward(root).click()
    await settle()
    expect(router.currentRoute.value.name).toBe('availability')
  })

  it('a spot added, still with no windows, the same', async () => {
    const root = await openMap((s) => { s.locations = [spot] })
    expect(onward(root).textContent).toBe(da.setup_start)
    onward(root).click()
    await settle()
    expect(router.currentRoute.value.name).toBe('availability')
  })

  it('with a setup, goes to the dashboard', async () => {
    const root = await openMap((s) => {
      s.locations = [spot]
      s.availability = [window1]
    })
    expect(onward(root).textContent).toBe(da.goto_dash)
    onward(root).click()
    await settle()
    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it('reads as the setup becomes whole, a spot added while it is open', async () => {
    const root = await openMap((s) => { s.availability = [window1] })
    expect(headButtons(root)).toHaveLength(1)
    useSetupStore().locations.push(spot)
    await nextTick()
    expect(onward(root).textContent).toBe(da.goto_dash)
    onward(root).click()
    await settle()
    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it('and as the windows go, the spot kept: back to starting the setup', async () => {
    const root = await openMap((s) => {
      s.locations = [spot]
      s.availability = [window1]
    })
    useSetupStore().availability = []
    await nextTick()
    expect(onward(root).textContent).toBe(da.setup_start)
  })
})
