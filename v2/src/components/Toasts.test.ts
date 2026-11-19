// @vitest-environment vue-dom
/**
 * The toast stack, as mounted on the in-memory DOM. Over the cap, a toast
 * that stays until it is used or closed waits out of sight for room
 * (lib/toast). A short line over the stack says how many wait: with none to
 * see, a spot's Fortryd that waited read as lost, as in the round F check.
 * A tap on the line brings one forward.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, type VNode } from 'vue'
import { FakeNode, installDocument, mount } from '@/test/fakeDom'
import { clearToasts, dismissKeyed, dismissToast, showToast, toasts } from '@/lib/toast'
import { langReady, setLang } from '@/lib/i18n'
import { STRINGS } from '@/test/strings'
import Toasts from './Toasts.vue'

/**
 * What the group was asked to do, as a real TransitionGroup works from it:
 * its name at the last render, and each toast (or the line) that left, by
 * key, under the name it left with. Its before-leave hook has run on it,
 * where the real group runs it: the element still in its place. Its fade
 * ends at once (after-leave), unless `slow`: then it ends at end(). The
 * before-enter hook runs for each that comes, after those that leave.
 */
const group = vi.hoisted(() => ({
  name: undefined as string | undefined,
  left: [] as { key: unknown; name?: string }[],
  slow: false,
  fading: [] as (() => void)[],
  end() { for (const after of this.fading.splice(0)) after() },
}))

// The in-memory DOM has no classes to animate nor a layout to measure: the
// group renders as its plain tag, the toasts in it.
vi.mock('vue', async (importOriginal) => {
  const vue = await importOriginal<typeof import('vue')>()
  // The keyed children, the v-for's toasts out of their fragment, as the real group reads them.
  const keyed = (ns: VNode[]): VNode[] =>
    ns.flatMap((n) => (n.type === vue.Fragment ? keyed(n.children as VNode[]) : [n])).filter((n) => n.key != null)
  const TransitionGroup = vue.defineComponent({
    props: { tag: { type: String, default: 'div' }, name: String },
    setup: (props, { slots, attrs }) => {
      let was: VNode[] = []
      return () => {
        const out = slots.default?.() ?? []
        const now = keyed(out)
        type Hook = ((el: unknown) => void) | undefined
        for (const v of was.filter((v) => v.el && !now.some((n) => n.key === v.key))) {
          ;(attrs.onBeforeLeave as Hook)?.(v.el)
          group.left.push({ key: v.key, name: props.name })
          const after = () => (attrs.onAfterLeave as Hook)?.(v.el)
          if (group.slow) group.fading.push(after)
          else after()
        }
        for (const v of now.filter((n) => !was.some((w) => w.key === n.key))) (attrs.onBeforeEnter as Hook)?.(v.el)
        was = now
        group.name = props.name
        return vue.h(props.tag, out)
      }
    },
  })
  return { ...vue, TransitionGroup }
})

