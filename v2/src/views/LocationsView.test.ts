// @vitest-environment vue-dom
/**
 * The spot card's water type, as mounted: the real view, Pinia and router on
 * the in-memory DOM. A change of type takes off the species that no longer
 * fit and can put the lookup's on; a toast says so and can undo the change
 * ("Fortryd"). The card marks a guessed type "gættet – ret hvis forkert".
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'
import { coordKey, type CoastAuto } from '@/lib/coast'
import { speciesFromNearby } from '@/lib/geo'
import { langReady, setLang, t } from '@/lib/i18n'
import { dismissToast, runToastAction, toasts } from '@/lib/toast'
import { guessFollowsMap, markWaterGuessed, waterGuessed } from '@/lib/waterGuess'
import { STRINGS } from '@/test/strings'
import type { Location, WaterType } from '@/lib/types'
import { useCoastStore } from '@/stores/coast'
import { useSetupStore } from '@/stores/setup'
import LocationsView from './LocationsView.vue'

// Custom spots: no official spot within 30 m, so a change of type re-runs the lookup (geo.ts speciesLookupFor).
const HORNBAEK = { name: 'Hornbæk', lat: 56.09027, lon: 12.45693 }
const NORDHUSE = { name: 'Nordhuse', lat: 55.97, lon: 12.1 } // a pin in mid-Arresø (waterGuess.test.ts)

/** The coast lookup's answer: the nearest water is a lake or river, and no sea within reach. */
const inland = (): CoastAuto => ({
  v: 2, at: 0, src: 'versatiles', water: 'inland', facing: null, nearFacing: null, spread: 180,
  exposure: null, fetchKm: [], pinToWaterM: 0, issues: [],
})
const fill = (s: string, params: Record<string, string>) =>
  Object.entries(params).reduce((out, [k, v]) => out.replace(`{${k}}`, v), s)

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined
let setup: ReturnType<typeof useSetupStore>
let coast: ReturnType<typeof useCoastStore>
// The guess is kept by id for the visit (waterGuess.ts): a fresh id per test.
let n = 0

async function mountCard(loc: Omit<Location, 'id'>, guessed: boolean): Promise<{ root: FakeNode; l: Location }> {
  const pinia = createPinia()
  setActivePinia(pinia)
  setup = useSetupStore(); coast = useCoastStore()
  const id = `wt${++n}`
  setup.locations = [{ id, ...loc }]
  if (guessed) markWaterGuessed(id)
  const page = { render: () => null }
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/locations', name: 'locations', component: page }, { path: '/map', name: 'map', component: page },
  ] })
  await router.push('/locations')
  view = mount(LocationsView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
  await nextTick()
  return { root: view.root, l: setup.locations[0] }
}

const card = (root: FakeNode) => root.byClass('card loc')[0]
const WT_LABEL = { salt: 'wt_salt_label', brackish: 'wt_brackish_label', fresh: 'wt_fresh_label' } as const
/** Taps the card's water-type button. */
async function pick(root: FakeNode, w: WaterType & keyof typeof WT_LABEL) {
  const b = card(root).byClass('wt').find((x) => x.textContent === t(WT_LABEL[w]))
  if (!b) throw new Error(`no ${w} button`)
  b.click()
  await nextTick()
}
/** Whether the card says its water type is a guess. */
const marked = (root: FakeNode) => card(root).byClass('wt-guess').map((x) => x.textContent).join() === t('wt_guessed')
/** Taps "Fortryd" on the one toast showing. */
async function undo() {
  expect(toasts.value).toHaveLength(1)
  const [toast] = toasts.value
  expect(toast.action?.label).toBe(t('undo'))
  runToastAction(toast.id)
  await nextTick()
}

beforeEach(() => { restoreDocument = installDocument() })
afterEach(() => {
  view?.unmount()
  view = undefined
  for (const x of [...toasts.value]) dismissToast(x.id)
  setLang('da')
  restoreDocument()
})

