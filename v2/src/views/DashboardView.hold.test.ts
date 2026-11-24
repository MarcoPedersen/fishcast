// @vitest-environment vue-dom
/**
 * The dashboard while a refresh runs, as mounted: the real view and stores on
 * the in-memory DOM, the network mocked. The list on screen is held while a
 * refresh runs (lib/holdWhileLoading), so the cards don't reorder as the
 * forecasts land. Round V's hunt found what the hold kept too:
 * - a spot removed during "Opdater alle" kept its cards until the refresh
 *   ended, and "Nulstil arter & tider" kept every card;
 * - after a language switch, the cards' tags, tips and lure colours stayed in
 *   the old language, and the 💡 panel gave the tip of a target not active
 *   at the spot;
 * - a new spot loading opened on "?" cards, not the skeletons, when a removed
 *   spot's weather was still in the cache;
 * - the simple view's rows with no weather said "?" and nothing else;
 * - the tab chosen went back to Tidsvinduer after a visit to another page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'

vi.mock('@/lib/weather', async (orig) => {
  const real = await orig<typeof import('@/lib/weather')>()
  return { ...real, fetchForecast: vi.fn(), fetchForecasts: vi.fn(), fetchLightningStatus: vi.fn() }
})
vi.mock('@/lib/coastClient', () => ({ deriveCoast: vi.fn(() => new Promise(() => {})), terminate: vi.fn() }))

import { DK_SPOTS, locationFromSpot } from '@/lib/spots'
import { fetchForecast, fetchForecasts, fetchLightningStatus, forecastKey, type FetchedForecast } from '@/lib/weather'
import { langReady, setLang } from '@/lib/i18n'
import { STRINGS } from '@/test/strings'
import type { Availability, HourData, Location, MarineHour } from '@/lib/types'
import { useSetupStore } from '@/stores/setup'
import DashboardView from './DashboardView.vue'

const da = STRINGS.da
const en = STRINGS.en

// Monday 9 November 2026, 06:00 in Denmark.
const NOW = Date.UTC(2026, 10, 9, 5, 0)
const H = 3600_000
const AVAIL: Availability[] = [{ id: 'a', days: [0, 1, 2, 3, 4, 5, 6], from: '07:00', to: '10:00', methods: ['shore'] }]
// Three catalogue sea spots.
const [L0, L1, L2]: Location[] = DK_SPOTS.filter((s) => s.waterType !== 'fresh').slice(0, 3)
  .map((s, i) => ({ id: 'L' + i, ...locationFromSpot(s) }))

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

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined
let pinia: Pinia

async function settle() {
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
  }
}

/** The dashboard for `locs`, with the weather of `cached` fetched 10 min ago. */
async function openDashboard(locs: Location[], cached: Location[] = locs, targets = ['havørred']) {
  localStorage.setItem('fc2-forecasts', JSON.stringify(Object.fromEntries(cached.map((l) => [l.id, forecastFor(l, NOW - 10 * 60_000)]))))
  pinia = createPinia()
  setActivePinia(pinia)
  const setup = useSetupStore()
  setup.locations = locs.map((l) => ({ ...l }))
  setup.availability = AVAIL.map((a) => ({ ...a }))
  setup.targetSpecies = targets
  view = mount(DashboardView, (app) => { app.use(pinia); app.config.warnHandler = () => {} })
  await settle()
  return { root: view.root, setup }
}

/** From now on, a refresh waits until `land()`: with the weather, or with none (`land(false)`). */
function holdTheNetwork(): (withWeather?: boolean) => void {
  let land!: (withWeather: boolean) => void
  vi.mocked(fetchForecasts).mockImplementation((locs) => new Promise((resolve) => {
    land = (withWeather) => resolve(locs.map((l) => (withWeather ? forecastFor(l) : null)))
  }))
  return (withWeather = true) => land(withWeather)
}
/** Every key and value in storage. */
const storage = () => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!)
  .map((k) => [k, localStorage.getItem(k)])
/** "Opdater alle". */
async function updateAll(root: FakeNode) {
  root.byClass('head-refresh')[0].byTag('button')[0].click()
  await settle()
}

