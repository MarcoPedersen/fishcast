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
import { DK_SPOTS, locationFromSpot } from '@/lib/spots'
import type { Location } from '@/lib/types'
import { useSetupStore } from '@/stores/setup'
import WelcomeView from './WelcomeView.vue'

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
