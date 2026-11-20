// @vitest-environment vue-dom
/**
 * A shared window's spot, added from the welcome page as mounted: the real
 * view, Pinia and router on the in-memory DOM. A spot at an official spot's
 * former pin is imported at the spot's pin now (shareImport.ts), so the
 * check for one already saved looks there too, as well as where the link
 * puts it. A shared setup, imported whole, likewise.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
  setLang('da')
  restoreDocument()
})

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
describe('a shared window\'s banner', () => {
  const win = (d: string, f: string, to: string, s = 71) =>
    std64({ v: 2, n: 'Hornbæk', la: 56.09027, lo: 12.45693, wt: 'salt', d, f, t: to, s })
  async function banner(link: string): Promise<FakeNode> {
    const pinia = createPinia()
    setActivePinia(pinia)
    const page = { render: () => null }
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', name: 'welcome', component: page }] })
    await router.push({ path: '/', query: { win: link } })
    view = mount(WelcomeView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
    await nextTick()
    return view.root.byClass('share-banner')[0]
  }

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
  it('shows a date that names no day as the link has it', async () => {
    const b = await banner(win('2026-13-01', '05:00', '09:00'))
    expect(b.byClass('sb-body')[0].textContent).toBe('📍 Hornbæk · 2026-13-01 · 05:00–09:00')
  })
})
