// @vitest-environment vue-dom
/**
 * The dashboard map's "compare with official spots", as mounted: which
 * lightning checks rescore the official spots, and that what the tab shows
 * after each one is what a tab opened afresh would show. The real tab, Pinia
 * stores and scoring; Leaflet faked (test/fakeLeaflet) and the network mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h, nextTick, shallowRef } from 'vue'
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
import type { Availability, HourData, LightningStatus, Location, MarineHour, ScoredWindow } from '@/lib/types'
import { langReady, setLang, t } from '@/lib/i18n'
import { LEAFLET_PREFIX } from '@/lib/osmCredit'
import { STRINGS } from '@/test/strings'
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

/** A window of yours today, 07–10, with this score. */
const yours = (loc: Location, score: number): ScoredWindow =>
  ({ location: loc, date: new Date(Date.UTC(2026, 10, 9)), from: '07:00', to: '10:00', score, noData: false, bestHourStr: null, tags: [] })
/** The windows of yours a tab gets when a test names none: none, unless a describe sets some. */
let yourWindows: () => ScoredWindow[] = () => []

/** Mounts the map tab for today ("I dag"), with these windows of yours, and returns its root and its pin layer. */
async function openTab(windows: () => ScoredWindow[] = yourWindows) {
  const layerAt = FL.layers.length
  const view = mount({ render: () => h(MapTab, { windows: windows(), horizon: 1 }) }, (app) => {
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
  yourWindows = () => []
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
  // A poor window at each of your spots, so the "better" banner has a score
  // of yours to beat: with none, it is not shown at all.
  beforeEach(() => { yourWindows = () => [yours(A, 5), yours(B, 5)] })

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

/**
 * Review (round E): the pins' popups are built from strings outside a render
 * and kept (Leaflet holds them). The tab rebuilt them only for new windows.
 * Scoring reads strings, so a scored spot's popup turned with the language;
 * a spot with no score yet kept "Ingen score i perioden" after a switch to
 * English, or English landing late (a chunk of its own, lib/i18n.ts).
 */
describe('the language', () => {
  it('the popups follow the language shown, English landing after the tab opened too', async () => {
    // Compare off (it stays as the last tab left it), so no official spots are
    // loaded: nothing here is scored, and only the language changes.
    const first = await openTab()
    const box = first.root.byClass('cmp')[0].byTag('input')[0] as FakeNode & { checked: boolean }
    if (box.checked) { box.checked = false; box.dispatch('change'); await settle() }
    first.unmount()
    const tab = await openTab() // your spots, not scored yet
    const danish = pinsOf(tab)
    expect(danish).toContain(t('map_no_score'))
    try {
      setLang('en')
      expect(await langReady()).toBe(true)
      await settle()
      expect(pinsOf(tab)).toContain(t('map_no_score'))
      expect(pinsOf(tab)).not.toBe(danish)
      expect(shown(tab)).toBe(await shownAfresh())
    } finally {
      setLang('da')
    }
    await settle()
    expect(pinsOf(tab)).toBe(danish)
  })

  /**
   * Leaflet's zoom buttons and a popup's ✕ said "Zoom in", "Zoom out" and
   * "Close popup" on the Danish app. They take the app's words, in the
   * language shown (lib/leafletControls).
   */
  it("Leaflet's own controls are named in the language shown, and renamed when it changes", async () => {
    await openTab()
    const m = FL.maps[FL.maps.length - 1]
    const popup = m.openPopup()
    const names = () => [m.zoomIn, m.zoomOut, popup.closeButton].map((e) => [e.getAttribute('aria-label'), e.getAttribute('title')])
    const of = (l: 'da' | 'en') => ['map_zoom_in', 'map_zoom_out', 'close'].map((k) => [STRINGS[l][k], STRINGS[l][k]])
    expect(names()).toEqual(of('da'))
    try {
      setLang('en')
      expect(await langReady()).toBe(true)
      await settle()
      expect(names()).toEqual(of('en'))
    } finally {
      setLang('da')
    }
    await settle()
    expect(names()).toEqual(of('da'))
  })

  it("the credit line starts with Leaflet's credit, opening in a new tab", async () => {
    await openTab()
    expect(FL.maps[FL.maps.length - 1].attributionControl.prefix).toBe(LEAFLET_PREFIX)
  })
})

/**
 * Round F's browser check: your spots' pins here are 30 px, or 14 without a
 * score, and a tap beside one did nothing. On a touch screen a tap within
 * 20 px of a pin's centre (a 40 px target) opens the nearest pin's popup; a
 * mouse clicks what it points at.
 */
describe("a finger on the map tab's pins", () => {
  type Pt = { x: number; y: number }
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
  const touch = (on: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q === '(pointer: coarse)' }))

  /** The tab with your two spots' pins only (compare off), its map, and A's and B's pins and places. */
  async function yourPins() {
    const tab = await openTab()
    const box = tab.root.byClass('cmp')[0].byTag('input')[0] as FakeNode & { checked: boolean }
    if (box.checked) { box.checked = false; box.dispatch('change'); await settle() }
    const map = tab.layer.map!
    const pinOf = (l: Location) => [...tab.layer.markers].find((m) => m.latlng[0] === l.lat && m.latlng[1] === l.lon)!
    expect(tab.layer.markers.size).toBe(2)
    const a = map.latLngToContainerPoint([A.lat, A.lon]), b = map.latLngToContainerPoint([B.lat, B.lon])
    const open = () => [...tab.layer.markers].filter((m) => m.popupOpen)
    // 10 px beyond A, away from B: within A's reach only.
    const besideA = { x: a.x - ((b.x - a.x) * 10) / dist(a, b), y: a.y - ((b.y - a.y) * 10) / dist(a, b) }
    /** Lets go of a pointer of this type on the map, then taps it at this point, the click naming `says`, or no pointer. */
    const tapWith = async (at: Pt, pointer: string, says?: string) => {
      tab.root.byClass('map')[0].dispatch('pointerup', { pointerType: pointer, isPrimary: true })
      map.tap(at, says === undefined ? {} : { pointerType: says })
      await settle()
    }
    return { map, a, b, pinA: pinOf(A), pinB: pinOf(B), open, besideA, tapWith }
  }

  it('a tap beside your spot opens its popup, the nearer of two takes it, and 25 px off none does', async () => {
    touch(true)
    const { map, a, b, pinA, pinB, open } = await yourPins()
    // About 34 px apart where the map opens: a tap between them is within reach of both.
    const d = dist(a, b)
    expect(d).toBeGreaterThan(22)
    expect(d).toBeLessThan(36)
    const along = (f: number) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f })
    map.tap(along(0.42))
    await settle()
    expect(open()).toEqual([pinA])
    map.tap(along(0.58))
    await settle()
    expect(open()).toEqual([pinB])
    map.tap(along(-25 / d)) // 25 px beyond A, away from B
    await settle()
    expect(open()).toEqual([])
  })

  it('a mouse clicks what it points at: 10 px beside a pin opens nothing', async () => {
    touch(false)
    const { map, besideA, open } = await yourPins()
    map.tap(besideA)
    await settle()
    expect(open()).toEqual([])
  })

  // Review (round G): a tap right on your pin with its popup open closes it
  // (Leaflet's marker toggles its popup). A near miss beside it closed it on
  // the map's 'preclick' and then opened it again, as the nearest pin.
  it('a near miss on your pin with its popup open closes it, as a tap right on it does', async () => {
    touch(true)
    const { map, besideA, pinA, pinB, open } = await yourPins()
    pinA.tap()
    expect(open()).toEqual([pinA])
    pinA.tap()
    expect(open()).toEqual([])
    for (const shown of [[pinA], [], [pinA]]) {
      map.tap(besideA)
      await settle()
      expect(open()).toEqual(shown)
    }
    // With another pin's popup open, a near miss on yours opens yours.
    pinB.tap()
    map.tap(besideA)
    await settle()
    expect(open()).toEqual([pinA])
  })

  // Review (round G): (pointer: coarse) is the screen's primary pointer only.
  it.each([
    ["a touchscreen laptop's finger", false, 'touch', 'touch', true],
    ['a pen', false, 'pen', 'pen', true],
    ["Safari's finger, its click saying mouse (WebKit bug 282988)", false, 'touch', 'mouse', true],
    ["Safari's finger before 18.2, its click naming no pointer", false, 'touch', undefined, true],
    ["a phone's mouse", true, 'mouse', 'mouse', false],
  ])("%s beside your pin: the pointer decides, not the screen's own", async (_, coarse, pointer, says, opens) => {
    touch(coarse)
    const { besideA, pinA, open, tapWith } = await yourPins()
    await tapWith(besideA, pointer, says)
    expect(open()).toEqual(opens ? [pinA] : [])
  })
})

