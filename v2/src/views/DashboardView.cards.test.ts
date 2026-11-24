// @vitest-environment vue-dom
/**
 * A window card's buttons to a screen reader, as mounted: the real view and
 * stores on the in-memory DOM, the network mocked. The 💡 opens and closes
 * the card's tips, and said neither; the relevance tag beside it says so
 * (aria-expanded). The 🔗 copies a link and shows "✓", but its fixed name
 * ("🔗 Del") was all a screen reader heard, so it never learnt the copy
 * worked. The topbar's share button names its "copied" state already.
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

// Monday 9 November 2026, 06:00 in Denmark.
const NOW = Date.UTC(2026, 10, 9, 5, 0)
const H = 3600_000
const AVAIL: Availability[] = [{ id: 'a', days: [0, 1, 2, 3, 4, 5, 6], from: '07:00', to: '10:00', methods: ['shore'] }]
const SPOT = DK_SPOTS.find((s) => s.waterType !== 'fresh')!
const LOC: Location = { id: 'L0', ...locationFromSpot(SPOT) }

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

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined
const writeText = vi.fn<(s: string) => Promise<void>>()

async function settle() {
  for (let i = 0; i < 5; i++) {
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
  }
}

async function openDashboard(): Promise<FakeNode> {
  localStorage.setItem('fc2-forecasts', JSON.stringify({ [LOC.id]: forecastFor(LOC, NOW - 10 * 60_000) }))
  const pinia = createPinia()
  setActivePinia(pinia)
  const setup = useSetupStore()
  setup.locations = [{ ...LOC }]
  setup.availability = AVAIL.map((a) => ({ ...a }))
  setup.targetSpecies = ['havørred']
  view = mount(DashboardView, (app) => { app.use(pinia); app.config.warnHandler = () => {} })
  await settle()
  return view.root
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  restoreDocument = installDocument()
  Object.assign(document, { body: { style: {} } })
  vi.stubGlobal('window', { innerWidth: 1024, addEventListener() {}, removeEventListener() {} })
  writeText.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', { onLine: true, clipboard: { writeText } })
  vi.stubGlobal('location', { origin: 'https://example.test', pathname: '/fishcast/v2/' })
  vi.stubGlobal('getComputedStyle', () => ({ overflowX: 'visible' }))
  localStorage.clear()
  vi.mocked(fetchForecasts).mockImplementation(async (locs) => locs.map((l) => forecastFor(l)))
  vi.mocked(fetchForecast).mockImplementation(async (l) => forecastFor(l))
  vi.mocked(fetchLightningStatus).mockResolvedValue({ level: 'clear', closestKm: null })
})
afterEach(() => {
  view?.unmount()
  view = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  restoreDocument()
})

describe("a window card's buttons say their state", () => {
  it('the 💡 says whether its tips are open', async () => {
    const root = await openDashboard()
    const tips = () => root.byClass('tips-btn')[0]
    expect(tips()).toBeDefined()
    expect(tips().attrs['aria-expanded']).toBe(false)
    tips().click()
    await nextTick()
    expect(root.byClass('tips-panel')).toHaveLength(1)
    expect(tips().attrs['aria-expanded']).toBe(true)
    tips().click()
    await nextTick()
    expect(root.byClass('tips-panel')).toHaveLength(0)
    expect(tips().attrs['aria-expanded']).toBe(false)
  })

  it('the 🔗 is named "copied" once the link is copied, and its own name again after', async () => {
    const root = await openDashboard()
    const share = () => root.byClass('share-win')[0]
    expect(share().attrs['aria-label']).toBe(STRINGS.da.share_btn)
    share().click()
    await settle()
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(share().textContent).toBe('✓')
    expect(share().attrs['aria-label']).toBe(STRINGS.da.share_copied)
    await vi.advanceTimersByTimeAsync(2000)
    await nextTick()
    expect(share().attrs['aria-label']).toBe(STRINGS.da.share_btn)
  })

  it('a copy the browser refused leaves the 🔗 as it was', async () => {
    writeText.mockRejectedValue(new DOMException('Write permission denied.', 'NotAllowedError'))
    const root = await openDashboard()
    root.byClass('share-win')[0].click()
    await settle()
    expect(root.byClass('share-win')[0].attrs['aria-label']).toBe(STRINGS.da.share_btn)
  })
})

describe('the 🏆 and the highlight mark the best window', () => {
  it('the first card has the 🏆 and the highlight, in both views', async () => {
    const root = await openDashboard()
    const cards = root.byClass('card win')
    expect(cards[0].classes).toContain('top')
    expect(cards[0].byClass('badge').map((b) => b.textContent)).toEqual(['🏆'])
    expect(cards.slice(1).filter((c) => c.classes.includes('top') || c.byClass('badge').length)).toEqual([])
    root.byClass('dbtn').find((b) => b.textContent.trim() === STRINGS.da.dash_simple)!.click()
    await nextTick()
    expect(root.byClass('srow').map((r) => r.textContent.includes('🏆'))).toEqual([true, false, false, false, false, false, false])
  })

  // Round V's sweep: a card with no weather ("?") sorts by a stand-in score
  // of 20, so with none loaded (a spot whose first fetch failed) it led the
  // list and took the 🏆 and the highlight that mark the best window.
  it('no card without weather has the 🏆 or the highlight', async () => {
    vi.mocked(fetchForecasts).mockRejectedValue(new Error('Failed to fetch'))
    vi.mocked(fetchForecast).mockRejectedValue(new Error('Failed to fetch'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const pinia = createPinia()
    setActivePinia(pinia)
    const setup = useSetupStore()
    setup.locations = [{ ...LOC }]
    setup.availability = AVAIL.map((a) => ({ ...a }))
    setup.targetSpecies = ['havørred']
    view = mount(DashboardView, (app) => { app.use(pinia); app.config.warnHandler = () => {} })
    await vi.advanceTimersByTimeAsync(4000) // its retries, 1 s and then 2 s apart
    await settle()
    const root = view.root
    const cards = root.byClass('card win')
    expect(cards).toHaveLength(7)
    expect(cards.every((c) => c.byClass('score')[0].textContent.trim() === '?')).toBe(true)
    expect(cards.filter((c) => c.classes.includes('top') || c.byClass('badge').length)).toEqual([])
    root.byClass('dbtn').find((b) => b.textContent.trim() === STRINGS.da.dash_simple)!.click()
    await nextTick()
    expect(root.byClass('srow')).toHaveLength(7)
    expect(root.byClass('srow').filter((r) => r.textContent.includes('🏆'))).toEqual([])
  })
})
