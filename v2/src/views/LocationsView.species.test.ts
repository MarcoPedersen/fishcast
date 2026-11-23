// @vitest-environment vue-dom
/**
 * The spot card's species picker, as mounted, with sync armed so that every
 * edit runs the store's refill (stores/setup.ts enrichMissingSpecies). The
 * refill took an emptied list for one never filled: the last species tapped
 * off brought the lookup's straight back, and a change of water type put
 * them on again too. An empty list is the user's now, and stays empty.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'
import { speciesFromNearby } from '@/lib/geo'
import { countedSpeciesIds, fitWaterType, pickableSpecies, speciesEntry } from '@/lib/locationSpecies'
import { langReady, setLang, spName, t } from '@/lib/i18n'
import { SPECIES_PREFS } from '@/lib/species'
import { DK_SPOTS, catalogueSpotAt, locationFromSpot } from '@/lib/spots'
import { confirmAccept } from '@/lib/confirm'
import { dismissToast, runToastAction, shownToasts, toasts } from '@/lib/toast'
import { STRINGS } from '@/test/strings'
import type { Location, WaterType } from '@/lib/types'
import { useSetupStore } from '@/stores/setup'
import LocationsView from './LocationsView.vue'

// Custom spots: no official spot within 30 m, so the lookup is theirs (geo.ts speciesLookupFor).
const NORDHUSE = { name: 'Nordhuse', lat: 55.97, lon: 12.1 } // a pin in mid-Arresø
const HORNBAEK = { name: 'Hornbæk', lat: 56.09027, lon: 12.45693 }
const ARRESO = { name: 'Arresø', lat: 55.98, lon: 12.13 } // another pin in the lake
// A point in mid-Jutland with no official spot within 12 km: the lookup gives none for any water.
const MIDTJYLLAND = { name: 'Midtjylland', lat: 56.0, lon: 9.0 }

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined
let setup: ReturnType<typeof useSetupStore>
let n = 0

/** The cards of the spots, mounted, with sync armed as after a start. */
async function mountCards(locs: Omit<Location, 'id'>[]): Promise<{ root: FakeNode; ls: Location[] }> {
  const pinia = createPinia()
  setActivePinia(pinia)
  setup = useSetupStore()
  setup.locations = locs.map((loc) => ({ id: `sp${++n}`, ...loc }))
  const page = { render: () => null }
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/locations', name: 'locations', component: page }, { path: '/map', name: 'map', component: page },
  ] })
  await router.push('/locations')
  view = mount(LocationsView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
  await nextTick()
  setup.markReady()
  return { root: view.root, ls: setup.locations }
}
/** The card of one spot, mounted, with sync armed as after a start. */
async function mountCard(loc: Omit<Location, 'id'>): Promise<{ root: FakeNode; l: Location }> {
  const { root, ls } = await mountCards([loc])
  return { root, l: ls[0] }
}

/**
 * Lets the store watcher's refill, started by the last edit, run, and runs a
 * pass of its own: whether or not the edit's has ended, any refill is done.
 */
async function settle() {
  await nextTick()
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  await setup.enrichMissingSpecies()
  await nextTick()
}
const card = (root: FakeNode, i = 0) => root.byClass('card loc')[i]
const lit = (root: FakeNode) => card(root).byClass('sp-chip on')
const WT_LABEL = { salt: 'wt_salt_label', brackish: 'wt_brackish_label', fresh: 'wt_fresh_label' } as const
/** Taps a water-type button on the card (the first, or the i-th). */
async function pick(root: FakeNode, w: keyof typeof WT_LABEL, i = 0) {
  card(root, i).byClass('wt').find((b) => b.textContent === t(WT_LABEL[w]))!.click()
  await nextTick()
}

beforeEach(() => { restoreDocument = installDocument() })
afterEach(() => {
  setup.pauseSync() // no push left queued
  view?.unmount()
  view = undefined
  for (const x of [...toasts.value]) dismissToast(x.id)
  setLang('da')
  restoreDocument()
})

