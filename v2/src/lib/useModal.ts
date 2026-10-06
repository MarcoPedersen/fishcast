import { onScopeDispose, nextTick, ref } from 'vue'
import { watch } from 'vue'

// Open dialogs, innermost last. Only the innermost may act on a key: with a
// confirm raised over another dialog, the outer trap would otherwise drag Tab
// focus back into itself, and one Escape would close both.
const stack: object[] = []

// Background scroll lock, shared by every open dialog — taken by the first to
// open, released by the last to close. Without it, scrolling past the end of
// the long score breakdown on a phone scrolled the window list underneath.
let locks = 0
let savedBody = { overflow: '', paddingRight: '' }
function lockScroll() {
  if (locks++ > 0) return
  const s = document.body.style
  savedBody = { overflow: s.overflow, paddingRight: s.paddingRight }
  // On Windows desktop the scrollbar takes ~17px; hiding it would shift the
  // whole page sideways under the overlay, so pad its width back in.
  const gap = window.innerWidth - document.documentElement.clientWidth
  s.overflow = 'hidden'
  if (gap > 0) s.paddingRight = `${gap}px`
}
function unlockScroll() {
  if (locks === 0 || --locks > 0) return
  document.body.style.overflow = savedBody.overflow
  document.body.style.paddingRight = savedBody.paddingRight
}

/**
 * Accessibility helper for a `v-if`-toggled overlay: Escape closes it, Tab is
 * trapped inside it, focus moves in on open and returns to the trigger on
 * close, and the page behind it can't scroll. Attach the returned ref to the
 * dialog element (give it tabindex="-1", role="dialog", aria-modal="true").
 * Focus lands on the element marked `data-autofocus` if there is one, else on
 * the first focusable control.
 *
 *   const { dialogRef } = useModal(() => open.value, () => open.value = false)
 */
export function useModal(isOpen: () => boolean, close: () => void) {
  const dialogRef = ref<HTMLElement | null>(null)
  let prevFocus: HTMLElement | null = null
  const token = {}
  let active = false

  const focusables = () =>
    Array.from(
      dialogRef.value?.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])',
      ) ?? [],
    )

  function onKey(e: KeyboardEvent) {
    if (!isOpen() || stack[stack.length - 1] !== token) return
    if (e.key === 'Escape') { e.stopPropagation(); close(); return }
    if (e.key === 'Tab') {
      const dlg = dialogRef.value
      if (!dlg) return
      const f = focusables()
      const cur = document.activeElement
      // Focus on the dialog box itself (a click on its text does that — it has
      // tabindex=-1) or anywhere outside it matched neither end below, so the
      // browser stepped to the page hidden behind the overlay. Pull it back in.
      if (cur === dlg || !dlg.contains(cur)) {
        e.preventDefault()
        ;(e.shiftKey ? f[f.length - 1] : f[0])?.focus()
        return
      }
      if (!f.length) { e.preventDefault(); return }
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && cur === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && cur === last) { e.preventDefault(); first.focus() }
    }
  }

  function activate() {
    if (active) return
    active = true
    prevFocus = document.activeElement as HTMLElement | null
    stack.push(token)
    lockScroll()
    document.addEventListener('keydown', onKey, true)
  }
  function deactivate(restoreFocus: boolean) {
    if (!active) return
    active = false
    stack.splice(stack.indexOf(token), 1)
    unlockScroll()
    document.removeEventListener('keydown', onKey, true)
    if (restoreFocus) prevFocus?.focus?.()
    prevFocus = null
  }

  watch(isOpen, async (open) => {
    if (open) {
      activate()
      await nextTick()
      if (!active) return // closed again before it rendered
      const dlg = dialogRef.value
      ;(dlg?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0] ?? dlg)?.focus()
    } else {
      deactivate(true)
    }
  })

  // Unmounted while open (e.g. navigating away): a leftover scroll lock would
  // leave every other page unscrollable.
  onScopeDispose(() => deactivate(false))
  return { dialogRef }
}
