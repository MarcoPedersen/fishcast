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
import { lang, langReady, setLang } from '@/lib/i18n'
import { useSetupStore } from '@/stores/setup'
import { useAuthStore } from '@/stores/auth'
import { createSession } from '@/stores/session'
import { STRINGS } from '@/test/strings'
import { DK_SPOTS, locationFromSpot } from '@/lib/spots'
import { fakeDb } from '@/test/fakeSupabase'
import type { GeoResult } from '@/lib/weather'
import type { User } from '@supabase/supabase-js'

const PLACES: Record<string, GeoResult[]> = {
  Hornbæk: [{ name: 'Hornbæk', admin1: 'Hovedstaden', lat: 56.09027, lon: 12.45693, country: 'DK' }],
  Nordhuse: [{ name: 'Nordhuse', admin1: 'Hovedstaden', lat: 55.97, lon: 12.1, country: 'DK' }],
  // One name in one region: one on the coast by Esbjerg, one inland by Vejen.
  Hjerting: [
    { name: 'Hjerting', admin1: 'Region Syddanmark', admin2: 'Esbjerg Kommune', lat: 55.53, lon: 8.36, country: 'DK' },
    { name: 'Hjerting', admin1: 'Region Syddanmark', admin2: 'Vejen Kommune', lat: 55.46, lon: 9.1, country: 'DK' },
  ],
}
/** The world's answer, when a test holds it: Denmark's places come from PLACES at once. */
let worldAnswer: ((q: string) => Promise<GeoResult[]>) | undefined
vi.mock('@/lib/weather', async (orig) => ({
  ...(await orig<object>()),
  geocode: async (q: string, _lang: string, country?: string) => {
    if (q === 'Offline') throw new TypeError('Failed to fetch')
    return !country && worldAnswer ? worldAnswer(q) : PLACES[q] ?? []
  },
}))

import SpotFinderView from './SpotFinderView.vue'

const da = STRINGS.da

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined
let router: Router
let pinia: Pinia

