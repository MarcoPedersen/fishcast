// @vitest-environment vue-dom
/**
 * The toast stack, as mounted on the in-memory DOM. Over the cap, a toast
 * that stays until it is used or closed waits out of sight for room
 * (lib/toast). A short line over the stack says how many wait: with none to
 * see, a spot's Fortryd that waited read as lost, as in the round F check.
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
  })
})
