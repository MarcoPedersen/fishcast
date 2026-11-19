// @vitest-environment vue-dom
/**
 * Find pladser, mounted: its "Find i nærheden" search, from a place picked
 * in the search box or from a saved spot. The geocoder answers from a list
 * of public places here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h, nextTick } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router'
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'
import { SEARCH_DEBOUNCE_MS } from '@/lib/placeSearch'
import { forgetAccountData } from '@/lib/forgetOnLogout'
import { useSetupStore } from '@/stores/setup'
import { useAuthStore } from '@/stores/auth'
import { STRINGS } from '@/test/strings'
import { DK_SPOTS, locationFromSpot } from '@/lib/spots'
import type { GeoResult } from '@/lib/weather'
import type { User } from '@supabase/supabase-js'

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

  // Hornbæk searched, then "Nordhuse" typed over it: Hornbæk's spots stayed
  // listed, at their distances from Hornbæk, under a box that said
  // Nordhuse (round J review, P3).
  it('lists no spots from a place the box no longer shows', async () => {
    const root = await open()
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    await pick(root, 'Hornbæk')
    await search(root)
    expect(found(root)).toContain('Gurre Sø 7 km')

    await type(root, 'Nordhuse')
    expect(found(root)).toEqual([])
    expect(root.byClass('results')).toEqual([])
  })

  it('lists no spots from the last place once another is picked, until it is searched from', async () => {
    const setup = useSetupStore()
    setup.locations.push({ id: 'arreso', ...locationFromSpot(DK_SPOTS.find((s) => s.slug === 'arreso')!) })
    const root = await open()
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    await pick(root, 'Hornbæk')
    await search(root)
    expect(found(root)).toContain('Gurre Sø 7 km')

    button(root, '📍 Arresø').click()
    await nextTick()
    expect(box(root).value).toBe('Arresø')
    expect(found(root)).toEqual([])
    await search(root)
    expect(found(root)).not.toContain('Gurre Sø 7 km')
    expect(found(root)).toContain('Arresø 0 km')
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

  // Signed out in another tab, or by a token refresh the server refused:
  // no logout runs in this page, so nothing calls onForget, and the next
  // one to open Find pladser here found the account's place and its spots.
  it('forgets the search of an account signed out elsewhere', async () => {
    const auth = useAuthStore()
    auth.user = { id: 'user-a' } as User
    let root = await open()
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    await pick(root, 'Hornbæk')
    await search(root)
    leave()
    auth.user = null
    root = await open()
    expect(modeOn(root)).toContain(da.sf_lucky_badge)
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    expect(box(root).value).toBe('')
    expect(found(root)).toEqual([])
  })

  // A guest who signs in is still the one at the screen: the search stays.
  it('keeps the search of a guest who signs in', async () => {
    let root = await open()
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    await pick(root, 'Hornbæk')
    await search(root)
    leave()
    useAuthStore().user = { id: 'user-a' } as User
    root = await open()
    expect(box(root).value).toBe('Hornbæk, Hovedstaden')
    expect(found(root)).toContain('Gurre Sø 7 km')
  })
})

describe('the mode and the link', () => {
  /**
   * The app's pages at `path`, Find pladser among them, as the router view
   * shows them: back and forward unmount and mount it. `from`: the page
   * before it in the history.
   */
  async function openApp(path: string, from?: string): Promise<FakeNode> {
    const page = { render: () => null }
    router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/finder', name: 'finder', component: SpotFinderView },
      { path: '/species', name: 'species', component: page },
      { path: '/dashboard', name: 'dashboard', component: page },
    ] })
    if (from) await router.push(from)
    await router.push(path)
    view = mount({ render: () => h(RouterView) }, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
    await nextTick()
    return view.root
  }
  /** A navigation, and the pages' re-render after it. */
  async function settle() {
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
  }

  // The mode buttons left the link as it was: opened in lucky mode by the
  // link, switched to Find i nærheden, then Skift arter and back, the
  // link's lucky mode won over the one used (round J review, P2).
  it('back to Find pladser reopens the mode used, not the one the link named', async () => {
    const root = await openApp('/finder?mode=lucky')
    button(root, da.sf_nearby_badge).click()
    await settle()
    expect(router.currentRoute.value.query.mode).toBe('nearby')
    button(root, da.sf_edit_species).click()
    await settle()
    expect(router.currentRoute.value.name).toBe('species')
    expect(root.byClass('finder')).toEqual([])
    router.back()
    await settle()
    expect(modeOn(root)).toContain(da.sf_nearby_badge)
  })

  it('forward to Find pladser reopens the mode used too', async () => {
    const root = await openApp('/finder?mode=lucky', '/dashboard')
    button(root, da.sf_nearby_badge).click()
    await settle()
    router.back()
    await settle()
    expect(router.currentRoute.value.name).toBe('dashboard')
    expect(root.byClass('finder')).toEqual([])
    router.forward()
    await settle()
    expect(modeOn(root)).toContain(da.sf_nearby_badge)
  })

  // Replaced, not pushed: back from Find pladser goes where it came from,
  // not through the modes picked there.
  it('switching modes adds no step to back', async () => {
    const root = await openApp('/finder', '/dashboard')
    button(root, da.sf_nearby_badge).click()
    await settle()
    button(root, da.sf_lucky_badge).click()
    await settle()
    expect(router.currentRoute.value.fullPath).toBe('/finder?mode=lucky')
    router.back()
    await settle()
    expect(router.currentRoute.value.name).toBe('dashboard')
  })
})