const source = import.meta.glob<string>('/src/components/Toasts.vue', { query: '?raw', import: 'default', eager: true })['/src/components/Toasts.vue']
/** The declarations the stylesheet gives `selector`, outside @media blocks and with it, joined. */
const decls = (selector: string) => [...(source.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? '')
  .replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((m) => m[1].split(',').map((s) => s.trim()).includes(selector)).map((m) => m[2].trim()).join(' ')

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
  vi.restoreAllMocks()
  group.left.length = 0
  group.slow = false
  group.fading.length = 0
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

const idOf = (message: string) => toasts.value.find((x) => x.message === message)!.id
/** Gives a fake element the box a browser would measure: a toast 60 px tall in a stack 226 px tall. */
const boxed = (el: FakeNode, top: number, stack = 226) => {
  root().byClass('toasts')[0].offsetHeight = stack
  return Object.assign(el, { offsetTop: top, offsetLeft: 0, offsetWidth: 440, offsetHeight: 60 })
}
/** The line's box: 22 px tall and 120 wide, centred, at the top of the stack. */
const boxedLine = () => Object.assign(line(root()), { offsetTop: 0, offsetLeft: 160, offsetWidth: 120, offsetHeight: 22 })

/**
 * The round H review: for 0.25 s after a tap the line jumped up by about a
 * toast's height. The group kept the toast sent to wait in the stack's flow
 * while it faded (.toast-leave-active is not out of the flow), so the stack
 * held it and the one brought forward at once, and grew upwards from the
 * bottom of the screen. In a swap, the one sent to wait now fades where it
 * stood, out of the flow, and the one brought forward fades in.
 */
describe('a tap swaps calmly', () => {
  // Held from the stack's bottom edge, which stays put on screen: the stack
  // grows upwards from the bottom.
  it('the toast sent to wait leaves under the swap\'s name, held where it stood', async () => {
    for (const m of ['a', 'b', 'c', 'd']) showToast(m, { action: undo() })
    await nextTick()
    const b = boxed(root().byClass('toast')[0], 30)
    const c = boxed(root().byClass('toast')[1], 98)
    line(root()).click()
    await nextTick()
    expect(said(root())).toEqual(['a', 'c', 'd'])
    expect(group.left).toEqual([{ key: idOf('b'), name: 'toast-swap' }])
    expect(b.style).toEqual({ bottom: '136px', left: '0px', width: '440px' })
    expect(c.style).toEqual({}) // it stays: nothing to hold
  })

  it('out of the flow, it takes no tap, and the two fade in place; those between slide', () => {
    const leave = decls('.toast-swap-leave-active')
    expect(leave).toMatch(/position:\s*absolute/)
    expect(leave).toMatch(/pointer-events:\s*none/)
    expect(leave).toMatch(/transition:\s*opacity/)
    expect(decls('.toast-swap-enter-active')).toMatch(/transition:\s*opacity/)
    expect(decls('.toast-swap-enter-from')).toMatch(/opacity:\s*0/)
    expect(decls('.toast-swap-leave-to')).toMatch(/opacity:\s*0/)
    expect(decls('.toast-swap-enter-from') + decls('.toast-swap-leave-to')).not.toMatch(/transform/)
    expect(decls('.toast-swap-move')).toMatch(/transition:\s*transform/)
  })

  // Only a swap: a toast closed, its time up or used with nothing coming in
  // its place still fades in the flow, sliding down as before.
  it('only for the swap: after it the stack\'s own name is back, and a lone ✕ leaves as before', async () => {
    for (const m of ['a', 'b', 'c', 'd']) showToast(m, { action: undo() })
    await nextTick()
    line(root()).click()
    await nextTick()
    await nextTick()
    expect(group.name).toBe('toast')
    dismissToast(idOf('b')) // the one waiting: none comes back for the ✕ below
    await nextTick()
    const c = boxed(root().byClass('toast')[1], 150)
    const cId = idOf('c')
    c.byClass('x')[0].click()
    await nextTick()
    expect(group.left.at(-1)).toEqual({ key: cId, name: 'toast' })
    expect(c.style).toEqual({})
    expect(decls('.toast-leave-active')).not.toMatch(/position/)
    expect(decls('.toast-leave-to')).toMatch(/translateY/)
  })
})

/**
 * Round I's probe, with Vue's real TransitionGroup: the same jump came
 * whenever a toast left while another came in. ✕, Fortryd or its time up
 * while one waited (it came back), or a new toast that sent one to wait. The
 * one leaving stayed in the flow for its fade, and the stack held both: 226
 * px, 294 during the fade, then 196 or 226. Every such change is now a swap:
 * what leaves fades where it stood, out of the flow, as in a tap's swap.
 */
describe('a toast that leaves while another comes leaves calmly', () => {
  it('✕ while one waits: the toast closed and the line go under the swap\'s name, held where they stood', async () => {
    for (const m of ['a', 'b', 'c', 'd']) showToast(m, { action: undo() })
    await nextTick()
    const lineEl = boxedLine()
    const c = boxed(root().byClass('toast')[1], 98)
    const cId = idOf('c')
    c.byClass('x')[0].click()
    await nextTick()
    expect(said(root())).toEqual(['a', 'b', 'd'])
    expect(group.left).toEqual([{ key: 'waiting', name: 'toast-swap' }, { key: cId, name: 'toast-swap' }])
    expect(lineEl.style).toEqual({ bottom: '204px', left: '160px', width: '120px' })
    expect(c.style).toEqual({ bottom: '68px', left: '0px', width: '440px' })
  })

  it('Fortryd while two wait: the toast used goes under the swap\'s name, and the line stays', async () => {
    const runs = ['a', 'b', 'c', 'd', 'e'].map(() => vi.fn())
    ;['a', 'b', 'c', 'd', 'e'].forEach((m, i) => showToast(m, { action: { label: 'Fortryd', run: runs[i] } }))
    await nextTick()
    const d = boxed(root().byClass('toast')[1], 98)
    const dId = idOf('d')
    d.byClass('act')[0].click()
    await nextTick()
    expect(runs[3]).toHaveBeenCalledOnce()
    expect(said(root())).toEqual(['b', 'c', 'e'])
    expect(group.left).toEqual([{ key: dId, name: 'toast-swap' }])
    expect(d.style).toEqual({ bottom: '68px', left: '0px', width: '440px' })
  })

  it('time up while one waits: the toast whose time is up goes under the swap\'s name', async () => {
    vi.useFakeTimers()
    try {
      for (const m of ['a', 'b', 'c', 'd']) showToast(m, { action: undo() })
      showToast('passing', { type: 'error' }) // b waits for it
      await nextTick()
      expect(said(root())).toEqual(['c', 'd', 'passing'])
      const passing = boxed(root().byClass('toast')[2], 166)
      const id = idOf('passing')
      vi.advanceTimersByTime(6000)
      await nextTick()
      expect(said(root())).toEqual(['b', 'c', 'd'])
      expect(group.left).toEqual([{ key: id, name: 'toast-swap' }])
      expect(passing.style).toEqual({ bottom: '0px', left: '0px', width: '440px' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('a new toast that sends one to wait: that one goes under the swap\'s name, held where it stood', async () => {
    for (const m of ['a', 'b', 'c']) showToast(m, { action: undo() })
    await nextTick()
    const a = boxed(root().byClass('toast')[0], 0, 196)
    const aId = idOf('a')
    showToast('d', { action: undo() })
    await nextTick()
    expect(said(root())).toEqual(['b', 'c', 'd'])
    expect(note(root())).toEqual([STRINGS.da.toast_waiting.replace('{n}', '1')])
    expect(group.left).toEqual([{ key: aId, name: 'toast-swap' }])
    expect(a.style).toEqual({ bottom: '136px', left: '0px', width: '440px' })
  })

  // A spot's passing word said again with its Fortryd (the same key): it
  // stays now, and takes the room of one that stays. Only the line comes.
  it('a toast that turns into one that stays sends one to wait: only the line comes, and that one goes calmly', async () => {
    for (const m of ['a', 'b', 'c']) showToast(m, { action: undo() })
    showToast('fetching', { key: 'spot' })
    await nextTick()
    const a = boxed(root().byClass('toast')[0], 0, 264)
    const aId = idOf('a')
    showToast('fetched', { key: 'spot', action: undo() })
    await nextTick()
    expect(said(root())).toEqual(['b', 'c', 'fetched'])
    expect(note(root())).toEqual([STRINGS.da.toast_waiting.replace('{n}', '1')])
    expect(group.left).toEqual([{ key: aId, name: 'toast-swap' }])
    expect(a.style).toEqual({ bottom: '204px', left: '0px', width: '440px' })
  })

  // Nothing comes in its place: the stack never holds more than it did, and
  // the line has nowhere to jump. The plain exit stays as it was.
  it('a toast that goes with nothing coming keeps the plain exit, and so does the line', async () => {
    vi.useFakeTimers()
    try {
      for (const m of ['a', 'b', 'c']) showToast(m, { key: m, action: undo() })
      showToast('passing', {}) // a passing notice: a fourth, and none waits
      await nextTick()
      const b = boxed(root().byClass('toast')[1], 68, 264)
      const bId = idOf('b')
      b.byClass('x')[0].click()
      await nextTick()
      expect(group.left).toEqual([{ key: bId, name: 'toast' }])
      const passing = boxed(root().byClass('toast')[2], 136, 196)
      const id = idOf('passing')
      vi.advanceTimersByTime(6000)
      await nextTick()
      expect(group.left.at(-1)).toEqual({ key: id, name: 'toast' })
      for (const m of ['d', 'e']) showToast(m, { key: m, action: undo() })
      await nextTick()
      expect(note(root())).toEqual([STRINGS.da.toast_waiting.replace('{n}', '1')])
      const lineEl = boxedLine()
      dismissKeyed('a') // the one waiting: only the line goes
      await nextTick()
      expect(group.left.at(-1)).toEqual({ key: 'waiting', name: 'toast' })
      expect([b.style, passing.style, lineEl.style]).toEqual([{}, {}, {}])
    } finally {
      vi.useRealTimers()
    }
  })

  it('the calm exit is for its change only: a lone ✕ after it is plain again', async () => {
    for (const m of ['a', 'b', 'c', 'd']) showToast(m, { action: undo() })
    await nextTick()
    root().byClass('toast')[1].byClass('x')[0].click() // c, while a waits: a swap
    await nextTick()
    expect(group.name).toBe('toast-swap')
    const b = boxed(root().byClass('toast')[1], 68, 196)
    const bId = idOf('b')
    b.byClass('x')[0].click()
    await nextTick()
    expect(group.left.at(-1)).toEqual({ key: bId, name: 'toast' })
    expect(b.style).toEqual({})
  })

  // The round J review, with the real group: a toast that goes with nothing
  // coming fades in the flow. A toast that came before that fade was over
  // found it still there, and the stack held both: a passing fourth's time
  // up, then within the 0.25 s a new toast that sent one to wait. The line
  // came 68 px too high, and dropped when the fade ended. One still fading
  // now leaves the flow where it stands once another comes.
  it('a toast still fading in the flow when another comes leaves the flow where it stands', async () => {
    vi.useFakeTimers()
    try {
      for (const m of ['a', 'b', 'c']) showToast(m, { action: undo() })
      showToast('passing', {}) // a fourth, and none waits
      await nextTick()
      group.slow = true
      const passing = boxed(root().byClass('toast')[3], 204, 264)
      const id = idOf('passing')
      vi.advanceTimersByTime(6000)
      await nextTick()
      expect(group.left.at(-1)).toEqual({ key: id, name: 'toast' })
      expect(passing.style).toEqual({}) // nothing came: the plain exit, in the flow
      const a = boxed(root().byClass('toast')[0], 0, 264)
      const aId = idOf('a')
      showToast('d', { action: undo() }) // a waits; the line and d come
      await nextTick()
      expect(said(root())).toEqual(['b', 'c', 'd'])
      expect(group.left.at(-1)).toEqual({ key: aId, name: 'toast-swap' })
      // a measured first, where it stood beside the one still fading.
      expect(a.style).toEqual({ bottom: '204px', left: '0px', width: '440px' })
      expect(passing.style).toEqual({ position: 'absolute', bottom: '0px', left: '0px', width: '440px' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('so does a toast closed when a new one comes in its fade, with none waiting', async () => {
    for (const m of ['a', 'b']) showToast(m, { action: undo() })
    await nextTick()
    group.slow = true
    const b = boxed(root().byClass('toast')[1], 68, 128)
    b.byClass('x')[0].click()
    await nextTick()
    expect(b.style).toEqual({})
    showToast('c', { action: undo() })
    await nextTick()
    expect(group.name).toBe('toast') // nothing went in this change: no swap
    expect(b.style).toEqual({ position: 'absolute', bottom: '0px', left: '0px', width: '440px' })
  })

  it('one whose fade is over holds nothing, and toasts that only go stay in the flow', async () => {
    for (const m of ['a', 'b', 'c']) showToast(m, { action: undo() })
    await nextTick()
    group.slow = true
    const c = boxed(root().byClass('toast')[2], 136, 196)
    c.byClass('x')[0].click()
    await nextTick()
    const b = boxed(root().byClass('toast')[1], 68, 196)
    b.byClass('x')[0].click() // nothing comes: both fade in the flow
    await nextTick()
    expect([b.style, c.style]).toEqual([{}, {}])
    group.end()
    showToast('d', { action: undo() })
    await nextTick()
    expect([b.style, c.style]).toEqual([{}, {}])
  })

  // A tap during the fade must not hit Fortryd or ✕ of a toast already going.
  it('no toast on its way out takes a tap, whichever way it goes', () => {
    expect(decls('.toast-leave-active')).toMatch(/pointer-events:\s*none/)
    expect(decls('.toast-swap-leave-active')).toMatch(/pointer-events:\s*none/)
  })
})

/**
 * The round H review: with only toasts that go by themselves shown and one
 * toast waiting, a tap shows it as an extra, and the line goes. The line had
 * the keyboard's focus, and it fell to the page. It now goes to the toast
 * brought forward. In every other case the line stays the same element, and
 * keeps the focus. Round J: only a line that had the focus hands it on. A
 * finger or a mouse that never focused the line leaves the focus alone.
 */
describe('the focus after a tap', () => {
  const focused = () => vi.spyOn(FakeNode.prototype, 'focus')
  /** The line has the focus: a keyboard's Tab to it, before Enter or Space. */
  const focusLine = () => Object.assign(document, { activeElement: line(root()) })

  it('when the line had the focus and goes, it goes to the button of the toast brought forward', async () => {
    showToast('a', { action: undo() })
    for (const e of ['e1', 'e2', 'e3']) showToast(e, { type: 'error' })
    await nextTick()
    const focus = focused()
    focusLine()
    line(root()).click()
    await nextTick()
    expect(said(root())).toEqual(['a', 'e1', 'e2', 'e3'])
    expect(note(root())).toEqual([])
    expect(focus.mock.contexts).toHaveLength(1)
    expect(focus.mock.contexts[0]).toBe(root().byClass('toast')[0].byClass('act')[0])
  })

  // "Logged in until the app is closed or reloaded" (main.ts): no button but ✕.
  it('one without a button: to its ✕', async () => {
    showToast('signed in for now', { ttl: 0 })
    for (const e of ['e1', 'e2', 'e3']) showToast(e, { type: 'error' })
    await nextTick()
    const focus = focused()
    focusLine()
    line(root()).click()
    await nextTick()
    expect(said(root())).toEqual(['signed in for now', 'e1', 'e2', 'e3'])
    expect(focus.mock.contexts).toHaveLength(1)
    expect(focus.mock.contexts[0]).toBe(root().byClass('toast')[0].byClass('x')[0])
  })

  // A tap may not focus the button (Safari's never does). Pulled to Fortryd,
  // the focus left wherever the user was, a field being typed in included.
  it('a tap on a line that never had the focus moves no focus, though the line goes', async () => {
    const focus = focused()
    for (const [m, opts] of [['a', { action: undo() }], ['signed in for now', { ttl: 0 }]] as const) {
      clearToasts()
      showToast(m, opts)
      for (const e of ['e1', 'e2', 'e3']) showToast(e, { type: 'error' })
      await nextTick()
      line(root()).click()
      await nextTick()
      expect(said(root())).toEqual([m, 'e1', 'e2', 'e3'])
      expect(note(root())).toEqual([])
    }
    expect(focus).not.toHaveBeenCalled()
  })

  it('while the line stays, it is the same element, and the focus is left on it', async () => {
    for (const m of ['a', 'b', 'c', 'd']) showToast(m, { action: undo() })
    await nextTick()
    const focus = focused()
    const before = line(root())
    focusLine()
    line(root()).click() // a swap
    await nextTick()
    expect(said(root())).toEqual(['a', 'c', 'd'])
    expect(line(root())).toBe(before)
    clearToasts()
    await nextTick()
    // An extra, with another still waiting.
    for (const m of ['f', 'g']) showToast(m, { action: undo() })
    for (const e of ['e1', 'e2', 'e3']) showToast(e, { type: 'error' })
    await nextTick()
    const again = line(root())
    line(root()).click()
    await nextTick()
    expect(said(root())).toEqual(['g', 'e1', 'e2', 'e3'])
    expect(line(root())).toBe(again)
    expect(focus).not.toHaveBeenCalled()
  })
})
