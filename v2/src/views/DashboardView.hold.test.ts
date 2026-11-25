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
import { useForecastStore } from '@/stores/forecast'
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

  // A sync from another device can change the targets mid-refresh. The 🎯
  // tag counted the targets of before until the refresh ended.
  it('the targets changed: the cards’ 🎯 tag as after the refresh', async () => {
    const { root, setup } = await openDashboard([L0])
    const land = holdTheNetwork()
    await updateAll(root)
    const tags = () => cards(root)[0].byClass('tags')[0].textContent
    const before = tags()
    setup.targetSpecies = ['havørred', 'gedde']
    await settle()
    expect(root.byClass('fetching')).toHaveLength(1)
    const during = tags()
    expect(during).not.toEqual(before)
    land()
    await settle()
    expect(root.byClass('fetching')).toEqual([])
    expect(during).toEqual(tags())
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
 * The fetching banner, "Opdater alle" and the hold count the fetches of the
 * spots you have. They counted any fetch under way, and a removed spot's
 * goes on (stores/forecast forgetSpots): removed while its weather was on
 * the way, it kept the banner up, "Opdater alle" off and the list held until
 * that fetch ended, the retries of the batch's fallback included.
 */
describe('the fetching banner counts the spots you have', () => {
  const refreshButton = (root: FakeNode) => root.byClass('head-refresh')[0].byTag('button')[0]
  const fetching = (root: FakeNode) => root.byClass('fetching').length > 0

  it('a spot removed while its own fetch runs: the banner goes, and "Opdater alle" is back', async () => {
    const land = holdTheNetwork()
    const { root, setup } = await openDashboard([L0, L1], [L0]) // L1's weather on its way
    expect(fetching(root)).toBe(true)
    expect(refreshButton(root).attrs.disabled).toBe(true)

    setup.locations = setup.locations.filter((l) => l.id !== L1.id)
    await settle()
    expect(fetching(root)).toBe(false)
    expect(refreshButton(root).attrs.disabled).toBe(false)
    expect(refreshButton(root).textContent.trim()).toBe(da.update_all)
    expect(spotsShown(root)).toEqual([L0.name])

    // Its weather lands after all: nothing of it shows.
    land()
    await settle()
    expect(fetching(root)).toBe(false)
    expect(spotsShown(root)).toEqual([L0.name])
    expect(cards(root)).toHaveLength(7)

    // "Opdater alle" fetches the spot you have.
    await updateAll(root)
    expect(vi.mocked(fetchForecasts).mock.lastCall![0].map((l) => l.id)).toEqual([L0.id])
    expect(fetching(root)).toBe(true)
  })

  it('every spot removed while the weather is on its way: the banner goes', async () => {
    holdTheNetwork()
    const { root, setup } = await openDashboard([L1], [])
    expect(fetching(root)).toBe(true)
    setup.locations = []
    await settle()
    expect(fetching(root)).toBe(false)
    expect(refreshButton(root).attrs.disabled).toBe(false)
    expect(root.byClass('notice').map((n) => n.textContent)).toEqual([da.dash_no_windows])
  })

  // Undone straight away, say: the fetch under way is its fetch again.
  it('a spot brought back while its fetch still runs: the banner is back until it lands', async () => {
    const land = holdTheNetwork()
    const { root, setup } = await openDashboard([L0, L1], [L0])
    const [mine, removed] = setup.locations
    setup.locations = [mine]
    await settle()
    expect(fetching(root)).toBe(false)
    setup.locations = [mine, removed]
    await settle()
    expect(fetching(root)).toBe(true)
    land()
    await settle()
    expect(fetching(root)).toBe(false)
    expect(spotsShown(root).sort()).toEqual([L0.name, L1.name].sort())
  })

  it('a spot added during a refresh: the banner stays until its own fetch lands too', async () => {
    const { root, setup } = await openDashboard([L0])
    const lands: (() => void)[] = []
    vi.mocked(fetchForecasts).mockImplementation((locs) => new Promise((resolve) => {
      lands.push(() => resolve(locs.map((l) => forecastFor(l))))
    }))
    await updateAll(root)
    // Its own fetch, as App.vue sends one for a spot new to the app.
    setup.locations = [...setup.locations, { ...L1 }]
    void useForecastStore().fetchAll([setup.locations[1]])
    await settle()
    expect(lands).toHaveLength(2)
    lands[0]() // the refresh's
    await settle()
    expect(fetching(root)).toBe(true) // L1 still on its way
    expect(refreshButton(root).attrs.disabled).toBe(true)
    lands[1]()
    await settle()
    expect(fetching(root)).toBe(false)
    expect(cards(root)).toHaveLength(14)
  })

  // The batch request failed: the spots are fetched three at a time, each
  // with its retries.
  it('the batch failed, and a spot removed while the spots come one by one: the banner goes once yours are in', async () => {
    const { root, setup } = await openDashboard([L0, L1])
    vi.mocked(fetchForecasts).mockRejectedValue(new Error('Bad response'))
    const lands = new Map<string, () => void>()
    vi.mocked(fetchForecast).mockReset().mockImplementation((l) => new Promise((resolve) => {
      lands.set(l.id, () => resolve(forecastFor(l)))
    }))
    await updateAll(root)
    expect([...lands.keys()]).toEqual([L0.id, L1.id])
    expect(fetching(root)).toBe(true)

    setup.locations = setup.locations.filter((l) => l.id !== L1.id)
    await settle()
    expect(fetching(root)).toBe(true) // L0 still on its way
    lands.get(L0.id)!()
    await settle()
    expect(fetching(root)).toBe(false)
    expect(refreshButton(root).attrs.disabled).toBe(false)
    expect(spotsShown(root)).toEqual([L0.name])
    lands.get(L1.id)!()
    await settle()
    expect(fetching(root)).toBe(false)
  })

  // The list is held for your spots' fetches only: a removed spot's held
  // the new weather of yours off the screen until its own fetch ended.
  it('a spot removed while the spots come one by one: your new weather shows as it lands', async () => {
    const { root, setup } = await openDashboard([L0, L1])
    const scores = () => cards(root).filter((c) => c.byClass('meta')[0].textContent.includes(L0.name))
      .map((c) => c.byClass('score')[0].textContent)
    const before = scores()
    vi.mocked(fetchForecasts).mockRejectedValue(new Error('Bad response'))
    const lands = new Map<string, (f: FetchedForecast) => void>()
    vi.mocked(fetchForecast).mockReset().mockImplementation((l) => new Promise((resolve) => { lands.set(l.id, resolve) }))
    await updateAll(root)
    setup.locations = setup.locations.filter((l) => l.id !== L1.id)
    await settle()

    // A gale for L0, while the removed spot's fetch still runs.
    const f = forecastFor(L0)
    lands.get(L0.id)!({ ...f, hourly: f.hourly.map((h) => ({ ...h, windMs: 17, gustMs: 24 })) })
    await settle()
    expect(fetching(root)).toBe(false)
    expect(scores()).toHaveLength(7)
    expect(scores()).not.toEqual(before)
    lands.get(L1.id)!(forecastFor(L1))
    await settle()
  })
})

/**
 * A spot with no weather on screen whose weather lands while the refresh
 * still runs for another spot. Its held cards said "Ingen vejrdata" and
 * offered "Hent vejrdata", with the weather in the store, until the last
 * spot landed; a press sent a second request for it.
 */
describe('a spot’s first weather, landing while the refresh still runs', () => {
  const ofSpot = (root: FakeNode, loc: Location) =>
    cards(root).filter((c) => c.byClass('meta')[0].textContent.includes(loc.name))

  it('a spot whose last fetch failed: its weather shows at once', async () => {
    // L1's fetch fails on opening: its cards have no weather.
    vi.mocked(fetchForecasts).mockImplementation(async (locs) => locs.map((l) => (l.id === L1.id ? null : forecastFor(l))))
    const { root } = await openDashboard([L0, L1], [L0])
    await vi.advanceTimersByTimeAsync(4000) // L1's own retries, 1 s and then 2 s apart
    await settle()
    expect(ofSpot(root, L1).flatMap((c) => c.byClass('nodata'))).toHaveLength(7)

    // "Opdater alle": the batch brings L1's weather. L0's is retried on its own.
    vi.mocked(fetchForecasts).mockImplementation(async (locs) => locs.map((l) => (l.id === L1.id ? forecastFor(l) : null)))
    vi.mocked(fetchForecast).mockReset().mockImplementation(() => new Promise(() => {}))
    await updateAll(root)
    expect(root.byClass('fetching')).toHaveLength(1) // L0 still on its way
    expect(ofSpot(root, L1)).toHaveLength(7)
    expect(ofSpot(root, L1).flatMap((c) => c.byClass('nodata'))).toEqual([])
    expect(fetchForecast).toHaveBeenCalledTimes(1) // L0's own, nothing for L1
  })

  it('a spot added meanwhile, on another device: its weather once its own fetch lands', async () => {
    localStorage.setItem('fc2-dash-density', 'simple')
    const { root, setup } = await openDashboard([L0])
    const land = holdTheNetwork()
    await updateAll(root)
    // Its own fetch, as App.vue sends one for a spot new to the app, lands at once.
    vi.mocked(fetchForecasts).mockImplementation(async (locs) => locs.map((l) => forecastFor(l)))
    setup.locations = [...setup.locations, { ...L1 }]
    await useForecastStore().fetchAll([setup.locations[1]])
    await settle()
    expect(root.byClass('fetching')).toHaveLength(1) // L0 still on its way
    const labels = root.byClass('srow').filter((r) => r.byClass('srow-loc')[0].textContent.includes(L1.name))
      .map((r) => r.byClass('srow-label')[0].textContent)
    expect(labels).toHaveLength(7)
    expect(labels.filter((l) => l === da.data_missing || l.includes(da.loading))).toEqual([])
    land()
    await settle()
  })

  // Only a spot's first weather: a spot's new weather over the weather on
  // screen waits for the refresh to end, as it always has.
  it('a spot’s new weather over the weather on screen stays held', async () => {
    const { root } = await openDashboard([L0, L1])
    const scores = () => ofSpot(root, L1).map((c) => c.byClass('score')[0].textContent)
    const before = scores()
    // A gale for L1 in the batch. L0's is retried on its own.
    const gale = (l: Location): FetchedForecast => {
      const f = forecastFor(l)
      return { ...f, hourly: f.hourly.map((h) => ({ ...h, windMs: 17, gustMs: 24 })) }
    }
    vi.mocked(fetchForecasts).mockImplementation(async (locs) => locs.map((l) => (l.id === L1.id ? gale(l) : null)))
    let landL0!: () => void
    vi.mocked(fetchForecast).mockReset().mockImplementation((l) => new Promise((resolve) => { landL0 = () => resolve(forecastFor(l)) }))
    await updateAll(root)
    expect(root.byClass('fetching')).toHaveLength(1)
    expect(scores()).toEqual(before)

    landL0()
    await settle()
    expect(root.byClass('fetching')).toEqual([])
    expect(scores()).not.toEqual(before)
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
