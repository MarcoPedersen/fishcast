import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, markRaw, ref, type EffectScope } from 'vue'
import { useModal } from './useModal'

// The test env is plain node, so this is the smallest DOM useModal touches:
// focus, containment, the focusable query, keydown listeners and body styles.
class El {
  children: El[] = []
  autofocus = false
  constructor(public name: string, public parent: El | null = null, public focusable = true) {
    parent?.children.push(this)
    // Vue leaves real DOM nodes unproxied; a plain class instance would be
    // wrapped by the ref and stop comparing equal to itself.
    markRaw(this)
  }
  focus() { doc.activeElement = this }
  contains(o: unknown): boolean {
    for (let n = o as El | null; n; n = n.parent) if (n === this) return true
    return false
  }
  private all(): El[] { return this.children.flatMap((c) => [c, ...c.all()]) }
  querySelectorAll() { return this.all().filter((c) => c.focusable) }
  querySelector(sel: string) { return sel === '[data-autofocus]' ? this.all().find((c) => c.autofocus) ?? null : null }
}

const scopes: EffectScope[] = []
type Listener = (e: KeyboardEvent) => void
let listeners: Listener[] = []
const doc = {
  activeElement: null as El | null,
  hidden: false,
  body: { style: { overflow: '', paddingRight: '' } },
  documentElement: { clientWidth: 983 },
  addEventListener: (_: string, fn: Listener) => { listeners.push(fn) },
  removeEventListener: (_: string, fn: Listener) => { listeners = listeners.filter((l) => l !== fn) },
}

function press(key: string, shiftKey = false) {
  const e = { key, shiftKey, preventDefault: vi.fn(), stopPropagation: vi.fn() }
  for (const l of [...listeners]) l(e as unknown as KeyboardEvent)
  return e
}
const settle = () => new Promise((r) => setTimeout(r, 0))

/** A page with a trigger button, and a dialog holding `n` buttons. */
function setupModal(n = 2) {
  const page = new El('page')
  const trigger = new El('trigger', page)
  const behind = new El('reset-btn', page) // e.g. the data-footer "Nulstil" buttons
  const dialog = new El('dialog', page, false)
  const text = new El('text', dialog, false)
  const buttons = Array.from({ length: n }, (_, i) => new El('btn' + i, dialog))
  const open = ref(false)
  const close = vi.fn(() => { open.value = false })
  const scope = effectScope()
  scopes.push(scope)
  const { dialogRef } = scope.run(() => useModal(() => open.value, close))!
  dialogRef.value = dialog as unknown as HTMLElement
  return { page, trigger, behind, dialog, text, buttons, open, close, scope }
}

beforeEach(() => {
  listeners = []
  doc.activeElement = null
  doc.body.style.overflow = ''
  doc.body.style.paddingRight = ''
  vi.stubGlobal('document', doc)
  vi.stubGlobal('window', { innerWidth: 1000 })
})
afterEach(() => {
  // Unmount everything, so a failed test can't leak a scroll lock into the next
  while (scopes.length) scopes.pop()!.stop()
  vi.unstubAllGlobals()
})

describe('useModal focus trap', () => {
  it('moves focus into the dialog on open and back to the trigger on close', async () => {
    const m = setupModal()
    m.trigger.focus()
    m.open.value = true
    await settle()
    expect(doc.activeElement).toBe(m.buttons[0])
    m.open.value = false
    await settle()
    expect(doc.activeElement).toBe(m.trigger)
  })

  it('still wraps Tab / Shift+Tab at the ends', async () => {
    const m = setupModal()
    m.open.value = true
    await settle()
    m.buttons[1].focus()
    expect(press('Tab').preventDefault).toHaveBeenCalled()
    expect(doc.activeElement).toBe(m.buttons[0])
    expect(press('Tab', true).preventDefault).toHaveBeenCalled()
    expect(doc.activeElement).toBe(m.buttons[1])
  })

  /**
   * Regression: clicking a breakdown row's text focuses the tabindex=-1 dialog
   * box itself. Shift+Tab from there matched neither "first" nor "last", so the
   * browser stepped back to the reset buttons hidden behind the overlay.
   */
  it('keeps Shift+Tab inside when the dialog box itself has focus', async () => {
    const m = setupModal(1)
    m.open.value = true
    await settle()
    m.dialog.focus()
    const e = press('Tab', true)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(doc.activeElement).toBe(m.buttons[0])
  })

  it('pulls focus back in when it is somewhere behind the overlay', async () => {
    const m = setupModal()
    m.open.value = true
    await settle()
    m.behind.focus()
    expect(press('Tab').preventDefault).toHaveBeenCalled()
    expect(doc.activeElement).toBe(m.buttons[0])
    m.behind.focus()
    press('Tab', true)
    expect(doc.activeElement).toBe(m.buttons[1])
  })

  it('focuses a [data-autofocus] control first when there is one', async () => {
    const m = setupModal()
    m.buttons[1].autofocus = true
    m.open.value = true
    await settle()
    expect(doc.activeElement).toBe(m.buttons[1])
  })

  it('lets only the innermost of two open dialogs handle keys', async () => {
    const a = setupModal()
    a.open.value = true
    await settle()
    const b = setupModal()
    b.open.value = true
    await settle()
    expect(doc.activeElement).toBe(b.buttons[0])
    // A mid-dialog Tab is B's to leave to the browser — and A, seeing focus
    // "outside" itself, must not drag it back into A.
    expect(press('Tab').preventDefault).not.toHaveBeenCalled()
    expect(doc.activeElement).toBe(b.buttons[0])
    press('Escape')
    expect(b.close).toHaveBeenCalledOnce()
    expect(a.close).not.toHaveBeenCalled()
    await settle()
    // With B gone, A is innermost again
    press('Escape')
    expect(a.close).toHaveBeenCalledOnce()
  })
})

describe('useModal scroll lock', () => {
  it('locks background scroll while open and restores it on close', async () => {
    const m = setupModal()
    doc.body.style.overflow = 'auto'
    m.open.value = true
    await settle()
    expect(doc.body.style.overflow).toBe('hidden')
    // Windows desktop: the 17px scrollbar disappears; pad so nothing shifts
    expect(doc.body.style.paddingRight).toBe('17px')
    m.open.value = false
    await settle()
    expect(doc.body.style.overflow).toBe('auto')
    expect(doc.body.style.paddingRight).toBe('')
  })

  it('stays locked until the last of two stacked dialogs closes', async () => {
    const a = setupModal()
    const b = setupModal()
    a.open.value = true
    await settle()
    b.open.value = true
    await settle()
    b.open.value = false
    await settle()
    expect(doc.body.style.overflow).toBe('hidden')
    a.open.value = false
    await settle()
    expect(doc.body.style.overflow).toBe('')
  })

  /** Navigating away with a dialog open must not leave the page unscrollable. */
  it('releases the lock and its key listener when unmounted while open', async () => {
    const m = setupModal()
    m.open.value = true
    await settle()
    m.scope.stop()
    expect(doc.body.style.overflow).toBe('')
    expect(listeners).toHaveLength(0)
  })
})

