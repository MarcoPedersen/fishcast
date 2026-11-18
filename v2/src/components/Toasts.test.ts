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
import { clearToasts, showToast, toasts } from '@/lib/toast'
import { langReady, setLang } from '@/lib/i18n'
import { STRINGS } from '@/test/strings'
import Toasts from './Toasts.vue'

/**
 * What the group was asked to do, as a real TransitionGroup works from it:
 * its name at the last render, and each toast (or the line) that left, by
 * key, under the name it left with. Its before-leave hook has run on it,
 * where the real group runs it: the element still in its place.
 */
const group = vi.hoisted(() => ({ name: undefined as string | undefined, left: [] as { key: unknown; name?: string }[] }))

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
        for (const v of was.filter((v) => v.el && !now.some((n) => n.key === v.key))) {
          ;(attrs.onBeforeLeave as ((el: unknown) => void) | undefined)?.(v.el)
          group.left.push({ key: v.key, name: props.name })
        }
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
const boxed = (el: FakeNode, top: number) => {
  root().byClass('toasts')[0].offsetHeight = 226
  return Object.assign(el, { offsetTop: top, offsetLeft: 0, offsetWidth: 440, offsetHeight: 60 })
}

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

  // Only the swap: a toast closed, its time up or used still fades in the
  // flow, sliding down as before.
  it('only for the swap: after it the stack\'s own name is back, and ✕ leaves as before', async () => {
    for (const m of ['a', 'b', 'c', 'd']) showToast(m, { action: undo() })
    await nextTick()
    line(root()).click()
    await nextTick()
    await nextTick()
    expect(group.name).toBe('toast')
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
