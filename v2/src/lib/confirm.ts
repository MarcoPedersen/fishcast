import { reactive } from 'vue'

/**
 * In-app confirmation dialog — replaces the native window.confirm(), whose title
 * is set by the host browser (e.g. "Claude" in the preview) and can't be branded.
 * Usage:  if (await confirmDialog(t('...'))) { ... }
 */
export const confirmState = reactive({
  open: false,
  message: '',
  resolve: null as ((v: boolean) => void) | null,
})

export function confirmDialog(message: string): Promise<boolean> {
  // If a previous prompt is somehow still open, resolve it as cancelled first.
  confirmState.resolve?.(false)
  return new Promise((resolve) => {
    confirmState.message = message
    confirmState.open = true
    confirmState.resolve = resolve
  })
}

function settle(value: boolean) {
  const r = confirmState.resolve
  confirmState.open = false
  confirmState.resolve = null
  confirmState.message = ''
  r?.(value)
}

export function confirmAccept() { settle(true) }
export function confirmCancel() { settle(false) }
