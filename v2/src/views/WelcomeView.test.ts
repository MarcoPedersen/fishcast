// @vitest-environment vue-dom
/**
 * A shared window's spot, added from the welcome page as mounted: the real
 * view, Pinia and router on the in-memory DOM. A spot at an official spot's
 * former pin is imported at the spot's pin now (shareImport.ts), so the
 * check for one already saved looks there too, as well as where the link
 * puts it.
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

/** Opens the link with these spots saved, and taps "add the spot". */
async function addFromLink(saved: Location[]): Promise<Location[]> {
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
  await router.push({ path: '/', query: { win: LINK } })
  view = mount(WelcomeView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
  await nextTick()
  const add = view.root.byTag('button').find((b) => b.textContent === t('share_add_loc'))
  if (!add) throw new Error('no add button')
  add.click()
  await nextTick()
  return setup.locations
}

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
