// @vitest-environment vue-dom
/**
 * The "+1" after a window's times on the dashboard, as mounted: the real view
 * and stores on the in-memory DOM, the network mocked. It said "Slutter næste
 * dag" for every window that crosses midnight, 22:00–00:00 too, which ends at
 * midnight, the end of its own evening: none of its hours is on the next day.
 * The top pick's "+1" had no title, and a screen reader heard "+1" everywhere.
 * The four places (top pick, simple rows, full cards, the score breakdown)
 * now agree, and a screen reader hears what the badge means.
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
import { STRINGS } from '@/test/strings'
import type { Availability, HourData, Location, MarineHour } from '@/lib/types'
import { useSetupStore } from '@/stores/setup'
import DashboardView from './DashboardView.vue'

const da = STRINGS.da
const en = STRINGS.en

// Monday 9 November 2026, 06:00 in Denmark.
const NOW = Date.UTC(2026, 10, 9, 5, 0)
const H = 3600_000
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6]
const MIDNIGHT: Availability = { id: 'm', days: EVERY_DAY, from: '22:00', to: '00:00', methods: ['shore'] }
const NIGHT: Availability = { id: 'n', days: EVERY_DAY, from: '22:00', to: '02:00', methods: ['shore'] }
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

async function openDashboard(availability: Availability[]): Promise<FakeNode> {
  localStorage.setItem('fc2-forecasts', JSON.stringify({ [LOC.id]: forecastFor(LOC, NOW - 10 * 60_000) }))
  const pinia = createPinia()
  setActivePinia(pinia)
  const setup = useSetupStore()
  setup.locations = [{ ...LOC }]
  setup.availability = availability.map((a) => ({ ...a }))
  setup.targetSpecies = ['havørred']
  view = mount(DashboardView, (app) => { app.use(pinia); app.config.warnHandler = () => {} })
  await settle()
  return view.root
}

/**
 * What a screen reader says for a node: its text, an image's name for the
 * image (its own text is hidden by role="img"), nothing for what is hidden.
 */
function spoken(n: FakeNode): string {
  const walk = (x: FakeNode): string => {
    if (x.tag === '#text') return x.text
    if (x.tag === '#comment' || x.attrs['aria-hidden'] === 'true' || x.attrs['aria-hidden'] === true) return ''
    if (x.attrs.role === 'img') return ` ${String(x.attrs['aria-label'] ?? '')} `
    return x.children.map(walk).join('')
  }
  return walk(n).replace(/\s+/g, ' ').trim()
}

/** A place a window's times are shown: its from–to text, its badge, and what a screen reader hears. */
interface Shown { when: string; badge: FakeNode | undefined; heard: string }
const shown = (n: FakeNode): Shown => ({
  when: n.textContent.match(/\d\d:\d\d–\d\d:\d\d/)?.[0] ?? '',
  badge: n.byClass('nextday')[0],
  heard: spoken(n),
})
/** Every badge on screen, by its text. */
const badges = (root: FakeNode) => root.byClass('nextday').map((b) => b.textContent)
/** A full card's title line (the moon card has a .title of its own). */
const titleOf = (card: FakeNode) => card.byClass('title')[0]
/** Every place on screen: the top pick, then the full cards' titles or the simple rows. */
const places = (root: FakeNode): Shown[] =>
  [...root.byClass('tp-when'), ...root.byClass('card win').map(titleOf), ...root.byClass('srow-when')].map(shown)
/** The score breakdown's line for the window it is about, once opened. */
async function breakdownOf(root: FakeNode, open: FakeNode): Promise<Shown> {
  open.click()
  await settle()
  return shown(root.byClass('bd-for')[0])
}

