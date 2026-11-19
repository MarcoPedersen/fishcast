// @vitest-environment vue-dom
/**
 * Find pladser, mounted: its "Find i nærheden" search, from a place picked
 * in the search box or from a saved spot. The geocoder answers from a list
 * of public places here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'
import { SEARCH_DEBOUNCE_MS } from '@/lib/placeSearch'
import { forgetAccountData } from '@/lib/forgetOnLogout'
import { useSetupStore } from '@/stores/setup'
import { STRINGS } from '@/test/strings'
import type { GeoResult } from '@/lib/weather'

const PLACES: Record<string, GeoResult[]> = {
  Hornbæk: [{ name: 'Hornbæk', admin1: 'Hovedstaden', lat: 56.09027, lon: 12.45693, country: 'DK' }],
  Nordhuse: [{ name: 'Nordhuse', admin1: 'Hovedstaden', lat: 55.97, lon: 12.1, country: 'DK' }],
}
vi.mock('@/lib/weather', async (orig) => ({ ...(await orig<object>()), geocode: async (q: string) => PLACES[q] ?? [] }))

import SpotFinderView from './SpotFinderView.vue'

const da = STRINGS.da

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined
let router: Router
let pinia: Pinia

beforeEach(() => {
  restoreDocument = installDocument()
  vi.useFakeTimers({ now: new Date(2026, 10, 19, 12, 0) }) // November: the finder scores by month
  pinia = createPinia()
  setActivePinia(pinia)
})
afterEach(() => {
  view?.unmount()
  view = undefined
  forgetAccountData() // as a logout: the finder starts over in the next test
  vi.useRealTimers()
  restoreDocument()
})

async function open(path = '/finder'): Promise<FakeNode> {
  const page = { render: () => null }
  router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/finder', name: 'finder', component: page },
    { path: '/species', name: 'species', component: page },
    { path: '/dashboard', name: 'dashboard', component: page },
  ] })
  await router.push(path)
  view = mount(SpotFinderView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
  await nextTick()
  return view.root
}

/** Off the screen: the router's view unmounts it. */
function leave() {
  view?.unmount()
  view = undefined
}

const button = (root: FakeNode, text: string) => root.byTag('button').find((b) => b.textContent.includes(text))!
const box = (root: FakeNode) => root.byTag('input').find((i) => i.attrs.type === 'search')!
const slider = (root: FakeNode) => root.byTag('input').find((i) => i.attrs.type === 'range')!
/** The mode button that is on. */
const modeOn = (root: FakeNode) => root.byClass('mode active')[0]?.textContent ?? ''
/** The names of the spots found, with their distance as the card shows it. */
const found = (root: FakeNode) => root.byClass('result-card').map((c) => c.byClass('name')[0].textContent)

async function type(root: FakeNode, text: string) {
  box(root).input(text)
  await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
  await nextTick()
}
async function pick(root: FakeNode, place: string) {
  await type(root, place)
  root.byClass('result')[0].click()
  await nextTick()
}
async function search(root: FakeNode) {
  button(root, da.sf_search_btn).click()
  await nextTick()
}

describe('Find i nærheden', () => {
  // Hornbæk picked and searched, then "Nordhuse" typed in the box and not
  // picked: the search button still searched from Hornbæk, and its spots
  // (Gurre Sø 7 km) stood under a box that said Nordhuse.
  it('searches only from the place the box shows: a place typed over it must be picked first', async () => {
    const root = await open()
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    await pick(root, 'Hornbæk')
    await search(root)
    expect(found(root)).toContain('Gurre Sø 7 km')

    await type(root, 'Nordhuse')
    expect(button(root, da.sf_search_btn).attrs.disabled).toBe(true)
    expect(root.textContent).toContain(da.sf_pick_point)

    await pick(root, 'Nordhuse')
    expect(button(root, da.sf_search_btn).attrs.disabled).toBe(false)
    await search(root)
    expect(found(root)).toContain('Arresø 3 km')
    expect(found(root)).not.toContain('Gurre Sø 7 km')
  })
})

describe('leaving Find pladser and coming back', () => {
  // "Skift arter" leads to Målarter, which goes on to the dashboard, not
  // back. Back on Find pladser, by the topbar, the search had started over:
  // lucky mode, the place and the radius gone, to be looked up again.
  it('keeps the place, the radius and the mode, and searches again for the species picked meanwhile', async () => {
    let root = await open()
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    await pick(root, 'Nordhuse')
    slider(root).input('60')
    await search(root)
    expect(found(root)).toContain('Arresø 3 km')
    expect(root.textContent).not.toContain(da.sf_unlisted_head) // no species picked: none set apart

    button(root, da.sf_edit_species).click()
    await vi.advanceTimersByTimeAsync(0)
    expect(router.currentRoute.value.name).toBe('species')
    leave()
    useSetupStore().targetSpecies = ['gedde']

    root = await open()
    expect(modeOn(root)).toContain(da.sf_nearby_badge)
    expect(box(root).value).toBe('Nordhuse, Hovedstaden')
    expect(root.byClass('radius')[0].textContent).toContain('60 km')
    // Searched again, for pike: the spots without it now follow the rest.
    expect(found(root)).toContain('Arresø 3 km')
    expect(root.byClass('result-card')[0].hasClass('unlisted')).toBe(false)
    expect(root.textContent).toContain(da.sf_unlisted_head)
  })

  it('keeps a place picked and not yet searched, without searching', async () => {
    let root = await open()
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    await pick(root, 'Hornbæk')
    leave()
    root = await open()
    expect(box(root).value).toBe('Hornbæk, Hovedstaden')
    expect(button(root, da.sf_search_btn).attrs.disabled).toBe(false)
    expect(found(root)).toEqual([])
  })

  // The welcome page's two buttons open the finder in the mode they name.
  it('opens in the mode the link names', async () => {
    let root = await open()
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    await pick(root, 'Hornbæk')
    await search(root)
    leave()
    root = await open('/finder?mode=lucky')
    expect(modeOn(root)).toContain(da.sf_lucky_badge)
    expect(found(root).length).toBeGreaterThan(0)
  })

  // Kept in memory for the tab, and a place searched for may be one's home:
  // the next user after a logout finds none of it.
  it('forgets it all at logout', async () => {
    let root = await open()
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    await pick(root, 'Hornbæk')
    slider(root).input('80')
    await search(root)
    leave()
    forgetAccountData()
    root = await open()
    expect(modeOn(root)).toContain(da.sf_lucky_badge)
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    expect(box(root).value).toBe('')
    expect(root.byClass('radius')[0].textContent).toContain('40 km')
    expect(button(root, da.sf_search_btn).attrs.disabled).toBe(true)
  })
})