const cards = (root: FakeNode) => root.byClass('card win').filter((c) => !c.hasClass('skel'))
/** The spots the cards are for, each once. */
const spotsShown = (root: FakeNode) =>
  [...new Set(cards(root).map((c) => c.byClass('meta')[0].textContent.split(' · ')[0].replace('📍', '').trim()))]

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  restoreDocument = installDocument()
  Object.assign(document, { body: { style: {} } })
  vi.stubGlobal('window', { innerWidth: 1024, addEventListener() {}, removeEventListener() {} })
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('getComputedStyle', () => ({ overflowX: 'visible' }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  localStorage.clear()
  vi.mocked(fetchForecasts).mockReset().mockImplementation(async (locs) => locs.map((l) => forecastFor(l)))
  vi.mocked(fetchForecast).mockReset().mockRejectedValue(new Error('Failed to fetch'))
  vi.mocked(fetchLightningStatus).mockReset().mockResolvedValue({ level: 'clear', closestKm: null })
})
afterEach(() => {
  view?.unmount()
  view = undefined
  setLang('da')
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  restoreDocument()
})

describe('a change to the setup while a refresh runs shows at once', () => {
  it('a spot removed: its cards go, and the rest stay held', async () => {
    const { root, setup } = await openDashboard([L0, L1])
    const land = holdTheNetwork()
    await updateAll(root)
    expect(spotsShown(root)).toEqual([L0.name, L1.name])
    expect(cards(root)).toHaveLength(14) // two spots, today to Sunday, 07–10

    setup.locations = setup.locations.filter((l) => l.id !== L1.id)
    await settle()
    expect(root.byClass('fetching')).toHaveLength(1) // the refresh still runs
    expect(spotsShown(root)).toEqual([L0.name])
    expect(cards(root)).toHaveLength(7)
    expect(root.byClass('toppick')[0].textContent).toContain(L0.name)

    land()
    await settle()
    expect(spotsShown(root)).toEqual([L0.name])
    expect(cards(root)).toHaveLength(7)
  })

  it('"Nulstil arter & tider": the cards go, and the notice says why', async () => {
    const { root, setup } = await openDashboard([L0])
    holdTheNetwork()
    await updateAll(root)
    expect(cards(root)).toHaveLength(7)

    setup.resetChoices()
    await settle()
    expect(root.byClass('fetching')).toHaveLength(1)
    expect(cards(root)).toHaveLength(0)
    expect(root.byClass('notice').map((n) => n.textContent)).toEqual([da.dash_no_windows])
  })

  it('a slot added: its cards come, with the weather on screen', async () => {
    const { root, setup } = await openDashboard([L0])
    holdTheNetwork()
    await updateAll(root)
    setup.availability.push({ id: 'b', days: [0, 1, 2, 3, 4, 5, 6], from: '15:00', to: '17:00', methods: ['shore'] })
    await settle()
    expect(cards(root)).toHaveLength(14)
  })

  it('a language switch: tags, tips and lure colours in the new language, as after the refresh', async () => {
    // Pike is not active at a sea spot: its tip is left out of the 💡 panel.
    const { root } = await openDashboard([L0], [L0], ['havørred', 'gedde'])
    const land = holdTheNetwork()
    await updateAll(root)
    setLang('en')
    expect(await langReady()).toBe(true)
    setActivePinia(pinia)
    await settle()
    /** The first card's tags, lure colours and 💡 tips. */
    const shown = async () => {
      const card = cards(root)[0]
      card.byClass('tips-btn')[0].click()
      await nextTick()
      const out = {
        tags: card.byClass('tags')[0].textContent,
        swatches: card.byClass('lure-mini')[0].attrs.title,
        tips: card.byClass('tips-panel')[0].byClass('tip').map((x) => x.textContent),
      }
      card.byClass('tips-btn')[0].click()
      await nextTick()
      return out
    }
    const during = await shown()
    expect(root.byClass('fetching')).toHaveLength(1)
    expect(during.tips?.[0]).toContain(en.lure_label)
    expect(during.tips).toContain(en.tip_havørred)
    expect(during.tips).not.toContain(en.tip_gedde)
    expect(during.tips).not.toContain(da.tip_gedde)

    land()
    await settle()
    expect(root.byClass('fetching')).toEqual([])
    expect(during).toEqual(await shown())
  })
})

