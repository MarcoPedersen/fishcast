// @vitest-environment vue-dom
/**
 * A shared window's spot, added from the welcome page as mounted: the real
 * view, Pinia and router on the in-memory DOM. A spot at an official spot's
 * former pin is imported at the spot's pin now (shareImport.ts), so the
 * check for one already saved looks there too, as well as where the link
 * puts it. A shared setup, imported whole, likewise.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'
import { STRINGS } from '@/test/strings'
import { langReady, setLang, t } from '@/lib/i18n'
import { shareSetupUrl, shareWindowUrl } from '@/lib/share'
import { DK_SPOTS, locationFromSpot } from '@/lib/spots'
import { confirmAccept, confirmState } from '@/lib/confirm'
import { runToastAction, toasts } from '@/lib/toast'
import type { Availability, Location } from '@/lib/types'
import type { User } from '@supabase/supabase-js'
import { fakeDb } from '@/test/fakeSupabase'
import { useAuthStore } from '@/stores/auth'
import { useSetupStore } from '@/stores/setup'
import WelcomeView from './WelcomeView.vue'
// Loaded up front for the setup store, which imports it on demand once sync
// is armed (enrichMissingSpecies): nothing is left loading when a test ends.
import '@/lib/geo'

// No @types/node: just the bit a test below moves the zone with.
declare const process: { env: Record<string, string | undefined> }

const HK = DK_SPOTS.find((s) => s.slug === 'helsingore-kysten')!
const OLD = HK.formerPins![0]
const std64 = (obj: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
/** A window link made from a copy of Helsingør Kysten saved before the spot moved. */
const LINK = std64({ v: 2, n: HK.name, la: OLD.lat, lo: OLD.lon, wt: HK.waterType, sl: HK.slug, d: '2026-07-15', f: '05:00', t: '09:00', s: 75 })

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined

/** Opens the link (`win` or `setup`) with these spots saved, and taps the banner's button. */
async function openLink(query: Record<string, string>, saved: Location[], button: string): Promise<Location[]> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const setup = useSetupStore()
  setup.locations = saved
  const page = { render: () => null }
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/', name: 'welcome', component: page },
    { path: '/dashboard', name: 'dashboard', component: page },
    { path: '/availability', name: 'availability', component: page },
  ] })
  await router.push({ path: '/', query })
  view = mount(WelcomeView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
  await nextTick()
  const b = view.root.byTag('button').find((x) => x.textContent === t(button))
  if (!b) throw new Error(`no ${button} button`)
  b.click()
  await nextTick()
  return setup.locations
}
/** Opens the window link with these spots saved, and taps "add the spot". */
const addFromLink = (saved: Location[], link = LINK) => openLink({ win: link }, saved, 'share_add_loc')

beforeEach(() => { restoreDocument = installDocument() })
afterEach(() => {
  view?.unmount()
  view = undefined
  vi.useRealTimers()
  setLang('da')
  restoreDocument()
})

/**
 * The clock the banner reads, at this local time: the clock lib/clock's
 * useNow ticks with (once a minute), and the Date it reads. Nothing else is
 * faked, so Vue's and the router's promises run as they do.
 */
function clockAt(at: Date) {
  vi.useFakeTimers({ now: at, toFake: ['Date', 'setInterval', 'clearInterval'] })
}
/** A minute passes on the clock the banner reads, and the view renders it. */
async function aMinuteLater() {
  vi.advanceTimersByTime(60_000)
  await nextTick()
}

describe('a shared window\'s spot at an official spot\'s former pin', () => {
  it('is saved at the spot\'s pin now', async () => {
    const locs = await addFromLink([])
    expect(locs).toHaveLength(1)
    expect(locs[0]).toMatchObject({ name: HK.name, lat: HK.lat, lon: HK.lon, spotSlug: HK.slug })
  })

  it('is not saved again when the spot is saved at its pin now', async () => {
    const mine = { id: 'mine', ...locationFromSpot(HK) }
    expect(await addFromLink([mine])).toEqual([mine])
  })

  // Theirs at the old pin is the same spot: its card offers the move (LocationsView).
  it('is not saved again when the recipient\'s own copy is at the old pin too', async () => {
    const mine = { id: 'mine', ...locationFromSpot(HK), lat: OLD.lat, lon: OLD.lon }
    expect(await addFromLink([mine])).toEqual([mine])
  })
})

/**
 * A link made at the spot's pin now (the sharer moved their copy, or saved
 * the spot since) names the same spot as the recipient's copy at the old
 * pin, as the spot finder's "added" knows (hasCopyOf). Added, it made a
 * second copy of one spot; the recipient's own card offers the move instead.
 */
describe('a shared window\'s spot at an official spot\'s pin now', () => {
  const NOW = std64({ v: 2, n: HK.name, la: HK.lat, lo: HK.lon, wt: HK.waterType, sl: HK.slug, d: '2026-07-15', f: '05:00', t: '09:00', s: 75 })

  it('is not saved again when the recipient\'s copy is at the old pin', async () => {
    const mine = { id: 'mine', ...locationFromSpot(HK), lat: OLD.lat, lon: OLD.lon }
    expect(await addFromLink([mine], NOW)).toEqual([mine])
  })

  // Near the spot, not on it: a place of the sharer's own, still added.
  it('is saved when it is a place beside the spot\'s pin', async () => {
    const mine = { id: 'mine', ...locationFromSpot(HK), lat: OLD.lat, lon: OLD.lon }
    const beside = std64({ v: 2, n: 'Pynten', la: HK.lat + 20 / 110540, lo: HK.lon, wt: 'salt', d: '2026-07-15', f: '05:00', t: '09:00', s: 75 })
    const locs = await addFromLink([mine], beside)
    expect(locs).toHaveLength(2)
    expect(locs[1]).toMatchObject({ name: 'Pynten', lat: HK.lat + 20 / 110540, lon: HK.lon })
  })
})

