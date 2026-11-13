// @vitest-environment vue-dom
/**
 * The spot card's water type, as mounted: the real view, Pinia and router on
 * the in-memory DOM. A change of type takes off the species that no longer
 * fit and can put the lookup's on; a toast says so and can undo the change
 * ("Fortryd"). The card marks a guessed type "gættet – ret hvis forkert".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'
import { coordKey, type CoastAuto } from '@/lib/coast'
import { speciesFromNearby } from '@/lib/geo'
import { langReady, setLang, t } from '@/lib/i18n'
import { dismissToast, runToastAction, toasts } from '@/lib/toast'
import { bottomGuessed, guessFollowsMap, markBottomGuessed, markWaterGuessed, waterGuessed, waterGuessOf } from '@/lib/waterGuess'
import { SEARCH_DEBOUNCE_MS } from '@/lib/placeSearch'
import { STRINGS } from '@/test/strings'
import { BOTTOM_TYPES, DK_SPOTS, locationFromSpot } from '@/lib/spots'
import type { Location, WaterType } from '@/lib/types'
import { useCoastStore } from '@/stores/coast'
import { useSetupStore } from '@/stores/setup'
import LocationsView from './LocationsView.vue'

// Custom spots: no official spot within 30 m, so a change of type re-runs the lookup (geo.ts speciesLookupFor).
const HORNBAEK = { name: 'Hornbæk', lat: 56.09027, lon: 12.45693 }
const NORDHUSE = { name: 'Nordhuse', lat: 55.97, lon: 12.1 } // a pin in mid-Arresø (waterGuess.test.ts)
const ARRESO = { name: 'Arresø', lat: 55.98, lon: 12.13 } // another pin in the lake

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

async function mountCards(locs: Omit<Location, 'id'>[], guessed: boolean): Promise<{ root: FakeNode; ls: Location[] }> {
  const pinia = createPinia()
  setActivePinia(pinia)
  setup = useSetupStore(); coast = useCoastStore()
  setup.locations = locs.map((loc) => ({ id: `wt${++n}`, ...loc }))
  if (guessed) for (const l of setup.locations) markWaterGuessed(l.id)
  const page = { render: () => null }
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/locations', name: 'locations', component: page }, { path: '/map', name: 'map', component: page },
  ] })
  await router.push('/locations')
  view = mount(LocationsView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
  await nextTick()
  return { root: view.root, ls: setup.locations }
}
async function mountCard(loc: Omit<Location, 'id'>, guessed: boolean): Promise<{ root: FakeNode; l: Location }> {
  const { root, ls } = await mountCards([loc], guessed)
  return { root, l: ls[0] }
}

const card = (root: FakeNode, i = 0) => root.byClass('card loc')[i]
const WT_LABEL = { salt: 'wt_salt_label', brackish: 'wt_brackish_label', fresh: 'wt_fresh_label' } as const
/** Taps the water-type button of the card (the first, or the i-th). */
async function pick(root: FakeNode, w: WaterType & keyof typeof WT_LABEL, i = 0) {
  const b = card(root, i).byClass('wt').find((x) => x.textContent === t(WT_LABEL[w]))
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
   * Two changes on one spot, one toast: Hornbæk Saltvand, Ferskvand, then
   * Brakvand. Each change had its own toast; the older Fortryd put Saltvand
   * back, and the newer one, used after it, set Ferskvand, a state the user
   * had already left. Now the newer toast takes the older one's place, and
   * its Fortryd undoes what its sentence names: the change to Brakvand.
   */
  it('two changes on one spot leave one toast, the newer change\'s, and its Fortryd undoes that change', async () => {
    const species = speciesFromNearby(HORNBAEK.lat, HORNBAEK.lon, 'salt')
    const { root, l } = await mountCard({ ...HORNBAEK, waterType: 'salt', species }, false)
    await pick(root, 'fresh')
    const lake = l.species
    await pick(root, 'brackish')
    // It names the lake's fish taken off: only Ferskvand puts them back.
    expect(toasts.value.map((x) => x.message)).toEqual([[
      fill(STRINGS.da.loc_species_dropped_nearby, { names: 'Gedde, Sandart, Aborre' }),
      fill(STRINGS.da.loc_species_added, { names: 'Makrel, Hornfisk' }),
    ].join(' ')])
    await undo()
    expect(l.waterType).toBe('fresh')
    expect(l.species).toEqual(lake)
    expect(marked(root)).toBe(false)
    expect(toasts.value).toEqual([]) // no older Fortryd left to set Saltvand later
  })

  /**
   * The type the newer change found was the user's pick, so once it is back
   * it must not read "gættet", though the type before the first change was
   * a guess. The bottom type the newer change found was still the app's
   * guess, and reads as one again.
   */
  it('two changes on one spot: Fortryd puts back the guesses the newer change found', async () => {
    const species = speciesFromNearby(HORNBAEK.lat, HORNBAEK.lon, 'brackish')
    const { root, l } = await mountCard({ ...HORNBAEK, waterType: 'brackish', species, bottomType: 'stone' }, true)
    markBottomGuessed(l.id)
    await pick(root, 'fresh')
    await pick(root, 'salt')
    expect(toasts.value).toHaveLength(1)
    await undo()
    expect(l.waterType).toBe('fresh') // as before the second change: the user's pick
    expect(l.bottomType).toBe('mixed')
    // "gættet" beside the bottom type only, not the water type.
    expect(card(root).byClass('wt-row').map((r) => r.byClass('wt-guess').length)).toEqual([0, 1])
    expect(waterGuessed(l.id)).toBe(false)
    expect(bottomGuessed(l.id)).toBe(true)
  })

  /**
   * The map's turn to fresh, then the user's own pick on the same spot: one
   * toast, the pick's. Fortryd puts back the map's Ferskvand, still a guess,
   * which the map has no reason to turn again.
   */
  it('the map\'s turn then the user\'s pick: one toast, whose Fortryd puts back the map\'s Ferskvand, still a guess', async () => {
    const { root, l } = await mountCard({ ...NORDHUSE, waterType: 'brackish' }, true)
    coast.entries = { [coordKey(l)]: inland() }
    await nextTick()
    expect(l.waterType).toBe('fresh')
    const lake = l.species
    await pick(root, 'salt')
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0].message).not.toContain(fill(STRINGS.da.wt_map_fresh, { name: NORDHUSE.name }))
    await undo()
    await nextTick()
    expect(l.waterType).toBe('fresh')
    expect(l.species).toEqual(lake)
    expect(marked(root)).toBe(true)
    expect(toasts.value).toEqual([])
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
   * A guess the user's pick had ended follows the map again once that pick
   * is undone: a lake pin guessed Brakvand, set to Ferskvand and undone
   * before the coast lookup landed, turns fresh when it lands, with its own
   * toast and Fortryd, as it would have without the pick.
   */
  it('a guess put back before the lookup lands follows the map when it does', async () => {
    const { root, l } = await mountCard({ ...NORDHUSE, waterType: 'brackish' }, true)
    await pick(root, 'fresh')
    await undo()
    expect(l.waterType).toBe('brackish')
    expect(marked(root)).toBe(true)
    coast.entries = { [coordKey(l)]: inland() }
    await nextTick()
    expect(l.waterType).toBe('fresh')
    expect(marked(root)).toBe(true)
    expect(toasts.value.map((x) => x.message).join()).toContain(fill(STRINGS.da.wt_map_fresh, { name: NORDHUSE.name }))
  })

  /**
   * Fortryd sticks: undone after the lookup has found the lake, the guess put
   * back would have turned fresh at once, the toast's Fortryd seemingly doing
   * nothing but swap one toast for another. It comes back as the map's turn
   * undone instead: Brakvand, still a guess, which the map leaves, and the
   * coast check asks.
   */
  it('undone once the lookup has landed, the guess comes back as the map\'s turn undone: Fortryd sticks', async () => {
    const { root, l } = await mountCard({ ...NORDHUSE, waterType: 'brackish' }, true)
    await pick(root, 'fresh')
    coast.entries = { [coordKey(l)]: inland() }
    await nextTick()
    expect(marked(root)).toBe(false) // the user's pick: the map leaves it
    await undo()
    await nextTick()
    expect(l.waterType).toBe('brackish')
    expect(marked(root)).toBe(true)
    expect(toasts.value).toEqual([])
    expect(guessFollowsMap(l, coast.autoFor(l))).toBe(false)
    expect(card(root).byClass('coast-check')[0]?.textContent).toContain(t('coast_check_inland'))
  })

  /** A guess the lookup has nothing against comes back as it was, still following the map. */
  it('undone once the lookup has found the sea, the guess comes back as a plain guess', async () => {
    const { root, l } = await mountCard({ ...HORNBAEK, waterType: 'brackish' }, true)
    await pick(root, 'salt')
    coast.entries = { [coordKey(l)]: { ...inland(), water: 'sea', facing: 0, nearFacing: 0 } }
    await nextTick()
    await undo()
    expect(l.waterType).toBe('brackish')
    expect(marked(root)).toBe(true)
    expect(waterGuessOf(l.id)).toBe('guess')
  })
})