describe('the mode and sort buttons', () => {
  // They showed which one was on by its look alone: to a screen reader, two
  // plain buttons each, as Tidsvinduer's were before round J.
  it('say which one is on (aria-pressed)', async () => {
    const root = await open()
    const pressed = (text: string) => button(root, text).attrs['aria-pressed']
    expect([pressed(da.sf_lucky_badge), pressed(da.sf_nearby_badge)]).toEqual([true, false])
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    expect([pressed(da.sf_lucky_badge), pressed(da.sf_nearby_badge)]).toEqual([false, true])

    await pick(root, 'Hornbæk')
    await search(root)
    expect([pressed(da.sf_sort_score), pressed(da.sf_sort_dist)]).toEqual([true, false])
    button(root, da.sf_sort_dist).click()
    await nextTick()
    expect([pressed(da.sf_sort_score), pressed(da.sf_sort_dist)]).toEqual([false, true])
  })
})

describe('Find pladser left open into a new month', () => {
  /** A spot's card: its score and its species this month. */
  function card(root: FakeNode, name: string) {
    const c = root.byClass('result-card').find((n) => n.byClass('name')[0].textContent.startsWith(name))
    if (!c) throw new Error(`no card for ${name}`)
    return { score: c.byClass('score')[0]?.textContent, species: c.byClass('pill').map((p) => p.textContent) }
  }

  // The month was read once, as the screen opened: open on 30 November and
  // left till December, it kept November's ranking and species.
  it('ranks the spots and lists their species for the new month', async () => {
    vi.setSystemTime(new Date(2026, 10, 30, 23, 58))
    const root = await open()
    expect(card(root, 'Kegnæs Fyr')).toEqual({ score: '50', species: expect.arrayContaining(['Ising']) })
    await vi.advanceTimersByTimeAsync(3 * 60_000) // past midnight: 1 December
    await nextTick()
    expect(card(root, 'Kegnæs Fyr').score).toBe('45')
    expect(card(root, 'Kegnæs Fyr').species).not.toContain('Ising') // dab: March to November
  })

  // Ranked again within the radius searched, not one the slider moved to since.
  it('ranks a nearby search again within the radius it was searched with', async () => {
    vi.setSystemTime(new Date(2026, 10, 30, 23, 58))
    const root = await open()
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    await pick(root, 'Nordhuse')
    await search(root)
    expect(card(root, 'Esrum Sø')).toEqual({ score: '30', species: ['Gedde', 'Bæk-/Søørred'] })
    slider(root).input('10')
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    await nextTick()
    expect(card(root, 'Esrum Sø')).toEqual({ score: '25', species: ['Gedde'] })
  })
})

