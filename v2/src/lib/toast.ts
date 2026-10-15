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

/** Returns the id of the toast now showing the message (a repeat refreshes the same one). */
export function showToast(
  message: string,
  opts: { type?: 'info' | 'error'; ttl?: number; action?: Toast['action'] } = {},
): number {
  // The same message again refreshes the toast already showing instead of
  // stacking a copy: one per failed location (or per flap of the connection)
  // put 18 identical "you're offline" toasts over the whole phone screen.
  const same = toasts.value.find((t) => t.message === message)
  // A toast with a button stays until it's used or closed: gone after 6 s, its
  // "Prøv igen" was out of reach for anyone tabbing to it or listening to a
  // screen reader finish the message. (The cap below still bounds the stack.)
  const ttl = opts.ttl ?? (opts.action || same?.action ? 0 : 6000)
  if (same) {
    same.type = opts.type ?? 'info'
    if (opts.action) same.action = opts.action // the latest Retry covers the latest failure
    arm(same.id, ttl)
    return same.id
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
  return id
}

export function dismissToast(id: number): void {
  clearTimeout(timers.get(id))
  timers.delete(id)
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

/**
 * A toast's button: dismiss it, THEN run the action. The other way round, a
 * Retry that failed again at once (offline) refreshed this very toast — same
 * message — and the dismiss then removed it, as if the retry had worked.
 */
export function runToastAction(id: number): void {
  const run = toasts.value.find((t) => t.id === id)?.action?.run
  dismissToast(id)
  run?.()
}

/**
 * Every toast, sticky ones included (logout). A Retry closes over the
 * previous account's spots and would fetch them back into the weather cache.
 */
export function clearToasts(): void {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  toasts.value = []
}
