import { computed, ref } from 'vue'

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
  /**
   * Waiting out of sight for room in the stack (the cap: fit), or for a tap
   * on the line over the stack (showNextWaiting). It is still one of the
   * toasts: its key and its button count as standing.
   */
  waiting?: boolean
}

const read = (text: ToastText): string => (typeof text === 'function' ? text() : text)
const live = (a: ToastAction): NonNullable<Toast['action']> => ({ get label() { return read(a.label) }, run: a.run })

interface ToastOpts { type?: 'info' | 'error'; ttl?: number; action?: ToastAction; key?: string }
function entry(id: number, message: ToastText, opts: ToastOpts): Toast {
  return { id, key: opts.key, get message() { return read(message) }, type: opts.type ?? 'info', action: opts.action && live(opts.action) }
}

/**
 * Every toast, in its place in the stack, those waiting for room included:
 * what asks for a toast standing (a key, a button) finds those too. The
 * updater holds its reload for a Fortryd that waits (main.ts pageHolds), and
 * a spot's undo history stays with it (lib/undoHistory).
 */
export const toasts = ref<Toast[]>([])
/** The toasts on screen, top to bottom: Toasts.vue renders these. */
export const shownToasts = computed(() => toasts.value.filter((t) => !t.waiting))
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
// The toast the last tap on the line brought forward (showNextWaiting), until
// it goes or says something new. It holds its place: the cap sends another
// to wait first, and brings it back first.
let held: number | undefined
// The toasts the cap sent to wait since the last tap (fit, showNextWaiting).
// Room brings these back first (refill), so a passing error leaves the
// stack as the tap showed it. Without it, room went by the cap's order: an
// error the tap had sent to wait came back before the spot's toast the
// passing error sent there. Before any tap it is every toast waiting.
let since = new WeakSet<Toast>()

function arm(id: number, ttl: number) {
  clearTimeout(timers.get(id))
  timers.delete(id)
  if (ttl > 0) timers.set(id, setTimeout(() => dismissToast(id), ttl))
}

// A passing word: no button, and it goes by itself. One that stays until it
// is closed ("logged in until the app is closed or reloaded", main.ts) holds
// its place as a toast with a button does: as the oldest notice it went first.
const notice = (t: Toast) => t.type === 'info' && !t.action && timers.has(t.id)
const age = (t: Toast) => raised.get(t.id) ?? 0
const oldestOf = (ts: Toast[]) => ts.reduce((a, b) => (age(b) < age(a) ? b : a))
// By type and age: an info before an error, then the older first. Taps on
// the line go down this order (showNextWaiting).
const byAge = (a: Toast, b: Toast) => (a.type !== b.type ? a.type === 'info' : age(a) < age(b))
// The cap's order: whether the cap sends `a` to wait before `b` (fit);
// refill brings them back the other way round. By type and age, but the
// toast a tap brought forward is the last of its type to wait: kept by its
// age, it was the first, and the next change to the stack undid the tap.
const before = (a: Toast, b: Toast) =>
  (a.type === b.type && (a.id === held) !== (b.id === held) ? b.id === held : byAge(a, b))
const firstOf = (ts: Toast[]) => ts.reduce((a, b) => (before(b, a) ? b : a))
const lastOf = (ts: Toast[]) => ts.reduce((a, b) => (before(a, b) ? b : a))

/**
 * Over the cap, the oldest INFO toast makes room first — the new one included.
 * "Sync failed" in an app that has lost data once matters more than
 * "refreshing…", and three quick infos used to push it off inside its 6 s.
 * And a notice without a button never takes a toast with one: a spot's
 * Fortryd toast holds its undo history (lib/undoHistory), which a 3-second
 * "⟳ refreshing" took with it. An older notice gives way first. A new one
 * shows anyway, as a fourth, and goes by itself in a few seconds: dropped
 * instead, "✓ Tur uden fangst gemt" never showed with three spots' toasts
 * standing, and a save without that word looked like it hadn't happened.
 *
 * A toast that stays until it is used or closed waits out of sight instead of
 * going, and comes back when there is room (refill). Dropped, a fourth spot's
 * change took the oldest spot's toast and its whole undo history with it: in
 * the round F browser check, Hornbæk's Torsk picked by hand could no longer
 * come back. One that goes by itself in a few seconds still just goes.
 *
 * The toast a tap brought forward is the last of its type to make room
 * (held, in the cap's order), but for the toast just raised.
 */