/** What a place should be, by the window's end: a badge that names the next day, or none. */
function expectAgrees(p: Shown, lang: 'da' | 'en') {
  const label = STRINGS[lang].window_next_day
  if (p.when.endsWith('00:00')) {
    expect(p.badge, p.when).toBeUndefined()
    expect(p.heard).not.toMatch(/\+1/)
    expect(p.heard).not.toContain(label)
  } else {
    expect(p.badge, p.when).toBeDefined()
    expect(p.badge!.textContent).toBe('+1')
    expect(p.badge!.attrs.title).toBe(label)
    expect(p.badge!.attrs['aria-label']).toBe(label)
    expect(p.heard).not.toMatch(/\+1/)
    expect(p.heard).toMatch(new RegExp(`${p.when} ${label}`))
  }
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

describe('a window ending at 00:00 has no "+1"', () => {
  it('not on the top pick, the cards or the score breakdown', async () => {
    const root = await openDashboard([MIDNIGHT])
    const all = places(root)
    expect(all.map((p) => p.when)).toEqual(Array(all.length).fill('22:00–00:00'))
    expect(all.length).toBeGreaterThan(5)
    expect(badges(root)).toEqual([])
    expectAgrees(await breakdownOf(root, root.byClass('toppick')[0]), 'da')
  })

  it('not on the simple view\'s rows', async () => {
    localStorage.setItem('fc2-dash-density', 'simple')
    const root = await openDashboard([MIDNIGHT])
    expect(root.byClass('srow-when').length).toBeGreaterThan(5)
    expect(badges(root)).toEqual([])
  })
})

describe('a window that runs on past midnight keeps its "+1", named for a screen reader', () => {
  it('in every place, the top pick\'s too', async () => {
    const root = await openDashboard([NIGHT])
    const all = places(root)
    expect(all.map((p) => p.when)).toEqual(Array(all.length).fill('22:00–02:00'))
    expect(root.byClass('tp-when')).toHaveLength(1)
    for (const p of all) expectAgrees(p, 'da')
    expectAgrees(await breakdownOf(root, root.byClass('toppick')[0]), 'da')
  })

  it('on the simple view\'s rows', async () => {
    localStorage.setItem('fc2-dash-density', 'simple')
    const root = await openDashboard([NIGHT])
    const rows = root.byClass('srow-when').map(shown)
    expect(rows.length).toBeGreaterThan(5)
    for (const p of rows) expectAgrees(p, 'da')
  })
})

describe('22:00–00:00 beside 22:00–02:00: each by its own end', () => {
  it('cards, rows and the breakdown agree', async () => {
    const root = await openDashboard([MIDNIGHT, NIGHT])
    const all = places(root)
    expect(new Set(all.map((p) => p.when))).toEqual(new Set(['22:00–00:00', '22:00–02:00']))
    for (const p of all) expectAgrees(p, 'da')
    // Each window's breakdown, opened from its card's score.
    const cards = root.byClass('card win')
    const midnight = cards.find((c) => shown(titleOf(c)).when === '22:00–00:00')!
    const night = cards.find((c) => shown(titleOf(c)).when === '22:00–02:00')!
    expectAgrees(await breakdownOf(root, midnight.byClass('score')[0]), 'da')
    expect(shown(root.byClass('bd-for')[0]).when).toBe('22:00–00:00')
    root.byClass('overlay')[0].click()
    await settle()
    expectAgrees(await breakdownOf(root, night.byClass('score')[0]), 'da')
    expect(shown(root.byClass('bd-for')[0]).when).toBe('22:00–02:00')
  })

  it('the simple view\'s rows agree', async () => {
    localStorage.setItem('fc2-dash-density', 'simple')
    const root = await openDashboard([MIDNIGHT, NIGHT])
    const rows = root.byClass('srow-when').map(shown)
    expect(new Set(rows.map((p) => p.when))).toEqual(new Set(['22:00–00:00', '22:00–02:00']))
    for (const p of rows) expectAgrees(p, 'da')
  })

  it('reads English', async () => {
    const root = await openDashboard([MIDNIGHT, NIGHT])
    setLang('en')
    expect(await langReady()).toBe(true)
    await settle()
    const all = places(root)
    expect(all.some((p) => p.badge)).toBe(true)
    for (const p of all) expectAgrees(p, 'en')
  })

  it('the badge\'s words say the next day, in both languages', () => {
    expect(da.window_next_day).toMatch(/næste dag/i)
    expect(en.window_next_day).toMatch(/next day/i)
  })
})
