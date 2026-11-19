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
  vi.useFakeTimers()
  pinia = createPinia()
  setActivePinia(pinia)
})
afterEach(() => {
  view?.unmount()
  view = undefined
  vi.useRealTimers()
  restoreDocument()
})

async function open(): Promise<FakeNode> {
  const page = { render: () => null }
  router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/finder', name: 'finder', component: page },
    { path: '/species', name: 'species', component: page },
    { path: '/dashboard', name: 'dashboard', component: page },
  ] })
  await router.push('/finder')
  view = mount(SpotFinderView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
  await nextTick()
  return view.root
}

const button = (root: FakeNode, text: string) => root.byTag('button').find((b) => b.textContent.includes(text))!
const box = (root: FakeNode) => root.byTag('input').find((i) => i.attrs.type === 'search')!
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
