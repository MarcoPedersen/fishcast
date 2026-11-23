// @vitest-environment vue-dom
/**
 * The spot cards to a screen reader: each card's buttons said "Omdøb",
 * "📝 Note", "Arter her" and "Fjern lokation" whatever the spot, so in a
 * list of cards nothing said which spot a button was for. Each now names
 * its spot, without the emoji the visible text keeps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { FakeNode, installDocument, mount } from '@/test/fakeDom'
import { langReady, setLang, t } from '@/lib/i18n'
import { confirmCancel, confirmState } from '@/lib/confirm'
import { clearToasts, toasts } from '@/lib/toast'
import { SEARCH_DEBOUNCE_MS } from '@/lib/placeSearch'
import type { Location } from '@/lib/types'
import { useSetupStore } from '@/stores/setup'
import LocationsView from './LocationsView.vue'

const HORNBAEK = { name: 'Hornbæk', lat: 56.09027, lon: 12.45693 }
const NORDHUSE = { name: 'Nordhuse', lat: 55.97, lon: 12.1 }

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined
let pinia: ReturnType<typeof createPinia>
let setup: ReturnType<typeof useSetupStore>

async function mountCards(locs: Omit<Location, 'id'>[]): Promise<FakeNode> {
  pinia = createPinia()
  setActivePinia(pinia)
  setup = useSetupStore()
  setup.locations = locs.map((l, i) => ({ id: `sn${i}`, ...l }))
  const page = { render: () => null }
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/locations', name: 'locations', component: page }, { path: '/map', name: 'map', component: page },
  ] })
  await router.push('/locations')
  view = mount(LocationsView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
  await nextTick()
  return view.root
}
const card = (root: FakeNode, i = 0) => root.byClass('card loc')[i]
/** The buttons ✎, 📝, 🐟 and 🗑 of a card: what they show, and what a screen reader says. */
const acts = (root: FakeNode, i = 0) => card(root, i).byClass('loc-acts')[0].byTag('button')
const EMOJI = /\p{Extended_Pictographic}/u

beforeEach(() => { restoreDocument = installDocument() })
afterEach(() => {
  vi.restoreAllMocks()
  view?.unmount()
  view = undefined
  clearToasts()
  setLang('da')
  restoreDocument()
})

describe("the spot card's buttons name the spot", () => {
  it('in Danish, each card its own', async () => {
    const root = await mountCards([{ ...HORNBAEK, waterType: 'brackish' }, { ...NORDHUSE, waterType: 'fresh' }])
    expect(acts(root, 0).map((b) => b.attrs['aria-label']))
      .toEqual(['Omdøb Hornbæk', 'Note til Hornbæk', 'Arter ved Hornbæk', 'Fjern Hornbæk'])
    expect(acts(root, 1).map((b) => b.attrs['aria-label']))
      .toEqual(['Omdøb Nordhuse', 'Note til Nordhuse', 'Arter ved Nordhuse', 'Fjern Nordhuse'])
  })

  it('in English', async () => {
    const root = await mountCards([{ ...HORNBAEK, waterType: 'brackish' }])
    setLang('en')
    await langReady()
    setActivePinia(pinia)
    await nextTick()
    expect(acts(root).map((b) => b.attrs['aria-label']))
      .toEqual(['Rename Hornbæk', 'Note for Hornbæk', 'Species at Hornbæk', 'Remove Hornbæk'])
  })

  it('without emoji, while the buttons show what they showed', async () => {
    const root = await mountCards([{ ...HORNBAEK, waterType: 'brackish' }])
    for (const b of acts(root)) expect(b.attrs['aria-label'], String(b.attrs['aria-label'])).not.toMatch(EMOJI)
    expect(acts(root).map((b) => b.textContent)).toEqual(['✎', '📝', '🐟', '🗑'])
    expect(acts(root).map((b) => b.attrs.title)).toEqual([t('rename'), t('note_label'), t('loc_species'), t('loc_remove')])
  })

  it('follow a new name', async () => {
    const root = await mountCards([{ ...HORNBAEK, waterType: 'brackish' }])
    setup.locations[0].name = 'Hornbæk Havn'
    await nextTick()
    expect(acts(root)[0].attrs['aria-label']).toBe('Omdøb Hornbæk Havn')
  })
})

