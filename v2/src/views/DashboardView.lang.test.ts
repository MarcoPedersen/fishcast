// @vitest-environment vue-dom
/**
 * The dates the dashboard's bars give screen readers, as mounted: the real
 * view and stores on the in-memory DOM, the network mocked. Each bar's
 * visible text is a letter or two, so its aria-label names the day in full.
 * The round E browser check reported one in English on a Danish screen. Its
 * names come from t(), so they follow the language shown, after a switch
 * either way too. But the date was written the Danish way in English too:
 * "Mon 9. Nov", the day of the month with the Danish full stop.
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
import { langReady, setLang, shownLang } from '@/lib/i18n'
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

/** Each bar's label: the week strip's and the trend strip's under the cards. */
const labels = (root: FakeNode) => ({
  week: root.byClass('wday').map((b) => String(b.attrs['aria-label'])),
  trend: root.byClass('tcol').map((b) => String(b.attrs['aria-label'])),
})
/**
 * A full date as `lang` writes it, at the start of a label: "Man 9. Nov"
 * in Danish, "Mon 9 Nov" in English (the names from that language's table).
 * No day name is the same in both, so a label matches one language only.
 */
function dateOf(lang: 'da' | 'en'): RegExp {
  const s = STRINGS[lang]
  const days = Array.from({ length: 7 }, (_, i) => s['day' + i]).join('|')
  const months = Array.from({ length: 12 }, (_, i) => s['month' + i]).join('|')
  return new RegExp(`^(${days}) \\d{1,2}${lang === 'da' ? '\\.' : ''} (${months}): `)
}
/** Every bar's label starts with its date as `lang` writes it. */
function allIn(root: FakeNode, lang: 'da' | 'en'): boolean {
  const { week, trend } = labels(root)
  return [...week, ...trend].every((l) => dateOf(lang).test(l))
}

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

describe('the dashboard\'s bars name their day in the language shown', () => {
  it('Danish on a Danish screen', async () => {
    const root = await openDashboard()
    const { week, trend } = labels(root)
    expect(week.length).toBe(7)
    expect(trend.length).toBeGreaterThan(1)
    expect(shownLang.value).toBe('da')
    expect(allIn(root, 'da')).toBe(true)
    expect(trend[0]).toMatch(/^Man 9\. Nov: /)
  })

  // "9." is how Danish writes the day of the month: English kept it.
  it('English once English is shown, written as English writes it, and Danish again after a switch back', async () => {
    const root = await openDashboard()
    setLang('en')
    expect(await langReady()).toBe(true)
    await settle()
    expect(shownLang.value).toBe('en')
    expect(allIn(root, 'en')).toBe(true)
    expect(labels(root).trend[0]).toMatch(/^Mon 9 Nov: /)
    setLang('da')
    await settle()
    expect(allIn(root, 'da')).toBe(true)
    expect(labels(root).trend[0]).toMatch(/^Man 9\. Nov: /)
  })

  /**
   * The simple view's rows say the day and its number: "Man 9." in Danish.
   * Written by hand, not with the bars' date, English read "Mon 9." there
   * while the bars read "Mon 9 Nov".
   */
  it('the simple view\'s rows write the day as the language shown writes it', async () => {
    localStorage.setItem('fc2-dash-density', 'simple')
    const root = await openDashboard()
    const rows = () => root.byClass('srow-when').map((r) => r.byTag('strong')[0].textContent)
    const dayIn = (lang: 'da' | 'en') => new RegExp(
      `^(${Array.from({ length: 7 }, (_, i) => STRINGS[lang]['day' + i]).join('|')}) \\d{1,2}${lang === 'da' ? '\\.' : ''}$`)
    expect(rows().length).toBeGreaterThan(1)
    expect(rows().filter((d) => !dayIn('da').test(d))).toEqual([])
    setLang('en')
    expect(await langReady()).toBe(true)
    await settle()
    expect(rows().filter((d) => !dayIn('en').test(d))).toEqual([])
    setLang('da')
    await settle()
    expect(rows().filter((d) => !dayIn('da').test(d))).toEqual([])
  })
})
