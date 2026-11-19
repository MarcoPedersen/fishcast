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
import { langReady, setLang } from '@/lib/i18n'
import { useSetupStore } from '@/stores/setup'
import type { Availability } from '@/lib/types'
import AvailabilityView from './AvailabilityView.vue'

const da = STRINGS.da
const en = STRINGS.en

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined

beforeEach(() => { restoreDocument = installDocument() })
afterEach(() => {
  view?.unmount()
  view = undefined
  setLang('da')
  restoreDocument()
})

const WINDOWS: Availability[] = [
  { id: 'w1', days: [6, 0], from: '06:00', to: '12:00', methods: ['shore'] },
  { id: 'w2', days: [1], from: '22:00', to: '02:00', methods: ['boat', 'waders'] },
]

async function open(windows: Availability[] = WINDOWS): Promise<FakeNode> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useSetupStore().availability = structuredClone(windows)
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

/** A window's time fields: from, then to. */
const times = (card: FakeNode) => card.byTag('input').filter((i) => i.attrs.type === 'time')
/** What a window says under its fields: its warnings, then its night note. */
const said = (card: FakeNode) => [...card.byClass('warn'), ...card.byClass('note-overnight')].map((p) => p.textContent)
/** What the page says under the list, before Next. */
const blockers = (root: FakeNode) => root.byClass('blocker').map((p) => p.textContent)
const next = (root: FakeNode) => root.byClass('btn primary')[0]

/**
 * The round J review: a time field cleared, or a synced row's time that
 * reads as no time, said "Start- og sluttid må ikke være den samme", in the
 * window and under the list, though one of the times was not there at all.
 */
describe('a window with a time missing', () => {
  it('a cleared field: says to fill in both times, in the window and under the list', async () => {
    const root = await open()
    times(cards(root)[0])[1].input('')
    await nextTick()
    expect(said(cards(root)[0])).toEqual([`⚠️ ${da.avail_time_missing}`])
    expect(blockers(root)).toEqual([`⚠️ ${da.avail_missing_fix_before_next}`])
    expect(next(root).attrs.disabled).toBe(true)
    // Filled in again, all is well.
    times(cards(root)[0])[1].input('12:00')
    await nextTick()
    expect(said(cards(root)[0])).toEqual([])
    expect(blockers(root)).toEqual([])
    expect(next(root).attrs.disabled).toBe(false)
  })

  it('a time a synced row holds that reads as none says the same', async () => {
    const root = await open([{ ...WINDOWS[0], from: 'abc' }, { ...WINDOWS[1], to: undefined as unknown as string }])
    for (const c of cards(root)) expect(said(c)).toEqual([`⚠️ ${da.avail_time_missing}`])
    expect(blockers(root)).toEqual([`⚠️ ${da.avail_missing_fix_before_next}`])
  })

  it('the same start and end still say so, beside a window with a time missing', async () => {
    const root = await open([{ ...WINDOWS[0], to: '06:00' }, { ...WINDOWS[1], from: '' }])
    expect(said(cards(root)[0])).toEqual([`⚠️ ${da.avail_time_warn}`])
    expect(said(cards(root)[1])).toEqual([`⚠️ ${da.avail_time_missing}`])
    expect(blockers(root)).toEqual([`⚠️ ${da.avail_fix_before_next}`, `⚠️ ${da.avail_missing_fix_before_next}`])
    expect(next(root).attrs.disabled).toBe(true)
  })

  it('reads English', async () => {
    const root = await open([{ ...WINDOWS[0], from: '' }])
    setLang('en')
    await langReady()
    await nextTick()
    expect(said(cards(root)[0])).toEqual([`⚠️ ${en.avail_time_missing}`])
    expect(blockers(root)).toEqual([`⚠️ ${en.avail_missing_fix_before_next}`])
  })

  it('a message of its own, that speaks of no time being the same', () => {
    for (const s of [da, en]) {
      expect(s.avail_time_missing).toBeTruthy()
      expect(s.avail_missing_fix_before_next).toBeTruthy()
      expect(s.avail_time_missing + s.avail_missing_fix_before_next).not.toMatch(/samme|same|differ/i)
    }
  })
})

/**
 * The round J review: 22:00–00:00 said "🌙 Natvindue — slutter næste
 * morgen." It ends at midnight, not in the morning. A window that ends
 * later in the night keeps its note.
 */
describe('a window ending at midnight', () => {
  const MIDNIGHT: Availability[] = [{ ...WINDOWS[0], from: '22:00', to: '00:00' }, WINDOWS[1]]

  it('says it ends at midnight; one ending at 02:00 still ends in the morning', async () => {
    const root = await open(MIDNIGHT)
    expect(said(cards(root)[0])).toEqual([`🌙 ${da.avail_midnight}`])
    expect(said(cards(root)[1])).toEqual([`🌙 ${da.avail_overnight}`])
    expect(next(root).attrs.disabled).toBe(false)
    // Its end moved on past midnight, it is a night window again.
    times(cards(root)[0])[1].input('01:00')
    await nextTick()
    expect(said(cards(root)[0])).toEqual([`🌙 ${da.avail_overnight}`])
  })

  it('reads English', async () => {
    const root = await open(MIDNIGHT)
    setLang('en')
    await langReady()
    await nextTick()
    expect(said(cards(root)[0])).toEqual([`🌙 ${en.avail_midnight}`])
    expect(said(cards(root)[1])).toEqual([`🌙 ${en.avail_overnight}`])
  })

  it('speaks of midnight, not the morning', () => {
    expect(da.avail_midnight).toMatch(/midnat/i)
    expect(da.avail_midnight).not.toMatch(/morgen/i)
    expect(en.avail_midnight).toMatch(/midnight/i)
    expect(en.avail_midnight).not.toMatch(/morning/i)
  })
})
