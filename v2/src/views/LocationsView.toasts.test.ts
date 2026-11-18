// @vitest-environment vue-dom
/**
 * The spot cards and the toast stack, mounted side by side, with sync armed
 * as after a start. The round G browser check: four spots changed, and the
 * oldest spot's toast waited out of sight under "+1 mere venter". The only
 * way to its Fortryd was to use up or close (✕, which forgets that spot's
 * history) a newer spot's toast. A tap on the line now brings it forward,
 * and the oldest shown toast waits in its place, its history kept.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'
import { speciesFromNearby } from '@/lib/geo'
import { speciesEntry } from '@/lib/locationSpecies'
import { setLang, t } from '@/lib/i18n'
import { DK_SPOTS, locationFromSpot } from '@/lib/spots'
import { clearToasts, dismissToast, showToast, shownToasts, toasts } from '@/lib/toast'
import { STRINGS } from '@/test/strings'
import type { Location } from '@/lib/types'
import { useSetupStore } from '@/stores/setup'
import LocationsView from './LocationsView.vue'
import Toasts from '@/components/Toasts.vue'

// The in-memory DOM has no classes to animate nor a layout to measure: the
// toast stack renders as its plain tag (as in components/Toasts.test.ts).
vi.mock('vue', async (importOriginal) => {
  const vue = await importOriginal<typeof import('vue')>()
  const TransitionGroup = vue.defineComponent({
    props: { tag: { type: String, default: 'div' }, name: String },
    setup: (props, { slots }) => () => vue.h(props.tag, slots.default?.()),
  })
  return { ...vue, TransitionGroup }
})

// Custom spots, and an official one: public places (geo.ts speciesLookupFor).
const HORNBAEK = { name: 'Hornbæk', lat: 56.09027, lon: 12.45693 }
const NORDHUSE = { name: 'Nordhuse', lat: 55.97, lon: 12.1 }
const ARRESO = { name: 'Arresø', lat: 55.98, lon: 12.13 }

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined
let stack: ReturnType<typeof mount> | undefined
let setup: ReturnType<typeof useSetupStore>
let n = 0

beforeEach(() => { restoreDocument = installDocument() })
afterEach(() => {
  setup.pauseSync() // no push left queued
  view?.unmount()
  stack?.unmount()
  view = stack = undefined
  clearToasts()
  setLang('da')
  restoreDocument()
})

/** The spots' cards and the toast stack, mounted, with sync armed as after a start. */
async function mountCards(locs: Omit<Location, 'id'>[]): Promise<{ root: FakeNode; ls: Location[] }> {
  const pinia = createPinia()
  setActivePinia(pinia)
  setup = useSetupStore()
  setup.locations = locs.map((loc) => ({ id: `tb${++n}`, ...loc }))
  const page = { render: () => null }
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/locations', name: 'locations', component: page }, { path: '/map', name: 'map', component: page },
  ] })
  await router.push('/locations')
  view = mount(LocationsView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
  stack = mount(Toasts)
  await nextTick()
  setup.markReady()
  return { root: view.root, ls: setup.locations }
}

/** Lets the store's refill after the last edit run, and runs a pass of its own (as LocationsView.species.test.ts). */
async function settle() {
  await nextTick()
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  await setup.enrichMissingSpecies()
  await nextTick()
}

const card = (root: FakeNode, i: number) => root.byClass('card loc')[i]
const WT_LABEL = { salt: 'wt_salt_label', brackish: 'wt_brackish_label', fresh: 'wt_fresh_label' } as const
async function pick(root: FakeNode, w: keyof typeof WT_LABEL, i: number) {
  card(root, i).byClass('wt').find((b) => b.textContent === t(WT_LABEL[w]))!.click()
  await nextTick()
}
const key = (l: Location) => `water:${l.id}`
const state = (ls: Location[]) => ls.map((l) => ({ waterType: l.waterType, species: l.species }))
const keysShown = () => shownToasts.value.map((x) => x.key)
const keysWaiting = () => toasts.value.filter((x) => x.waiting).map((x) => x.key)

/** The line over the stack, as the stack renders it. */
const line = () => stack!.root.byClass('toasts-waiting')[0]
/** Taps Fortryd on the spot's toast, as the stack renders it. */
async function tapUndo(l: Location) {
  const i = shownToasts.value.findIndex((x) => x.key === key(l))
  expect(i, l.name).toBeGreaterThanOrEqual(0)
  stack!.root.byClass('toast')[i].byClass('act')[0].click()
  await nextTick()
}

