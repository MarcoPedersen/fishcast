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
// The keyed toast whose button is running (runToastAction), while it runs.
let running: { key: string; id: number; at: number } | undefined

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
 * the same id, so the stack does not jump. The spot card's toasts (a change
 * of water type, "Hent arter": LocationsView setWater, fetchSpecies) are
 * keyed by spot. Joined by text, two spots whose
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
  // Shown again by its own button (a spot's earlier change, LocationsView
  // showStep), a keyed toast takes the old one's place and id: Toasts.vue
  // keeps the same element, its button keeps the focus, and a second tap
  // lands on it, not on a toast that slid into its place.
  const back = opts.key !== undefined && running?.key === opts.key ? running : undefined
  if (back) running = undefined
  const id = back?.id ?? nextId++
  if (back) toasts.value.splice(Math.min(back.at, toasts.value.length), 0, entry(id, message, opts))
  else toasts.value.push(entry(id, message, opts))
  raised.set(id, ++raises)
  // Over the cap, the oldest INFO toast goes first — the new one included.
  // "Sync failed" in an app that has lost data once matters more than
  // "refreshing…", and three quick infos used to push it off inside its 6 s.
  // And a notice without a button never takes a toast with one: a spot's
  // Fortryd toast holds its undo history (lib/undoHistory), which a 3-second
  // "⟳ refreshing" took with it. An older notice gives way first. A new one
  // shows anyway, as a fourth, and goes by itself in a few seconds: dropped
  // instead, "✓ Tur uden fangst gemt" never showed with three spots' toasts
  // standing, and a save without that word looked like it hadn't happened.
  const added = toasts.value.find((t) => t.id === id)
  // A passing word, which goes by itself. One that stays until it is closed
  // ("logged in until the app is closed or reloaded", main.ts) holds its place
  // as a toast with a button does: as the oldest notice it went first.
  const notice = (t: Toast) => t.type === 'info' && !t.action && (t === added ? ttl > 0 : timers.has(t.id))
  const oldestOf = (ts: Toast[]) => ts.reduce((a, b) => ((raised.get(b.id) ?? 0) < (raised.get(a.id) ?? 0) ? b : a))
  while (toasts.value.length > MAX_VISIBLE) {
    const olderNotices = toasts.value.filter((t) => notice(t) && t !== added)
    if (olderNotices.length) { dismissToast(oldestOf(olderNotices).id); continue }
    if (added && notice(added) && toasts.value.length <= MAX_VISIBLE + 1) break
    const others = toasts.value.filter((t) => !(added && notice(added) && t === added))
    const infos = others.filter((t) => t.type === 'info')
    dismissToast(oldestOf(infos.length ? infos : others).id)
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

/**
 * The room the page leaves at its end for a stack of toasts `height` px tall
 * (Toasts.vue sets it as --toast-space; style.css .shell): the stack, its
 * 16 px off the bottom and 8 px of air. Standing toasts covered the page's
 * last buttons, and the page couldn't scroll them clear.
 */
export function toastSpace(height: number): string {
  return height > 0 ? `${Math.round(height) + 24}px` : '0px'
}

/** Takes down the toast showing under `key` (showToast's key), if any: what it was about is gone. */
export function dismissKeyed(key: string): void {
  for (const t of toasts.value.filter((x) => x.key === key)) dismissToast(t.id)
}

/**
 * A toast's button: dismiss it, THEN run the action. The other way round, a
 * Retry that failed again at once (offline) refreshed this very toast — same
 * message — and the dismiss then removed it, as if the retry had worked.
 * A keyed toast the action shows again takes this one's place and id.
 */
export function runToastAction(id: number): void {
  const at = toasts.value.findIndex((t) => t.id === id)
  const key = toasts.value[at]?.key
  const run = toasts.value[at]?.action?.run
  dismissToast(id)
  if (key !== undefined) running = { key, id, at }
  try { run?.() } finally { running = undefined }
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