/**
 * A custom spot's bottom type is guessed from the official spots of its
 * water type (geo.ts inferBottomType): Hornbæk guessed Brakvand takes
 * Helsingør Kysten's 'stone', set to Ferskvand Gurre Sø's and Esrum Sø's
 * 'mixed'. Left as it was, a pin the map turned fresh kept the sea's stone
 * and its slip warning at a lake. One the guess didn't give, and an
 * official spot's own, stay.
 */
describe('a change of water type and the bottom type', () => {
  it('a bottom type that is the guess for the old water becomes the guess for the new; Fortryd puts it back', async () => {
    const { root, l } = await mountCard({ ...HORNBAEK, waterType: 'brackish', bottomType: 'stone' }, true)
    await pick(root, 'fresh')
    expect(l.bottomType).toBe('mixed')
    await undo()
    expect(l.waterType).toBe('brackish')
    expect(l.bottomType).toBe('stone')
  })

  it('the map\'s turn to fresh guesses it again too', async () => {
    const { l } = await mountCard({ ...HORNBAEK, waterType: 'brackish', bottomType: 'stone' }, true)
    coast.entries = { [coordKey(l)]: inland() }
    await nextTick()
    expect(l.waterType).toBe('fresh')
    expect(l.bottomType).toBe('mixed')
  })

  it('one the guess did not give stays, and so does an official spot\'s own', async () => {
    const a = await mountCard({ ...HORNBAEK, waterType: 'brackish', bottomType: 'sand' }, false)
    await pick(a.root, 'fresh')
    expect(a.l.bottomType).toBe('sand')
    view?.unmount()
    const spot = DK_SPOTS.find((s) => s.slug === 'helsingore-kysten')!
    const b = await mountCard(locationFromSpot(spot), false)
    await pick(b.root, 'fresh')
    expect(b.l.bottomType).toBe('stone')
  })
})

