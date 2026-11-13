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
import { installDocument, mount } from '@/test/fakeDom'
import { t } from '@/lib/i18n'
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