function fit(added: Toast) {
  while (shownToasts.value.length > MAX_VISIBLE) {
    const on = shownToasts.value
    const olderNotices = on.filter((t) => notice(t) && t !== added)
    if (olderNotices.length) { remove(oldestOf(olderNotices).id); continue }
    if (notice(added) && on.length <= MAX_VISIBLE + 1) break
    let out = firstOf(on.filter((t) => !(notice(added) && t === added)))
    // The toast held never sends the toast just raised to wait in its stead:
    // the only info beside errors that stay, it did, and the user's latest
    // change waited at once, unseen. It waits itself, and comes back first.
    if (out === added) out = on.find((t) => t.id === held && t.type === added.type) ?? out
    if (timers.has(out.id)) remove(out.id)
    else { out.waiting = true; since.add(out) }
  }
  refill()
}

/**
 * Room in the stack: the newest toasts waiting show again, each in its place.
 * Newest first, so the stack shows the newest that stay, as it did before
 * they waited. Errors before infos, as the cap keeps them: an error with its
 * Retry waited behind a spot's toast. A passing notice takes no room from
 * them: it shows as an extra, as a new one does over the cap. The toast a
 * tap brought forward comes back first of its type: the stack is as the tap
 * showed it once a passing error has gone. And the toasts the cap sent to
 * wait since the last tap come back before any other (since): a toast that
 * tap sent to wait, an error included, waits on.
 */
function refill() {
  for (;;) {
    const waiting = toasts.value.filter((t) => t.waiting)
    if (!waiting.length || shownToasts.value.filter((t) => !notice(t)).length >= MAX_VISIBLE) return
    const recent = waiting.filter((t) => since.has(t))
    delete lastOf(recent.length ? recent : waiting).waiting
  }
}

/**
 * A tap on the line over the stack ("+1 mere – vis", Toasts.vue): the
 * toast a refill would bring back shows in its place, and the shown toast
 * the cap would send to wait first waits in its place. A swap: nothing is
 * dropped, and a spot's undo history stays with its toast. Without it, the
 * way to a waiting Fortryd was to use up or close (✕, which forgets that
 * spot's history) a newer toast, as in the round G browser check.
 *
 * Taps in a row go down the cap's order: each brings the next toast waiting
 * after the one it sends to wait, and past the last the first again. So they
 * show every toast waiting in turn, then the stack as it began. A passing
 * toast never waits (fit): beside only those, the toast shows as an extra,
 * and the others come back as they go.
 *
 * The toast brought forward holds its place (held) until the next tap, which
 * sends it to wait in its turn, or until it goes or says something new. Kept
 * by its age, the next change to the stack sent it to wait: a passing error
 * came, the cap sent the oldest info to wait, and when the error went the
 * stack was as before the tap. Returns the id of the toast brought forward.
 */