describe('the line over the toast stack, with four spots changed', () => {
  const cod = speciesEntry('torsk', 'salt')!
  const pike = speciesEntry('gedde', 'fresh')!
  const gurre = locationFromSpot(DK_SPOTS.find((s) => s.slug === 'gurre-so')!)

  /** Hornbæk changed to fresh water and "Hent arter" tapped, then a change on each of the other three. */
  async function changeAll() {
    const { root, ls } = await mountCards([
      { ...HORNBAEK, waterType: 'salt', species: [cod] },
      { ...NORDHUSE, waterType: 'fresh', species: [pike] },
      { ...ARRESO, waterType: 'fresh', species: [pike] },
      { ...gurre },
    ])
    const before = state(ls)
    await pick(root, 'fresh', 0)
    card(root, 0).byClass('sp-missing')[0].byTag('button').find((b) => b.textContent === STRINGS.da.loc_species_nearby)!.click()
    await nextTick()
    expect(ls[0].species).toEqual(speciesFromNearby(HORNBAEK.lat, HORNBAEK.lon, 'fresh'))
    for (const i of [1, 2, 3]) await pick(root, 'salt', i)
    return { ls, before }
  }

  it("a tap brings the oldest spot's toast forward; its Fortryd steps back, and the others' histories stay whole", async () => {
    const { ls, before } = await changeAll()
    const [a, b, c, d] = ls
    expect(keysShown()).toEqual([b, c, d].map(key))
    expect(line().textContent).toBe(STRINGS.da.toast_waiting.replace('{n}', '1'))
    line().click()
    await nextTick()
    expect(keysShown()).toEqual([a, c, d].map(key))
    expect(keysWaiting()).toEqual([key(b)])
    await tapUndo(a) // the lake's species off
    expect(a).toMatchObject({ waterType: 'fresh', species: [] })
    expect(keysWaiting()).toEqual([key(b)])
    await tapUndo(a) // the cod back
    await settle()
    expect(state([a])).toEqual([before[0]])
    // Nordhuse's toast, which waited for Hornbæk's, is back, and its Fortryd too.
    expect(keysShown()).toEqual([b, c, d].map(key))
    for (const l of [b, c, d]) await tapUndo(l)
    await settle()
    expect(state(ls)).toEqual(before)
    expect(toasts.value).toEqual([])
  })

  // The round H review: a sync error after the tap sent Hornbæk's toast back
  // to wait, and when the error went, Nordhuse's came back: the stack as
  // before the tap, with Hornbæk's Fortryd out of sight again.
  it("Hornbæk's toast, brought forward, holds its place while a sync error passes", async () => {
    const { ls, before } = await changeAll()
    const [a, b, c, d] = ls
    line().click()
    await nextTick()
    expect(keysShown()).toEqual([a, c, d].map(key))
    // As a failed push says it (stores/localSave), for 6 s.
    const failed = showToast(() => '⚠️ ' + t('toast_sync_failed'), { type: 'error' })
    await nextTick()
    expect(keysShown()).toEqual([key(a), key(d), undefined])
    expect(keysWaiting()).toEqual([b, c].map(key))
    dismissToast(failed) // its time up
    await nextTick()
    expect(keysShown()).toEqual([a, c, d].map(key))
    expect(keysWaiting()).toEqual([key(b)])
    await tapUndo(a) // the lake's species off
    await tapUndo(a) // the cod back
    await settle()
    expect(state([a])).toEqual([before[0]])
    expect(keysShown()).toEqual([b, c, d].map(key))
    for (const l of [b, c, d]) await tapUndo(l)
    await settle()
    expect(state(ls)).toEqual(before)
    expect(toasts.value).toEqual([])
  })

  it('taps in a row show each spot in turn, and no history is lost on the way', async () => {
    const { ls, before } = await changeAll()
    const [a, b, c, d] = ls
    line().click()
    await nextTick()
    expect(keysShown()).toEqual([a, c, d].map(key))
    line().click() // back: Hornbæk's waits again, Nordhuse's shows
    await nextTick()
    expect(keysShown()).toEqual([b, c, d].map(key))
    expect(keysWaiting()).toEqual([key(a)])
    for (const l of [d, c, b]) await tapUndo(l)
    expect(keysShown()).toEqual([key(a)])
    await tapUndo(a)
    await tapUndo(a)
    await settle()
    expect(state(ls)).toEqual(before)
    expect(toasts.value).toEqual([])
  })
})
