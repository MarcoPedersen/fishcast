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
import { countedSpeciesIds, fitWaterType, speciesEntry } from '@/lib/locationSpecies'
import { langReady, setLang, spName, t } from '@/lib/i18n'
import { SPECIES_PREFS } from '@/lib/species'
import { DK_SPOTS, catalogueSpotAt, locationFromSpot } from '@/lib/spots'
import { confirmAccept } from '@/lib/confirm'
import { dismissToast, runToastAction, toasts } from '@/lib/toast'
import { STRINGS } from '@/test/strings'
import type { Location, WaterType } from '@/lib/types'
import { useSetupStore } from '@/stores/setup'
import LocationsView from './LocationsView.vue'

// Custom spots: no official spot within 30 m, so the lookup is theirs (geo.ts speciesLookupFor).
const NORDHUSE = { name: 'Nordhuse', lat: 55.97, lon: 12.1 } // a pin in mid-Arresø
const HORNBAEK = { name: 'Hornbæk', lat: 56.09027, lon: 12.45693 }
// A point in mid-Jutland with no official spot within 12 km: the lookup gives none for any water.
const MIDTJYLLAND = { name: 'Midtjylland', lat: 56.0, lon: 9.0 }

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined
let setup: ReturnType<typeof useSetupStore>
let n = 0

/** The card of one spot, mounted, with sync armed as after a start. */
async function mountCard(loc: Omit<Location, 'id'>): Promise<{ root: FakeNode; l: Location }> {
  const pinia = createPinia()
  setActivePinia(pinia)
  setup = useSetupStore()
  setup.locations = [{ id: `sp${++n}`, ...loc }]
  const page = { render: () => null }
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/locations', name: 'locations', component: page }, { path: '/map', name: 'map', component: page },
  ] })
  await router.push('/locations')
  view = mount(LocationsView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
  await nextTick()
  setup.markReady()
  return { root: view.root, l: setup.locations[0] }
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
const card = (root: FakeNode) => root.byClass('card loc')[0]
const lit = (root: FakeNode) => card(root).byClass('sp-chip on')

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
    card(root).byTag('button').find((b) => b.attrs['aria-label'] === t('loc_species'))!.click()
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
})

/**
 * An emptied list stays empty, and the card says "Ingen arter valgt". The
 * only way back to the nearby spots' species was picking them one by one.
 * The line now offers them in one tap, and a toast with Fortryd says what
 * it put on. An official spot, or a copy of one, gets its own species from
 * the catalogue, not the lookup's.
 */
describe('an emptied species list gets the species back in one tap', () => {
  const line = (root: FakeNode) => card(root).byClass('sp-missing')[0]
  const fetchButton = (root: FakeNode, key: 'loc_species_nearby' | 'loc_species_own', lang: 'da' | 'en' = 'da') =>
    line(root)?.byTag('button').find((b) => b.textContent === STRINGS[lang][key])
  const anyFetch = (root: FakeNode) => !!(fetchButton(root, 'loc_species_nearby') ?? fetchButton(root, 'loc_species_own'))
  /** The names the toast gives: the species the app knows, in the language shown. */
  const named = (species: { nameEn: string }[], w: WaterType) =>
    countedSpeciesIds(species, w).map((id) => spName(SPECIES_PREFS[id])).join(', ')
  const said = (name: string, species: { nameEn: string }[], w: WaterType, lang: 'da' | 'en' = 'da') =>
    `${name}: ${STRINGS[lang].loc_species_added.replace('{names}', named(species, w))}`
  const own = (slug: string, w: WaterType) =>
    fitWaterType(locationFromSpot(DK_SPOTS.find((s) => s.slug === slug)!).species, w)
  const speciesToast = (l: Location) => toasts.value.find((x) => x.key === `species:${l.id}`)

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
    runToastAction(speciesToast(l)!.id)
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
    expect(speciesToast(old.l)?.message).toBe(said(gurre.name, own('gurre-so', 'fresh'), 'fresh'))
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
  // the list empty too, so the line offers the lookup for the new water. Its
  // own toast can still undo the change, and the species toast's Fortryd then
  // takes off only what it put on: the cod picked by hand is the user's.
  it('a change of water type that took off every species picked by hand offers it too', async () => {
    const cod = speciesEntry('torsk', 'salt')!
    const { root, l } = await mountCard({ ...HORNBAEK, waterType: 'salt', species: [cod] })
    card(root).byClass('wt').find((b) => b.textContent === t('wt_fresh_label'))!.click()
    await nextTick()
    expect(l.species).toEqual([])
    const water = toasts.value.find((x) => x.key === `water:${l.id}`)!
    fetchButton(root, 'loc_species_nearby')!.click()
    await nextTick()
    expect(l.species).toEqual(speciesFromNearby(HORNBAEK.lat, HORNBAEK.lon, 'fresh'))
    runToastAction(water.id)
    await nextTick()
    expect(l.waterType).toBe('salt')
    expect(l.species).toEqual([cod])
    // The species it named are gone with the list it filled: its toast goes too,
    // rather than stand with a Fortryd that does nothing.
    expect(speciesToast(l)).toBeUndefined()
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
    expect(speciesToast(l)?.message).toBe(said(NORDHUSE.name, lake, 'fresh', 'en'))
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
    expect(speciesToast(l)?.message).toBe(said(NORDHUSE.name, lake, 'fresh'))
    setLang('en')
    await langReady()
    expect(speciesToast(l)?.message).toBe(said(NORDHUSE.name, lake, 'fresh', 'en'))
    expect(speciesToast(l)?.action?.label).toBe(STRINGS.en.undo)
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
  it('names the spot as it is called now, after a rename from another tab', async () => {
    const { root, l } = await mountCard({ ...NORDHUSE, waterType: 'fresh', species: [] })
    fetchButton(root, 'loc_species_nearby')!.click()
    await nextTick()
    const renamed = setup.locations.map((x) => ({ ...x, name: 'Nordhuse Vest' }))
    localStorage.setItem('fc2-setup', JSON.stringify({ locations: renamed, targetSpecies: ['torsk'], availability: [] }))
    setup.reloadLocal()
    await nextTick()
    expect(setup.locations[0]).not.toBe(l)
    expect(speciesToast(l)!.message.startsWith('Nordhuse Vest: ')).toBe(true)
  })

  it('Fortryd after a sync takes them off the spot as it is shown now', async () => {
    const { root, l } = await mountCard({ ...NORDHUSE, waterType: 'fresh', species: [] })
    fetchButton(root, 'loc_species_nearby')!.click()
    await nextTick()
    localStorage.setItem('fc2-setup', JSON.stringify({ locations: setup.locations, targetSpecies: ['torsk'], availability: [] }))
    setup.reloadLocal()
    await nextTick()
    expect(setup.locations[0]).not.toBe(l)
    runToastAction(speciesToast(l)!.id)
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
})