describe('a species list the user emptied on the spot card stays empty', () => {
  it('the last species tapped off leaves none, though the lookup lists the lake\'s', async () => {
    expect(speciesFromNearby(NORDHUSE.lat, NORDHUSE.lon, 'fresh').length).toBeGreaterThan(0)
    const { root, l } = await mountCard({ ...NORDHUSE, waterType: 'fresh', species: [speciesEntry('gedde', 'fresh')!] })
    card(root).byTag('button').find((b) => b.attrs.title === t('loc_species'))!.click()
    await nextTick()
    expect(lit(root)).toHaveLength(1)
    lit(root)[0].click()
    await settle()
    expect(l.species).toEqual([])
    expect(lit(root)).toEqual([])
  })

  it('a change of water type puts none on it, and says nothing', async () => {
    const { root, l } = await mountCard({ ...HORNBAEK, waterType: 'brackish', species: [] })
    card(root).byClass('wt').find((b) => b.textContent === t('wt_fresh_label'))!.click()
    await settle()
    expect(l.waterType).toBe('fresh')
    expect(l.species).toEqual([])
    expect(toasts.value).toEqual([])
  })

  it('a spot never filled is still filled by the lookup', async () => {
    const { l } = await mountCard({ ...NORDHUSE, waterType: 'fresh' })
    l.note = 'any edit runs the refill'
    await settle()
    expect(l.species).toEqual(speciesFromNearby(NORDHUSE.lat, NORDHUSE.lon, 'fresh'))
  })

  // As "Hent arter" fills an emptied one (geo.ts speciesBackFor): not the lookup's sea trout.
  it('a copy of an official spot never filled is filled with its own', async () => {
    const gurre = DK_SPOTS.find((s) => s.slug === 'gurre-so')!
    const { root, l } = await mountCard({ name: gurre.name, lat: gurre.lat, lon: gurre.lon, waterType: 'fresh' })
    l.note = 'any edit runs the refill'
    await settle()
    expect(l.species).toEqual(locationFromSpot(gurre).species)
    card(root).byTag('button').find((b) => b.attrs.title === t('loc_species'))!.click()
    await nextTick()
    const shown = lit(root).map((c) => c.textContent)
    expect(shown).toHaveLength(3)
    for (const id of ['gedde', 'aborre', 'sandart']) expect(shown.some((x) => x.includes(spName(SPECIES_PREFS[id]))), id).toBe(true)
  })

  /**
   * A copy of Grærup Strand saved as Ferskvand: none of its flatfish live in
   * fresh water, so the refill left it never filled. Set to Saltvand, it
   * kept none, though its own are turbot, plaice, dab and flounder: a change
   * of water type ran only the custom spots' lookup, and an official spot
   * has none. It is filled as the refill fills a list never filled (geo.ts
   * speciesBackFor).
   */
  it('a copy of an official spot never filled takes its own species on a change of water type', async () => {
    const graerup = DK_SPOTS.find((s) => s.slug === 'graerup-strand')!
    const { root, l } = await mountCard({ name: graerup.name, lat: graerup.lat, lon: graerup.lon, waterType: 'fresh' })
    l.note = 'any edit runs the refill'
    await settle()
    expect(l.species).toBeUndefined() // none of the sea's in fresh water
    await pick(root, 'salt')
    await settle()
    const own = fitWaterType(locationFromSpot(graerup).species, 'salt')
    expect(l.species).toEqual(own)
    expect(countedSpeciesIds(l.species, 'salt').sort()).toEqual(['ising', 'pighvar', 'roedspætte', 'skrubbe'])
    // The toast names them, and its Fortryd leaves the list never filled again.
    const names = countedSpeciesIds(own, 'salt').map((id) => spName(SPECIES_PREFS[id])).join(', ')
    expect(toasts.value.map((x) => x.message)).toEqual([`${graerup.name}: ${STRINGS.da.loc_species_added.replace('{names}', names)}`])
    runToastAction(toasts.value[0].id)
    await settle()
    expect(l.waterType).toBe('fresh')
    expect(l.species).toBeUndefined()
  })

  it('a copy of an official spot the user emptied stays empty on a change of water type', async () => {
    const gurre = DK_SPOTS.find((s) => s.slug === 'gurre-so')!
    const { root, l } = await mountCard({ name: gurre.name, lat: gurre.lat, lon: gurre.lon, waterType: 'salt', species: [] })
    await pick(root, 'fresh')
    await settle()
    expect(l.species).toEqual([])
    expect(toasts.value).toEqual([])
  })

  /**
   * Empty where none of its own live: a copy of Grærup Strand at Ferskvand,
   * emptied there, or saved so from the map (an official spot's own list,
   * judged by its water, is its list even when none fit). Its own give
   * nothing at the old water, so an empty list reads as "still what they
   * give", and the refill's lookup would put all four flatfish on at
   * Saltvand. Empty stays empty: only a list never filled takes the
   * refill's species (speciesLookupOf). "Hent arter" offers them.
   */
  it('a copy of an official spot emptied where none of its own live stays empty on a change of water type', async () => {
    const graerup = DK_SPOTS.find((s) => s.slug === 'graerup-strand')!
    const { root, l } = await mountCard({ name: graerup.name, lat: graerup.lat, lon: graerup.lon, waterType: 'fresh', species: [] })
    await pick(root, 'salt')
    await settle()
    expect(l.waterType).toBe('salt')
    expect(l.species).toEqual([])
    expect(toasts.value).toEqual([])
  })

  // As the refill: with none the score can use, a list never filled stays so.
  it('a spot never filled where the lookup finds none stays never filled on a change of water type', async () => {
    const { root, l } = await mountCard({ ...MIDTJYLLAND, waterType: 'brackish' })
    await pick(root, 'fresh')
    await settle()
    expect(l.species).toBeUndefined()
    expect(toasts.value).toEqual([])
  })
})

