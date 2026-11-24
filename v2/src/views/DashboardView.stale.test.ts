// @vitest-environment vue-dom
/**
 * What the dashboard shows once its data or its day has moved on, as
 * mounted: the real view and stores on the in-memory DOM, the network
 * mocked. Round L's sweep found three places that kept an older picture:
 * - "· Opdateret lige nu" while another spot's weather was 11 h old, its
 *   refetch having failed: the label took the newest fetch of them all.
 * - A day filter on today, once today's last window ended: no cards, no
 *   notice, and today's bar pressed (aria-pressed) yet disabled.
 * - The score breakdown held the window it was opened with, so a refresh
 *   that landed while it was open left it showing the old score beside the
 *   card's new one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, toRaw } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { FakeNode, installDocument, mount } from '@/test/fakeDom'

vi.mock('@/lib/weather', async (orig) => {
  const real = await orig<typeof import('@/lib/weather')>()
  return { ...real, fetchForecast: vi.fn(), fetchForecasts: vi.fn(), fetchLightningStatus: vi.fn() }
})
vi.mock('@/lib/coastClient', () => ({ deriveCoast: vi.fn(() => new Promise(() => {})), terminate: vi.fn() }))
vi.mock('@/lib/toast', () => ({ showToast: vi.fn(() => 1), dismissToast: vi.fn() }))

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
// Catalogue sea spots, as many as a test needs.
const SPOTS: Location[] = DK_SPOTS.filter((s) => s.waterType !== 'fresh').slice(0, 3)
  .map((s, i) => ({ id: 'L' + i, ...locationFromSpot(s) }))

/** Weather from the day before `fetched` to a week ahead, on the local hour: mild, or a gale. */
function forecastFor(loc: Location, fetched = Date.now(), windMs = 4): FetchedForecast {
  const d = new Date(fetched)
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime()
  const hourly: HourData[] = []
  const marine: MarineHour[] = []
  for (let h = 0; h < 24 * 9; h++) {
    const time = start + h * H
    hourly.push({ time, temp: 9, windMs, windDir: 250, gustMs: windMs + 3, cloud: 70, precipPct: 10, pressure: 1012 })
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

/** The dashboard for these spots and times, with this weather cached (spot id → fetched at), once its first refresh is over. */
async function openDashboard(spots: Location[], cached: Record<string, number>, availability = AVAIL): Promise<FakeNode> {
  const all = [...SPOTS, ...spots]
  localStorage.setItem('fc2-forecasts', JSON.stringify(Object.fromEntries(
    Object.entries(cached).map(([id, at]) => [id, forecastFor(all.find((l) => l.id === id) ?? SPOTS[0], at)]))))
  pinia = createPinia()
  setActivePinia(pinia)
  const setup = useSetupStore()
  setup.locations = spots.map((l) => ({ ...l }))
  setup.availability = availability.map((a) => ({ ...a }))
  setup.targetSpecies = ['havørred']
  view = mount(DashboardView, (app) => { app.use(pinia); app.config.warnHandler = () => {} })
  // Long enough for a failed spot's retries (1 s, then 2 s) to run out.
  for (let i = 0; i < 4; i++) {
    await vi.advanceTimersByTimeAsync(1500)
    await settle()
  }
  return view.root
}

const updated = (root: FakeNode) => root.byClass('updated')[0]?.textContent.replace(/\s+/g, ' ').trim()

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
  vi.mocked(fetchForecast).mockReset().mockImplementation(async (l) => forecastFor(l))
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

describe('"Opdateret …" says when a spot still has older weather', () => {
  /** Every spot's refetch fails but those in `ok`. */
  function failAllBut(...ok: string[]) {
    vi.mocked(fetchForecasts).mockImplementation(async (locs) => locs.map((l) => (ok.includes(l.id) ? forecastFor(l) : null)))
    vi.mocked(fetchForecast).mockRejectedValue(new Error('Failed to fetch'))
  }

  it('one spot refetched just now, the other failed and kept its weather from 11 h ago', async () => {
    failAllBut('L0')
    const root = await openDashboard(SPOTS.slice(0, 2), { L0: NOW - 11 * H, L1: NOW - 11 * H })
    expect(useForecastStore().status).toEqual({ L0: 'ok', L1: 'error' })
    expect(updated(root)).toBe(`· ${da.updated_prefix} ${da.time_just_now} · ${da.dash_older_one}`)
  })

  it('two of three failed: the count', async () => {
    failAllBut('L0')
    const root = await openDashboard(SPOTS, { L0: NOW - 11 * H, L1: NOW - 11 * H, L2: NOW - 20 * H })
    expect(updated(root)).toBe(`· ${da.updated_prefix} ${da.time_just_now} · ${da.dash_older_many.replace('{n}', '2')}`)
  })

  it('in English', async () => {
    failAllBut('L0')
    const root = await openDashboard(SPOTS.slice(0, 2), { L0: NOW - 11 * H, L1: NOW - 11 * H })
    setLang('en')
    expect(await langReady()).toBe(true)
    setActivePinia(pinia)
    await settle()
    expect(updated(root)).toBe(`· ${en.updated_prefix} ${en.time_just_now} · ${en.dash_older_one}`)
    expect(en.dash_older_many.replace('{n}', '2')).toBe('2 spots have older data')
  })

  // Weather younger than 3 h is not refetched (forecastFreshness FRESH_MS):
  // a spot skipped as fresh on this refresh has nothing older to say. Nor
  // has a deleted spot, whose weather can stay in the cache.
  it('not for a spot whose weather is still fresh, nor for a deleted spot', async () => {
    const root = await openDashboard(SPOTS.slice(0, 2), { L0: NOW - 2.5 * H, L1: NOW - 11 * H, L2: NOW - 20 * H })
    expect(vi.mocked(fetchForecasts).mock.calls.map((c) => c[0].map((l) => l.id))).toEqual([['L1']])
    expect(updated(root)).toBe(`· ${da.updated_prefix} ${da.time_just_now}`)
  })

  it('not when every spot is as old: the time says it', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const root = await openDashboard(SPOTS.slice(0, 2), { L0: NOW - 11 * H, L1: NOW - 11 * H })
    expect(updated(root)).toBe(`· ${da.updated_prefix} 11 ${da.time_hr_ago}`)
  })

  // The app also refetches every spot as the local date turns, and again as
  // the UTC date does (forecastFreshness): weather from the day before has no
  // tides for the new 7th day. A refetch that failed then left a spot with
  // weather only an hour or two older, which "3 h" did not count.
  it('a spot whose refetch failed as the local date turned', async () => {
    vi.setSystemTime(Date.UTC(2026, 10, 9, 23, 30)) // Tuesday 00:30 in Denmark
    failAllBut('L0')
    const at = Date.UTC(2026, 10, 9, 22, 0) // Monday 23:00
    const root = await openDashboard(SPOTS.slice(0, 2), { L0: at, L1: at })
    expect(useForecastStore().status).toEqual({ L0: 'ok', L1: 'error' })
    expect(updated(root)).toBe(`· ${da.updated_prefix} ${da.time_just_now} · ${da.dash_older_one}`)
  })

  it('a spot whose refetch failed as the UTC date turned', async () => {
    vi.setSystemTime(Date.UTC(2026, 10, 10, 0, 30)) // Tuesday 01:30 in Denmark
    failAllBut('L0')
    const at = Date.UTC(2026, 10, 9, 23, 30) // Tuesday 00:30, still Monday in UTC
    const root = await openDashboard(SPOTS.slice(0, 2), { L0: at, L1: at })
    expect(useForecastStore().status).toEqual({ L0: 'ok', L1: 'error' })
    expect(updated(root)).toBe(`· ${da.updated_prefix} ${da.time_just_now} · ${da.dash_older_one}`)
  })

  // A refresh lands spot by spot where the batch fails (the store's per-spot
  // fallback) or leaves a straggler to retry. The spots still being fetched
  // have failed nothing yet: counting them read as a failure that counted
  // down to nothing as they landed.
  it('not for a spot still being fetched', async () => {
    let land = () => {}
    vi.mocked(fetchForecasts).mockImplementation(async (locs) => locs.map((l) => (l.id === 'L0' ? forecastFor(l) : null)))
    vi.mocked(fetchForecast).mockImplementation((l) => new Promise((done) => { land = () => done(forecastFor(l)) }))
    const root = await openDashboard(SPOTS.slice(0, 2), { L0: NOW - 11 * H, L1: NOW - 11 * H })
    expect(useForecastStore().status).toEqual({ L0: 'ok', L1: 'loading' })
    expect(updated(root)).toBe(`· ${da.updated_prefix} ${da.time_just_now}`)
    land()
    await settle()
    expect(useForecastStore().status).toEqual({ L0: 'ok', L1: 'ok' })
    expect(updated(root)).toBe(`· ${da.updated_prefix} ${da.time_just_now}`)
  })
})

describe('a day filter whose day has no window left', () => {
  const wdays = (root: FakeNode) => root.byClass('wday')
  const pressed = (root: FakeNode) => wdays(root).filter((b) => b.attrs['aria-pressed'] === true)

  it("today's, once today's last window has ended: the list shows every day again", async () => {
    const root = await openDashboard([SPOTS[0]], { L0: NOW - 10 * 60_000 })
    wdays(root)[0].click()
    await settle()
    expect(root.byClass('dayfilter')).toHaveLength(1)
    expect(root.byClass('card win')).toHaveLength(1) // today 07–10
    vi.setSystemTime(NOW + 5 * H) // 11:00: today's window is over
    await vi.advanceTimersByTimeAsync(60_000)
    await settle()
    expect(root.byClass('dayfilter')).toHaveLength(0)
    expect(root.byClass('card win')).toHaveLength(6) // the six days to come
    expect(wdays(root)[0].attrs.disabled).toBe(true)
    expect(pressed(root)).toEqual([])
  })

  it("tomorrow's stays when today's window ends", async () => {
    const root = await openDashboard([SPOTS[0]], { L0: NOW - 10 * 60_000 })
    wdays(root)[1].click()
    await settle()
    vi.setSystemTime(NOW + 5 * H)
    await vi.advanceTimersByTimeAsync(60_000)
    await settle()
    expect(root.byClass('dayfilter')).toHaveLength(1)
    expect(root.byClass('card win')).toHaveLength(1)
    expect(pressed(root)).toEqual([wdays(root)[1]])
  })

  // As before this rule: at midnight a filtered day becomes yesterday, off
  // the strip. Its overnight window, still running, is listed under today.
  it("a day's, at midnight, its overnight window still running", async () => {
    const night: Availability = { id: 'n', days: [0, 1, 2, 3, 4, 5, 6], from: '22:00', to: '02:00', methods: ['shore'] }
    const root = await openDashboard([SPOTS[0]], { L0: NOW - 10 * 60_000 }, [night])
    wdays(root)[0].click()
    await settle()
    expect(root.byClass('card win')).toHaveLength(1) // Monday 22–02
    vi.setSystemTime(NOW + 18.5 * H) // Tuesday 00:30
    await vi.advanceTimersByTimeAsync(60_000)
    await settle()
    expect(root.byClass('dayfilter')).toHaveLength(0)
    expect(pressed(root)).toEqual([])
    expect(root.byClass('card win')[0].byClass('title')[0].textContent).toContain('Man 9. Nov')
    expect(wdays(root)[0].attrs.title).toBe('Tir 10. Nov')
    expect(wdays(root)[0].attrs.disabled).toBe(false)
  })
})

// Round V's review: the week strip told a screen reader "ingen tidsvinduer"
// for a day whose windows had no weather, while the list below showed that
// day's "?" cards. Such a day has no score for its bar, but it has windows.
describe('the week strip on a day whose windows have no weather', () => {
  // Monday and Wednesday 07–10: the other days have no window at all.
  const MON_WED: Availability[] = [{ id: 'mw', days: [1, 3], from: '07:00', to: '10:00', methods: ['shore'] }]
  const labels = (root: FakeNode) => root.byClass('wday').map((b) => String(b.attrs['aria-label']))
  /** These spots; the first one's weather never loads, a second one's is cached. */
  async function open(spots: Location[]) {
    vi.mocked(fetchForecasts).mockImplementation(async (locs) => locs.map(() => null))
    vi.mocked(fetchForecast).mockRejectedValue(new Error('Failed to fetch'))
    return openDashboard(spots, spots[1] ? { L1: NOW - 10 * 60_000 } : {}, MON_WED)
  }

  it('says it has no weather, not that it has no windows', async () => {
    const root = await open([SPOTS[0]])
    expect(root.byClass('card win').map((c) => c.byClass('score')[0].textContent.trim())).toEqual(['?', '?'])
    expect(labels(root)).toEqual([
      `Man 9. Nov: ${da.dash_day_nodata}`, `Tir 10. Nov: ${da.dash_day_empty}`, `Ons 11. Nov: ${da.dash_day_nodata}`,
      `Tor 12. Nov: ${da.dash_day_empty}`, `Fre 13. Nov: ${da.dash_day_empty}`, `Lør 14. Nov: ${da.dash_day_empty}`,
      `Søn 15. Nov: ${da.dash_day_empty}`,
    ])
  })

  it('a day with a score as well gives its best score', async () => {
    const root = await open([SPOTS[0], SPOTS[1]])
    const [mon, tue, wed] = labels(root)
    expect(mon).toMatch(new RegExp(`^Man 9\\. Nov: ${da.dash_day_best} \\d+$`))
    expect(tue).toBe(`Tir 10. Nov: ${da.dash_day_empty}`)
    expect(wed).toMatch(new RegExp(`^Ons 11\\. Nov: ${da.dash_day_best} \\d+$`))
  })

  it('in English', async () => {
    const root = await open([SPOTS[0]])
    setLang('en')
    expect(await langReady()).toBe(true)
    setActivePinia(pinia)
    await settle()
    expect(labels(root).slice(0, 3)).toEqual([
      `Mon 9 Nov: ${en.dash_day_nodata}`, `Tue 10 Nov: ${en.dash_day_empty}`, `Wed 11 Nov: ${en.dash_day_nodata}`,
    ])
  })
})

// Round V's sweep: a slot on one weekday only (Monday 07–10). The list holds
// today and the six days after it, so once Monday's window ended nothing was
// left until midnight brought next Monday in. The notice said "none in the
// chosen range" and offered "Vis hele ugen", which at 7 days did nothing.
describe('every window in the list has ended', () => {
  const MONDAYS: Availability[] = [{ id: 'm', days: [1], from: '07:00', to: '10:00', methods: ['shore'] }]
  const notices = (root: FakeNode) => root.byClass('notice').map((p) => ({
    text: p.textContent.replace(/\s+/g, ' ').trim(),
    buttons: p.byTag('button').map((b) => b.textContent.trim()),
  }))
  const horizon = (root: FakeNode, label: string) =>
    root.byClass('dbtn').find((b) => b.textContent.trim() === label)!
  async function mondayEnds() {
    vi.setSystemTime(NOW + 5 * H) // 11:00: Monday's window is over
    await vi.advanceTimersByTimeAsync(60_000)
    await settle()
  }

  it('says none is left this week and when the next come, with no button that shows nothing more', async () => {
    const root = await openDashboard([SPOTS[0]], { L0: NOW - 10 * 60_000 }, MONDAYS)
    expect(root.byClass('card win')).toHaveLength(1)
    await mondayEnds()
    expect(root.byClass('card win')).toHaveLength(0)
    expect(notices(root)).toEqual([{ text: da.dash_none_left, buttons: [] }])
  })

  it('the same at a shorter horizon: a longer one has nothing more to show', async () => {
    const root = await openDashboard([SPOTS[0]], { L0: NOW - 10 * 60_000 }, MONDAYS)
    horizon(root, da.dash_h_today).click()
    await settle()
    await mondayEnds()
    expect(notices(root)).toEqual([{ text: da.dash_none_left, buttons: [] }])
  })

  it('in English', async () => {
    const root = await openDashboard([SPOTS[0]], { L0: NOW - 10 * 60_000 }, MONDAYS)
    setLang('en')
    expect(await langReady()).toBe(true)
    setActivePinia(pinia)
    await mondayEnds()
    expect(notices(root)).toEqual([{ text: en.dash_none_left, buttons: [] }])
  })

  it('a day with none left at a shorter horizon still offers the whole week, which shows the days to come', async () => {
    const root = await openDashboard([SPOTS[0]], { L0: NOW - 10 * 60_000 })
    horizon(root, da.dash_h_today).click()
    await settle()
    await mondayEnds()
    expect(notices(root)).toEqual([{ text: `${da.dash_none_in_horizon} ${da.dash_show_week}`, buttons: [da.dash_show_week] }])
    root.byClass('notice')[0].byTag('button')[0].click()
    await settle()
    expect(notices(root)).toEqual([])
    expect(root.byClass('card win')).toHaveLength(6)
  })
})

describe('the score breakdown follows its window', () => {
  /** The breakdown's score, and the window it names (place, day, times). */
  const dialog = (root: FakeNode) => ({
    score: root.byClass('modal')[0]?.byTag('h3')[0]?.textContent.split(' · ')[0],
    of: root.byClass('bd-for')[0]?.textContent.replace(/\s+/g, ' ').trim(),
  })
  /** The full card for the window shown as "Man 9. Nov · 07:00–10:00", and its score. */
  const cardFor = (root: FakeNode, when: string) =>
    root.byClass('card win').find((c) => c.byClass('title')[0].textContent.replace(/\s+/g, ' ').includes(when))

  it('a refresh that lands while it is open: the new score, as on the card', async () => {
    const root = await openDashboard([SPOTS[0]], { L0: NOW - 10 * 60_000 })
    const card = root.byClass('card win')[0]
    const when = card.byClass('title')[0].byTag('strong')[0].textContent
    card.byClass('score')[0].click()
    await settle()
    const before = dialog(root)
    expect(before.score).toBe(card.byClass('score')[0].textContent.trim())

    // A focus refresh (App.vue) or a toast's Retry, while the dialog is open: a gale.
    vi.mocked(fetchForecasts).mockImplementation(async (locs) => locs.map((l) => forecastFor(l, Date.now(), 15)))
    await useForecastStore().fetchAll(useSetupStore().locations, { force: true })
    await settle()
    const after = dialog(root)
    const now = cardFor(root, when)!
    expect(now.byClass('score')[0].textContent.trim()).not.toBe(before.score)
    expect(after.of).toBe(before.of)
    expect(after.score).toBe(now.byClass('score')[0].textContent.trim())
  })

  it('closes once its window has ended', async () => {
    const root = await openDashboard([SPOTS[0]], { L0: NOW - 10 * 60_000 })
    const today = cardFor(root, 'Man 9. Nov')!
    today.byClass('score')[0].click()
    await settle()
    expect(dialog(root).of).toContain('07:00–10:00')
    vi.setSystemTime(NOW + 5 * H) // 11:00
    await vi.advanceTimersByTimeAsync(60_000)
    await settle()
    expect(root.byClass('overlay')).toHaveLength(0)
    expect(root.byClass('card win')).toHaveLength(6)
  })

  // Closed because its window went, it stays closed if that window comes
  // back: its times edited on another device and edited back, say. It
  // would open again by itself, and take the focus with it.
  it('stays closed when its window comes back', async () => {
    const root = await openDashboard([SPOTS[0]], { L0: NOW - 10 * 60_000 })
    cardFor(root, 'Man 9. Nov')!.byClass('score')[0].click()
    await settle()
    expect(root.byClass('overlay')).toHaveLength(1)
    const setup = useSetupStore()
    setup.availability = [{ ...AVAIL[0], to: '11:00' }]
    await settle()
    expect(root.byClass('overlay')).toHaveLength(0)
    setup.availability = [{ ...AVAIL[0] }]
    await settle()
    expect(cardFor(root, 'Man 9. Nov · 07:00–10:00')).toBeDefined()
    expect(root.byClass('overlay')).toHaveLength(0)
  })

  // Closed by itself, it sent the focus back to the score button that
  // opened it, which had gone with its card: a keyboard or a screen reader
  // was left at the top of the page. It goes to the list's heading instead.
  // Closed by the user, it still goes back to that button.
  describe('where the focus goes as it closes', () => {
    beforeEach(() => {
      // A ref holds a fake node in a proxy (a real one is left alone): the node itself.
      vi.spyOn(FakeNode.prototype, 'focus').mockImplementation(function (this: FakeNode) {
        Object.assign(document, { activeElement: toRaw(this) })
      })
    })
    /** The element with the focus, by tag and class, and whether it is still on the page. */
    const focused = (root: FakeNode) => {
      const n = document.activeElement as unknown as FakeNode | null
      return n ? `<${n.tag} class="${n.classes.join(' ')}">${n.getRootNode() === root ? '' : ' (gone)'}` : 'nothing'
    }
    const has = (n: FakeNode) => (document.activeElement as unknown) === n
    const heading = (root: FakeNode) => root.byClass('muted-h')[0]
    /** Opens the breakdown from today's card, as a keyboard does: the score button has the focus. */
    async function openToday(root: FakeNode): Promise<FakeNode> {
      const button = cardFor(root, 'Man 9. Nov')!.byClass('score')[0]
      button.focus()
      button.click()
      await settle()
      expect(focused(root)).toBe('<div class="card modal">')
      return button
    }
    /** Waits until 11:00, when today's 07–10 window has ended. */
    async function todayEnds() {
      vi.setSystemTime(NOW + 5 * H)
      await vi.advanceTimersByTimeAsync(60_000)
      await settle()
    }

    it('closed as its window ends: to the heading of the list, which can take it', async () => {
      const root = await openDashboard([SPOTS[0]], { L0: NOW - 10 * 60_000 })
      await openToday(root)
      await todayEnds()
      expect(root.byClass('overlay')).toHaveLength(0)
      expect(focused(root)).toBe('<span class="muted-h">')
      expect(has(heading(root))).toBe(true)
      expect(heading(root).attrs.tabindex).toBe('-1')
      expect(heading(root).textContent).toContain(da.tab_windows)
    })

    it('closed as its window is edited away: the same', async () => {
      const root = await openDashboard([SPOTS[0]], { L0: NOW - 10 * 60_000 })
      await openToday(root)
      useSetupStore().availability = [{ ...AVAIL[0], to: '11:00' }]
      await settle()
      expect(root.byClass('overlay')).toHaveLength(0)
      expect(focused(root)).toBe('<span class="muted-h">')
      expect(has(heading(root))).toBe(true)
    })

    it('closed by its ✕, or by a click beside it: back to the button that opened it', async () => {
      const root = await openDashboard([SPOTS[0]], { L0: NOW - 10 * 60_000 })
      let button = await openToday(root)
      root.byClass('modal')[0].byTag('button')[0].click() // ✕
      await settle()
      expect(root.byClass('overlay')).toHaveLength(0)
      expect(focused(root)).toBe(`<button class="${button.classes.join(' ')}">`)
      expect(has(button)).toBe(true)
      button = await openToday(root)
      root.byClass('overlay')[0].click()
      await settle()
      expect(root.byClass('overlay')).toHaveLength(0)
      expect(has(button)).toBe(true)
    })

    it('closed by itself after an earlier close by the user: to the heading', async () => {
      const root = await openDashboard([SPOTS[0]], { L0: NOW - 10 * 60_000 })
      await openToday(root)
      root.byClass('modal')[0].byTag('button')[0].click()
      await settle()
      await openToday(root)
      await todayEnds()
      expect(focused(root)).toBe('<span class="muted-h">')
    })
  })
})
