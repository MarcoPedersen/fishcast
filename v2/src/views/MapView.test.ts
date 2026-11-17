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
import { spotTypeLabel } from '@/lib/spotfinder'
import { langReady, setLang } from '@/lib/i18n'
import { LEAFLET_PREFIX } from '@/lib/osmCredit'
import { STRINGS } from '@/test/strings'
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

/**
 * Round F's browser check: the official spots' dots are 13.5 px across and
 * your spots' pins 16 or 26, and a tap that just missed a dot landed on the
 * map and started a new spot there. On a touch screen a tap within 20 px of
 * a pin's centre (a 40 px target) is a tap on the nearest pin; a mouse
 * clicks what it points at. And a tap on a dot opened its popup with the add
 * sheet, whose backdrop covered the popup's ✕: the sheet opens alone.
 */
describe("a finger on the setup map's pins", () => {
  type Pt = { x: number; y: number }
  const map = () => FL.maps[0]
  const userLayer = () => FL.layers[1]
  const onScreen = (lat: number, lon: number) => map().latLngToContainerPoint([lat, lon])
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
  const pinsOnScreen = () => [...userLayer().markers, ...spotLayer().markers].map((m) => onScreen(...m.latlng))
  const sheet = () => view!.root.byClass('sheet')[0]
  const openPopups = () => FL.created.filter((m) => m.popupOpen)
  const dotOf = (spot: Spot) => [...spotLayer().markers].find((m) => m.latlng[0] === spot.lat && m.latlng[1] === spot.lon)!
  const touch = (on: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q === '(pointer: coarse)' }))

  /** Zooms in on a spot, as you would to tap it, with no other pin within 45 px of it. */
  function zoomTo(lat: number, lon: number): Pt {
    map().setView([lat, lon], 11)
    const at = onScreen(lat, lon)
    expect(pinsOnScreen().filter((p) => dist(p, at) > 0.5).every((p) => dist(p, at) > 45)).toBe(true)
    return at
  }
  /** Taps the map at this screen point; returns where that is. */
  async function tapMap(at: Pt) {
    map().tap(at)
    await settle()
    return map().containerPointToLatLng(at)
  }
  /** Add on the sheet: the spot it saves. */
  async function add(): Promise<Location> {
    const before = setup.locations.length
    sheet().byClass('btn primary')[0].click()
    await nextTick()
    expect(setup.locations).toHaveLength(before + 1)
    return setup.locations[before]
  }

  // The place name of a tapped point: the coordinates.
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') })) })

  it('a tap 15 px beside an official spot opens it, and one 25 px off starts a new spot there', async () => {
    touch(true)
    await openMap()
    const dot = zoomTo(NEW_A.lat, NEW_A.lon)
    await tapMap({ x: dot.x + 9, y: dot.y - 12 })
    expect(openPopups()).toEqual([])
    const official = await add()
    expect(official).toMatchObject({ name: NEW_A.name, lat: NEW_A.lat, lon: NEW_A.lon, bottomType: NEW_A.bottomType })
    expect(bottomGuessed(official.id)).toBe(false)

    const where = await tapMap({ x: dot.x - 25, y: dot.y })
    const tapped = await add()
    expect(tapped).toMatchObject({ lat: where.lat, lon: where.lng })
    expect(bottomGuessed(tapped.id)).toBe(true)
  })

  // At the zoom the map opens on, 36 of the 57 official spots have another
  // within 20 px. An area of their own around each dot would go to the one
  // drawn last.
  it('of two official spots close together, the nearer takes the tap, the one drawn first too', async () => {
    touch(true)
    await openMap()
    const dots = [...spotLayer().markers]
    const taken = new Set(LOCS.map((l) => `${l.lat},${l.lon}`))
    let pair: [Spot, Spot, Pt, Pt] | undefined
    for (let i = 0; i < dots.length && !pair; i++) {
      for (let j = i + 1; j < dots.length && !pair; j++) {
        const [a, b] = [dots[i], dots[j]].map((m) => onScreen(...m.latlng))
        const d = dist(a, b)
        if (d < 24 || d > 32) continue
        const [nearA, nearB] = [0.4, 0.6].map((f) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }))
        // Only these two within reach of either tap.
        const others = pinsOnScreen().filter((p) => dist(p, a) > 0.5 && dist(p, b) > 0.5)
        if (others.some((p) => dist(p, nearA) <= 20 || dist(p, nearB) <= 20)) continue
        const spots = [i, j].map((k) => DK_SPOTS.find((s) => s.lat === dots[k].latlng[0] && s.lon === dots[k].latlng[1])!)
        if (spots.some((s) => taken.has(`${s.lat},${s.lon}`))) continue
        pair = [spots[0], spots[1], nearA, nearB]
      }
    }
    if (!pair) throw new Error('no two official spots 24-32 px apart on their own')
    const [first, second, nearFirst, nearSecond] = pair
    const name = () => (sheet().byTag('input')[0] as unknown as { value: string }).value
    await tapMap(nearFirst)
    expect(name()).toBe(first.name)
    sheet().byClass('btn ghost sm')[0].click() // ✕
    await nextTick()
    expect(sheet()).toBeUndefined()
    await tapMap(nearSecond)
    expect(name()).toBe(second.name)
  })

  it('a tap just beside your spot opens its popup, and no sheet: your pin over the dot it was added from', async () => {
    touch(true)
    await openMap()
    const [yours] = [...userLayer().markers].filter((m) => m.latlng[0] === LOCS[0].lat && m.latlng[1] === LOCS[0].lon)
    expect(dotOf(SEA[0])).toBeDefined() // the official spot it was added from, in the same place
    const pin = zoomTo(LOCS[0].lat, LOCS[0].lon)
    await tapMap({ x: pin.x, y: pin.y + 14 })
    expect(openPopups()).toEqual([yours])
    expect(sheet()).toBeUndefined()
  })

  it('a mouse clicks what it points at: 10 px beside a dot is a new spot there', async () => {
    touch(false)
    await openMap()
    const dot = zoomTo(NEW_A.lat, NEW_A.lon)
    const where = await tapMap({ x: dot.x + 10, y: dot.y })
    expect(await add()).toMatchObject({ lat: where.lat, lon: where.lng })
  })

  it.each([['a mouse', false], ['a finger', true]])(
    "%s on an official spot's dot opens the sheet for it alone: no popup under its backdrop",
    async (_, finger) => {
      touch(finger)
      await openMap()
      const [yours] = [...userLayer().markers].filter((m) => m.latlng[0] === LOCS[0].lat)
      yours.tap()
      expect(openPopups()).toEqual([yours])
      dotOf(NEW_A).tap()
      await settle()
      expect(openPopups()).toEqual([])
      // What the dot's popup said that the sheet did not: where it is and what kind of spot.
      expect(sheet().textContent).toContain(`${NEW_A.region} · ${spotTypeLabel(NEW_A.spotType)}`)
      // The tap stops at the dot: it does not go on to start a new spot where it landed.
      const official = await add()
      expect(official).toMatchObject({ name: NEW_A.name, lat: NEW_A.lat, lon: NEW_A.lon, bottomType: NEW_A.bottomType })
      expect(bottomGuessed(official.id)).toBe(false)
    },
  )

  // Review (round G): your spots' pins are drawn over the dots, and a 26 px
  // one hides a dot within 6 px of its centre whole. Where the map opens,
  // 6 px is about 4 km: a spot saved near an official one. A tap beside
  // your pin went to the dot it could not see, as the nearer centre.
  it("a dot hidden under your spot's pin takes no tap: beside your pin is yours, past its reach a new spot", async () => {
    // Your spot 3 px west of NEW_A's dot at zoom 11, with today's score.
    const px = 360 / (256 * 2 ** 11)
    const { spotSlug: _, ...near } = locationFromSpot(NEW_A)
    const mine: Location = { ...near, id: 'L9', name: 'Min plads', lon: NEW_A.lon - 3 * px }
    touch(true)
    await openMap(cacheOf([...LOCS, mine], NOW - 10 * 60_000))
    setup.locations.push({ ...mine })
    await settle()
    const [pin] = [...userLayer().markers].filter((m) => m.latlng[1] === mine.lon)
    expect(pin.iconHtml).toContain('min-width:26px')
    map().setView([NEW_A.lat, NEW_A.lon], 11)
    const at = onScreen(mine.lat, mine.lon)
    const dot = onScreen(NEW_A.lat, NEW_A.lon)
    expect(dist(at, dot)).toBeCloseTo(3, 1)

    // 17 px east of your pin, 14 from the dot under it.
    await tapMap({ x: at.x + 17, y: at.y })
    expect(openPopups()).toEqual([pin])
    expect(sheet()).toBeUndefined()

    // 22 px east, beyond your pin's reach: 19 from the hidden dot, a new spot.
    const where = await tapMap({ x: at.x + 22, y: at.y })
    expect(openPopups()).toEqual([])
    expect(await add()).toMatchObject({ lat: where.lat, lon: where.lng })
  })

  it('with "Vis alle pladser" off, a tap beside a dot no longer shown starts a new spot, with no region line', async () => {
    touch(true)
    await openMap()
    const box = view!.root.byClass('toggle')[0].byTag('input')[0] as unknown as { checked: boolean; dispatch(t: string): void }
    box.checked = false
    box.dispatch('change')
    await settle()
    expect(spotLayer().markers.size).toBe(0)
    const dot = zoomTo(NEW_A.lat, NEW_A.lon)
    const where = await tapMap({ x: dot.x + 9, y: dot.y - 12 })
    // The region line is an official spot's: a tapped point's sheet has none.
    expect(sheet().textContent).not.toContain(`${NEW_A.region} ·`)
    const tapped = await add()
    expect(tapped).toMatchObject({ lat: where.lat, lon: where.lng })
    expect(bottomGuessed(tapped.id)).toBe(true)
  })

  it('the region line follows the language shown, the sheet left open', async () => {
    await openMap()
    const line = (lang: 'da' | 'en') => `${NEW_A.region} · ${STRINGS[lang]['spottype_' + NEW_A.spotType]}`
    try {
      setLang('en')
      expect(await langReady()).toBe(true)
      dotOf(NEW_A).tap()
      await settle()
      expect(sheet().textContent).toContain(line('en'))
    } finally {
      setLang('da')
    }
    await settle()
    expect(sheet().textContent).toContain(line('da'))
  })
})

/**
 * Leaflet's zoom buttons and a popup's ✕ said "Zoom in", "Zoom out" and
 * "Close popup" on the Danish app. They take the app's words, in the
 * language shown (lib/leafletControls).
 */
describe("Leaflet's own controls on the setup map", () => {
  it('are named in the language shown, and renamed when it changes', async () => {
    await openMap()
    const m = FL.maps[0]
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

  // Round G merge: a pin's own popup, opened by a tap, is named as it opens.
  it("name your pin's popup ✕ when a tap opens it", async () => {
    await openMap()
    const [pin] = [...FL.layers[1].markers]
    pin.tap()
    expect(pin.popupOpen).toBe(true)
    expect(pin.frame?.closeButton.getAttribute('aria-label')).toBe(STRINGS.da.close)
    pin.remove()
    expect(FL.maps[0].popupPane.children).toEqual([])
  })

  it("start the credit line with Leaflet's credit, opening in a new tab", async () => {
    await openMap()
    expect(FL.maps[0].attributionControl.prefix).toBe(LEAFLET_PREFIX)
  })
})