beforeEach(() => {
  restoreDocument = installDocument()
  vi.useFakeTimers({ now: new Date(2026, 10, 19, 12, 0) }) // November: the finder scores by month
  fakeDb.reset()
  pinia = createPinia()
  setActivePinia(pinia)
})
afterEach(() => {
  view?.unmount()
  view = undefined
  forgetAccountData() // as a logout: the finder starts over in the next test
  worldAnswer = undefined
  localStorage.removeItem('fc2-setup')
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

const SETUP_KEY = 'fc2-setup'
/** `who` signs in, and the pull makes the setup the page holds the account's. */
async function signedIn(who: string) {
  fakeDb.seed('setups', { user_id: who, setup: { locations: [], targetSpecies: [], availability: [] }, updated_at: '2026-11-01T00:00:00.000Z' })
  fakeDb.session = { user: { id: who } }
  useAuthStore().user = { id: who } as User
  await useSetupStore().pullRemote()
}
/**
 * A token refresh the server refused: the page is signed out, and the
 * account's setup stays on the device and on screen.
 */
function refused() {
  fakeDb.session = null
  useAuthStore().user = null
}
/** Another tab's logout wipes the setup on the device; this page reads that in (session onStorage). */
function setupWiped() {
  localStorage.removeItem(SETUP_KEY)
  useSetupStore().reloadLocal()
}
/** Another tab saves `who`'s setup on the device; this page reads it in. */
function setupOf(who: string) {
  localStorage.setItem(SETUP_KEY, JSON.stringify({ locations: [], targetSpecies: [], availability: [], ownerId: who, dirty: false }))
  useSetupStore().reloadLocal()
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

  // Lokationer told the two apart; Find pladser showed two buttons alike,
  // both 'Hjerting, Region Syddanmark'.
  it('tells two places of one name and region apart by their municipality', async () => {
    const root = await open()
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    await type(root, 'Hjerting')
    const shown = root.byTag('button').filter((b) => b.textContent.includes('Hjerting')).map((b) => b.textContent.trim())
    expect(shown).toEqual([
      '📍 Hjerting, Esbjerg Kommune, Region Syddanmark',
      '📍 Hjerting, Vejen Kommune, Region Syddanmark',
    ])
  })

  // Denmark answered and the world's request hung: Denmark's places waited
  // for its 10 s deadline. They show at once, with 'Søger…' under them.
  it("shows Denmark's places while the world is still asked, and says the search goes on", async () => {
    let world!: (r: GeoResult[]) => void
    worldAnswer = () => new Promise((r) => { world = r })
    const root = await open()
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    await type(root, 'Hornbæk')
    expect(root.byClass('result').map((b) => b.textContent)).toEqual(['📍 Hornbæk, Hovedstaden'])
    expect(root.byClass('geo-state').map((p) => p.textContent)).toEqual([da.geo_searching])
    world([])
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
    expect(root.byClass('result').map((b) => b.textContent)).toEqual(['📍 Hornbæk, Hovedstaden'])
    expect(root.byClass('geo-state')).toEqual([])
  })

  // A new search over the last one's places put 'Søger…' under them at each
  // pause in the typing, and the saved spots below jumped down and back. That
  // line was never there: it shows under places only while the world is
  // asked for this search's. The status line still says that it searches.
  it("shows no searching line under the last search's places while the next is typed", async () => {
    const root = await open()
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    await type(root, 'Hornbæk')
    box(root).input('Nordhuse')
    await nextTick()
    expect(root.byClass('result').map((b) => b.textContent)).toEqual(['📍 Hornbæk, Hovedstaden'])
    expect(root.byClass('geo-state')).toEqual([])
    expect(root.findAll((n) => n.attrs.role === 'status').map((n) => n.textContent)).toEqual([da.geo_searching])
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
    await nextTick()
    expect(root.byClass('result').map((b) => b.textContent)).toEqual(['📍 Nordhuse, Hovedstaden'])
    expect(root.byClass('geo-state')).toEqual([])
  })

  // 'Søger…' and the failed line were each a new element with role=status,
  // which a screen reader often leaves unsaid; 'Ingen steder fundet' had no
  // role, and the places found were never said. One status line stays, and
  // its text follows the search; the lines seen look as they did.
  it('says where the search is in one status line that stays', async () => {
    const root = await open()
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    const statuses = () => root.findAll((n) => n.attrs.role === 'status')
    const [status] = statuses()
    expect(status.hasClass('sr-only')).toBe(true) // heard, not seen: the lines seen say it
    /** The status line's text, once it is the only one and the one there from the start. */
    const now = () => {
      expect(statuses()).toHaveLength(1)
      expect(statuses()[0]).toBe(status)
      return status.textContent
    }
    /** The lines seen: their text, and that a screen reader hears them through the status line alone. */
    const seen = () => root.byClass('geo-state').map((p) => `${p.textContent}|${p.attrs.role ?? ''}|${p.attrs['aria-hidden']}`)
    expect(now()).toBe('')
    box(root).input('Hjerting')
    await nextTick()
    expect(now()).toBe(da.geo_searching)
    expect(seen()).toEqual([`${da.geo_searching}||true`])
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
    await nextTick()
    expect(now()).toBe('2 steder fundet.')
    expect(seen()).toEqual([])
    await type(root, 'Xyzzy')
    expect(now()).toBe(da.geo_no_results)
    expect(seen()).toEqual([`${da.geo_no_results}||true`])
    await type(root, 'Offline')
    expect(now()).toBe(da.geo_failed)
    expect(seen()).toEqual([`${da.geo_failed}||true`])
    await pick(root, 'Hornbæk')
    expect(now()).toBe('')
    expect(seen()).toEqual([])
  })

  // The box named either 'Hjerting, Region Syddanmark'.
  it('names a picked twin as its row reads, and a place its name and region tell apart as before', async () => {
    const root = await open()
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    await type(root, 'Hjerting')
    root.byClass('result')[1].click()
    await nextTick()
    expect(box(root).value).toBe('Hjerting, Vejen Kommune, Region Syddanmark')
    await pick(root, 'Hornbæk')
    expect(box(root).value).toBe('Hornbæk, Hovedstaden')
  })

  it('shows no municipality for a place its name and region tell apart', async () => {
    const root = await open()
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    await type(root, 'Hornbæk')
    expect(root.byTag('button').filter((b) => b.textContent.includes('📍 Hornbæk')).map((b) => b.textContent.trim()))
      .toEqual(['📍 Hornbæk, Hovedstaden'])
  })

  // An Android keyboard with suggestions composes each word until a space or
  // the search key ends it, and v-model takes none of it in until then. The
  // search read the box as it was before the word and found nothing.
  it('searches the word as it is typed, before the keyboard ends it', async () => {
    const root = await open()
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    const field = box(root)
    field.dispatch('compositionstart') // v-model marks the field as composing
    for (const typed of ['H', 'Ho', 'Hor', 'Horn', 'Hornb', 'Hornbæ', 'Hornbæk']) {
      field.value = typed
      field.dispatch('input')
    }
    await nextTick()
    expect(root.byClass('geo-state').map((p) => p.textContent)).toEqual([da.geo_searching])
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
    await nextTick()
    expect(root.byTag('button').filter((b) => b.textContent.includes('📍 Hornbæk')).map((b) => b.textContent))
      .toEqual(['📍 Hornbæk, Hovedstaden'])
  })
})

/**
 * The search box's label was for no field, so a screen reader named the box
 * by its placeholder, and the radius slider had no name at all ("Radius:
 * 40 km" was tied to nothing) and said its value as a bare number.
 */
describe('Find i nærheden to a screen reader', () => {
  /** A field's accessible name: what aria-labelledby points at, its aria-label, or the text of the label for it. */
  function nameOf(root: FakeNode, field: FakeNode): string {
    const by = field.attrs['aria-labelledby']
    if (typeof by === 'string') return by.split(' ').map((id) => root.findAll((n) => n.attrs.id === id)[0]?.textContent ?? '').join(' ')
    if (typeof field.attrs['aria-label'] === 'string') return field.attrs['aria-label']
    const id = field.attrs.id
    const label = id ? root.byTag('label').find((l) => l.attrs.for === id) : undefined
    return label?.textContent ?? ''
  }
  /** The label a tap on which moves the focus to the field. */
  const labelsFor = (root: FakeNode, field: FakeNode) => root.byTag('label').filter((l) => !!field.attrs.id && l.attrs.for === field.attrs.id)

  it('names the search box by its label', async () => {
    const root = await open('/finder?mode=nearby')
    expect(nameOf(root, box(root))).toBe(da.sf_from_where)
    expect(labelsFor(root, box(root))).toHaveLength(1)
  })

  it('names the radius slider, and says its value in km', async () => {
    const root = await open('/finder?mode=nearby')
    expect(nameOf(root, slider(root))).toBe(da.sf_radius)
    expect(labelsFor(root, slider(root))).toHaveLength(1)
    expect(slider(root).attrs['aria-valuetext']).toBe('40 km')
    slider(root).input('65')
    await nextTick()
    expect(slider(root).attrs['aria-valuetext']).toBe('65 km')
    expect(root.byClass('radius')[0].textContent).toContain('65 km') // as seen
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

  // Signed out in another tab, whose logout took the account's setup off
  // the device: no logout runs in this page, so nothing calls onForget, and
  // the next one to open Find pladser here found the account's place and
  // its spots. (The setup here was never the account's: it is a guest's.)
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

  // A token refresh the server refused signs the page out, and leaves the
  // account's setup on the device and its spots on screen: the same person
  // is at the screen, and signs in again. The search went as if the
  // account had been signed out elsewhere.
  it('keeps the search over a refused token refresh, and after signing in again', async () => {
    await signedIn('user-a')
    let root = await open()
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    await pick(root, 'Hornbæk')
    await search(root)
    leave()
    refused()
    root = await open()
    expect(modeOn(root)).toContain(da.sf_nearby_badge)
    expect(box(root).value).toBe('Hornbæk, Hovedstaden')
    expect(found(root)).toContain('Gurre Sø 7 km')
    leave()
    await signedIn('user-a')
    root = await open()
    expect(box(root).value).toBe('Hornbæk, Hovedstaden')
    expect(found(root)).toContain('Gurre Sø 7 km')
  })

  // Signed out with the account's setup still here, the search is the
  // account's until that setup goes: another tab's logout wipes it, or
  // another tab signed in to another account saves that one's.
  it('forgets it once a logout elsewhere wipes the setup, or another account’s takes its place', async () => {
    for (const [what, then] of [['wiped', setupWiped], ['another account’s', () => setupOf('user-b')]] as const) {
      await signedIn('user-a')
      let root = await open()
      button(root, da.sf_nearby_badge).click()
      await nextTick()
      await pick(root, 'Hornbæk')
      await search(root)
      leave()
      refused()
      then()
      root = await open()
      expect(modeOn(root), what).toContain(da.sf_lucky_badge)
      button(root, da.sf_nearby_badge).click()
      await nextTick()
      expect(box(root).value, what).toBe('')
      expect(found(root), what).toEqual([])
      leave()
    }
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

describe('+ Tilføj on a spot card', () => {
  afterEach(() => { setLang('da') })
  /** Each card's spot name, and the name its add button has to a screen reader. */
  const addNames = (root: FakeNode) => root.byClass('result-card').map((c): [string, unknown] => [
    c.byClass('name')[0].textContent.trim(),
    c.byTag('button').find((b) => b.textContent.trim() === STRINGS[lang.value].add)?.attrs['aria-label'],
  ])

  // Six cards, six buttons that each read "+ Tilføj": a screen reader did
  // not say which spot one would add.
  it('names the spot it adds', async () => {
    const root = await open('/finder?mode=lucky')
    const shown = addNames(root)
    expect(shown.length).toBeGreaterThan(1)
    for (const [name, label] of shown) expect(label).toBe(da.sf_add_named.replace('{name}', () => name))
  })

  it('in English too', async () => {
    setLang('en')
    await langReady()
    setActivePinia(pinia)
    const root = await open('/finder?mode=lucky')
    for (const [name, label] of addNames(root)) expect(label).toBe(STRINGS.en.sf_add_named.replace('{name}', () => name))
  })

  // Tapped, the button gave way to a "✓ Tilføjet" text: the focus it held
  // went with it, to the top of the page, and a screen reader heard nothing.
  // The same button stays, and says its spot is added.
  it('stays in the page once its spot is added, and says so', async () => {
    const root = await open('/finder?mode=lucky')
    const card = root.byClass('result-card')[0]
    const name = card.byClass('name')[0].textContent.trim()
    const btn = card.byTag('button').find((b) => b.textContent.trim() === da.add)!
    btn.click()
    await nextTick()
    expect(useSetupStore().locations.map((l) => l.name)).toEqual([name])
    expect(root.findAll((n) => n === btn)).toHaveLength(1)
    expect(btn.textContent.trim()).toBe(da.added)
    expect(btn.attrs['aria-label']).toBe(da.sf_added_named.replace('{name}', () => name))
    expect(btn.attrs['aria-disabled']).toBe(true)
    btn.click() // again: no second copy
    await nextTick()
    expect(useSetupStore().locations).toHaveLength(1)
  })
})

describe('the way on from Find pladser', () => {
  /** Find pladser, and the dashboard as the app's router guards it: no setup, back to the welcome page. */
  async function openGuarded(): Promise<FakeNode> {
    const page = { render: () => null }
    router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/', name: 'welcome', component: page },
      { path: '/finder', name: 'finder', component: page },
      { path: '/species', name: 'species', component: page },
      { path: '/setup/availability', name: 'availability', component: page },
      { path: '/dashboard', name: 'dashboard', component: page, beforeEnter: () => (useSetupStore().hasSetup() ? true : { name: 'welcome' }) },
    ] })
    await router.push('/finder?mode=lucky')
    view = mount(SpotFinderView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
    await nextTick()
    return view.root
  }
  const onward = (root: FakeNode) => root.byTag('button').find((b) => [da.goto_dash, da.setup_start].includes(b.textContent.trim()))!
  async function settle() {
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
  }

  // The welcome page opens Find pladser before any setup. A spot added
  // there, "Gå til dashboard →" led to the dashboard, which sends a visit
  // with no setup back to the welcome page: the user stood where they began.
  it('with no setup yet, starts the setup, as the welcome page does', async () => {
    const root = await openGuarded()
    button(root, da.add).click()
    await nextTick()
    expect(useSetupStore().locations).toHaveLength(1)
    onward(root).click()
    await settle()
    expect(router.currentRoute.value.name).toBe('availability')
    expect(onward(root).textContent.trim()).toBe(da.setup_start)
  })

  it('with a setup, goes to the dashboard', async () => {
    const setup = useSetupStore()
    setup.locations = [{ id: 'l1', ...locationFromSpot(DK_SPOTS[0]) }]
    setup.availability = [{ id: 'a1', days: [6], from: '06:00', to: '10:00', methods: ['shore'] }]
    const root = await openGuarded()
    expect(onward(root).textContent.trim()).toBe(da.goto_dash)
    onward(root).click()
    await settle()
    expect(router.currentRoute.value.name).toBe('dashboard')
  })
})

describe('a spot where the species picked is closed today', () => {
  /** Each card's name, and its rank as shown: a medal, "4." or "·". */
  const ranks = (root: FakeNode) => root.byClass('result-card').map((c) => [c.byClass('name')[0].textContent.trim(), c.byClass('rank')[0].textContent.trim()])
  const MEDAL = /^[🥇🥈🥉]/u
  const closedLine = (root: FakeNode, name: string) =>
    root.byClass('result-card').find((c) => c.byClass('name')[0].textContent.startsWith(name))!.byClass('sf-closed')[0]?.textContent.trim()

  // Held og lykke for cod in November: Sletterhage on silver and three
  // bronzes on Als and Bornholm, all inside the Baltic cod ban.
  it('takes no medal in Held og lykke, comes after the open ones and says why', async () => {
    useSetupStore().targetSpecies = ['torsk']
    const root = await open('/finder?mode=lucky')
    const shown = ranks(root)
    expect(shown.filter(([, r]) => MEDAL.test(r)).map(([n]) => n)).toEqual(['Fornæs Fyr', 'Hundested Havn'])
    expect(shown.slice(2).map(([, r]) => r)).toEqual(shown.slice(2).map(() => '·'))
    expect(closedLine(root, 'Sletterhage')).toBe(`🚫 ${da.season_closed}: Torsk`)
    expect(closedLine(root, 'Fornæs Fyr')).toBeUndefined()
  })

  // Pike's freshwater closure starts on 15 March: a screen left open over
  // that midnight kept Esrum Sø on its medal.
  it('follows the day: a lake whose closure starts at midnight loses its medal', async () => {
    vi.setSystemTime(new Date(2026, 2, 14, 23, 58))
    useSetupStore().targetSpecies = ['gedde']
    const root = await open('/finder?mode=nearby')
    await pick(root, 'Nordhuse')
    await search(root)
    expect(MEDAL.test(ranks(root).find(([n]) => n.startsWith('Esrum Sø'))![1])).toBe(true)
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    await nextTick()
    expect(ranks(root).find(([n]) => n.startsWith('Esrum Sø'))![1]).toBe('·')
    expect(closedLine(root, 'Esrum Sø')).toBe(`🚫 ${da.season_closed}: Gedde`)
  })

  // Cod and sea trout in November: Kegnæs Fyr is open for sea trout and
  // keeps its medal, and its card said nothing of cod, closed there.
  it('says which target is closed at a spot open for another, and keeps its medal', async () => {
    useSetupStore().targetSpecies = ['torsk', 'havørred']
    const root = await open('/finder?mode=lucky')
    expect(MEDAL.test(ranks(root).find(([n]) => n === 'Kegnæs Fyr')![1])).toBe(true)
    expect(closedLine(root, 'Kegnæs Fyr')).toBe(`🚫 ${da.season_closed}: Torsk`)
    expect(closedLine(root, 'Fornæs Fyr')).toBeUndefined() // open for both
  })

  // The "=" says a medal is shared with another open spot. A closed spot on
  // the same score shares none, having no medal: cod on 1 March, Fornæs Fyr
  // and Aarhus Havn Østmolen both score 72, the harbour inside the ban.
  it('marks a medal shared (=) only with another open spot', async () => {
    const card = (root: FakeNode, name: string) => root.byClass('result-card').find((c) => c.byClass('name')[0].textContent.trim() === name)!
    const rank = (root: FakeNode, name: string) => card(root, name).byClass('rank')[0]
    vi.setSystemTime(new Date(2026, 2, 1, 12))
    useSetupStore().targetSpecies = ['torsk']
    let root = await open('/finder?mode=lucky')
    expect(['Fornæs Fyr', 'Aarhus Havn Østmolen'].map((n) => card(root, n).byClass('score')[0].textContent)).toEqual(['72', '72'])
    expect(rank(root, 'Fornæs Fyr').textContent.trim()).toBe('🥇')
    expect(rank(root, 'Fornæs Fyr').attrs.title).toBeUndefined()
    expect(rank(root, 'Aarhus Havn Østmolen').textContent.trim()).toBe('·')
    leave()

    // Cod and sea trout in November: four open spots on 75 share bronze.
    vi.setSystemTime(new Date(2026, 10, 19, 12))
    useSetupStore().targetSpecies = ['torsk', 'havørred']
    root = await open('/finder?mode=lucky')
    expect(ranks(root)).toEqual([
      ['Fornæs Fyr', '🥇'], ['Virksund', '🥈'],
      ['Kegnæs Fyr', '🥉='], ['Svendborgsundbroen', '🥉='], ['Rønne Havn', '🥉='], ['Tejn Havn', '🥉='],
    ])
    expect(rank(root, 'Tejn Havn').attrs.title).toBe(da.sf_shared_rank)
  })

  // Sorted by distance, the closed ones still come after the open ones:
  // Arresø, 3 km off and closed for pike, ahead of the sea trout coast.
  it('stays after the open ones when sorted by distance', async () => {
    vi.setSystemTime(new Date(2026, 3, 12, 12))
    useSetupStore().targetSpecies = ['havørred', 'gedde']
    const root = await open('/finder?mode=nearby')
    await pick(root, 'Nordhuse')
    await search(root)
    button(root, da.sf_sort_dist).click()
    await nextTick()
    expect(ranks(root).map(([n]) => n)).toEqual([
      'Hundested Havn 16 km', 'Rørvig Strand 22 km', 'Helsingør Kysten 34 km',
      'Arresø 3 km', 'Esrum Sø 18 km', 'Furesø 25 km', 'Gurre Sø 26 km',
    ])
  })

  // A spot open for one target and closed for another ranks as open, so by
  // distance too it stays with the open ones, and is listed once: Arresø
  // for pike and bream on 19 March, 25 km from Hornbæk, before the lakes
  // nearer by, closed for every target they list.
  it('keeps a spot open for one target with the open ones when sorted by distance', async () => {
    vi.setSystemTime(new Date(2026, 2, 19, 12))
    useSetupStore().targetSpecies = ['gedde', 'brasen']
    const root = await open('/finder?mode=nearby')
    await pick(root, 'Hornbæk')
    await search(root)
    button(root, da.sf_sort_dist).click()
    await nextTick()
    expect(ranks(root)).toEqual([
      ['Arresø 25 km', '🥇'],
      ['Gurre Sø 7 km', '·'], ['Esrum Sø 11 km', '·'], ['Furesø 32 km', '·'],
      ['Helsingør Kysten 12 km', '·'], ['Hundested Havn 39 km', '·'],
    ])
    expect(closedLine(root, 'Arresø')).toBe(`🚫 ${da.season_closed}: Gedde`)
  })

  // Every target closed there is named, not the first alone: Rønne Havn
  // for pike and cod on 19 April.
  it('names every target closed at the spot', async () => {
    vi.setSystemTime(new Date(2026, 3, 19, 12))
    useSetupStore().targetSpecies = ['gedde', 'torsk']
    const root = await open('/finder?mode=lucky')
    expect(closedLine(root, 'Rønne Havn')).toBe(`🚫 ${da.season_closed}: Gedde, Torsk`)
  })
})

/**
 * The line over the cards counted the closed spots as found: Held og lykke
 * for cod in November read "6 pladser fundet", four of them inside the
 * Baltic ban, and pike in April "4 pladser fundet" with every lake closed.
 * It says how many are open and how many closed today. Both, not the open
 * ones alone: the closed spots stay listed, and a count of two over six
 * cards would read wrong.
 */
describe('the count over the spots found', () => {
  afterEach(() => { setLang('da') })
  const count = (root: FakeNode) => root.byClass('count')[0]?.textContent.trim()
  const n = (s: string, v: number) => s.replace('{n}', () => String(v))

  it('says how many are open and how many closed today', async () => {
    useSetupStore().targetSpecies = ['torsk']
    const root = await open('/finder?mode=lucky')
    expect(found(root)).toHaveLength(6)
    expect(count(root)).toBe(`2 ${da.sf_results_count} · ${n(da.sf_results_closed, 4)}`)
  })

  it('says when every spot found is closed today, the spots without the species not counted', async () => {
    vi.setSystemTime(new Date(2026, 3, 12, 12))
    useSetupStore().targetSpecies = ['gedde']
    const root = await open('/finder?mode=nearby')
    await pick(root, 'Nordhuse')
    await search(root)
    expect(count(root)).toBe(n(da.sf_results_all_closed, 4))
    // Arresø alone within 10 km.
    slider(root).input('10')
    await search(root)
    expect(found(root)).toEqual(['Arresø 3 km'])
    expect(count(root)).toBe(n(da.sf_results_all_closed_one, 1))
  })

  it('counts as before when none is closed', async () => {
    useSetupStore().targetSpecies = ['havørred']
    const root = await open('/finder?mode=lucky')
    expect(count(root)).toBe(`6 ${da.sf_results_count}`)
  })

  it('in English too', async () => {
    setLang('en')
    await langReady()
    setActivePinia(pinia)
    const en = STRINGS.en
    useSetupStore().targetSpecies = ['torsk']
    let root = await open('/finder?mode=lucky')
    expect(count(root)).toBe(`2 ${en.sf_results_count} · ${n(en.sf_results_closed, 4)}`)
    leave()
    vi.setSystemTime(new Date(2026, 3, 12, 12))
    useSetupStore().targetSpecies = ['gedde']
    root = await open('/finder?mode=lucky')
    expect(count(root)).toBe(n(en.sf_results_all_closed, 6))
  })
})

/** A spot card's region, type and water line, in English: the region stayed Danish. */
describe("a spot card's region in English", () => {
  afterEach(() => { setLang('da') })
  const meta = (root: FakeNode, name: string) =>
    root.byClass('result-card').find((c) => c.byClass('name')[0].textContent.trim() === name)!.byClass('meta')[0].textContent.replace(/\s+/g, ' ').trim()

  it('names the region in the language shown', async () => {
    useSetupStore().targetSpecies = ['torsk', 'havørred']
    let root = await open('/finder?mode=lucky')
    expect(meta(root, 'Kegnæs Fyr')).toBe(`Syddanmark · 🌊 ${da.spottype_coast} · ${da.wt_brackish_label}`)
    leave()
    setLang('en')
    await langReady()
    setActivePinia(pinia)
    const en = STRINGS.en
    root = await open('/finder?mode=lucky')
    expect(meta(root, 'Kegnæs Fyr')).toBe(`Southern Denmark · 🌊 ${en.spottype_coast} · ${en.wt_brackish_label}`)
    expect(meta(root, 'Svendborgsundbroen')).toMatch(/^Funen · /)
    expect(meta(root, 'Rønne Havn')).toMatch(/^Bornholm · /)
  })
})

/**
 * A card's 🅿️ ⛵ ♿ were bare text: a screen reader said "P button" and
 * "sailboat". Each is an image named for what it stands for, with a tooltip.
 */
describe("a spot card's facilities", () => {
  afterEach(() => { setLang('da') })
  const icons = (root: FakeNode, name: string) =>
    root.byClass('result-card').find((c) => c.byClass('name')[0].textContent.trim() === name)!.byClass('fac')[0].byTag('span')
      .map((s) => [s.textContent.trim(), s.attrs.role, s.attrs['aria-label'], s.attrs.title])
  const named = (s: Record<string, string>) => ({
    parking: ['🅿️', 'img', s.sf_fac_parking, s.sf_fac_parking],
    ramp: ['⛵', 'img', s.sf_fac_boat_ramp, s.sf_fac_boat_ramp],
    wheelchair: ['♿', 'img', s.sf_fac_wheelchair, s.sf_fac_wheelchair],
  })

  it('names each one, in the language shown', async () => {
    useSetupStore().targetSpecies = ['torsk', 'havørred']
    let root = await open('/finder?mode=lucky')
    let f = named(da)
    expect(icons(root, 'Rønne Havn')).toEqual([f.parking, f.ramp, f.wheelchair])
    expect(icons(root, 'Kegnæs Fyr')).toEqual([f.parking])
    leave()
    setLang('en')
    await langReady()
    setActivePinia(pinia)
    root = await open('/finder?mode=lucky')
    f = named(STRINGS.en)
    expect(icons(root, 'Rønne Havn')).toEqual([f.parking, f.ramp, f.wheelchair])
  })
})

describe('the species picked changing with Find pladser open', () => {
  /** Another tab saves the setup with `species` picked; this page reads it in (session onStorage). */
  function pickedElsewhere(species: string[]) {
    localStorage.setItem(SETUP_KEY, JSON.stringify({ locations: [], targetSpecies: species, availability: [], dirty: false }))
    useSetupStore().reloadLocal()
  }
  const names = (root: FakeNode) => found(root).map((n) => n.trim())
  const targeting = (root: FakeNode) => root.byClass('targeting')[0].textContent

  // Pike picked in another tab, or on another device and pulled: the line
  // above the list said "Gedde", and the list stayed ranked for cod, with
  // its medals and its "Fredningstid: Torsk" lines.
  it('ranks Held og lykke again for the species picked now', async () => {
    useSetupStore().targetSpecies = ['torsk']
    const root = await open('/finder?mode=lucky')
    expect(names(root).slice(0, 2)).toEqual(['Fornæs Fyr', 'Hundested Havn'])
    pickedElsewhere(['gedde'])
    await nextTick()
    expect(targeting(root)).toContain('Gedde')
    expect(names(root)).toContain('Gurre Sø')
    expect(names(root)).not.toContain('Fornæs Fyr')
    expect(root.byClass('sf-closed')).toEqual([])
  })

  // Sea trout to pike: Rørvig Strand kept its gold, and the pike lakes stood
  // under "they don't list your species". Ranked again from the place and
  // within the radius searched, not the one the slider moved to since.
  it('ranks a nearby search again, within the radius it was searched with', async () => {
    useSetupStore().targetSpecies = ['havørred']
    const root = await open('/finder?mode=nearby')
    await pick(root, 'Nordhuse')
    await search(root)
    expect(names(root)[0]).toBe('Rørvig Strand 22 km')
    slider(root).input('10')
    pickedElsewhere(['gedde'])
    await nextTick()
    expect(targeting(root)).toContain('Gedde')
    expect(names(root).slice(0, 4)).toEqual(['Gurre Sø 26 km', 'Esrum Sø 18 km', 'Arresø 3 km', 'Furesø 25 km'])
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

  // Signed out in another tab, with the screen open: the box still said
  // Hornbæk and its spots stayed listed, for whoever used the page next
  // (round J review, P6). (The setup here is a guest's, as that tab's
  // logout leaves it.)
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

  // A token refresh the server refused, with the screen open: the
  // account's setup and its spots stayed on screen, but the box was
  // emptied and the spots found went. The same person is at the screen.
  it('keeps the place and its spots over a refused token refresh', async () => {
    await signedIn('user-a')
    const root = await searchedHornbaek()
    refused()
    await nextTick()
    expect(box(root).value).toBe('Hornbæk, Hovedstaden')
    expect(found(root)).toContain('Gurre Sø 7 km')
    await signedIn('user-a')
    await nextTick()
    expect(box(root).value).toBe('Hornbæk, Hovedstaden')
    expect(found(root)).toContain('Gurre Sø 7 km')
  })

  // Logged out here with the screen open (App.vue then moves on to the
  // welcome page). Logout starts the kept search over (onForget) before the
  // screen hears the setup go, and the screen took the search for a
  // guest's: back in "Find i nærheden", the box still named the account's
  // place.
  it('forgets the place in the box at a logout here', async () => {
    await signedIn('user-a')
    const root = await searchedHornbaek()
    expect(await createSession().logout(async () => true)).toBe('done')
    await nextTick()
    button(root, da.sf_nearby_badge).click()
    await nextTick()
    expect(box(root).value).toBe('')
    expect(found(root)).toEqual([])
  })

  // Lucky mode's list is ranked for the account's species: it stays too.
  it('keeps lucky mode’s spots over a refused token refresh', async () => {
    await signedIn('user-a')
    useSetupStore().targetSpecies = ['gedde']
    const root = await open()
    expect(found(root)).toContain('Gurre Sø')
    refused()
    await nextTick()
    expect(found(root)).toContain('Gurre Sø')
  })

  // Another tab's logout reaches this page in two parts, the sign-out and
  // the setup wiped, in either order. Only the wipe tells it from a
  // refused refresh.
  it('forgets them once a logout elsewhere wipes the setup, in either order', async () => {
    for (const order of ['signed out, then wiped', 'wiped, then signed out']) {
      await signedIn('user-a')
      const root = await searchedHornbaek()
      const out = async () => { refused(); await nextTick() }
      const wipe = async () => { setupWiped(); await nextTick() }
      if (order.startsWith('signed out')) await out()
      else await wipe()
      expect(found(root), order).toContain('Gurre Sø 7 km')
      if (order.startsWith('signed out')) await wipe()
      else await out()
      expect(box(root).value, order).toBe('')
      expect(found(root), order).toEqual([])
      leave()
    }
  })

  // Signed out by a refused refresh, and another tab signs in to another
  // account: its setup reaches this page before its sign-in does.
  it('forgets them once another account’s setup takes the account’s place, signed out', async () => {
    await signedIn('user-a')
    const root = await searchedHornbaek()
    refused()
    await nextTick()
    setupOf('user-b')
    await nextTick()
    expect(box(root).value).toBe('')
    expect(found(root)).toEqual([])
  })

  // The radius and the order are the search's too: with the screen open
  // they stayed at the account's, and went back to 40 km and score only
  // when the screen was opened again (round K review). The mode stays: the
  // link names it, and the two would disagree.
  it('sets the radius and the order back too, and keeps the mode the link names', async () => {
    const auth = useAuthStore()
    auth.user = { id: 'user-a' } as User
    let root = await open('/finder?mode=nearby')
    await pick(root, 'Hornbæk')
    slider(root).input('80')
    await search(root)
    button(root, da.sf_sort_dist).click()
    await nextTick()
    auth.user = { id: 'user-b' } as User
    await nextTick()
    expect(root.byClass('radius')[0].textContent).toContain('40 km')
    expect(modeOn(root)).toContain(da.sf_nearby_badge)
    expect(router.currentRoute.value.query.mode).toBe('nearby')
    await pick(root, 'Hornbæk')
    await search(root)
    expect(button(root, da.sf_sort_score).attrs['aria-pressed']).toBe(true)
    // And so it is kept for the next account.
    leave()
    root = await open('/finder?mode=nearby')
    expect(root.byClass('radius')[0].textContent).toContain('40 km')
    expect(button(root, da.sf_sort_score).attrs['aria-pressed']).toBe(true)
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
