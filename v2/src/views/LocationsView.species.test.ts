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
import { speciesEntry } from '@/lib/locationSpecies'
import { setLang, t } from '@/lib/i18n'
import { dismissToast, toasts } from '@/lib/toast'
import type { Location } from '@/lib/types'
import { useSetupStore } from '@/stores/setup'
import LocationsView from './LocationsView.vue'

// Custom spots: no official spot within 30 m, so the lookup is theirs (geo.ts speciesLookupFor).
const NORDHUSE = { name: 'Nordhuse', lat: 55.97, lon: 12.1 } // a pin in mid-Arresø
const HORNBAEK = { name: 'Hornbæk', lat: 56.09027, lon: 12.45693 }

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