/**
 * Skeletons, not "?" cards, while the weather of every spot you have is on
 * its way. Weather is kept 48 h, a removed spot's too: it counted as weather
 * on screen.
 */
describe('the first load of the spots you have', () => {
  it('shows the skeletons while a removed spot’s weather is still kept', async () => {
    const land = holdTheNetwork()
    const { root } = await openDashboard([L1], [L2])
    expect(root.byClass('skel')).toHaveLength(4)
    expect(cards(root)).toHaveLength(0)
    land()
    await settle()
    expect(root.byClass('skel')).toHaveLength(0)
    expect(cards(root)).toHaveLength(7)
  })

  it('the spot removed while its weather is on the way: the notice, not the skeletons', async () => {
    holdTheNetwork()
    const { root, setup } = await openDashboard([L1], [])
    expect(root.byClass('skel')).toHaveLength(4)
    setup.locations = []
    await settle()
    expect(root.byClass('skel')).toHaveLength(0)
    expect(root.byClass('notice').map((n) => n.textContent)).toEqual([da.dash_no_windows])
  })

  it('with weather for a spot you have, its cards show at once, the new spot’s on the way', async () => {
    holdTheNetwork()
    const { root } = await openDashboard([L0, L1], [L0])
    expect(root.byClass('skel')).toHaveLength(0)
    expect(cards(root)).toHaveLength(14)
  })
})

/** The simple view's row with no weather said "?" and no word. */
describe('the simple view’s rows with no weather', () => {
  const rowsOf = (root: FakeNode, loc: Location) =>
    root.byClass('srow').filter((r) => r.byClass('srow-loc')[0].textContent.includes(loc.name))
  const labels = (root: FakeNode, loc: Location) => rowsOf(root, loc).map((r) => r.byClass('srow-label')[0]?.textContent)

  beforeEach(() => { localStorage.setItem('fc2-dash-density', 'simple') })

  it('say the weather is on its way, then that it is missing', async () => {
    const land = holdTheNetwork()
    const { root } = await openDashboard([L0, L1], [L0])
    expect(labels(root, L1)).toEqual(Array(7).fill(`⏳ ${da.loading}`))
    // The rows with weather keep their score's word.
    expect(labels(root, L0).every((l) => l && l !== `⏳ ${da.loading}` && l !== da.data_missing)).toBe(true)

    land(false)
    await settle()
    await vi.advanceTimersByTimeAsync(4000) // L1's own retries, 1 s and then 2 s apart
    await settle()
    expect(labels(root, L1)).toEqual(Array(7).fill(da.data_missing))
  })

  it('in English once English is shown', async () => {
    holdTheNetwork()
    const { root } = await openDashboard([L0, L1], [L0])
    setLang('en')
    expect(await langReady()).toBe(true)
    setActivePinia(pinia)
    await settle()
    expect(labels(root, L1)).toEqual(Array(7).fill(`⏳ ${en.loading}`))
  })
})

/**
 * The tab chosen is kept while the app runs, as the map's compare is: it
 * went back to Tidsvinduer after a look at another page. Not stored: a fresh
 * start opens on Tidsvinduer.
 */
describe('the tab chosen', () => {
  const selected = (root: FakeNode) => root.byClass('tab').filter((b) => b.attrs['aria-selected'] === true).map((b) => b.attrs.id)
  const tabButton = (root: FakeNode, id: string) => root.byClass('tab').find((b) => b.attrs.id === 'dash-tab-' + id)!

  it('is still chosen when the dashboard is opened again', async () => {
    let { root } = await openDashboard([L0])
    expect(selected(root)).toEqual(['dash-tab-windows'])
    const stored = storage()
    try {
      tabButton(root, 'conditions').click()
      await settle()
      expect(selected(root)).toEqual(['dash-tab-conditions'])
      expect(storage()).toEqual(stored)

      view!.unmount()
      ;({ root } = await openDashboard([L0]))
      expect(selected(root)).toEqual(['dash-tab-conditions'])
      expect(root.byClass('conditions')).toHaveLength(1)
    } finally {
      // Back to the start for the tests after: the choice outlives a mount.
      tabButton(root, 'windows').click()
      await settle()
    }
    expect(selected(root)).toEqual(['dash-tab-windows'])
  })
})