describe('Fortryd after a change of water type puts the guess back as it was', () => {
  it('a type that was a guess shows as one again, with the fields it had', async () => {
    const species = speciesFromNearby(HORNBAEK.lat, HORNBAEK.lon, 'brackish')
    const { root, l } = await mountCard({ ...HORNBAEK, waterType: 'brackish', species }, true)
    expect(marked(root)).toBe(true)
    await pick(root, 'fresh')
    expect(l.waterType).toBe('fresh')
    expect(marked(root)).toBe(false) // the user's pick is no guess
    await undo()
    expect(l.waterType).toBe('brackish')
    expect(l.species).toEqual(species)
    expect(marked(root)).toBe(true)
    expect(waterGuessed(l.id)).toBe(true)
    expect(toasts.value).toEqual([])
  })

  it('a type the user had picked stays unmarked', async () => {
    const species = speciesFromNearby(HORNBAEK.lat, HORNBAEK.lon, 'fresh')
    const { root, l } = await mountCard({ ...HORNBAEK, waterType: 'fresh', species }, false)
    await pick(root, 'salt') // the lake's fish go: a toast
    expect(l.waterType).toBe('salt')
    await undo()
    expect(l.waterType).toBe('fresh')
    expect(l.species).toEqual(species)
    expect(marked(root)).toBe(false)
    expect(waterGuessed(l.id)).toBe(false)
  })

  /**
   * Two changes, two toasts, the older one undone first: each Fortryd puts
   * the card back as it was before its own change, guess and all. The newer
   * one's type was the user's pick, so once it is back it must not read
   * "gættet", though the older undo had put the guess back meanwhile.
   */
  it('two changes undone, the older first: each puts back the guess it found', async () => {
    const species = speciesFromNearby(HORNBAEK.lat, HORNBAEK.lon, 'brackish')
    const { root, l } = await mountCard({ ...HORNBAEK, waterType: 'brackish', species }, true)
    await pick(root, 'fresh')
    await pick(root, 'salt')
    expect(toasts.value).toHaveLength(2)
    const [first, second] = toasts.value
    runToastAction(first.id)
    await nextTick()
    expect(l.waterType).toBe('brackish')
    expect(marked(root)).toBe(true)
    runToastAction(second.id)
    await nextTick()
    expect(l.waterType).toBe('fresh') // as before the second change: the user's pick
    expect(marked(root)).toBe(false)
    expect(waterGuessed(l.id)).toBe(false)
  })

  /**
   * The map's turn undone is the user's "no" to fresh water, and only that:
   * salt or brackish is still the app's guess, so the card still says so,
   * and the coast check asks. The map no longer turns it.
   */
  it('the map\'s turn to fresh undone: the guess again, still shown as one, and the map no longer turns it', async () => {
    const { root, l } = await mountCard({ ...NORDHUSE, waterType: 'brackish' }, true)
    coast.entries = { [coordKey(l)]: inland() }
    await nextTick()
    expect(l.waterType).toBe('fresh')
    expect(marked(root)).toBe(true) // the map's answer is not the user's
    expect(toasts.value.map((x) => x.message).join()).toContain(fill(STRINGS.da.wt_map_fresh, { name: NORDHUSE.name }))
    await undo()
    expect(l.waterType).toBe('brackish')
    expect(l.species).toBeUndefined()
    expect(marked(root)).toBe(true)
    expect(guessFollowsMap(l, coast.autoFor(l))).toBe(false)
    // The lookup landing again turns nothing.
    coast.entries = { [coordKey(l)]: inland() }
    await nextTick()
    expect(l.waterType).toBe('brackish')
    expect(toasts.value).toEqual([])
  })

  /**
   * Put back exactly: a guess the user's pick had ended follows the map
   * again once that pick is undone. A lake pin guessed Brakvand, set to
   * Ferskvand before the coast lookup landed, and undone after it found the
   * lake: the guess is back, so the map turns it fresh at once, with its own
   * toast and Fortryd, as it would have without the pick.
   */
  it('a guess put back follows the map again: undone once the lookup has landed, the map turns it at once', async () => {
    const { root, l } = await mountCard({ ...NORDHUSE, waterType: 'brackish' }, true)
    await pick(root, 'fresh')
    coast.entries = { [coordKey(l)]: inland() }
    await nextTick()
    expect(marked(root)).toBe(false) // the user's pick: the map leaves it
    await undo()
    await nextTick()
    expect(l.waterType).toBe('fresh')
    expect(marked(root)).toBe(true)
    expect(toasts.value.map((x) => x.message).join()).toContain(fill(STRINGS.da.wt_map_fresh, { name: NORDHUSE.name }))
    // The map's turn undone in its turn: the user's "no", as above.
    await undo()
    expect(l.waterType).toBe('brackish')
    expect(marked(root)).toBe(true)
    expect(guessFollowsMap(l, coast.autoFor(l))).toBe(false)
  })
})