export function showNextWaiting(): number | undefined {
  const waiting = toasts.value.filter((t) => t.waiting)
  if (!waiting.length) return undefined
  const stays = shownToasts.value.filter((t) => !timers.has(t.id))
  // The line's place is the toast the last tap brought forward, while it shows.
  const out = stays.find((t) => t.id === held) ?? (stays.length ? firstOf(stays) : undefined)
  const next = out ? waiting.filter((t) => byAge(t, out)) : []
  // Down the plain order too: the toast held, sent to wait for an error,
  // took the next turn out of it, and the taps came back to the start
  // before they had shown every toast waiting.
  const forward = (next.length ? next : waiting).reduce((a, b) => (byAge(a, b) ? b : a))
  delete forward.waiting
  if (out) out.waiting = true
  held = forward.id
  since = new WeakSet() // the stack as this tap shows it is what room comes back to
  return forward.id
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
 * One waiting for room shows again in its place: it says something new, and
 * is the newest.
 */
export function showToast(message: ToastText, opts: ToastOpts = {}): number {
  if (opts.key !== undefined) {
    const i = toasts.value.findIndex((t) => t.key === opts.key)
    if (i >= 0) {
      const { id, waiting } = toasts.value[i]
      toasts.value[i] = entry(id, message, opts)
      raised.set(id, ++raises)
      if (held === id) held = undefined // it says something new: the newest now, it needs no hold
      arm(id, opts.ttl ?? (opts.action ? 0 : 6000))
      // One shown takes no room it did not have: a passing notice showing as
      // a fourth keeps its few seconds. The cap runs for one that waited, or
      // one that went by itself and now stays.
      if (waiting || shownToasts.value.filter((t) => !notice(t)).length > MAX_VISIBLE) fit(toasts.value[i])
      else refill()
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
    // Waiting, and now it goes by itself: it shows, as the newest. It got its
    // timer out of sight, and went unseen.
    if (same.waiting && timers.has(same.id)) {
      delete same.waiting
      raised.set(same.id, ++raises)
      fit(same)
    }
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
  arm(id, ttl)
  fit(toasts.value.find((t) => t.id === id)!)
  return id
}

function remove(id: number) {
  clearTimeout(timers.get(id))
  timers.delete(id)
  raised.delete(id)
  if (held === id) held = undefined
  toasts.value = toasts.value.filter((t) => t.id !== id)
}

/** Takes the toast down: closed, its time up, or what it was about gone. A toast waiting takes its room. */
export function dismissToast(id: number): void {
  remove(id)
  refill()
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

/**
 * Whether a change to the stack is a swap: one goes (closed, used, its time
 * up, or sent to wait) while another comes (back from waiting, new, or the
 * line over the stack). `before` and `after` are the keys of what Toasts.vue
 * shows, the line's included. Toasts.vue gives a swap its calm exit: in the
 * plain one, the toast going stayed in the flow for its fade, the stack held
 * it and the one coming at once, and the line jumped up a toast's height and
 * back. A toast that goes with nothing coming keeps the plain exit.
 */
export function isSwap(before: readonly PropertyKey[], after: readonly PropertyKey[]): boolean {
  return before.some((k) => !after.includes(k)) && after.some((k) => !before.includes(k))
}

/** Takes down the toast under `key` (showToast's key), shown or waiting, if any: what it was about is gone. */
export function dismissKeyed(key: string): void {
  for (const t of toasts.value.filter((x) => x.key === key)) dismissToast(t.id)
}

/**
 * A toast's button: dismiss it, THEN run the action. The other way round, a
 * Retry that failed again at once (offline) refreshed this very toast — same
 * message — and the dismiss then removed it, as if the retry had worked.
 * A keyed toast the action shows again takes this one's place and id. Its
 * room is the button's until the action has run: a toast waiting for room
 * takes it only if the action showed nothing there.
 */
export function runToastAction(id: number): void {
  const at = toasts.value.findIndex((t) => t.id === id)
  const key = toasts.value[at]?.key
  const run = toasts.value[at]?.action?.run
  remove(id)
  if (key !== undefined) running = { key, id, at }
  try { run?.() } finally { running = undefined; refill() }
}

/**
 * Every toast, sticky ones included (logout). A Retry closes over the
 * previous account's spots and would fetch them back into the weather cache.
 */
export function clearToasts(): void {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
  raised.clear()
  held = undefined
  toasts.value = []
}
