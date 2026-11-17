// @vitest-environment vue-dom
/**
 * The toast stack, as mounted on the in-memory DOM. Over the cap, a toast
 * that stays until it is used or closed waits out of sight for room
 * (lib/toast). A short line over the stack says how many wait: with none to
 * see, a spot's Fortryd that waited read as lost, as in the round F check.
 * A tap on the line brings one forward.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'
import { clearToasts, showToast } from '@/lib/toast'
import { langReady, setLang } from '@/lib/i18n'
import { STRINGS } from '@/test/strings'
import Toasts from './Toasts.vue'

// The in-memory DOM has no classes to animate nor a layout to measure: the
// group renders as its plain tag, the toasts in it.
vi.mock('vue', async (importOriginal) => {
  const vue = await importOriginal<typeof import('vue')>()
  const TransitionGroup = vue.defineComponent({
    props: { tag: { type: String, default: 'div' }, name: String },
    setup: (props, { slots }) => () => vue.h(props.tag, slots.default?.()),
  })
  return { ...vue, TransitionGroup }
})

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined

beforeEach(() => {
  restoreDocument = installDocument()
  view = mount(Toasts)
})
afterEach(() => {
  view?.unmount()
  view = undefined
  clearToasts()
  setLang('da')
  restoreDocument()
})

const root = () => view!.root
const said = (r: FakeNode) => r.byClass('toast').map((x) => x.byClass('msg')[0].textContent)
const note = (r: FakeNode) => r.byClass('toasts-waiting').map((x) => x.textContent)
const line = (r: FakeNode) => r.byClass('toasts-waiting')[0]
const undo = () => ({ label: 'Fortryd', run: vi.fn() })

describe('the toast stack', () => {
  it('shows no line while none wait', async () => {
    for (const m of ['a', 'b', 'c']) showToast(m, { action: undo() })
    await nextTick()
    expect(said(root())).toEqual(['a', 'b', 'c'])
    expect(note(root())).toEqual([])
  })

  it('shows three, and over them how many wait', async () => {
    for (const m of ['a', 'b', 'c', 'd', 'e']) showToast(m, { action: undo() })
    await nextTick()
    expect(said(root())).toEqual(['c', 'd', 'e'])
    expect(note(root())).toEqual([STRINGS.da.toast_waiting.replace('{n}', '2')])
    // Over the stack: the first thing in it.
    expect(root().byClass('toasts')[0].elements[0].hasClass('toasts-waiting')).toBe(true)
  })

  it('one closed with ✕ brings the newest waiting back, and the line counts down, then goes', async () => {
    for (const m of ['a', 'b', 'c', 'd', 'e']) showToast(m, { action: undo() })
    await nextTick()
    root().byClass('toast')[2].byClass('x')[0].click()
    await nextTick()
    expect(said(root())).toEqual(['b', 'c', 'd'])
    expect(note(root())).toEqual([STRINGS.da.toast_waiting.replace('{n}', '1')])
    root().byClass('toast')[0].byClass('x')[0].click()
    await nextTick()
    expect(said(root())).toEqual(['a', 'c', 'd'])
    expect(note(root())).toEqual([])
  })

  it('reads English', async () => {
    for (const m of ['a', 'b', 'c', 'd']) showToast(m, { action: undo() })
    setLang('en')
    await langReady()
    await nextTick()
    expect(note(root())).toEqual([STRINGS.en.toast_waiting.replace('{n}', '1')])
    expect(line(root()).attrs['aria-label']).toBe(STRINGS.en.toast_waiting_label.replace('{n}', '1'))
  })
})

/**
 * The round G browser check: the line only said how many waited, and the
 * way to a waiting spot's Fortryd was to use up or close a newer toast (✕
 * forgets that spot's history). The line is now a button: a tap brings the
 * newest waiting toast forward, and the oldest shown toast that stays waits
 * in its place (lib/toast showNextWaiting).
 */
describe('the line over the stack', () => {
  it('is a button that brings the newest waiting toast forward, while the oldest shown waits', async () => {
    for (const m of ['a', 'b', 'c', 'd', 'e']) showToast(m, { action: undo() })
    await nextTick()
    expect(line(root()).tag).toBe('button')
    expect(line(root()).attrs.type).toBe('button')
    line(root()).click()
    await nextTick()
    expect(said(root())).toEqual(['b', 'd', 'e'])
    // A swap: as many wait as before.
    expect(note(root())).toEqual([STRINGS.da.toast_waiting.replace('{n}', '2')])
  })

  it('taps in a row go through every waiting toast, then back to the start', async () => {
    for (const m of ['a', 'b', 'c', 'd', 'e']) showToast(m, { action: undo() })
    await nextTick()
    const seen: string[][] = []
    for (let i = 0; i < 3; i++) {
      line(root()).click()
      await nextTick()
      seen.push(said(root()))
    }
    expect(seen).toEqual([['b', 'd', 'e'], ['a', 'd', 'e'], ['c', 'd', 'e']])
  })

  it('the toast brought forward has its own Fortryd and ✕', async () => {
    const runs = ['a', 'b', 'c', 'd'].map(() => vi.fn())
    ;['a', 'b', 'c', 'd'].forEach((m, i) => showToast(m, { action: { label: 'Fortryd', run: runs[i] } }))
    await nextTick()
    line(root()).click()
    await nextTick()
    expect(said(root())).toEqual(['a', 'c', 'd'])
    root().byClass('toast')[0].byClass('act')[0].click()
    await nextTick()
    expect(runs[0]).toHaveBeenCalledOnce()
    expect(said(root())).toEqual(['b', 'c', 'd'])
    expect(note(root())).toEqual([])
  })

  // Its name starts with what it shows (a voice command says what it sees),
  // then says what a tap does.
  it('has a name that says how many wait and what a tap does', async () => {
    for (const m of ['a', 'b', 'c', 'd']) showToast(m, { action: undo() })
    await nextTick()
    const name = STRINGS.da.toast_waiting_label.replace('{n}', '1')
    expect(line(root()).attrs['aria-label']).toBe(name)
    expect(line(root()).attrs.title).toBe(name)
    expect(name.startsWith(line(root()).textContent)).toBe(true)
    expect(name.length).toBeGreaterThan(line(root()).textContent.length)
    for (const lang of ['da', 'en']) {
      expect(STRINGS[lang].toast_waiting_label.startsWith(STRINGS[lang].toast_waiting), lang).toBe(true)
    }
    // "plads" is a fishing spot in the app's Danish.
    expect(STRINGS.da.toast_waiting + STRINGS.da.toast_waiting_label).not.toMatch(/plads/i)
  })
})
