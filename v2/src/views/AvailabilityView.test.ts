// @vitest-environment vue-dom
/**
 * Tidsvinduer, mounted, as a screen reader meets it. A day or a fishing
 * method showed it was on only by its colour, and the two time fields
 * were named by nothing: their "Fra" and "Til" were labels of no field.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'
import { STRINGS } from '@/test/strings'
import { useSetupStore } from '@/stores/setup'
import AvailabilityView from './AvailabilityView.vue'

const da = STRINGS.da

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined

beforeEach(() => { restoreDocument = installDocument() })
afterEach(() => {
  view?.unmount()
  view = undefined
  restoreDocument()
})

async function open(): Promise<FakeNode> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useSetupStore().availability = [
    { id: 'w1', days: [6, 0], from: '06:00', to: '12:00', methods: ['shore'] },
    { id: 'w2', days: [1], from: '22:00', to: '02:00', methods: ['boat', 'waders'] },
  ]
  const page = { render: () => null }
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/availability', name: 'availability', component: page },
    { path: '/', name: 'welcome', component: page },
    { path: '/locations', name: 'locations', component: page },
  ] })
  await router.push('/availability')
  view = mount(AvailabilityView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
  await nextTick()
  return view.root
}

/** Each window's card. */
const cards = (root: FakeNode) => root.byClass('avail')
/** What a screen reader says a button's state is: on, off, or nothing. */
const pressed = (b: FakeNode) => b.attrs['aria-pressed']
/** A field's accessible name: its aria-label, or the text of the label for it. */
function nameOf(root: FakeNode, field: FakeNode): string {
  if (typeof field.attrs['aria-label'] === 'string') return field.attrs['aria-label']
  const id = field.attrs.id
  const label = id ? root.byTag('label').find((l) => l.attrs.for === id) : undefined
  return label?.textContent ?? ''
}

describe('Tidsvinduer to a screen reader', () => {
  it('says which days are ticked, and follows a tap', async () => {
    const root = await open()
    const days = cards(root)[0].byClass('day')
    expect(days.map((d) => d.textContent)).toEqual([0, 1, 2, 3, 4, 5, 6].map((d) => da['day' + d]))
    expect(days.map(pressed)).toEqual([true, false, false, false, false, false, true])
    days[1].click()
    await nextTick()
    expect(pressed(cards(root)[0].byClass('day')[1])).toBe(true)
  })

  it('says which fishing methods are picked', async () => {
    const root = await open()
    const [first, second] = cards(root).map((c) => c.byClass('mbtn').map(pressed))
    expect(first).toEqual([true, false, false]) // shore, waders, boat
    expect(second).toEqual([false, true, true])
  })

  it('names each time field by its label, a field of its own in every window', async () => {
    const root = await open()
    const fields = root.byTag('input').filter((i) => i.attrs.type === 'time')
    expect(fields).toHaveLength(4)
    expect(fields.map((f) => nameOf(root, f))).toEqual([da.time_from, da.time_to, da.time_from, da.time_to])
    expect(new Set(fields.map((f) => f.attrs.id)).size).toBe(4)
  })
})
