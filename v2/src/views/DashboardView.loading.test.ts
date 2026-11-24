// @vitest-environment vue-dom
/**
 * The cards of a spot whose weather is on its way, as mounted: the real view
 * and stores on the in-memory DOM, the network mocked. Opened while a spot's
 * first fetch was under way (one just added, or one whose cache had expired,
 * beside spots with weather), its cards said "⚠️ Ingen vejrdata" with a
 * "Hent vejrdata" button. A press sent a second request for the spot beside
 * the one under way; when it failed, the spot was marked failed and a toast
 * said its weather could not be fetched, though the first request had
 * brought it. The Vejr & Bølger tab says "⏳ Henter…" for such a spot already.
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
import { STRINGS } from '@/test/strings'
import type { Availability, HourData, Location, MarineHour } from '@/lib/types'
import { useSetupStore } from '@/stores/setup'
import DashboardView from './DashboardView.vue'

const da = STRINGS.da

// Monday 9 November 2026, 06:00 in Denmark.
const NOW = Date.UTC(2026, 10, 9, 5, 0)
const H = 3600_000
const AVAIL: Availability[] = [{ id: 'a', days: [0, 1, 2, 3, 4, 5, 6], from: '07:00', to: '10:00', methods: ['shore'] }]
// Two catalogue sea spots: L0 with weather cached, L1 with none yet.
const [WITH, WITHOUT]: Location[] = DK_SPOTS.filter((s) => s.waterType !== 'fresh').slice(0, 2)
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

async function settle() {
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
  }
}

/** The dashboard for both spots, L0's weather cached 10 min ago. */
async function openDashboard(): Promise<FakeNode> {
  localStorage.setItem('fc2-forecasts', JSON.stringify({ [WITH.id]: forecastFor(WITH, NOW - 10 * 60_000) }))
  const pinia = createPinia()
  setActivePinia(pinia)
  const setup = useSetupStore()
  setup.locations = [WITH, WITHOUT].map((l) => ({ ...l }))
  setup.availability = AVAIL.map((a) => ({ ...a }))
  setup.targetSpecies = ['havørred']
  view = mount(DashboardView, (app) => { app.use(pinia); app.config.warnHandler = () => {} })
  await settle()
  return view.root
}

/** The cards of the spot with no weather: each one's no-data line. */
const noDataLines = (root: FakeNode) => root.byClass('card win')
  .filter((c) => c.byClass('meta')[0]?.textContent.includes(WITHOUT.name))
  .map((c) => c.byClass('nodata')[0])

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  restoreDocument = installDocument()
  Object.assign(document, { body: { style: {} } })
  vi.stubGlobal('window', { innerWidth: 1024, addEventListener() {}, removeEventListener() {} })
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('getComputedStyle', () => ({ overflowX: 'visible' }))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  localStorage.clear()
  vi.mocked(fetchForecasts).mockReset()
  vi.mocked(fetchForecast).mockReset().mockRejectedValue(new Error('Failed to fetch'))
  vi.mocked(fetchLightningStatus).mockReset().mockResolvedValue({ level: 'clear', closestKm: null })
})
afterEach(() => {
  view?.unmount()
  view = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  restoreDocument()
})

describe('the cards of a spot whose weather is on its way', () => {
  it('say it is being fetched, with no button to fetch it again', async () => {
    let land!: () => void
    vi.mocked(fetchForecasts).mockImplementation((locs) => new Promise((resolve) => {
      land = () => resolve(locs.map((l) => forecastFor(l)))
    }))
    const root = await openDashboard()
    const lines = noDataLines(root)
    expect(lines).toHaveLength(7) // today to Sunday, 07–10
    for (const line of lines) {
      expect(line.textContent).toContain(da.loading)
      expect(line.textContent).not.toContain(da.data_missing)
      expect(line.byTag('button')).toEqual([])
    }
    expect(fetchForecast).not.toHaveBeenCalled()

    land()
    await settle()
    expect(noDataLines(root).filter(Boolean)).toEqual([])
  })

  it('once its fetch has failed: no weather, and the button to fetch it', async () => {
    vi.mocked(fetchForecasts).mockImplementation(async (locs) => locs.map(() => null))
    const root = await openDashboard()
    // The retries, 1 s and then 2 s apart.
    await vi.advanceTimersByTimeAsync(4000)
    await settle()
    const lines = noDataLines(root)
    expect(lines).toHaveLength(7)
    for (const line of lines) {
      expect(line.textContent).toContain(da.data_missing)
      expect(line.byTag('button').map((b) => b.textContent.trim())).toEqual([`⟳ ${da.load_data_btn}`])
    }
  })
})