/**
 * Round H's browser check: a pin's popup pointed at the pin's centre, and
 * its tip covered the top of the pin. A tap there kept the popup open. It
 * points at the pin's top edge now (lib/pinIcon).
 */
describe("the map tab's pins and their popups", () => {
  const anchors = (m: FL.FakeMarker) => {
    const { iconSize, iconAnchor, popupAnchor } = m.icon!.options
    return { iconSize, iconAnchor, popupAnchor }
  }
  const of = (size: number) => ({ iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2] })
  const today = (loc: Location, score: number): ScoredWindow =>
    ({ location: loc, date: new Date(Date.UTC(2026, 10, 9)), from: '07:00', to: '10:00', score, noData: false, bestHourStr: null, tags: [] })

  it("your pin's popup points at its top edge, and moves up with the pin when its score lands", async () => {
    const windows = shallowRef<ScoredWindow[]>([])
    const tab = await openTab(() => windows.value)
    const box = tab.root.byClass('cmp')[0].byTag('input')[0] as FakeNode & { checked: boolean }
    if (box.checked) { box.checked = false; box.dispatch('change'); await settle() }
    const pins = [...tab.layer.markers]
    expect(pins.map(anchors)).toEqual([of(14), of(14)]) // no score yet: a dot
    const pinA = pins.find((m) => m.latlng[0] === A.lat && m.latlng[1] === A.lon)!
    pinA.tap()
    expect(pinA.popupAt).toEqual([0, -7])

    windows.value = [today(A, 72), today(B, 58)]
    await settle()
    // The same markers, each icon swapped for its score.
    expect([...tab.layer.markers]).toEqual(pins)
    expect(pins.map(anchors)).toEqual([of(30), of(30)])
    expect(pinA.popupOpen).toBe(true)
    expect(pinA.popupAt).toEqual([0, -15])
  })

  it("the official spots' pins too, and after a rescore", async () => {
    const tab = await openTab()
    await compareOn(tab.root)
    await check() // all clear
    const official = [...tab.layer.markers].filter((m) => m.iconHtml.includes('border-style:dashed'))
    expect(official.length).toBeGreaterThanOrEqual(4)
    expect(official.map(anchors)).toEqual(official.map(() => of(30)))
    official[0].tap()
    expect(official[0].popupAt).toEqual([0, -15])

    const quiet = official.map((m) => m.iconHtml)
    answers = { A: storm('danger', 6) } // capped: every official spot's badge is rebuilt
    await check()
    expect(official.map((m) => m.iconHtml).filter((html, i) => html === quiet[i])).toEqual([])
    expect(official.map(anchors)).toEqual(official.map(() => of(30)))
    expect(official[0].popupOpen).toBe(true)
    expect(official[0].popupAt).toEqual([0, -15])
  })
})

