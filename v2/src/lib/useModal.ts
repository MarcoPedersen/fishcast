import { onBeforeUnmount, nextTick, ref } from 'vue'
import { watch } from 'vue'

/**
 * Accessibility helper for a `v-if`-toggled overlay: Escape closes it, Tab is
 * trapped inside it, focus moves in on open and returns to the trigger on
 * close. Attach the returned ref to the dialog element (give it tabindex="-1",
 * role="dialog", aria-modal="true").
 *
 *   const { dialogRef } = useModal(() => open.value, () => open.value = false)
 */
export function useModal(isOpen: () => boolean, close: () => void) {
  const dialogRef = ref<HTMLElement | null>(null)
  let prevFocus: HTMLElement | null = null

  const focusables = () =>
    Array.from(
      dialogRef.value?.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])',
      ) ?? [],
    )

  function onKey(e: KeyboardEvent) {
    if (!isOpen()) return
    if (e.key === 'Escape') { e.stopPropagation(); close(); return }
    if (e.key === 'Tab') {
      const f = focusables()
      if (!f.length) return
      const first = f[0], last = f[f.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
  }

  watch(isOpen, async (open) => {
    if (open) {
      prevFocus = document.activeElement as HTMLElement | null
      document.addEventListener('keydown', onKey, true)
      await nextTick()
      ;(focusables()[0] ?? dialogRef.value)?.focus()
    } else {
      document.removeEventListener('keydown', onKey, true)
      prevFocus?.focus?.()
    }
  })

  onBeforeUnmount(() => document.removeEventListener('keydown', onKey, true))
  return { dialogRef }
}
