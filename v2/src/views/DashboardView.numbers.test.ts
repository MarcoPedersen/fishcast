// @vitest-environment vue-dom
/**
 * The decimals in a window's tags and in its score breakdown, as mounted:
 * the real view and stores on the in-memory DOM, the network mocked. The
 * Danish dashboard wrote them with a full stop ("💧 9.4 °C", "9.5 m/s"). They
 * follow the language shown, and change with it while the breakdown is open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'

vi.mock('@/lib/weather', async (orig) => {
  const real = await orig<typeof import('@/lib/weather')>()
  return { ...real, fetchForecast: vi.fn(), fetchForecasts: vi.fn(), fetchLightningStatus: vi.fn() }
})
vi.mock('@/lib/coastClient', () => ({ deriveCoast: vi.fn(() => new Promise(() => {})), terminate: vi.fn() }))

import { DK_SPOTS, locationFromSpot } from '@/lib/spots'
import { fetchForecast, fetchForecasts, fetchLightningStatus, forecastKey, type FetchedForecast } from '@/lib/weather'
import { langReady, setLang } from '@/lib/i18n'
import type { Availability, HourData, Location, MarineHour } from '@/lib/types'
import { useSetupStore } from '@/stores/setup'
import DashboardView from './DashboardView.vue'

// Monday 9 November 2026, 06:00 in Denmark.
const NOW = Date.UTC(2026, 10, 9, 5, 0)
const H = 3600_000
const AVAIL: Availability[] = [{ id: 'a', days: [0, 1, 2, 3, 4, 5, 6], from: '07:00', to: '10:00', methods: ['shore'] }]
const SPOT = DK_SPOTS.find((s) => s.waterType === 'salt')!
const LOC: Location = { id: 'L0', ...locationFromSpot(SPOT) }

/** A fresh breeze (a breakdown row for every target) over sea trout's water, from yesterday to a week ahead. */
function forecastFor(loc: Location, fetched = Date.now()): FetchedForecast {
  const d = new Date(fetched)
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime()
  const hourly: HourData[] = []
  const marine: MarineHour[] = []
  for (let h = 0; h < 24 * 9; h++) {
    const time = start + h * H
    hourly.push({ time, temp: 9, windMs: 9.5, windDir: 250, gustMs: 12.5, cloud: 70, precipPct: 10, pressure: 1012 })
    marine.push({ time, waveM: 0.5, wavePeriod: 4, sstC: 9.4 })
  }
  return { fetched, fetchedFor: forecastKey(loc), hourly, marine, tides: null }
}

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined
let pinia: ReturnType<typeof createPinia>

async function settle() {
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
  }
}

async function openDashboard(): Promise<FakeNode> {
  localStorage.setItem('fc2-forecasts', JSON.stringify({ [LOC.id]: forecastFor(LOC, NOW - 10 * 60_000) }))
  pinia = createPinia()
  setActivePinia(pinia)
  const setup = useSetupStore()
  setup.locations = [{ ...LOC }]
  setup.availability = AVAIL.map((a) => ({ ...a }))
  setup.targetSpecies = ['havørred']
  view = mount(DashboardView, (app) => { app.use(pinia); app.config.warnHandler = () => {} })
  await settle()
  return view.root
}

/** The first card's water-temperature tag, and the wind and water-temperature rows of its open breakdown. */
const shown = (root: FakeNode) => {
  const rows = root.byClass('bd-row').map((r) => [r.byClass('bd-icon')[0].textContent, r.byClass('bd-label')[0].textContent])
  return {
    tag: root.byClass('card win')[0].byClass('tag').map((n) => n.textContent.trim()).filter((s) => s.startsWith('💧')),
    rows: rows.filter(([icon]) => icon === '💨' || icon === '💧').map(([icon, label]) => `${icon} ${label}`),
  }
}
const inDanish = { tag: ['💧 9,4 °C'], rows: ['💨 9,5 m/s', '💧 9,4 °C'] }

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  restoreDocument = installDocument()
  Object.assign(document, { body: { style: {} } })
  vi.stubGlobal('window', { innerWidth: 1024, addEventListener() {}, removeEventListener() {} })
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('getComputedStyle', () => ({ overflowX: 'visible' }))
  localStorage.clear()
  vi.mocked(fetchForecasts).mockImplementation(async (locs) => locs.map((l) => forecastFor(l)))
  vi.mocked(fetchForecast).mockImplementation(async (l) => forecastFor(l))
  vi.mocked(fetchLightningStatus).mockResolvedValue({ level: 'clear', closestKm: null })
})
afterEach(() => {
  view?.unmount()
  view = undefined
  setLang('da')
  vi.unstubAllGlobals()
  vi.useRealTimers()
  restoreDocument()
})

describe('a window’s tags and breakdown write their decimals', () => {
  it('with a comma in Danish, and with a point once English is shown, the breakdown open throughout', async () => {
    const root = await openDashboard()
    root.byClass('card win')[0].byClass('score')[0].click()
    await settle()
    expect(shown(root)).toEqual(inDanish)
    setLang('en')
    expect(await langReady()).toBe(true)
    setActivePinia(pinia)
    await settle()
    expect(shown(root)).toEqual({ tag: ['💧 9.4 °C'], rows: ['💨 9.5 m/s', '💧 9.4 °C'] })
    setLang('da')
    await settle()
    expect(shown(root)).toEqual(inDanish)
  })
})