/**
 * Round L's sweep. The compare loaded the official spots' weather when it was
 * ticked or your spots changed, and never again while the tab stayed open:
 * past midnight it rescored yesterday's weather for the new day, while your
 * own spots were refetched (App.vue). Fetched yesterday, that weather has no
 * tides for the new 7th day, and its hours end before that day's night does.
 * And the banner measured the official spots against 0 when none of your
 * spots had a score (their weather not loaded, or failed), so the best of
 * them "scored higher than your own spots".
 */
describe('compare with official spots, as the day turns and before yours are scored', () => {
  /** Moves the clock to `at` and lets the tab's minute tick see it. */
  async function clockTo(at: number) {
    vi.setSystemTime(at)
    await vi.advanceTimersByTimeAsync(60_000)
    await settle()
  }

  it('their weather is loaded again when the local date turns, and when the UTC date does, with the tab left open', async () => {
    const tab = await openTab()
    await compareOn(tab.root)
    expect(mBatch).toHaveBeenCalledTimes(1)
    await clockTo(NOW + 17 * H) // 23:00: the same day
    expect(mBatch).toHaveBeenCalledTimes(1)
    await clockTo(Date.UTC(2026, 10, 9, 23, 1)) // Tuesday 00:01 in Denmark
    expect(mBatch).toHaveBeenCalledTimes(2)
    await clockTo(Date.UTC(2026, 10, 10, 0, 1)) // 01:01: the UTC date turns
    expect(mBatch).toHaveBeenCalledTimes(3)
    expect(shown(tab)).toBe(await shownAfresh())
    expect(mBatch).toHaveBeenCalledTimes(3) // the fresh tab found it all loaded
  })

  it('not while compare is off', async () => {
    const tab = await openTab()
    await compareOn(tab.root)
    const box = tab.root.byClass('cmp')[0].byTag('input')[0] as FakeNode & { checked: boolean }
    box.checked = false
    box.dispatch('change')
    await settle()
    await clockTo(Date.UTC(2026, 10, 9, 23, 1))
    expect(mBatch).toHaveBeenCalledTimes(1)
  })

  it('no "scores higher" banner while none of your spots has a score', async () => {
    const tab = await openTab()
    await compareOn(tab.root)
    expect([...tab.layer.markers].filter((m) => m.iconHtml.includes('border-style:dashed')).length).toBeGreaterThanOrEqual(4)
    expect(tab.root.byClass('better')).toEqual([])
  })

  it('the banner once one of yours has a lower score', async () => {
    const tab = await openTab(() => [yours(A, 5)])
    await compareOn(tab.root)
    expect(tab.root.byClass('better')[0]?.textContent).toContain(t('maptab_better'))
  })
})