/**
 * An emptied list stays empty, and the card says "Ingen arter valgt". The
 * only way back to the nearby spots' species was picking them one by one.
 * The line now offers them in one tap, and a toast with Fortryd says what
 * it put on. An official spot, or a copy of one, gets its own species from
 * the catalogue, not the lookup's. The tap is a step in the spot's undo
 * history, as a change of water type is: the spot keeps one toast, which
 * names its latest step.
 */
describe('an emptied species list gets the species back in one tap', () => {
  const line = (root: FakeNode, i = 0) => card(root, i).byClass('sp-missing')[0]
  const fetchButton = (root: FakeNode, key: 'loc_species_nearby' | 'loc_species_own', lang: 'da' | 'en' = 'da', i = 0) =>
    line(root, i)?.byTag('button').find((b) => b.textContent === STRINGS[lang][key])
  const anyFetch = (root: FakeNode) => !!(fetchButton(root, 'loc_species_nearby') ?? fetchButton(root, 'loc_species_own'))
  /** The names the toast gives: the species the app knows, in the language shown. */
  const named = (species: { nameEn: string }[], w: WaterType) =>
    countedSpeciesIds(species, w).map((id) => spName(SPECIES_PREFS[id])).join(', ')
  const said = (name: string, species: { nameEn: string }[], w: WaterType, lang: 'da' | 'en' = 'da') =>
    `${name}: ${STRINGS[lang].loc_species_added.replace('{names}', named(species, w))}`
  const own = (slug: string, w: WaterType) =>
    fitWaterType(locationFromSpot(DK_SPOTS.find((s) => s.slug === slug)!).species, w)
  /** The spot's one toast, keyed by spot as its water-type changes' (LocationsView showStep). */
  const spotToast = (l: Location) => toasts.value.find((x) => x.key === `water:${l.id}`)
  /** Taps Fortryd on the spot's toast. */
  async function undoSpot(l: Location) {
    runToastAction(spotToast(l)!.id)
    await nextTick()
  }

  it('a custom spot gets the lookup\'s species for its water, and a toast names them', async () => {
    const { root, l } = await mountCard({ ...NORDHUSE, waterType: 'fresh', species: [] })
    const lake = speciesFromNearby(NORDHUSE.lat, NORDHUSE.lon, 'fresh')
    expect(line(root).textContent).toContain(STRINGS.da.loc_species_cleared)
    fetchButton(root, 'loc_species_nearby')!.click()
    await nextTick()
    expect(l.species).toEqual(lake)
    expect(line(root)).toBeUndefined()
    expect(card(root).byClass('sp-have')[0].textContent).toContain(`${countedSpeciesIds(lake, 'fresh').length} ${STRINGS.da.loc_species_count}`)
    expect(toasts.value.map((x) => [x.message, x.action?.label])).toEqual([[said(NORDHUSE.name, lake, 'fresh'), STRINGS.da.undo]])
  })

  it('Fortryd leaves the list empty again, not missing, and the refill leaves it so', async () => {
    const { root, l } = await mountCard({ ...NORDHUSE, waterType: 'fresh', species: [] })
    fetchButton(root, 'loc_species_nearby')!.click()
    await nextTick()
    runToastAction(spotToast(l)!.id)
    await settle()
    expect(l.species).toEqual([])
    expect(toasts.value).toEqual([])
    expect(line(root).textContent).toContain(STRINGS.da.loc_species_cleared)
    expect(fetchButton(root, 'loc_species_nearby')).toBeDefined()
  })

  it('is not offered where the lookup has no species for the water', async () => {
    expect(speciesFromNearby(NORDHUSE.lat, NORDHUSE.lon, 'brackish')).toEqual([])
    const lake = await mountCard({ ...NORDHUSE, waterType: 'brackish', species: [] })
    expect(line(lake.root).textContent).toContain(STRINGS.da.loc_species_cleared)
    expect(anyFetch(lake.root)).toBe(false)
    view?.unmount()
    for (const w of ['salt', 'brackish', 'fresh'] as const) expect(speciesFromNearby(MIDTJYLLAND.lat, MIDTJYLLAND.lon, w)).toEqual([])
    const inland = await mountCard({ ...MIDTJYLLAND, waterType: 'fresh', species: [] })
    expect(line(inland.root).textContent).toContain(STRINGS.da.loc_species_cleared)
    expect(anyFetch(inland.root)).toBe(false)
  })

  // Gurre Sø lists pike, perch and zander. The lookup round its old pin adds
  // the other lakes' "Brown Trout (river/lake)", and round its pin sea trout.
  it('a copy of an official spot gets its own species, at its pin or a former one', async () => {
    const gurre = DK_SPOTS.find((s) => s.slug === 'gurre-so')!
    const former = gurre.formerPins![0]
    expect(catalogueSpotAt(former.lat, former.lon)?.slug).toBe('gurre-so')
    expect(speciesFromNearby(former.lat, former.lon, 'fresh').map((s) => s.nameEn)).toContain('Brown Trout (river/lake)')
    // Saved from the setup map before the pin moved: no slug, the old pin.
    const old = await mountCard({ name: gurre.name, ...former, waterType: 'fresh', species: [] })
    expect(fetchButton(old.root, 'loc_species_nearby')).toBeUndefined()
    fetchButton(old.root, 'loc_species_own')!.click()
    await nextTick()
    expect(old.l.species).toEqual(own('gurre-so', 'fresh'))
    expect(spotToast(old.l)?.message).toBe(said(gurre.name, own('gurre-so', 'fresh'), 'fresh'))
    view?.unmount()
    expect(countedSpeciesIds(speciesFromNearby(gurre.lat, gurre.lon, 'fresh'), 'fresh')).toContain('havørred')
    const copy = await mountCard({ ...locationFromSpot(gurre), species: [] })
    fetchButton(copy.root, 'loc_species_own')!.click()
    await nextTick()
    expect(copy.l.species).toEqual(own('gurre-so', 'fresh'))
  })

  // Helsingør Kysten set to Ferskvand: of its own only sea trout lives there,
  // where the lookup has a lake's pike, perch and zander.
  it("an official spot's own species are those that fit its water now", async () => {
    const hk = DK_SPOTS.find((s) => s.slug === 'helsingore-kysten')!
    const { root, l } = await mountCard({ ...locationFromSpot(hk), waterType: 'fresh', species: [] })
    fetchButton(root, 'loc_species_own')!.click()
    await nextTick()
    expect(countedSpeciesIds(l.species, 'fresh')).toEqual(['havørred'])
    expect(l.species).toEqual(own('helsingore-kysten', 'fresh'))
  })

  // A change of water type that takes off every species picked by hand leaves
  // the list empty too, so the line offers the lookup for the new water. The
  // tap goes on top of the change in the spot's undo history, in the spot's
  // one toast. Its Fortryd takes off only what it put on; then the change's
  // toast comes back, and its Fortryd puts back the cod picked by hand.
  it('a change of water type that took off every species picked by hand offers it too', async () => {
    const cod = speciesEntry('torsk', 'salt')!
    const lake = speciesFromNearby(HORNBAEK.lat, HORNBAEK.lon, 'fresh')
    const { root, l } = await mountCard({ ...HORNBAEK, waterType: 'salt', species: [cod] })
    await pick(root, 'fresh')
    expect(l.species).toEqual([])
    const water = spotToast(l)!.message
    fetchButton(root, 'loc_species_nearby')!.click()
    await nextTick()
    expect(l.species).toEqual(lake)
    expect(toasts.value.map((x) => [x.key, x.message])).toEqual([[`water:${l.id}`, said(HORNBAEK.name, lake, 'fresh')]])
    await undoSpot(l)
    expect(l).toMatchObject({ waterType: 'fresh', species: [] })
    expect(toasts.value.map((x) => [x.key, x.message])).toEqual([[`water:${l.id}`, water]])
    await undoSpot(l)
    await settle()
    expect(l.waterType).toBe('salt')
    expect(l.species).toEqual([cod])
    expect(toasts.value).toEqual([])
  })

  /**
   * The round E browser check: with three spots' toasts standing, "Hent
   * arter" on the spot whose toast was the oldest raised a fourth toast,
   * which pushed that spot's own toast off, and its history with it: the
   * cod an earlier change took off could no longer come back. The tap now
   * takes the spot's toast, in its place, and pushes nothing off.
   */
  it('with three toasts standing it keeps the spot\'s own toast, and Fortryd steps back to the change before it', async () => {
    const cod = speciesEntry('torsk', 'salt')!
    const pike = speciesEntry('gedde', 'fresh')!
    const lake = speciesFromNearby(HORNBAEK.lat, HORNBAEK.lon, 'fresh')
    const { root, ls: [a, b, c] } = await mountCards([
      { ...HORNBAEK, waterType: 'salt', species: [cod] },
      { ...NORDHUSE, waterType: 'fresh', species: [pike] },
      { ...ARRESO, waterType: 'fresh', species: [pike] },
    ])
    await pick(root, 'fresh', 0)
    await pick(root, 'salt', 1)
    await pick(root, 'salt', 2)
    const stack = toasts.value.map((x) => [x.id, x.key])
    expect(stack.map(([, key]) => key)).toEqual([a, b, c].map((x) => `water:${x.id}`))
    const water = spotToast(a)!.message
    fetchButton(root, 'loc_species_nearby', 'da', 0)!.click()
    await nextTick()
    expect(a.species).toEqual(lake)
    expect(toasts.value.map((x) => [x.id, x.key])).toEqual(stack)
    expect(spotToast(a)!.message).toBe(said(HORNBAEK.name, lake, 'fresh'))
    await undoSpot(a)
    expect(a).toMatchObject({ waterType: 'fresh', species: [] })
    expect(spotToast(a)!.message).toBe(water)
    await undoSpot(a)
    expect(a).toMatchObject({ waterType: 'salt', species: [cod] })
    expect(toasts.value.map((x) => x.key)).toEqual([b, c].map((x) => `water:${x.id}`))
  })

  /**
   * The round F browser check: Hornbæk's toast was the oldest of three, and
   * a change on a fourth spot pushed it off the stack, its history with it:
   * the cod picked by hand could no longer come back. Now the toast waits
   * for room (lib/toast), and Fortryd on each spot's toast in turn takes
   * every spot back as it began, Hornbæk's two changes too.
   */
  describe('with four spots changed', () => {
    const cod = speciesEntry('torsk', 'salt')!
    const pike = speciesEntry('gedde', 'fresh')!
    const gurre = locationFromSpot(DK_SPOTS.find((s) => s.slug === 'gurre-so')!)
    const key = (l: Location) => `water:${l.id}`
    const state = (ls: Location[]) => ls.map((l) => ({ waterType: l.waterType, species: l.species }))
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
      fetchButton(root, 'loc_species_nearby', 'da', 0)!.click()
      await nextTick()
      expect(ls[0].species).toEqual(speciesFromNearby(HORNBAEK.lat, HORNBAEK.lon, 'fresh'))
      for (const i of [1, 2, 3]) await pick(root, 'salt', i)
      return { root, ls, before }
    }

    it("the oldest spot's toast waits for room, and Fortryd on each in turn takes all back", async () => {
      const { ls, before } = await changeAll()
      const [a, b, c, d] = ls
      expect(shownToasts.value.map((x) => x.key)).toEqual([b, c, d].map(key))
      expect(toasts.value.filter((x) => x.waiting).map((x) => x.key)).toEqual([key(a)])
      await undoSpot(d) // its toast used up: Hornbæk's comes back, at the top
      expect(state([d])).toEqual([before[3]])
      expect(shownToasts.value.map((x) => x.key)).toEqual([a, b, c].map(key))
      await undoSpot(c)
      await undoSpot(b)
      expect(state([b, c, d])).toEqual(before.slice(1))
      await undoSpot(a) // the lake's species off
      expect(a).toMatchObject({ waterType: 'fresh', species: [] })
      await undoSpot(a) // the cod back
      await settle()
      expect(state(ls)).toEqual(before)
      expect(toasts.value).toEqual([])
    })

    // Its next change shows it again, in its place, on top of its history.
    it('a change on the spot whose toast waits shows it, its history whole', async () => {
      const { root, ls, before } = await changeAll()
      const [a, b] = ls
      const first = toasts.value[0].id
      await pick(root, 'brackish', 0)
      expect(toasts.value[0]).toMatchObject({ id: first, key: key(a) })
      expect(shownToasts.value[0].id).toBe(first)
      expect(toasts.value.filter((x) => x.waiting).map((x) => x.key)).toEqual([key(b)])
      for (let i = 0; i < 3; i++) await undoSpot(a)
      await settle()
      expect(state([a])).toEqual([before[0]])
      expect(shownToasts.value.map((x) => x.key)).toContain(key(b))
      expect(toasts.value.filter((x) => x.waiting)).toEqual([])
    })
  })

  // Fortryd takes off what the tap put on and nothing else.
  it('Fortryd keeps a species picked since', async () => {
    const lake = speciesFromNearby(NORDHUSE.lat, NORDHUSE.lon, 'fresh')
    const { root, l } = await mountCard({ ...NORDHUSE, waterType: 'fresh', species: [] })
    fetchButton(root, 'loc_species_nearby')!.click()
    await nextTick()
    const extra = pickableSpecies('fresh').find((x) => !countedSpeciesIds(lake, 'fresh').includes(x.id))!
    card(root).byTag('button').find((b) => b.attrs.title === t('loc_species'))!.click()
    await nextTick()
    card(root).byClass('sp-chip').find((b) => b.textContent.trim().endsWith(` ${spName(SPECIES_PREFS[extra.id])}`))!.click()
    await nextTick()
    expect(countedSpeciesIds(l.species, 'fresh')).toContain(extra.id)
    await undoSpot(l)
    await settle()
    expect(countedSpeciesIds(l.species, 'fresh')).toEqual([extra.id])
    expect(toasts.value).toEqual([])
  })

  // ✕ is the user's "done with this": the spot's steps go with its toast
  // (lib/undoHistory), and the tap starts a new history. Its Fortryd must not
  // bring back the toast the user closed.
  it('closed with ✕, the change before it is forgotten: Fortryd brings back no toast', async () => {
    const cod = speciesEntry('torsk', 'salt')!
    const { root, l } = await mountCard({ ...HORNBAEK, waterType: 'salt', species: [cod] })
    await pick(root, 'fresh')
    dismissToast(spotToast(l)!.id)
    fetchButton(root, 'loc_species_nearby')!.click()
    await nextTick()
    await undoSpot(l)
    await settle()
    expect(l).toMatchObject({ waterType: 'fresh', species: [] })
    expect(toasts.value).toEqual([])
  })

  // Its Fortryd would read as undoing the delete.
  it('a spot deleted closes its toast', async () => {
    const { root } = await mountCard({ ...NORDHUSE, waterType: 'fresh', species: [] })
    fetchButton(root, 'loc_species_nearby')!.click()
    await nextTick()
    expect(toasts.value).toHaveLength(1)
    card(root).findAll((x) => x.tag === 'button' && x.textContent === '🗑')[0].click()
    await nextTick()
    confirmAccept()
    await nextTick(); await nextTick()
    expect(setup.locations).toEqual([])
    expect(toasts.value).toEqual([])
  })

  it('reads English', async () => {
    setLang('en')
    await langReady()
    const lake = speciesFromNearby(NORDHUSE.lat, NORDHUSE.lon, 'fresh')
    const { root, l } = await mountCard({ ...NORDHUSE, waterType: 'fresh', species: [] })
    fetchButton(root, 'loc_species_nearby', 'en')!.click()
    await nextTick()
    expect(l.species).toEqual(lake)
    expect(spotToast(l)?.message).toBe(said(NORDHUSE.name, lake, 'fresh', 'en'))
    view?.unmount()
    const gurre = DK_SPOTS.find((s) => s.slug === 'gurre-so')!
    const copy = await mountCard({ ...locationFromSpot(gurre), species: [] })
    expect(fetchButton(copy.root, 'loc_species_own', 'en')).toBeDefined()
  })

  // The toast stays until it is used or closed, and a language switch
  // meanwhile re-renders it, its button too (lib/toast).
  it('a language switch while the toast is up re-renders it', async () => {
    const lake = speciesFromNearby(NORDHUSE.lat, NORDHUSE.lon, 'fresh')
    const { root, l } = await mountCard({ ...NORDHUSE, waterType: 'fresh', species: [] })
    fetchButton(root, 'loc_species_nearby')!.click()
    await nextTick()
    expect(spotToast(l)?.message).toBe(said(NORDHUSE.name, lake, 'fresh'))
    setLang('en')
    await langReady()
    expect(spotToast(l)?.message).toBe(said(NORDHUSE.name, lake, 'fresh', 'en'))
    expect(spotToast(l)?.action?.label).toBe(STRINGS.en.undo)
  })

  // Only a list the user emptied. One never filled is the refill's, and the
  // line says "Vi kender ikke arterne her". One that holds species, though
  // none count (the water type hides them), keeps them: the tap would put
  // the lookup's in their place, and Fortryd takes off only what it put on.
  it('is offered only on an emptied list', async () => {
    const never = await mountCard({ ...NORDHUSE, waterType: 'fresh' })
    expect(never.l.species).toBeUndefined()
    expect(line(never.root).textContent).toContain(STRINGS.da.loc_species_unknown)
    expect(anyFetch(never.root)).toBe(false)
    view?.unmount()
    const pike = speciesEntry('gedde', 'fresh')!
    expect(countedSpeciesIds([pike], 'salt')).toEqual([])
    expect(countedSpeciesIds(speciesFromNearby(HORNBAEK.lat, HORNBAEK.lon, 'salt'), 'salt').length).toBeGreaterThan(0)
    const hidden = await mountCard({ ...HORNBAEK, waterType: 'salt', species: [pike] })
    expect(line(hidden.root).textContent).toContain(STRINGS.da.loc_species_unknown)
    expect(anyFetch(hidden.root)).toBe(false)
  })

  // Another tab saved, or a pull came in, while the toast was up: the list
  // holds a fresh copy of the spot (stores/setup reloadLocal). Fortryd takes
  // them off that one, and the list it leaves empty stays so after a reload.
  // Another tab renamed the spot (a sync puts fresh copies in the list): the
  // water-type toasts followed the name (79fc550), this one kept the old.
  // A change of water type that changes the list: a toast of the tap's own
  // stood naming species that were gone, with a Fortryd that did nothing.
  // The change goes on top of the tap, in the spot's one toast, which names
  // the change. Its Fortryd puts back what the tap put on, and the tap's
  // toast comes back, true again; its Fortryd empties the list.
  it('a change of water type after it goes on top: Fortryd puts its species back, then takes them off', async () => {
    const lake = speciesFromNearby(NORDHUSE.lat, NORDHUSE.lon, 'fresh')
    const { root, l } = await mountCard({ ...NORDHUSE, waterType: 'fresh', species: [] })
    fetchButton(root, 'loc_species_nearby')!.click()
    await nextTick()
    await pick(root, 'salt')
    expect(l.species).toEqual([])
    expect(toasts.value.map((x) => [x.key, x.message])).toEqual([[`water:${l.id}`,
      `${NORDHUSE.name}: ${STRINGS.da.loc_species_dropped_nearby.replace('{names}', named(lake, 'fresh'))}`]])
    await undoSpot(l)
    expect(l).toMatchObject({ waterType: 'fresh', species: lake })
    expect(toasts.value.map((x) => [x.key, x.message])).toEqual([[`water:${l.id}`, said(NORDHUSE.name, lake, 'fresh')]])
    await undoSpot(l)
    await settle()
    expect(l).toMatchObject({ waterType: 'fresh', species: [] })
    expect(toasts.value).toEqual([])
  })

  it('names the spot as it is called now, after a rename from another tab', async () => {
    const { root, l } = await mountCard({ ...NORDHUSE, waterType: 'fresh', species: [] })
    fetchButton(root, 'loc_species_nearby')!.click()
    await nextTick()
    const renamed = setup.locations.map((x) => ({ ...x, name: 'Nordhuse Vest' }))
    localStorage.setItem('fc2-setup', JSON.stringify({ locations: renamed, targetSpecies: ['torsk'], availability: [] }))
    setup.reloadLocal()
    await nextTick()
    expect(setup.locations[0]).not.toBe(l)
    expect(spotToast(l)!.message.startsWith('Nordhuse Vest: ')).toBe(true)
  })

  it('Fortryd after a sync takes them off the spot as it is shown now', async () => {
    const { root, l } = await mountCard({ ...NORDHUSE, waterType: 'fresh', species: [] })
    fetchButton(root, 'loc_species_nearby')!.click()
    await nextTick()
    localStorage.setItem('fc2-setup', JSON.stringify({ locations: setup.locations, targetSpecies: ['torsk'], availability: [] }))
    setup.reloadLocal()
    await nextTick()
    expect(setup.locations[0]).not.toBe(l)
    runToastAction(spotToast(l)!.id)
    await settle()
    expect(setup.locations[0].species).toEqual([])
    // What this tab saved, read back as a reload reads it.
    expect(JSON.parse(localStorage.getItem('fc2-setup')!).locations[0].species).toEqual([])
    setup.reloadLocal()
    await settle()
    expect(setup.locations[0].species).toEqual([])
    expect(line(root).textContent).toContain(STRINGS.da.loc_species_cleared)
    expect(fetchButton(root, 'loc_species_nearby')).toBeDefined()
  })

  // Nothing is left to step back on: the spot's toast goes with it, its
  // steps too (stores/setup), and no earlier toast comes back.
  it('once the spot was deleted in another tab, its toast goes and the list stays as that tab left it', async () => {
    const cod = speciesEntry('torsk', 'salt')!
    const { root, ls: [a, b] } = await mountCards([{ ...HORNBAEK, waterType: 'salt', species: [cod] }, { ...NORDHUSE, waterType: 'fresh', species: [] }])
    await pick(root, 'fresh', 0)
    fetchButton(root, 'loc_species_nearby', 'da', 0)!.click()
    await nextTick()
    expect(spotToast(a)).toBeDefined()
    localStorage.setItem('fc2-setup', JSON.stringify({ locations: [b], targetSpecies: ['torsk'], availability: [] }))
    setup.reloadLocal()
    await nextTick()
    expect(spotToast(a)).toBeUndefined()
    await settle()
    expect(setup.locations.map((x) => [x.id, x.waterType, x.species])).toEqual([[b.id, 'fresh', []]])
    expect(toasts.value).toEqual([])
  })
})