/**
 * A shared setup is imported whole. A sharer who added the spot again at its
 * pin now still holds the copy at the old pin, and its card says the spot is
 * saved at its pin too. Both moved there, the recipient had two copies at
 * one place, with nothing on either card to say so (shareImport.ts).
 */
describe('a shared setup with an official spot at its old pin and at its pin now', () => {
  it('is imported with one copy at each place, as the sharer has them', async () => {
    const link = std64({ v: 2, locs: [
      { n: 'Kronborg', la: OLD.lat, lo: OLD.lon, wt: HK.waterType, sl: HK.slug },
      { n: HK.name, la: HK.lat, lo: HK.lon, wt: HK.waterType, sl: HK.slug },
    ], sp: [], av: [{ d: [3], f: '05:00', t: '09:00', m: ['shore'] }] })
    const locs = await openLink({ setup: link }, [], 'setup_import')
    expect(locs.map((l) => [l.name, l.lat, l.lon])).toEqual([['Kronborg', OLD.lat, OLD.lon], [HK.name, HK.lat, HK.lon]])
  })
})

/**
 * The banner of a shared window, as the recipient sees it. It read
 * "📍 Hornbæk · 2026-11-21 · 22:00–02:00 · 71": the date as the link
 * carries it, no "+1" for a window that ends the next day, and a bare
 * number. The date is written as the dashboard writes it, the "+1" is the
 * dashboard's badge, and the score is named, in both languages.
 */
const win = (d: string, f: string, to: string, s: unknown = 71) =>
  std64({ v: 2, n: 'Hornbæk', la: 56.09027, lo: 12.45693, wt: 'salt', d, f, t: to, s })
/**
 * The banner of this window link, opened at this local time: by default the
 * day before 21 November 2026, the day most links below are for. The time is
 * set, so no test reads differently on another day or in another year.
 */
