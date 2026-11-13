// @vitest-environment vue-dom
/**
 * The spot card's rename, as mounted. ✎ put a field where the name was, but
 * not the cursor: on a phone it took a second tap before the keyboard came
 * up (round D's e2e). The field takes focus as it opens, with the name
 * selected, so typing replaces it. Enter and leaving the field keep the new
 * name; Escape keeps the old one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { FakeNode, installDocument, mount } from '@/test/fakeDom'
import { t } from '@/lib/i18n'
import type { Location } from '@/lib/types'
import { useSetupStore } from '@/stores/setup'
import LocationsView from './LocationsView.vue'

const HORNBAEK = { name: 'Hornbæk', lat: 56.09027, lon: 12.45693 }

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined

async function mountCard(): Promise<{ root: FakeNode; l: Location }> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const setup = useSetupStore()
  setup.locations = [{ id: 'rn1', ...HORNBAEK, waterType: 'salt' }]
  const page = { render: () => null }
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/locations', name: 'locations', component: page }, { path: '/map', name: 'map', component: page },
  ] })
  await router.push('/locations')
  view = mount(LocationsView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
  await nextTick()
  return { root: view.root, l: setup.locations[0] }
}
const field = (root: FakeNode): FakeNode | undefined => root.byClass('rename')[0]
/** Taps ✎ and lets the field render. */
async function openRename(root: FakeNode): Promise<FakeNode> {
  root.byTag('button').find((b) => b.attrs['aria-label'] === t('rename'))!.click()
  await nextTick()
  return field(root)!
}
/** A whole press of Enter in the field: the key goes down, then comes up. */
function pressEnter(input: FakeNode) {
  input.dispatch('keydown', { key: 'Enter' })
  input.dispatch('keyup', { key: 'Enter' })
}

beforeEach(() => { restoreDocument = installDocument() })
afterEach(() => {
  vi.restoreAllMocks()
  view?.unmount()
  view = undefined
  restoreDocument()
})

describe('renaming a spot on its card', () => {
  it('✎ opens the field with the cursor in it and the name selected', async () => {
    const focused: FakeNode[] = []
    const selected: string[] = []
    vi.spyOn(FakeNode.prototype, 'focus').mockImplementation(function (this: FakeNode) { focused.push(this) })
    vi.spyOn(FakeNode.prototype, 'select').mockImplementation(function (this: FakeNode) { selected.push(String(this.value)) })
    const { root } = await mountCard()
    expect(field(root)).toBeUndefined()
    const input = await openRename(root)
    expect(focused).toEqual([input])
    // Selected once the field holds the name: selected while still empty,
    // the name filled in after would leave nothing selected.
    expect(selected).toEqual(['Hornbæk'])
  })

  // A keyboard's Enter clicks ✎ as the key goes down. The field opens and
  // takes focus at once, so the same key coming back up lands in the field.
  // That is not the Enter that saves: the field shut as it opened.
  it('Enter on ✎ opens the field, and the key coming back up leaves it open', async () => {
    const focused: FakeNode[] = []
    vi.spyOn(FakeNode.prototype, 'focus').mockImplementation(function (this: FakeNode) { focused.push(this) })
    const { root, l } = await mountCard()
    const pen = root.byTag('button').find((b) => b.attrs['aria-label'] === t('rename'))!
    // The second time comes after a name saved with Enter in the field.
    for (const name of ['Hornbæk', 'Nordstranden']) {
      focused.length = 0
      pen.dispatch('keydown', { key: 'Enter' })
      pen.click() // what a button does as Enter goes down
      await nextTick()
      const input = field(root)!
      expect(focused).toEqual([input])
      input.dispatch('keyup', { key: 'Enter' }) // the release goes where the focus is now
      await nextTick()
      expect(field(root)).toBe(input)
      expect(l.name).toBe(name)
      input.input('Nordstranden')
      pressEnter(input)
      await nextTick()
      expect(field(root)).toBeUndefined()
      expect(l.name).toBe('Nordstranden')
    }
  })

  it('Enter and leaving the field keep the new name; Escape keeps the old', async () => {
    const { root, l } = await mountCard()
    let input = await openRename(root)
    input.input('Nordstranden')
    pressEnter(input)
    await nextTick()
    expect(field(root)).toBeUndefined()
    expect(l.name).toBe('Nordstranden')

    input = await openRename(root)
    expect(input.value).toBe('Nordstranden')
    input.input('Sydstranden')
    input.dispatch('keydown', { key: 'Escape' })
    await nextTick()
    expect(field(root)).toBeUndefined()
    expect(l.name).toBe('Nordstranden')

    input = await openRename(root)
    input.input('Vesthavn')
    input.dispatch('blur')
    await nextTick()
    expect(field(root)).toBeUndefined()
    expect(l.name).toBe('Vesthavn')
  })
})
