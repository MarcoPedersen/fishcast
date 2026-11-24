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
  // Monday first, as a Danish week is. The days were listed Sunday first,
  // so a weekend window (a new window's default) had Lør and Søn at the two
  // ends of the row. Only the order on screen changed: a window still stores
  // Date.getDay()'s numbers, Sunday 0.
  it('says which days are ticked, Monday first, and follows a tap', async () => {
    const root = await open()
    const days = cards(root)[0].byClass('day')
    expect(days.map((d) => d.textContent)).toEqual([1, 2, 3, 4, 5, 6, 0].map((d) => da['day' + d]))
    expect(days.map(pressed)).toEqual([false, false, false, false, false, true, true]) // Lør, Søn
    days[0].click() // Man
    await nextTick()
    expect(pressed(cards(root)[0].byClass('day')[0])).toBe(true)
    expect(useSetupStore().availability[0].days).toEqual([6, 0, 1])
  })

  it('a new window, Saturday and Sunday, has them side by side at the end', async () => {
    const root = await open([])
    root.byClass('btn ghost').find((b) => b.textContent === da.avail_add)!.click()
    await nextTick()
    expect(cards(root)[0].byClass('day').map(pressed)).toEqual([false, false, false, false, false, true, true])
    expect(useSetupStore().availability[0].days).toEqual([6, 0])
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

  // The round T sweep: the fields read "Fra, Til, Fra, Til" across two
  // windows, and the day buttons the same in every window; only the 🗑 said
  // which window it was in. Each card is now a group named by its heading,
  // which a screen reader says as it enters the window.
  it('each window is a group, named by its own "Tidsvindue N"', async () => {
    const root = await open()
    for (const [i, c] of cards(root).entries()) {
      expect(c.attrs.role, `window ${i + 1}`).toBe('group')
      const id = c.attrs['aria-labelledby']
      const heads = root.findAll((n) => n.attrs.id === id)
      expect(heads, `window ${i + 1}`).toHaveLength(1)
      expect(heads[0].textContent).toBe(`${da.avail_window} ${i + 1}`)
      expect(c.findAll((n) => n === heads[0])).toHaveLength(1) // in its own card
    }
    const ids = root.findAll((n) => n.attrs.id != null).map((n) => n.attrs.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

/**
 * The round T sweep: a tap on the only fishing method a window had left did
 * nothing and said nothing. It stayed pressed, and "Mindst én metode skal
 * være valgt" was in the strings but on no screen. The tap is still refused;
 * the window now says why, in a status line a screen reader reads as it
 * fills. The next change to the windows clears it.
 */
describe('the last fishing method of a window', () => {
  /** A window's status lines, by their text. */
  const status = (card: FakeNode) => card.findAll((n) => n.attrs.role === 'status').map((s) => s.textContent)
  const methodsOf = (card: FakeNode) => card.byClass('mbtn')
  const refused = `⚠️ ${da.method_required}`

  it('a tap on it is refused, and that window says why', async () => {
    const root = await open()
    // There from the start and empty, so a screen reader hears it fill.
    expect(cards(root).map(status)).toEqual([[''], ['']])
    methodsOf(cards(root)[0])[0].click() // shore, its only method
    await nextTick()
    expect(useSetupStore().availability[0].methods).toEqual(['shore'])
    expect(pressed(methodsOf(cards(root)[0])[0])).toBe(true)
    expect(cards(root).map(status)).toEqual([[refused], ['']])
  })

  it('a method let go while another stays picked says nothing', async () => {
    const root = await open()
    methodsOf(cards(root)[1])[2].click() // boat, waders stays
    await nextTick()
    expect(useSetupStore().availability[1].methods).toEqual(['waders'])
    expect(cards(root).map(status)).toEqual([[''], ['']])
  })

  it('the next change clears it: a method, a day or a time', async () => {
    const root = await open()
    const refuse = async () => {
      methodsOf(cards(root)[0])[0].click()
      await nextTick()
      expect(status(cards(root)[0])).toEqual([refused])
    }
    await refuse()
    methodsOf(cards(root)[0])[1].click() // waders picked
    await nextTick()
    expect(useSetupStore().availability[0].methods).toEqual(['shore', 'waders'])
    expect(status(cards(root)[0])).toEqual([''])
    methodsOf(cards(root)[0])[1].click() // and let go: shore is the only one again
    await nextTick()
    await refuse()
    cards(root)[1].byClass('day')[0].click() // a day, in the other window
    await nextTick()
    expect(status(cards(root)[0])).toEqual([''])
    await refuse()
    times(cards(root)[0])[0].input('05:00')
    await nextTick()
    expect(status(cards(root)[0])).toEqual([''])
  })

  it('reads English', async () => {
    const root = await open()
    setLang('en')
    await langReady()
    methodsOf(cards(root)[0])[0].click()
    await nextTick()
    expect(status(cards(root)[0])).toEqual([`⚠️ ${en.method_required}`])
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
 * morgen." It ends at midnight, not in the morning. The round L review: so
 * did a window that ends at 00:30, 01:00 or 03:00. The note now goes by the
 * hour a window ends: at midnight, in the night (up to and including 04:00),
 * or the next morning.
 */
describe('a night window says when it ends', () => {
  const MIDNIGHT: Availability[] = [{ ...WINDOWS[0], from: '22:00', to: '00:00' }, WINDOWS[1]]

  it('at midnight; one ending at 02:00 ends in the night', async () => {
    const root = await open(MIDNIGHT)
    expect(said(cards(root)[0])).toEqual([`🌙 ${da.avail_midnight}`])
    expect(said(cards(root)[1])).toEqual([`🌙 ${da.avail_night}`])
    expect(next(root).attrs.disabled).toBe(false)
  })

  it('follows its end as it moves through the night and into the morning', async () => {
    const root = await open(MIDNIGHT)
    const notes: Record<string, string> = {}
    for (const to of ['00:00', '00:30', '01:00', '03:00', '04:00', '04:30', '06:00', '09:00']) {
      times(cards(root)[0])[1].input(to)
      await nextTick()
      notes[to] = said(cards(root)[0]).join(' | ')
    }
    const midnight = `🌙 ${da.avail_midnight}`, night = `🌙 ${da.avail_night}`, morning = `🌙 ${da.avail_overnight}`
    expect(notes).toEqual({
      '00:00': midnight, '00:30': night, '01:00': night, '03:00': night, '04:00': night,
      '04:30': morning, '06:00': morning, '09:00': morning,
    })
  })

  it('reads English', async () => {
    const root = await open([...MIDNIGHT, { ...WINDOWS[1], id: 'w3', to: '06:00' }])
    setLang('en')
    await langReady()
    await nextTick()
    expect(cards(root).map(said)).toEqual([[`🌙 ${en.avail_midnight}`], [`🌙 ${en.avail_night}`], [`🌙 ${en.avail_overnight}`]])
  })

  it('speaks of midnight, the night or the morning, each its own', () => {
    expect(da.avail_midnight).toMatch(/midnat/i)
    expect(da.avail_midnight).not.toMatch(/morgen/i)
    expect(en.avail_midnight).toMatch(/midnight/i)
    expect(en.avail_midnight).not.toMatch(/morning/i)
    expect(da.avail_night).toMatch(/natten/i)
    expect(da.avail_night).not.toMatch(/morgen|midnat/i)
    expect(en.avail_night).toMatch(/night/i)
    expect(en.avail_night).not.toMatch(/morning|midnight/i)
    expect(da.avail_overnight).toMatch(/morgen/i)
    expect(en.avail_overnight).toMatch(/morning/i)
  })

  it('the night note ends as the others do: it is fine', () => {
    expect(da.avail_night).toMatch(/\. Det er helt fint\.$/)
    expect(en.avail_night).toMatch(/\. That’s fine\.$/)
  })
})