/**
 * The bottom type is what the safety advice reads (conditions.ts safetyRec):
 * stone and seaweed warn of a slippery bottom, mud says don't wade, sand
 * warns of weevers. It could not be seen or changed anywhere, so a wrong
 * guess could never be put right. The card shows it among the catalogue's
 * bottom types and a tap sets it; a guess says so until the user picks one.
 */
describe('the bottom type on the spot card', () => {
  const BT_LABEL = { sand: 'bt_sand', stone: 'bt_stone', mixed: 'bt_mixed', mud: 'bt_mud' } as const
  const row = (root: FakeNode) => card(root).byClass('bt-row')[0]
  const pills = (root: FakeNode) => row(root).byClass('bt')
  const shown = (root: FakeNode) => pills(root).filter((p) => p.hasClass('on')).map((p) => p.textContent)
  async function setBottom(root: FakeNode, b: keyof typeof BT_LABEL) {
    const p = pills(root).find((x) => x.textContent === t(BT_LABEL[b]))
    if (!p) throw new Error(`no ${b} button`)
    p.click()
    await nextTick()
  }

  it('shows it among the catalogue\'s bottom types, and a tap sets it', async () => {
    const { root, l } = await mountCard({ ...HORNBAEK, waterType: 'brackish', bottomType: 'stone' }, false)
    expect(row(root).textContent).toMatch(new RegExp(`^${STRINGS.da.loc_bottom}:`))
    expect(pills(root).map((p) => p.textContent)).toEqual(BOTTOM_TYPES.map((b) => STRINGS.da[BT_LABEL[b]]))
    expect(shown(root)).toEqual([STRINGS.da.bt_stone])
    await setBottom(root, 'sand')
    expect(l.bottomType).toBe('sand')
    expect(shown(root)).toEqual([STRINGS.da.bt_sand])
  })

  it('without one it shows Blandet, as the safety advice reads it, and writes nothing', async () => {
    const { root, l } = await mountCard({ ...HORNBAEK, waterType: 'brackish' }, false)
    expect(shown(root)).toEqual([STRINGS.da.bt_mixed])
    expect(l).not.toHaveProperty('bottomType')
  })

  it('says a guess is one until the user picks a bottom type, the active one too', async () => {
    const { root, l } = await mountCard({ ...HORNBAEK, waterType: 'brackish', bottomType: 'stone' }, true)
    markBottomGuessed(l.id)
    await nextTick()
    expect(row(root).byClass('wt-guess').map((x) => x.textContent)).toEqual([t('wt_guessed')])
    await setBottom(root, 'stone')
    expect(l.bottomType).toBe('stone')
    expect(row(root).byClass('wt-guess')).toEqual([])
    expect(bottomGuessed(l.id)).toBe(false)
    expect(marked(root)).toBe(true) // the water type is still the app's guess
  })

  it('one the user picked stays when the water type changes', async () => {
    const { root, l } = await mountCard({ ...HORNBAEK, waterType: 'brackish', bottomType: 'stone' }, true)
    await setBottom(root, 'sand')
    await pick(root, 'fresh')
    expect(l.bottomType).toBe('sand')
    expect(shown(root)).toEqual([STRINGS.da.bt_sand])
  })

  // A tap on the active pill confirms the guess: the tag goes, and the user
  // has said stone. Equal to the guess, it was re-guessed all the same, and
  // Ferskvand made it Blandet without a word.
  it('the guess confirmed by a tap on its pill stays when the water type changes', async () => {
    const { root, l } = await mountCard({ ...HORNBAEK, waterType: 'brackish', bottomType: 'stone' }, true)
    markBottomGuessed(l.id)
    await setBottom(root, 'stone')
    await pick(root, 'fresh')
    expect(l.bottomType).toBe('stone')
    expect(shown(root)).toEqual([STRINGS.da.bt_stone])
  })

  // Picked while the toast was up and undone with it: the guess is back, and
  // follows the water again.
  it('a pick undone by Fortryd leaves the guess free to follow the water again', async () => {
    const { root, l } = await mountCard({ ...HORNBAEK, waterType: 'brackish', bottomType: 'stone' }, true)
    markBottomGuessed(l.id)
    await pick(root, 'fresh')
    await setBottom(root, 'mixed')
    await undo()
    expect(l.bottomType).toBe('stone')
    await pick(root, 'fresh')
    expect(l.bottomType).toBe('mixed')
  })

  it('a guess the water type changes shows the new guess', async () => {
    const { root } = await mountCard({ ...HORNBAEK, waterType: 'brackish', bottomType: 'stone' }, true)
    await pick(root, 'fresh')
    expect(shown(root)).toEqual([STRINGS.da.bt_mixed])
  })

  // Fortryd puts the card back as it was, the bottom type's guess too. A
  // bottom type picked while the toast was up goes with it, as picked
  // species do, and the guess it puts back is shown as one again.
  it('Fortryd puts the guess back, still shown as one', async () => {
    const { root, l } = await mountCard({ ...HORNBAEK, waterType: 'brackish', bottomType: 'stone' }, true)
    markBottomGuessed(l.id)
    await pick(root, 'fresh')
    await setBottom(root, 'sand')
    await undo()
    expect(l.bottomType).toBe('stone')
    expect(bottomGuessed(l.id)).toBe(true)
    expect(row(root).byClass('wt-guess').map((x) => x.textContent)).toEqual([t('wt_guessed')])
  })

  it('reads English', async () => {
    setLang('en')
    await langReady()
    const { root } = await mountCard({ ...HORNBAEK, waterType: 'brackish', bottomType: 'mud' }, false)
    expect(row(root).textContent).toMatch(/^Bottom:/)
    expect(pills(root).map((p) => p.textContent)).toEqual(['Sand', 'Stone', 'Mixed', 'Mud'])
    expect(shown(root)).toEqual(['Mud'])
  })

  // The water type's pills, so on a touch screen they get the height a finger needs (touchTargets.test.ts .wt).
  it('its buttons are the water type\'s pills', async () => {
    const { root } = await mountCard({ ...HORNBAEK, waterType: 'brackish', bottomType: 'stone' }, false)
    expect(pills(root)).toHaveLength(BOTTOM_TYPES.length)
    for (const p of pills(root)) expect(p.tag === 'button' && p.hasClass('wt')).toBe(true)
  })

  /**
   * A place picked in the search: the water and bottom type are both
   * guesses (placeSearch.ts locationFromSearch), and the card says so for
   * each. Espergærde takes Helsingør Kysten's stone, not the lakes' mixed.
   */
  it('a place picked in the search is saved with the guess, and the card says it is one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      json: async () => ({ results: [{ name: 'Espergærde', admin1: 'Region Hovedstaden', latitude: 55.99078, longitude: 12.55296, country_code: 'DK' }] }),
    })))
    try {
      const { root } = await mountCard({ ...HORNBAEK, waterType: 'brackish', bottomType: 'stone' }, false)
      root.byTag('input').find((x) => x.attrs.type === 'search')!.input('Espergærde')
      await new Promise((r) => setTimeout(r, SEARCH_DEBOUNCE_MS + 20))
      await nextTick()
      root.byClass('result')[0].click()
      await new Promise((r) => setTimeout(r, 0))
      await nextTick()
      const added = setup.locations[1]
      expect(added).toMatchObject({ name: 'Espergærde, Region Hovedstaden', waterType: 'brackish', bottomType: 'stone' })
      const addedCard = root.byClass('card loc')[1]
      expect(addedCard.byClass('bt-row')[0].byClass('wt-guess').map((x) => x.textContent)).toEqual([t('wt_guessed')])
      expect(bottomGuessed(added.id)).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

/**
 * A change of type re-runs the lookup for a custom spot's species
 * (locationSpecies.ts changeWaterType), which can put species on as well as
 * take them off. The toast named only those taken off: Hornbæk set from
 * Brakvand to Ferskvand gained perch, pike and zander unnamed, and a
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
      fill(STRINGS.da.loc_species_added, { names: 'Gedde, Sandart, Aborre' }),
    ].join(' '))
    // Read when shown: a language switch re-renders it.
    setLang('en')
    await langReady()
    expect(toast.message).toBe([
      fill(STRINGS.en.loc_species_dropped_nearby, { names: 'Mackerel, Garfish' }),
      fill(STRINGS.en.loc_species_added, { names: 'Pike, Zander, Perch' }),
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

/**
 * Two spots whose change reads the same ("Tilføjet til pladsen: …" names no
 * spot) shared one toast, joined by its text, and its Fortryd undid only the
 * spot changed last. Each spot keeps its own toast and its own Fortryd.
 */
describe('the water-type toasts of two spots', () => {
  it('two spots whose change reads the same keep a toast each, and each Fortryd undoes its own spot', async () => {
    const { root, ls: [a, b] } = await mountCards([{ ...NORDHUSE, waterType: 'brackish' }, { ...ARRESO, waterType: 'brackish' }], false)
    await pick(root, 'fresh', 0)
    await pick(root, 'fresh', 1)
    expect(toasts.value).toHaveLength(2)
    const [ta, tb] = toasts.value
    expect(ta.message).toBe(tb.message)
    runToastAction(ta.id)
    await nextTick()
    expect(a.waterType).toBe('brackish')
    expect(a.species).toBeUndefined()
    expect(b.waterType).toBe('fresh')
    runToastAction(tb.id)
    await nextTick()
    expect(b.waterType).toBe('brackish')
    expect(b.species).toBeUndefined()
    expect(toasts.value).toEqual([])
  })
})
