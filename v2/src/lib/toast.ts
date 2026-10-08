import { ref } from 'vue'

export interface Toast {
  id: number
  message: string
  type: 'info' | 'error'
  action?: { label: string; run: () => void }
}

export const toasts = ref<Toast[]>([])
let nextId = 1
const timers = new Map<number, ReturnType<typeof setTimeout>>()
// The stack grows up from the bottom of the screen with no height limit; a
// few is all anyone reads, and more covered the topbar on a phone.
const MAX_VISIBLE = 3

function arm(id: number, ttl: number) {
  clearTimeout(timers.get(id))
  timers.delete(id)
  if (ttl > 0) timers.set(id, setTimeout(() => dismissToast(id), ttl))
}

export function showToast(
  message: string,
  opts: { type?: 'info' | 'error'; ttl?: number; action?: Toast['action'] } = {},
): void {
  const ttl = opts.ttl ?? 6000
  // The same message again refreshes the toast already showing instead of
  // stacking a copy: one per failed location (or per flap of the connection)
  // put 18 identical "you're offline" toasts over the whole phone screen.
  const same = toasts.value.find((t) => t.message === message)
  if (same) {
    same.type = opts.type ?? 'info'
    if (opts.action) same.action = opts.action // the latest Retry covers the latest failure
    arm(same.id, ttl)
    return
  }
  const id = nextId++
  toasts.value.push({ id, message, type: opts.type ?? 'info', action: opts.action })
  // Over the cap, the oldest INFO toast goes first — the new one included.
  // "Sync failed" in an app that has lost data once matters more than
  // "refreshing…", and three quick infos used to push it off inside its 6 s.
  while (toasts.value.length > MAX_VISIBLE) {
    dismissToast((toasts.value.find((t) => t.type === 'info') ?? toasts.value[0]).id)
  }
  if (toasts.value.some((t) => t.id === id)) arm(id, ttl)
}

export function dismissToast(id: number): void {
  clearTimeout(timers.get(id))
  timers.delete(id)
  toasts.value = toasts.value.filter((t) => t.id !== id)
}
