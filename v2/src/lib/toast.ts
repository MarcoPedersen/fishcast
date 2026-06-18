import { ref } from 'vue'

export interface Toast {
  id: number
  message: string
  type: 'info' | 'error'
  action?: { label: string; run: () => void }
}

export const toasts = ref<Toast[]>([])
let nextId = 1

export function showToast(
  message: string,
  opts: { type?: 'info' | 'error'; ttl?: number; action?: Toast['action'] } = {},
): void {
  const id = nextId++
  toasts.value.push({ id, message, type: opts.type ?? 'info', action: opts.action })
  const ttl = opts.ttl ?? 6000
  if (ttl > 0) setTimeout(() => dismissToast(id), ttl)
}

export function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id)
}