/** The delete confirm said "Fjern denne lokation?": now it says which. */
describe('the delete confirm names the spot', () => {
  /** Taps 🗑 on the card and reads the question it asks. */
  async function asked(root: FakeNode, i = 0): Promise<string> {
    acts(root, i)[3].click()
    await nextTick()
    const said = confirmState.message
    confirmCancel()
    await nextTick()
    return said
  }

  it('in Danish', async () => {
    const root = await mountCards([{ ...HORNBAEK, waterType: 'brackish' }, { ...NORDHUSE, waterType: 'fresh' }])
    expect(await asked(root, 1)).toBe('Fjern Nordhuse? Dens arter og noter forsvinder også.')
    expect(setup.locations).toHaveLength(2)
  })

  it('in English', async () => {
    const root = await mountCards([{ ...HORNBAEK, waterType: 'brackish' }])
    setLang('en')
    await langReady()
    setActivePinia(pinia)
    await nextTick()
    expect(await asked(root)).toBe('Remove Hornbæk? Its species and notes go too.')
  })
})

/** The note field had its placeholder alone to say what it was for. */
describe('the note field names the spot', () => {
  /** Taps 📝 and returns the field it opens. */
  async function openNote(root: FakeNode, i = 0): Promise<FakeNode> {
    acts(root, i)[1].click()
    await nextTick()
    return card(root, i).byTag('textarea')[0]
  }

  it('in Danish', async () => {
    const root = await mountCards([{ ...HORNBAEK, waterType: 'brackish' }, { ...NORDHUSE, waterType: 'fresh' }])
    expect((await openNote(root, 1)).attrs['aria-label']).toBe('Note til Nordhuse')
  })

  it('in English', async () => {
    const root = await mountCards([{ ...HORNBAEK, waterType: 'brackish' }])
    setLang('en')
    await langReady()
    setActivePinia(pinia)
    await nextTick()
    expect((await openNote(root)).attrs['aria-label']).toBe('Note for Hornbæk')
  })
})

/**
 * A search result picked went to the end of the list with nothing said,
 * and one already saved did nothing at all once the box was cleared.
 */
describe('picking a search result says what it did', () => {
  const KOGE = { name: 'Køge', admin1: 'Region Sjælland', latitude: 55.45802, longitude: 12.18214, country_code: 'DK' }
  const SAVED = { name: 'Køge, Region Sjælland', lat: 55.45802, lon: 12.18214, waterType: 'salt' as const }
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ results: [KOGE] }) })))
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
  /** Searches for Køge and taps its result. */
  async function pickKoge(root: FakeNode) {
    root.byTag('input').find((x) => x.attrs.type === 'search')!.input('Køge')
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 20)
    await nextTick()
    root.byClass('result')[0].click()
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
  }
  const said = () => toasts.value.map((x) => x.message)

  it('a new place is added, and the toast says so', async () => {
    const root = await mountCards([{ ...HORNBAEK, waterType: 'brackish' }])
    await pickKoge(root)
    expect(setup.locations.map((l) => l.name)).toEqual(['Hornbæk', 'Køge, Region Sjælland'])
    expect(said()).toEqual(['Køge er tilføjet.'])
  })

  it('a place already saved is not added twice, and the toast says it is there', async () => {
    const root = await mountCards([{ ...HORNBAEK, waterType: 'brackish' }, SAVED])
    await pickKoge(root)
    expect(setup.locations).toHaveLength(2)
    expect(said()).toEqual(['Køge er allerede på listen.'])
  })

  it('in English', async () => {
    const root = await mountCards([{ ...HORNBAEK, waterType: 'brackish' }])
    setLang('en')
    await langReady()
    setActivePinia(pinia)
    await pickKoge(root)
    expect(said()).toEqual(['Added Køge.'])
    await pickKoge(root)
    expect(said()).toEqual(['Added Køge.', 'Køge is already on the list.'])
  })
})