/**
 * A change of type re-runs the lookup for a custom spot's species
 * (locationSpecies.ts changeWaterType), which can put species on as well as
 * take them off. The toast named only those taken off: Hornbæk set from
 * Brakvand to Ferskvand gained perch, pike, carp and zander unnamed, and a
 * spot with none that gained the lake's fish got no toast, so no Fortryd.
 */
describe('the toast after a change of water type names what it put on', () => {
  it('a change that only puts species on says which, with Fortryd', async () => {
    const { root, l } = await mountCard({ ...NORDHUSE, waterType: 'brackish' }, false)
    await pick(root, 'fresh')
    expect(l.species?.map((s) => s.nameEn).sort()).toEqual(['Bream', 'Carp', 'Perch', 'Pike', 'Zander'])
    expect(toasts.value.map((x) => x.message)).toEqual([fill(STRINGS.da.loc_species_added, { names: 'Gedde, Sandart, Aborre, Brasen, Karpe' })])
    await undo()
    expect(l.waterType).toBe('brackish')
    expect(l.species).toBeUndefined()
  })

  it('what the lookup took off and what it put on, never a species the app doesn\'t know', async () => {
    const { root, l } = await mountCard({ ...HORNBAEK, waterType: 'brackish', species: speciesFromNearby(HORNBAEK.lat, HORNBAEK.lon, 'brackish') }, false)
    await pick(root, 'fresh')
    expect(l.species?.map((s) => s.nameEn)).toContain('Brown Trout (river/lake)')
    expect(toasts.value).toHaveLength(1)
    const [toast] = toasts.value
    expect(toast.message).toBe([
      fill(STRINGS.da.loc_species_dropped_nearby, { names: 'Makrel, Hornfisk' }),
      fill(STRINGS.da.loc_species_added, { names: 'Gedde, Sandart, Aborre, Karpe' }),
    ].join(' '))
    // Read when shown: a language switch re-renders it.
    setLang('en')
    await langReady()
    expect(toast.message).toBe([
      fill(STRINGS.en.loc_species_dropped_nearby, { names: 'Mackerel, Garfish' }),
      fill(STRINGS.en.loc_species_added, { names: 'Pike, Zander, Perch, Carp' }),
    ].join(' '))
    expect(toast.message).not.toMatch(/Brown Trout/)
  })

  it('the map\'s turn to fresh says what it put on; undone, the user\'s own pick undone stays a guess the map no longer turns', async () => {
    const { root, l } = await mountCard({ ...NORDHUSE, waterType: 'brackish' }, true)
    coast.entries = { [coordKey(l)]: inland() }
    await nextTick()
    expect(toasts.value.map((x) => x.message)).toEqual([[
      fill(STRINGS.da.wt_map_fresh, { name: NORDHUSE.name }),
      fill(STRINGS.da.loc_species_added, { names: 'Gedde, Sandart, Aborre, Brasen, Karpe' }),
    ].join(' ')])
    await undo()
    // Still a guess, and the coast check asks whether the water is salt, brackish or fresh.
    expect(marked(root)).toBe(true)
    expect(card(root).byClass('coast-check')[0]?.textContent).toContain(t('coast_check_inland'))
    // The user picks fresh after all, then undoes that too: the guess as it was, which the map still doesn't turn.
    await pick(root, 'fresh')
    expect(marked(root)).toBe(false)
    await undo()
    expect(l.waterType).toBe('brackish')
    expect(marked(root)).toBe(true)
    coast.entries = { [coordKey(l)]: inland() }
    await nextTick()
    expect(l.waterType).toBe('brackish')
    expect(toasts.value).toEqual([])
  })
})