async function banner(link: string, at = new Date(2026, 10, 20, 12)): Promise<FakeNode> {
  clockAt(at)
  const pinia = createPinia()
  setActivePinia(pinia)
  const page = { render: () => null }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', name: 'welcome', component: page }] })
  await router.push({ path: '/', query: { win: link } })
  view = mount(WelcomeView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
  await nextTick()
  return view.root.byClass('share-banner')[0]
}
const body = (b: FakeNode) => b.byClass('sb-body')[0].textContent
const over = (b: FakeNode) => b.byClass('sb-over').map((x) => x.textContent)
/** Runs `fn` with the local time zone moved to `zone`, and moves it back. */
async function inZone(zone: string, fn: () => Promise<void>) {
  const was = process.env.TZ
  process.env.TZ = zone
  try { await fn() } finally { process.env.TZ = was }
}

describe('a shared window\'s banner', () => {
  it('writes the day, marks a window that ends the next day, and names the score', async () => {
    const b = await banner(win('2026-11-21', '22:00', '02:00'))
    expect(b.byClass('sb-body')[0].textContent).toBe('📍 Hornbæk · Lør 21. Nov · 22:00–02:00+1')
    const plus = b.byClass('nextday')
    expect(plus).toHaveLength(1)
    expect(plus[0].attrs.role).toBe('img')
    expect(plus[0].attrs['aria-label']).toBe(STRINGS.da.window_next_day)
    expect(plus[0].attrs.title).toBe(STRINGS.da.window_next_day)
    expect(b.byClass('sb-score')[0].textContent).toBe(`${STRINGS.da.share_score}: 71 · ${STRINGS.da.score_good}`)
  })

  it('in English too', async () => {
    const b = await banner(win('2026-11-21', '22:00', '02:00'))
    setLang('en')
    await langReady() // the English table is a chunk of its own
    await nextTick()
    expect(b.byClass('sb-body')[0].textContent).toBe('📍 Hornbæk · Sat 21 Nov · 22:00–02:00+1')
    expect(b.byClass('nextday')[0].attrs['aria-label']).toBe(STRINGS.en.window_next_day)
    expect(b.byClass('sb-score')[0].textContent).toBe(`${STRINGS.en.share_score}: 71 · ${STRINGS.en.score_good}`)
  })

  // 22:00–00:00 ends at midnight, the end of its own evening (endsNextDay).
  it('marks no "+1" on a window that ends by midnight', async () => {
    for (const [f, to] of [['22:00', '00:00'], ['05:00', '09:00']]) {
      const b = await banner(win('2026-07-15', f, to, 40))
      expect(b.byClass('sb-body')[0].textContent).toBe(`📍 Hornbæk · Ons 15. Jul · ${f}–${to}`)
      expect(b.byClass('nextday')).toEqual([])
      expect(b.byClass('sb-score')[0].textContent).toBe(`${STRINGS.da.share_score}: 40 · ${STRINGS.da.score_below}`)
      view!.unmount()
      view = undefined
    }
  })

  // The link's date passes the pattern check but names no day: shown as it came.
  // Date rolls 30 February over to 2 March rather than refuse it.
  // With no day, it has no end either: it is not said to be over.
  it('shows a date that names no day as the link has it', async () => {
    for (const d of ['2026-13-01', '2026-02-30']) {
      const b = await banner(win(d, '05:00', '09:00'))
      expect(b.byClass('sb-body')[0].textContent).toBe(`📍 Hornbæk · ${d} · 05:00–09:00`)
      expect(over(b)).toEqual([])
      view!.unmount()
      view = undefined
    }
  })

  // The tests run in Copenhagen, where UTC midnight is still the same day.
  // West of UTC it is the evening before: local parts named the day before.
  it('names the same day for a recipient west of UTC', async () => {
    const zone = process.env.TZ
    process.env.TZ = 'America/New_York'
    try {
      const b = await banner(win('2026-11-21', '05:00', '09:00'))
      expect(b.byClass('sb-body')[0].textContent).toBe('📍 Hornbæk · Lør 21. Nov · 05:00–09:00')
    } finally {
      process.env.TZ = zone
    }
  })
})

/**
 * Round N: the banner named no year, so a window from another
 * year (a link opened long after it was shared, or around New Year) read as
 * this year's. The year is written, as a catch's card writes it, when the
 * window's day is not in the recipient's own year.
 */
describe('a shared window from another year', () => {
  it('names the year, before this year and after it', async () => {
    let b = await banner(win('2025-11-21', '05:00', '09:00'))
    expect(body(b)).toBe('📍 Hornbæk · Fre 21. Nov 2025 · 05:00–09:00')
    view!.unmount()
    b = await banner(win('2027-01-02', '22:00', '02:00'))
    expect(body(b)).toBe('📍 Hornbæk · Lør 2. Jan 2027 · 22:00–02:00+1')
  })

  it('in English too', async () => {
    const b = await banner(win('2025-11-21', '05:00', '09:00'))
    setLang('en')
    await langReady() // the English table is a chunk of its own
    await nextTick()
    expect(body(b)).toBe('📍 Hornbæk · Fri 21 Nov 2025 · 05:00–09:00')
  })

  // A page left open over New Year: the year goes once the window's year is the recipient's.
  it('stops naming it at New Year on a page left open', async () => {
    const b = await banner(win('2027-01-01', '05:00', '09:00'), new Date(2026, 11, 31, 23, 59))
    expect(body(b)).toBe('📍 Hornbæk · Fre 1. Jan 2027 · 05:00–09:00')
    await aMinuteLater()
    expect(body(b)).toBe('📍 Hornbæk · Fre 1. Jan · 05:00–09:00')
  })

  // New York's New Year's Eve at 20:00 is 01:00 on 1 January UTC. The year
  // is the recipient's own, and the window's day is the link's, west of UTC too.
  it('reads the year on the recipient\'s clock, west of UTC', async () => {
    await inZone('America/New_York', async () => {
      const eve = () => new Date(2026, 11, 31, 20)
      let b = await banner(win('2026-12-31', '05:00', '09:00'), eve())
      expect(body(b)).toBe('📍 Hornbæk · Tor 31. Dec · 05:00–09:00')
      view!.unmount()
      b = await banner(win('2027-01-01', '05:00', '09:00'), eve())
      expect(body(b)).toBe('📍 Hornbæk · Fre 1. Jan 2027 · 05:00–09:00')
      setLang('en')
      await langReady()
      await nextTick()
      expect(body(b)).toBe('📍 Hornbæk · Fri 1 Jan 2027 · 05:00–09:00')
    })
  })
})

/**
 * Round N: nothing said a shared window was over, so a link
 * opened after it ended read as if the window were still coming. A line
 * says so once it has ended: at its end time, on the next day for one that
 * crosses midnight. The banner reads the app's clock (lib/clock useNow), so
 * a page left open says so at the minute the window ends. Its spot can
 * still be added.
 */
describe('a shared window that is over', () => {
  const OVER_DA = `⌛ ${STRINGS.da.share_window_over}`

  it('is said to be over at the minute it ends', async () => {
    const b = await banner(win('2026-11-20', '05:00', '09:00'), new Date(2026, 10, 20, 8, 59))
    expect(over(b)).toEqual([])
    await aMinuteLater() // 09:00
    expect(over(b)).toEqual([OVER_DA])
    // The rest of the banner is as it was.
    expect(body(b)).toBe('📍 Hornbæk · Fre 20. Nov · 05:00–09:00')
    expect(b.byClass('sb-score')[0].textContent).toBe(`${STRINGS.da.share_score}: 71 · ${STRINGS.da.score_good}`)
  })

  it('is not said to be over while it is under way, or still to come', async () => {
    for (const at of [new Date(2026, 10, 20, 4), new Date(2026, 10, 20, 7), new Date(2026, 10, 20, 8, 59, 59)]) {
      const b = await banner(win('2026-11-20', '05:00', '09:00'), at)
      expect(over(b), at.toString()).toEqual([])
      view!.unmount()
      view = undefined
    }
  })

  it('in English too', async () => {
    const b = await banner(win('2026-11-20', '05:00', '09:00'), new Date(2026, 10, 20, 12))
    setLang('en')
    await langReady() // the English table is a chunk of its own
    await nextTick()
    expect(over(b)).toEqual([`⌛ ${STRINGS.en.share_window_over}`])
  })

  // 22:00–02:00 ends at 02:00 the next day; 22:00–00:00 at the midnight after its evening.
  it('ends on the next day when it crosses midnight', async () => {
    let b = await banner(win('2026-11-21', '22:00', '02:00'), new Date(2026, 10, 21, 23))
    expect(over(b)).toEqual([])
    view!.unmount()
    b = await banner(win('2026-11-21', '22:00', '02:00'), new Date(2026, 10, 22, 1, 59))
    expect(over(b)).toEqual([])
    await aMinuteLater()
    expect(over(b)).toEqual([OVER_DA])
    view!.unmount()
    b = await banner(win('2026-11-21', '22:00', '00:00'), new Date(2026, 10, 21, 23, 59))
    expect(over(b)).toEqual([])
    await aMinuteLater()
    expect(over(b)).toEqual([OVER_DA])
  })

  // The window's times are read on the recipient's clock, as the app reads
  // every window's: at 20:00 in New York, 01:00 UTC, one until 22:00 is on.
  it('ends on the recipient\'s clock, west of UTC', async () => {
    await inZone('America/New_York', async () => {
      let b = await banner(win('2026-12-31', '18:00', '22:00'), new Date(2026, 11, 31, 20))
      expect(over(b)).toEqual([])
      view!.unmount()
      b = await banner(win('2026-12-31', '05:00', '09:00'), new Date(2026, 11, 31, 20))
      expect(over(b)).toEqual([OVER_DA])
    })
  })

  it('still has its spot added', async () => {
    clockAt(new Date(2026, 6, 16, 12)) // the day after LINK's window
    const locs = await openLink({ win: LINK }, [], 'share_add_loc')
    expect(locs).toHaveLength(1)
    expect(locs[0]).toMatchObject({ name: HK.name, lat: HK.lat, lon: HK.lon, spotSlug: HK.slug })
  })

  it('is said to be over beside the button that adds its spot', async () => {
    const b = await banner(LINK, new Date(2026, 6, 16, 12))
    expect(over(b)).toEqual([OVER_DA])
    expect(b.byTag('button').map((x) => x.textContent)).toContain(STRINGS.da.share_add_loc)
  })
})

/**
 * Round N: a link with no score, or one that is no score, was
 * read as 0, and the banner said "Score: 0 · Dårligt" of a window nobody
 * had scored. With none, the banner has no score line. 0 is still a score.
 */
describe('a shared window without a score', () => {
  it('has no score line', async () => {
    const none = std64({ v: 2, n: 'Hornbæk', la: 56.09027, lo: 12.45693, wt: 'salt', d: '2026-11-21', f: '05:00', t: '09:00' })
    const links = [['none', none], ...['lots', 1e9, -3].map((s) => [String(s), win('2026-11-21', '05:00', '09:00', s)])]
    for (const [s, link] of links) {
      const b = await banner(link)
      expect(body(b), s).toBe('📍 Hornbæk · Lør 21. Nov · 05:00–09:00')
      expect(b.byClass('sb-score').length, s).toBe(0)
      view!.unmount()
      view = undefined
    }
  })

  // The dashboard's 🔗 on a window without data, whose card shows "?": the
  // link carried its stand-in 20, and the banner said "Score: 20 · Dårligt".
  it('has no score line for a window shared without data', async () => {
    vi.stubGlobal('location', { origin: 'https://example.test', pathname: '/fishcast/v2/' })
    let link: string
    try {
      link = shareWindowUrl({
        location: { id: 'h', name: 'Hornbæk', lat: 56.09027, lon: 12.45693, waterType: 'salt' },
        date: new Date(Date.UTC(2026, 10, 21)), from: '05:00', to: '09:00',
        score: 20, noData: true, bestHourStr: null, tags: [],
      }).split('win=')[1]
    } finally {
      vi.unstubAllGlobals()
    }
    const b = await banner(link)
    expect(body(b)).toBe('📍 Hornbæk · Lør 21. Nov · 05:00–09:00')
    expect(b.byClass('sb-score')).toEqual([])
  })

  it('names a score of 0', async () => {
    const b = await banner(win('2026-11-21', '05:00', '09:00', 0))
    expect(b.byClass('sb-score')[0].textContent).toBe(`${STRINGS.da.share_score}: 0 · ${STRINGS.da.score_poor}`)
  })

  // A link from before links carried depth, slug and species, and with no score.
  it('still has its spot added', async () => {
    clockAt(new Date(2026, 6, 14, 12))
    const old = std64({ n: 'Molen', la: 55.6, lo: 12.6, wt: 'salt', d: '2026-07-15', f: '05:00', t: '09:00' })
    const locs = await openLink({ win: old }, [], 'share_add_loc')
    expect(locs).toHaveLength(1)
    expect(locs[0]).toMatchObject({ name: 'Molen', lat: 55.6, lon: 12.6 })
  })
})

/**
 * A link whose payload the app can't read: cut short on its way (a chat
 * app, a line break in a mail), or mangled. It opened to the plain welcome
 * page with no word, as if the spots it carried were lost. A banner of the
 * link's kind says it could not be read, and closes as the others do.
 */
describe('a link that cannot be read', () => {
  const SETUP = std64({ v: 2, locs: [{ n: 'Hornbæk', la: 56.09027, lo: 12.45693, wt: 'salt' }], sp: ['torsk'], av: [{ d: [6], f: '05:00', t: '09:00', m: ['shore'] }] })
  const half = (s: string) => s.slice(0, Math.floor(s.length / 2))
  const BROKEN_DA = `⚠️ ${STRINGS.da.share_link_broken}`

  /** The welcome page opened with this query: its banners and the router. */
  async function land(query: Record<string, string>) {
    const pinia = createPinia()
    setActivePinia(pinia)
    const page = { render: () => null }
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', name: 'welcome', component: page }] })
    await router.push({ path: '/', query })
    view = mount(WelcomeView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
    await nextTick()
    return { banners: () => view!.root.byClass('share-banner'), router }
  }
  const buttons = (b: FakeNode) => b.byTag('button').map((x) => x.textContent)

  it('a setup link cut short says so, under the setup banner\'s title', async () => {
    const { banners } = await land({ setup: half(SETUP) })
    expect(banners()).toHaveLength(1)
    expect(banners()[0].byClass('sb-title')[0].textContent).toBe(`📤 ${STRINGS.da.setup_shared_title}`)
    expect(banners()[0].byClass('sb-warn').map((x) => x.textContent)).toEqual([BROKEN_DA])
    expect(buttons(banners()[0])).toEqual([STRINGS.da.close])
  })

  it('a window link cut short says so, under the window banner\'s title', async () => {
    const { banners } = await land({ win: half(LINK) })
    expect(banners()).toHaveLength(1)
    expect(banners()[0].byClass('sb-title')[0].textContent).toBe(`📤 ${STRINGS.da.share_window}`)
    expect(banners()[0].byClass('sb-warn').map((x) => x.textContent)).toEqual([BROKEN_DA])
    expect(buttons(banners()[0])).toEqual([STRINGS.da.close])
  })

  it('so does one that holds nothing the app reads, or nothing at all', async () => {
    const queries: Record<string, string>[] = [{ setup: 'hello' }, { setup: '' }, { win: std64({ n: 'Molen' }) }, { setup: std64({ v: 2, locs: [], sp: [], av: [] }) }]
    for (const query of queries) {
      const { banners } = await land(query)
      expect(banners().map((b) => b.byClass('sb-warn')[0]?.textContent), JSON.stringify(query)).toEqual([BROKEN_DA])
      view!.unmount()
      view = undefined
    }
  })

  it('closes, and takes the link out of the address', async () => {
    const { banners, router } = await land({ setup: half(SETUP) })
    banners()[0].byTag('button')[0].click()
    await new Promise((r) => setTimeout(r, 0)) // the router's replace
    await nextTick()
    expect(router.currentRoute.value.query).toEqual({})
    expect(banners()).toEqual([])
  })

  it('a link that can be read says nothing of the kind', async () => {
    const queries: Record<string, string>[] = [{ setup: SETUP }, { win: LINK }]
    for (const query of queries) {
      const { banners } = await land(query)
      expect(banners()).toHaveLength(1)
      expect(banners()[0].textContent, JSON.stringify(query)).not.toContain(STRINGS.da.share_link_broken)
      view!.unmount()
      view = undefined
    }
  })

  it('in English too', async () => {
    const { banners } = await land({ setup: half(SETUP) })
    setLang('en')
    await langReady() // the English table is a chunk of its own
    await nextTick()
    expect(banners()[0].byClass('sb-title')[0].textContent).toBe(`📤 ${STRINGS.en.setup_shared_title}`)
    expect(banners()[0].byClass('sb-warn')[0].textContent).toBe(`⚠️ ${STRINGS.en.share_link_broken}`)
  })
})

// ── Round P: taking in a shared setup ────────────────────────────────

const HORNBAEK = { n: 'Hornbæk', la: 56.09027, lo: 12.45693, wt: 'salt' }
const NORDHUSE = { n: 'Nordhuse', la: 55.97, lo: 12.1, wt: 'salt' }
const AV_LINK = [{ d: [6], f: '05:00', t: '09:00', m: ['shore'] }]
const setupLink = (locs: unknown[], av: unknown[] = AV_LINK, more: Record<string, unknown> = {}) => std64({ v: 2, locs, sp: ['torsk'], av, ...more })
const MY_WINDOW: Availability = { id: 'w', days: [0], from: '17:00', to: '21:00', methods: ['boat'] }
/** The user's own copy of Hornbæk: their name, ★ and note on it. */
const MY_HORNBAEK: Location = { id: 'mine', name: 'Min mole', lat: 56.09027, lon: 12.45693, waterType: 'salt', fav: true, note: 'Bedst ved vestenvind' }

/**
 * The welcome page opened with this setup link over this setup, as mounted:
 * `take` taps "Importér opsætning" and says yes to the question that follows.
 */
async function setupBanner(link: string, own: { locations?: Location[]; targetSpecies?: string[]; availability?: Availability[] } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const setup = useSetupStore()
  setup.locations = own.locations ?? []
  setup.targetSpecies = own.targetSpecies ?? []
  setup.availability = own.availability ?? []
  const page = { render: () => null }
  const router = createRouter({ history: createMemoryHistory(), routes: ['welcome', 'dashboard', 'availability', 'locations'].map((name) => ({ path: name === 'welcome' ? '/' : '/' + name, name, component: page })) })
  await router.push({ path: '/', query: { setup: link } })
  view = mount(WelcomeView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
  await nextTick()
  const banner = () => view!.root.byClass('share-banner')[0]
  async function take() {
    const b = banner().byTag('button').find((x) => x.textContent === t('setup_import'))
    if (!b) throw new Error('no import button')
    b.click()
    await nextTick()
    const asked = confirmState.open ? confirmState.message : null
    if (asked !== null) confirmAccept()
    await new Promise((r) => setTimeout(r, 0)) // the router's replace
    await nextTick()
    return asked
  }
  return { setup, router, banner, take }
}

/** What the user's setup loses, and keeps, as the banner's line says it (counts as in lib/shareImport importEffect). */
const keptOf = (lang: 'da' | 'en', kept: string) => STRINGS[lang].setup_import_keeps.replace('{kept}', kept)
const warnOf = (lang: 'da' | 'en', gone: string, kept = '') =>
  `⚠️ ${STRINGS[lang].setup_import_warn.replace('{gone}', gone)}` + (kept ? ' ' + keptOf(lang, kept) : '')
/** …and as the question before the import asks it. */
const askOf = (lang: 'da' | 'en', gone: string, kept = '') =>
  STRINGS[lang].setup_import_confirm.replace('{gone}', gone) + (kept ? ' ' + keptOf(lang, kept) : '')

/**
 * Taking in a link that holds spots the user has already put the link's
 * copies in their place: the ★, the note and the id were gone, and with the
 * id each catch's link to its spot (CatchEntry.locationId), on every synced
 * device. A spot both hold stays the user's (shareImport.ts keepOwnCopies).
 */
describe('a shared setup taken in over spots the user has already', () => {
  it('keeps the user\'s copy, and adds the spots they lack', async () => {
    const { setup, take } = await setupBanner(setupLink([HORNBAEK, NORDHUSE]), { locations: [MY_HORNBAEK] })
    await take()
    expect(setup.locations).toHaveLength(2)
    expect(setup.locations[0]).toEqual(MY_HORNBAEK)
    expect(setup.locations[1]).toMatchObject({ name: 'Nordhuse', lat: 55.97, lon: 12.1 })
    expect(setup.locations[1].id).not.toBe('mine')
  })

  // Round Q: the user's automatic coast (no coast field) took the sharer's pick.
  it('keeps the user\'s automatic coast, though the link\'s copy has one picked', async () => {
    const picked = { ...HORNBAEK, co: { facing: 90, spread: 180, exposure: 'open' } }
    const { setup, take } = await setupBanner(setupLink([picked, NORDHUSE]), { locations: [MY_HORNBAEK] })
    await take()
    expect(setup.locations[0]).toEqual(MY_HORNBAEK)
    expect(setup.locations[0]).not.toHaveProperty('coast')
  })

  it('signed in, the account\'s row keeps the spot\'s id and ★ too', async () => {
    fakeDb.reset()
    fakeDb.seed('setups', { user_id: 'u1', setup: { locations: [MY_HORNBAEK], targetSpecies: [], availability: [MY_WINDOW], lang: 'da' }, updated_at: new Date(1000).toISOString() })
    const { setup, take } = await setupBanner(setupLink([HORNBAEK, NORDHUSE]))
    useAuthStore().user = { id: 'u1' } as User
    fakeDb.session = { user: { id: 'u1' } }
    try {
      await setup.pullRemote()
      setup.markReady()
      expect(setup.locations).toEqual([MY_HORNBAEK])
      await take()
      await setup.flush()
      const row = fakeDb.row('setups', 'u1')!.setup
      expect(row.locations.map((l: Location) => [l.id, l.fav])).toEqual([['mine', true], [setup.locations[1].id, undefined]])
    } finally {
      useAuthStore().user = null
      fakeDb.session = null
      fakeDb.reset()
    }
  })
})

/**
 * A setup link with spots but no time windows (one made by hand, or whose
 * windows the checks dropped) put none in place of the user's own, and the
 * dashboard, with no windows to show, sent the user back to the plain
 * welcome page: the spots were taken in, and nothing said where they went.
 * Such a link keeps the user's windows. With windows the setup is whole and
 * the dashboard opens; without, the windows screen, the step still missing,
 * and a toast says why.
 */
describe('a shared setup without time windows', () => {
  const DA = STRINGS.da
  const said = () => toasts.value.map((x) => x.message)
  beforeEach(() => { toasts.value = [] })

  it('keeps the user\'s windows, and opens the dashboard', async () => {
    const { setup, router, take } = await setupBanner(setupLink([NORDHUSE], []), { locations: [MY_HORNBAEK], availability: [MY_WINDOW] })
    await take()
    expect(setup.availability).toEqual([MY_WINDOW])
    expect(setup.locations.map((l) => l.name)).toEqual(['Nordhuse'])
    expect(setup.targetSpecies).toEqual(['torsk'])
    expect(router.currentRoute.value.name).toBe('dashboard')
    expect(said()).toEqual([])
  })

  it('with no windows of the user\'s own, opens the windows screen and says why', async () => {
    const { setup, router, take } = await setupBanner(setupLink([NORDHUSE], []))
    await take()
    expect(setup.locations.map((l) => l.name)).toEqual(['Nordhuse'])
    expect(setup.availability).toEqual([])
    expect(router.currentRoute.value.name).toBe('availability')
    expect(said()).toEqual([DA.setup_import_no_av])
  })

  it('says before the import that the windows are kept, and asks only of what goes', async () => {
    const { banner, take } = await setupBanner(setupLink([NORDHUSE], []), { locations: [MY_HORNBAEK], availability: [MY_WINDOW] })
    expect(banner().byClass('sb-warn').map((x) => x.textContent)).toEqual([warnOf('da', '1 📍', '1 ⏱')])
    expect(await take()).toBe(askOf('da', '1 📍', '1 ⏱'))
  })

  it('asks nothing when the only thing the user has is windows it keeps', async () => {
    const { banner, take } = await setupBanner(setupLink([NORDHUSE], []), { availability: [MY_WINDOW] })
    expect(banner().byClass('sb-warn')).toEqual([])
    expect(banner().byClass('sb-keep').map((x) => x.textContent)).toEqual([keptOf('da', '1 ⏱')])
    expect(await take()).toBeNull()
  })

  // Round P review: the question waits for an answer, and the address can
  // change meanwhile (Back, a new link). Whether the windows stay is read
  // from the link being taken in, before the question.
  it('keeps the windows when the link has left the address by the time the user says yes', async () => {
    const { setup, router, banner } = await setupBanner(setupLink([NORDHUSE], []), { locations: [MY_HORNBAEK], availability: [MY_WINDOW] })
    banner().byTag('button').find((x) => x.textContent === t('setup_import'))!.click()
    await nextTick()
    expect(confirmState.open).toBe(true)
    await router.replace({ name: 'welcome', query: {} })
    confirmAccept()
    await new Promise((r) => setTimeout(r, 0)) // the router's replace
    expect(setup.availability).toEqual([MY_WINDOW])
    expect(setup.locations.map((l) => l.name)).toEqual(['Nordhuse'])
  })

  it('in English too', async () => {
    const { banner, take } = await setupBanner(setupLink([NORDHUSE], []), { locations: [MY_HORNBAEK] })
    setLang('en')
    await langReady() // the English table is a chunk of its own
    await nextTick()
    expect(banner().byClass('sb-warn')[0].textContent).toBe(warnOf('en', '1 📍'))
    await take()
    expect(said()).toEqual([STRINGS.en.setup_import_no_av])
  })

  // As before: a link's windows replace the user's, and say so.
  it('a link with windows still replaces them, after the same question', async () => {
    const { setup, router, banner, take } = await setupBanner(setupLink([NORDHUSE]), { locations: [MY_HORNBAEK], availability: [MY_WINDOW] })
    expect(banner().byClass('sb-warn').map((x) => x.textContent)).toEqual([warnOf('da', '1 📍 · 1 ⏱')])
    expect(await take()).toBe(askOf('da', '1 📍 · 1 ⏱'))
    expect(setup.availability.map((a) => [a.days, a.from, a.to])).toEqual([[[6], '05:00', '09:00']])
    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  // Round Q: a link with no `av` key at all (made by hand, or by an older
  // build) read as one that could not be read, while `av: []` worked.
  it('a link with no windows key at all is read as one without windows', async () => {
    const link = std64({ v: 2, locs: [NORDHUSE], sp: ['torsk'] })
    const { setup, router, banner, take } = await setupBanner(link, { availability: [MY_WINDOW] })
    expect(banner().byClass('sb-title')[0].textContent).toBe(`📤 ${DA.setup_shared_title}`)
    expect(banner().textContent).not.toContain(DA.share_link_broken)
    expect(banner().byClass('sb-body')[0].textContent).toBe('📍 1 · 🎯 1 · ⏱ 0')
    await take()
    expect(setup.locations.map((l) => l.name)).toEqual(['Nordhuse'])
    expect(setup.availability).toEqual([MY_WINDOW])
    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  // A link with windows but no spots: the spots screen is the step still missing.
  it('a link without spots, taken in with none, opens the spots screen', async () => {
    const { router, take } = await setupBanner(setupLink([]))
    await take()
    expect(router.currentRoute.value.name).toBe('locations')
  })
})

/**
 * Round Q: the import's question counted every spot, target species and
 * window of the user's as replaced: "(1 📍 · 1 🎯)" while Helsingør Kysten,
 * which the user had, was kept with its ★ and note. A link of the user's own
 * setup read as losing everything. The banner and the question count only
 * what goes, and say what is kept; with nothing to lose, nothing is asked.
 */
describe('the import\'s question counts only what goes', () => {
  const DA = STRINGS.da
  const MY_HK: Location = { id: 'hk', ...locationFromSpot(HK), name: 'Kronborg', fav: true, note: 'Ved fyret' }
  const SHARED_HK = { n: HK.name, la: HK.lat, lo: HK.lon, wt: HK.waterType, sl: HK.slug }
  const link = () => std64({ v: 2, locs: [SHARED_HK, NORDHUSE], sp: ['torsk'], av: [] })
  const own = () => ({ locations: [MY_HK], targetSpecies: ['gedde'], availability: [MY_WINDOW] })

  it('counts the spot the user has as kept, not as lost', async () => {
    const { banner, take, setup } = await setupBanner(link(), own())
    expect(banner().byClass('sb-warn').map((x) => x.textContent)).toEqual(['⚠️ Fjerner 1 🎯 fra din opsætning. Du beholder 1 📍 · 1 ⏱.'])
    expect(await take()).toBe('Importér den delte opsætning? Det fjerner 1 🎯 fra din opsætning og kan ikke fortrydes. Du beholder 1 📍 · 1 ⏱.')
    expect(setup.locations[0]).toEqual(MY_HK)
    expect(setup.locations.map((l) => l.name)).toEqual(['Kronborg', 'Nordhuse'])
    expect(setup.targetSpecies).toEqual(['torsk'])
    expect(setup.availability).toEqual([MY_WINDOW])
  })

  it('in English too', async () => {
    const { banner, take } = await setupBanner(link(), own())
    setLang('en')
    await langReady() // the English table is a chunk of its own
    await nextTick()
    expect(banner().byClass('sb-warn')[0].textContent).toBe('⚠️ Removes 1 🎯 from your setup. You keep 1 📍 · 1 ⏱.')
    expect(await take()).toBe(askOf('en', '1 🎯', '1 📍 · 1 ⏱'))
  })

  /** Shared from one phone and opened on another, or opened again by mistake. */
  it('a link of the user\'s own setup asks nothing, says all is kept, and leaves the setup as it is', async () => {
    const mine = { locations: [MY_HK, MY_HORNBAEK], targetSpecies: ['torsk', 'gedde'], availability: [MY_WINDOW] }
    vi.stubGlobal('location', { origin: 'https://example.test', pathname: '/fishcast/v2/' })
    let q: string
    try {
      q = shareSetupUrl(mine.locations, mine.targetSpecies, mine.availability).split('setup=')[1]
    } finally {
      vi.unstubAllGlobals()
    }
    const before = JSON.parse(JSON.stringify(mine))
    const { banner, take, setup, router } = await setupBanner(q, mine)
    expect(banner().byClass('sb-warn')).toEqual([])
    expect(banner().byClass('sb-keep').map((x) => x.textContent)).toEqual([keptOf('da', '2 📍 · 2 🎯 · 1 ⏱')])
    expect(await take()).toBeNull()
    expect(JSON.parse(JSON.stringify({ locations: setup.locations, targetSpecies: setup.targetSpecies, availability: setup.availability }))).toEqual(before)
    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it('says nothing of what is kept when the user has nothing', async () => {
    const { banner, take } = await setupBanner(link())
    expect(banner().byClass('sb-warn')).toEqual([])
    expect(banner().byClass('sb-keep')).toEqual([])
    expect(await take()).toBeNull()
  })
})

/**
 * A setup of more than 50 spots was shared whole, and the recipient got the
 * first 50 (lib/share MAX_LOCS), with no word. The link now says how many
 * the sharer has, and the banner says only the first 50 came with it; a link
 * made before, with all of them in it, is said to be cut too.
 */
describe('a shared setup cut at 50 spots', () => {
  const spots = (n: number) => Array.from({ length: n }, (_, i) => ({ n: 'Plads ' + i, la: 55 + i / 100, lo: 12, wt: 'salt' }))
  const cut = (lang: 'da' | 'en', total: number) => `⚠️ ${STRINGS[lang].setup_shared_cut.replace('{n}', '50').replace('{total}', String(total))}`

  it('says the link holds only the first 50, of how many', async () => {
    const { banner } = await setupBanner(setupLink(spots(50), AV_LINK, { of: 73 }))
    expect(banner().byClass('sb-cut').map((x) => x.textContent)).toEqual([cut('da', 73)])
  })

  it('says so of a link made before, that held them all', async () => {
    const { banner, setup, take } = await setupBanner(setupLink(spots(60)))
    expect(banner().byClass('sb-cut').map((x) => x.textContent)).toEqual([cut('da', 60)])
    await take()
    expect(setup.locations).toHaveLength(50)
  })

  it('says nothing of a link that holds them all', async () => {
    const { banner } = await setupBanner(setupLink(spots(50)))
    expect(banner().byClass('sb-cut')).toEqual([])
  })

  it('in English too', async () => {
    const { banner } = await setupBanner(setupLink(spots(50), AV_LINK, { of: 73 }))
    setLang('en')
    await langReady() // the English table is a chunk of its own
    await nextTick()
    expect(banner().byClass('sb-cut')[0].textContent).toBe(cut('en', 73))
  })
})

/**
 * A guest who took in a shared setup here, then signed in to an account with
 * a setup of its own, lost the import with no word: the account's setup wins
 * at sign-in (stores/setup.ts). The spots the account lacks are offered back.
 */
describe('a shared setup taken in as a guest, then signing in', () => {
  const offered = () => toasts.value.filter((x) => x.key === 'guest-spots')
  beforeEach(() => { toasts.value = [] })
  afterEach(() => {
    useAuthStore().user = null
    fakeDb.session = null
    fakeDb.reset()
  })

  it('offers the spots the account lacks, and adds them when asked', async () => {
    const { setup, take } = await setupBanner(setupLink([HORNBAEK, NORDHUSE]))
    await take()
    expect(setup.account).toBeNull()
    fakeDb.reset()
    fakeDb.seed('setups', { user_id: 'u1', setup: { locations: [MY_HORNBAEK], targetSpecies: [], availability: [MY_WINDOW], lang: 'da' }, updated_at: new Date(1000).toISOString() })
    useAuthStore().user = { id: 'u1' } as User
    fakeDb.session = { user: { id: 'u1' } }
    await setup.pullRemote()
    expect(setup.locations).toEqual([MY_HORNBAEK])
    // Hornbæk is the account's already: Nordhuse alone is offered.
    expect(offered().map((x) => x.message)).toEqual(['📍 ' + STRINGS.da.toast_guest_spots_one])
    setup.markReady()
    runToastAction(offered()[0].id)
    expect(setup.locations.map((l) => l.name)).toEqual(['Min mole', 'Nordhuse'])
    await nextTick() // the edit is marked
    await setup.flush()
    expect(fakeDb.row('setups', 'u1')!.setup.locations.map((l: Location) => l.name)).toEqual(['Min mole', 'Nordhuse'])
  })

  // Signed in, the import is the account's own edit: nothing is offered, it syncs.
  it('signed in, takes the spots in for the account, with nothing to offer', async () => {
    fakeDb.reset()
    fakeDb.seed('setups', { user_id: 'u1', setup: { locations: [MY_HORNBAEK], targetSpecies: [], availability: [MY_WINDOW], lang: 'da' }, updated_at: new Date(1000).toISOString() })
    const { setup, take } = await setupBanner(setupLink([HORNBAEK, NORDHUSE]))
    useAuthStore().user = { id: 'u1' } as User
    fakeDb.session = { user: { id: 'u1' } }
    await setup.pullRemote()
    setup.markReady()
    await take()
    await setup.flush()
    expect(offered()).toEqual([])
    expect(fakeDb.row('setups', 'u1')!.setup.locations.map((l: Location) => l.name)).toEqual(['Min mole', 'Nordhuse'])
  })
})