describe('the account changing with Find pladser open', () => {
  /** Hornbæk picked and searched, as the account signed in now. */
  async function searchedHornbaek(): Promise<FakeNode> {
    const root = await open()
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    await pick(root, 'Hornbæk')
    await search(root)
    expect(found(root)).toContain('Gurre Sø 7 km')
    return root
  }

  // Signed out in another tab, or by a token refresh the server refused,
  // with the screen open: the box still said Hornbæk and its spots stayed
  // listed, for whoever used the page next (round J review, P6).
  it('forgets the place and its spots of an account signed out elsewhere', async () => {
    const auth = useAuthStore()
    auth.user = { id: 'user-a' } as User
    let root = await searchedHornbaek()
    auth.user = null
    await nextTick()
    expect(box(root).value).toBe('')
    expect(found(root)).toEqual([])
    expect(button(root, da.sf_search_btn).attrs.disabled).toBe(true)
    // Nor is it searched again on return.
    leave()
    root = await open()
    expect(box(root).value).toBe('')
    expect(found(root)).toEqual([])
  })

  it('forgets them when another account is signed in', async () => {
    const auth = useAuthStore()
    auth.user = { id: 'user-a' } as User
    const root = await searchedHornbaek()
    auth.user = { id: 'user-b' } as User
    await nextTick()
    expect(box(root).value).toBe('')
    expect(found(root)).toEqual([])
  })

  // Lucky mode hides the box, not the place in it.
  it('forgets the place in lucky mode too', async () => {
    const auth = useAuthStore()
    auth.user = { id: 'user-a' } as User
    const root = await searchedHornbaek()
    button(root, da.sf_lucky_badge).click()
    await nextTick()
    auth.user = null
    await nextTick()
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    expect(box(root).value).toBe('')
    expect(button(root, da.sf_search_btn).attrs.disabled).toBe(true)
  })

  // Lucky mode's spots are ranked for the account's species, and spots near
  // its saved ones score higher. Logged out in another tab, which wiped this
  // page's spots and species too, the list stayed: ranked for pike, under
  // "Søger efter: alle arter".
  it('drops lucky mode\'s spots too: they were ranked for the account', async () => {
    const auth = useAuthStore()
    auth.user = { id: 'user-a' } as User
    const setup = useSetupStore()
    setup.targetSpecies = ['gedde']
    const root = await open()
    expect(found(root)).toContain('Gurre Sø')
    auth.user = null
    setup.clear() // the other tab's wipe, as its storage event reloads it here
    await nextTick()
    expect(root.byClass('targeting')[0].textContent).toContain(da.sf_targeting_all)
    expect(found(root)).toEqual([])
    expect(root.byClass('results')).toEqual([]) // nor a "no spots found" in their place
    await search(root)
    expect(found(root)).toContain('Kegnæs Fyr') // the list for all species
    expect(found(root)).not.toContain('Gurre Sø')
  })

  // A place search typed as the account changes: its results, and an answer
  // still to come, are the account's too.
  it('drops a place search typed or still on its way', async () => {
    const auth = useAuthStore()
    auth.user = { id: 'user-a' } as User
    const root = await open()
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    await type(root, 'Nordhuse')
    expect(root.byClass('result').length).toBe(1)
    auth.user = null
    await nextTick()
    expect(root.byClass('result')).toEqual([])

    auth.user = { id: 'user-b' } as User
    await nextTick()
    box(root).input('Hornbæk')
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS / 2)
    auth.user = { id: 'user-c' } as User
    await nextTick()
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
    await nextTick()
    expect(box(root).value).toBe('')
    expect(root.byClass('result')).toEqual([])
    expect(root.byClass('geo-state')).toEqual([])
  })

  // As for the search kept on return: a guest who signs in (in another
  // tab) is still the one at the screen. Signed out then, it goes.
  it('keeps a guest\'s place and spots through a sign-in', async () => {
    const auth = useAuthStore()
    const root = await searchedHornbaek()
    auth.user = { id: 'user-a' } as User
    await nextTick()
    expect(box(root).value).toBe('Hornbæk, Hovedstaden')
    expect(found(root)).toContain('Gurre Sø 7 km')
    auth.user = null
    await nextTick()
    expect(box(root).value).toBe('')
    expect(found(root)).toEqual([])
  })
})
