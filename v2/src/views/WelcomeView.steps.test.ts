// @vitest-environment vue-dom
/**
 * Where the welcome page leads, as mounted on the app's own router (its
 * routes and the dashboard's guard: no setup, back to the welcome page),
 * over a memory history. Round W gave Find pladser's and Målarter's way on
 * the first step a setup lacks (lib/setupStep). The welcome page's main
 * button still went to Tidsvinduer (step 1) whenever the setup was not
 * whole: a visit with time windows made and no spot yet, the usual one in
 * the middle of the setup, was sent back to step 1 under "Start opsætning".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('vue-router', async (orig) => {
  const real = await orig<typeof import('vue-router')>()
  return { ...real, createWebHashHistory: () => real.createMemoryHistory() }
})
vi.mock('@/lib/quickStart', async (orig) => {
  const real = await orig<typeof import('@/lib/quickStart')>()
  return { ...real, quickStartPicks: vi.fn(real.quickStartPicks) }
})

import router from '@/router'
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'
import { STRINGS } from '@/test/strings'
import { langReady, setLang } from '@/lib/i18n'
import { quickStartPicks } from '@/lib/quickStart'
import { DK_SPOTS, locationFromSpot } from '@/lib/spots'
import { toasts } from '@/lib/toast'
import type { Availability, Location } from '@/lib/types'
import { useSetupStore } from '@/stores/setup'
import WelcomeView from './WelcomeView.vue'
// The pages it leads to, loaded up front: the router loads a page before it
// goes there, and the first load of one is slow.
import './AvailabilityView.vue'
import './LocationsView.vue'
import './DashboardView.vue'

const da = STRINGS.da
const en = STRINGS.en

const SPOT: Location = { id: 'l1', ...locationFromSpot(DK_SPOTS[0]) }
const WINDOW: Availability = { id: 'a1', days: [6], from: '06:00', to: '10:00', methods: ['shore'] }
const std64 = (obj: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))))

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined

beforeEach(() => {
  restoreDocument = installDocument()
  vi.stubGlobal('navigator', { onLine: true }) // no geolocation: the quick start's picks are the country's best
  toasts.value = []
})
afterEach(() => {
  view?.unmount()
  view = undefined
  setLang('da')
  vi.unstubAllGlobals()
  restoreDocument()
})

/** The welcome page at `query`, over this setup. */
async function openWelcome(own: { locations?: Location[]; availability?: Availability[] }, query: Record<string, string> = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const setup = useSetupStore()
  setup.locations = (own.locations ?? []).map((l) => ({ ...l }))
  setup.availability = (own.availability ?? []).map((a) => ({ ...a }))
  await router.push({ name: 'welcome', query })
  view = mount(WelcomeView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
  await nextTick()
  return { root: view.root, setup }
}
/** Taps `b`, and waits for the navigation it starts to end: the page loaded, the dashboard's guard run. */
async function tapAndGo(b: FakeNode) {
  const done = new Promise<void>((resolve) => { const off = router.afterEach(() => { off(); resolve() }) })
  b.click()
  await done
  await nextTick()
}
const routeName = () => router.currentRoute.value.name
/** The main button, under the quick start: to the setup or the dashboard. */
const mainButton = (root: FakeNode) => root.byClass('btn lg').find((b) => !b.hasClass('quickstart'))!

describe("the welcome page's main button goes to the first step the setup lacks", () => {
  it('with time windows but no spot yet: on to Lokationer, "Fortsæt opsætning →"', async () => {
    const { root } = await openWelcome({ availability: [WINDOW] })
    expect(mainButton(root).textContent.trim()).toBe(da.setup_continue)
    expect(mainButton(root).hasClass('ghost')).toBe(true)
    await tapAndGo(mainButton(root))
    expect(routeName()).toBe('locations')
  })

  it('with nothing set up: Tidsvinduer, step 1, "Start opsætning →"', async () => {
    const { root } = await openWelcome({})
    expect(mainButton(root).textContent.trim()).toBe(da.setup_start)
    await tapAndGo(mainButton(root))
    expect(routeName()).toBe('availability')
  })

  it('with a spot but no time windows: Tidsvinduer', async () => {
    const { root } = await openWelcome({ locations: [SPOT] })
    expect(mainButton(root).textContent.trim()).toBe(da.setup_start)
    await tapAndGo(mainButton(root))
    expect(routeName()).toBe('availability')
  })

  it('with a whole setup: the dashboard, "Gå til dashboard →"', async () => {
    const { root } = await openWelcome({ locations: [SPOT], availability: [WINDOW] })
    expect(mainButton(root).textContent.trim()).toBe(da.goto_dash)
    expect(mainButton(root).hasClass('primary')).toBe(true)
    await tapAndGo(mainButton(root))
    expect(routeName()).toBe('dashboard')
  })

  it('reads as the setup changes while the page is open', async () => {
    const { root, setup } = await openWelcome({})
    setup.availability.push({ ...WINDOW })
    await nextTick()
    expect(mainButton(root).textContent.trim()).toBe(da.setup_continue)
    setup.locations.push({ ...SPOT })
    await nextTick()
    expect(mainButton(root).textContent.trim()).toBe(da.goto_dash)
  })

  it('in English too', async () => {
    const { root } = await openWelcome({ availability: [WINDOW] })
    setLang('en')
    expect(await langReady()).toBe(true)
    await nextTick()
    expect(mainButton(root).textContent.trim()).toBe(en.setup_continue)
  })
})

/** "⚡ Hurtig start" adds spots and a morning window, and goes on. */
describe('the quick start goes to the first step the setup still lacks', () => {
  const quick = (root: FakeNode) => root.byClass('quickstart')[0]

  it('with time windows already: the spots added, the windows kept, the dashboard', async () => {
    const { root, setup } = await openWelcome({ availability: [WINDOW] })
    await tapAndGo(quick(root))
    expect(setup.availability).toEqual([WINDOW])
    expect(setup.locations.length).toBeGreaterThan(0)
    expect(routeName()).toBe('dashboard')
  })

  // No spot to pick (none the finder can score): the window is made, so
  // the step missing is a spot, not the windows it has just made.
  it('with no spot to pick: Lokationer, not the windows it has just made', async () => {
    vi.mocked(quickStartPicks).mockReturnValueOnce({ results: [], where: 'no_position' })
    const { root, setup } = await openWelcome({})
    await tapAndGo(quick(root))
    expect(setup.availability).toHaveLength(1)
    expect(setup.locations).toEqual([])
    expect(routeName()).toBe('locations')
  })
})

/** Taking in a shared setup: the dashboard, or the step still missing. */
describe('a shared setup taken in goes to the first step the setup still lacks', () => {
  async function take(link: string, own: { locations?: Location[]; availability?: Availability[] } = {}) {
    const { root, setup } = await openWelcome(own, { setup: link })
    const b = root.byClass('share-banner')[0].byTag('button').find((x) => x.textContent === da.setup_import)!
    await tapAndGo(b)
    return setup
  }
  const said = () => toasts.value.map((x) => x.message)

  // A link of target species only, taken in with nothing of the user's own:
  // no windows and no spots. It opened Lokationer, step 2.
  it('with neither windows nor spots: Tidsvinduer, step 1, and says the link has no windows', async () => {
    const setup = await take(std64({ v: 2, locs: [], sp: ['torsk'], av: [] }))
    expect(setup.targetSpecies).toEqual(['torsk'])
    expect(routeName()).toBe('availability')
    expect(said()).toEqual([da.setup_import_no_av])
  })

  it('with windows and no spots: Lokationer, with no word', async () => {
    await take(std64({ v: 2, locs: [], sp: ['torsk'], av: [{ d: [6], f: '05:00', t: '09:00', m: ['shore'] }] }))
    expect(routeName()).toBe('locations')
    expect(said()).toEqual([])
  })

  it('with spots and no windows: Tidsvinduer, and says why', async () => {
    await take(std64({ v: 2, locs: [{ n: 'Nordhuse', la: 55.97, lo: 12.1, wt: 'salt' }], sp: [], av: [] }))
    expect(routeName()).toBe('availability')
    expect(said()).toEqual([da.setup_import_no_av])
  })

  it('whole: the dashboard', async () => {
    await take(std64({ v: 2, locs: [{ n: 'Nordhuse', la: 55.97, lo: 12.1, wt: 'salt' }], sp: [], av: [] }), { availability: [WINDOW] })
    expect(routeName()).toBe('dashboard')
    expect(said()).toEqual([])
  })
})

/**
 * A shared window's spot added: a spot is saved by then, so the step
 * missing, if any, is the time windows. Its way on was right already.
 */
describe("a shared window's spot added goes on as the setup is", () => {
  const WIN = std64({ v: 2, n: 'Hornbæk', la: 56.09027, lo: 12.45693, wt: 'salt', d: '2026-07-15', f: '05:00', t: '09:00' })
  async function add(own: { locations?: Location[]; availability?: Availability[] }) {
    const { root, setup } = await openWelcome(own, { win: WIN })
    await tapAndGo(root.byClass('share-banner')[0].byTag('button').find((x) => x.textContent === da.share_add_loc)!)
    return setup
  }

  it('with no time windows: Tidsvinduer', async () => {
    const setup = await add({})
    expect(setup.locations.map((l) => l.name)).toEqual(['Hornbæk'])
    expect(routeName()).toBe('availability')
  })

  it('with time windows: the dashboard', async () => {
    await add({ availability: [WINDOW] })
    expect(routeName()).toBe('dashboard')
  })
})
