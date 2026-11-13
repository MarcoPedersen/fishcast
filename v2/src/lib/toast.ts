import { ref } from 'vue'

/**
 * A toast's text: a string, or a function that builds it each time it is
 * read. A toast with a button stands until it is used or closed, and text
 * built once kept the language it was raised in after a switch; built from
 * t() on each read, the toast re-renders in the new one.
 */
export type ToastText = string | (() => string)
export interface ToastAction { label: ToastText; run: () => void }

export interface Toast {
  id: number
  /** What the toast is about, when the caller named it (showToast's key). */
  readonly key?: string
  /** The text as of now (a getter when it was given as a function). */
  readonly message: string
  type: 'info' | 'error'
  action?: { readonly label: string; run: () => void }
}

const read = (text: ToastText): string => (typeof text === 'function' ? text() : text)
const live = (a: ToastAction): NonNullable<Toast['action']> => ({ get label() { return read(a.label) }, run: a.run })

interface ToastOpts { type?: 'info' | 'error'; ttl?: number; action?: ToastAction; key?: string }
function entry(id: number, message: ToastText, opts: ToastOpts): Toast {
  return { id, key: opts.key, get message() { return read(message) }, type: opts.type ?? 'info', action: opts.action && live(opts.action) }
}

export const toasts = ref<Toast[]>([])
let nextId = 1
const timers = new Map<number, ReturnType<typeof setTimeout>>()
// The stack grows up from the bottom of the screen with no height limit; a
// few is all anyone reads, and more covered the topbar on a phone.
const MAX_VISIBLE = 3
// When each toast last said something new. A keyed toast replaced in its
// place is the newest, so the cap goes by this, not by place in the stack.
const raised = new Map<number, number>()
let raises = 0

function arm(id: number, ttl: number) {
  clearTimeout(timers.get(id))
  timers.delete(id)
  if (ttl > 0) timers.set(id, setTimeout(() => dismissToast(id), ttl))
}

/**
 * Returns the id of the toast now showing the message (a repeat refreshes the same one).
 *
 * With a key, a toast is joined by its key, not its text: the one showing
 * under that key is replaced, text, type and button, in the same place with
 * the same id, so the stack does not jump. The spot card's water-type toasts
 * are keyed by spot (LocationsView setWater). Joined by text, two spots whose
 * change read the same shared one toast, whose Fortryd undid only the latest.
 */
export function showToast(message: ToastText, opts: ToastOpts = {}): number {
  if (opts.key !== undefined) {
    const i = toasts.value.findIndex((t) => t.key === opts.key)
    if (i >= 0) {
      const { id } = toasts.value[i]
      toasts.value[i] = entry(id, message, opts)
      raised.set(id, ++raises)
      arm(id, opts.ttl ?? (opts.action ? 0 : 6000))
      return id
    }
  }
  // The same message again refreshes the toast already showing instead of
  // stacking a copy: one per failed location (or per flap of the connection)
  // put 18 identical "you're offline" toasts over the whole phone screen.
  // Keyed toasts stay out of it, either way.
  const same = opts.key === undefined
    ? toasts.value.find((t) => t.key === undefined && t.message === read(message))
    : undefined
  // A toast with a button stays until it's used or closed: gone after 6 s, its
  // "Prøv igen" was out of reach for anyone tabbing to it or listening to a
  // screen reader finish the message. (The cap below still bounds the stack.)
  const ttl = opts.ttl ?? (opts.action || same?.action ? 0 : 6000)
  if (same) {
    same.type = opts.type ?? 'info'
    if (opts.action) same.action = live(opts.action) // the latest Retry covers the latest failure
    arm(same.id, ttl)
    return same.id
  }
  const id = nextId++
  toasts.value.push(entry(id, message, opts))
  raised.set(id, ++raises)
  // Over the cap, the oldest INFO toast goes first — the new one included.
  // "Sync failed" in an app that has lost data once matters more than
  // "refreshing…", and three quick infos used to push it off inside its 6 s.
  while (toasts.value.length > MAX_VISIBLE) {
    const infos = toasts.value.filter((t) => t.type === 'info')
    const oldest = (infos.length ? infos : toasts.value)
      .reduce((a, b) => ((raised.get(b.id) ?? 0) < (raised.get(a.id) ?? 0) ? b : a))
    dismissToast(oldest.id)
  }
  if (toasts.value.some((t) => t.id === id)) arm(id, ttl)
  return id
}

export function dismissToast(id: number): void {
  clearTimeout(timers.get(id))
  timers.delete(id)
  raised.delete(id)
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

/** Takes down the toast showing under `key` (showToast's key), if any: what it was about is gone. */
export function dismissKeyed(key: string): void {
  for (const t of toasts.value.filter((x) => x.key === key)) dismissToast(t.id)
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
  raised.clear()
  toasts.value = []
}
