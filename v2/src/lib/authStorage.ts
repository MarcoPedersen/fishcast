import { shallowRef } from 'vue'
import type { SupportedStorage } from '@supabase/supabase-js'
import { writeOwn } from './safeStorage'

export interface AuthStorage extends SupportedStorage {
  /**
   * True while the session lives only in this page's memory: a reload, or
   * closing the app, signs out. Reactive. main.ts makes no reload by itself
   * then, and tells the user once.
   */
  readonly inMemory: boolean
  /**
   * Calls `listener` each time this page takes in another tab's memory copy:
   * an answer to its question, or a change. auth-js may say nothing of it
   * here, so stores/auth reads the session again. Listening opens the
   * channel. Returns the undo.
   */
  onTake(listener: () => void): () => void
  /**
   * Calls `listener` each time this page drops a copy on another tab's
   * word that it was signed out, or replaced, while the page was in the
   * back/forward cache. auth-js here heard nothing of it, so stores/auth
   * reads the session again. Returns the undo.
   */
  onDrop(listener: () => void): () => void
  /** Stops talking to the other tabs, and lets go of the lock. The app never does; the tests close what they open. */
  close(): void
}

/** What the adapter uses of a BroadcastChannel; the tests pass a stand-in. */
export interface TabChannel {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void
  close(): void
}

/** What the adapter uses of the browser's Web Locks (navigator.locks); the tests pass a stand-in. */
export interface TabLocks {
  request(name: string, options: { mode: 'shared' }, granted: () => Promise<void>): Promise<unknown>
  query(): Promise<{ held?: { name?: string }[] }>
}

/**
 * What the adapter uses of the page's window: pagehide and pageshow, whose
 * `persisted` says the page goes into, or comes back from, the
 * back/forward cache. The tests pass a stand-in.
 */
export interface TabPage {
  addEventListener(type: 'pagehide' | 'pageshow', listener: (e?: { persisted?: boolean }) => void): void
}

/** What the adapter uses of the page's document: freeze and resume (Page Lifecycle). The tests pass a stand-in. */
export interface TabDocument {
  addEventListener(type: 'freeze' | 'resume', listener: () => void): void
}

export interface AuthStorageOptions {
  /** Opens the channel to the app's other tabs; null: none. Default: a BroadcastChannel, in a browser. */
  channel?: () => TabChannel | null
  /** The origin's Web Locks; null: none, and a page asks no tab. Default: navigator.locks, in a browser. */
  locks?: () => TabLocks | null
  /** The page's window, for pagehide and pageshow; null: none. Default: window, in a browser. */
  page?: () => TabPage | null
  /** The page's document, for freeze and resume; null: none. Default: document, in a browser. */
  doc?: () => TabDocument | null
  /** How long a page waits for the other tabs at its first miss: the look at the locks, and their answer (ms). */
  askMs?: number
}

/**
 * The adapters' own channel. Not auth-js's: that one is named after its
 * storage key, and takes every message on it for an auth event.
 */
export const AUTH_CHANNEL = 'fc2-auth-memory'

/**
 * The lock a tab holds, shared, while it holds a memory copy. auth-js takes
 * none of its own by default (2.108); a lock of it would be named after its
 * key too.
 */
export const AUTH_LOCK = 'fc2-auth-memory'

/**
 * Another tab answers within milliseconds. Only a tab that holds a copy but
 * cannot answer makes a page wait this long, once: one busy past it, or one
 * whose browser freezes it in a moment it has not said so yet. The look at
 * the locks counts in it too.
 */
export const ASK_MS = 100

/**
 * What the adapters say to each other:
 *  - { key, value, was }: my memory copy of `key` is now `value`. `was` is
 *    the fingerprint of what I held for it before (none: nothing).
 *  - { key, value: null, out }: I hold no memory copy of `key`: signed out
 *    (removed it), or the device holds it now. `out` is the fingerprint of
 *    the copy a sign-out removed (none: it removed nothing). Each tab does
 *    the same.
 *  - { ask }: a page with no copy asks for the others'. `ask` is its id.
 *  - { ask, have }: a page back from the back/forward cache asks too.
 *    `have` is the fingerprints of the copies it holds.
 *  - { re, copies }: the answer to question `re`: every memory copy, by key.
 *  - { re, copies, out }: to a page back from the cache, also the
 *    fingerprints in its `have` that were signed out, or replaced by a
 *    token refresh. `copies` may be empty then.
 * A tab of an older build answers `have` as any question, and an `out` it
 * reads as a plain answer.
 */
type Note =
  | { key: string; value: string; was?: string }
  | { key: string; value: null; out?: string }
  | { ask: string; have?: string[] }
  | { re: string; copies: Record<string, string>; out?: string[] }

/** How many signed-out copies a page remembers (their fingerprints), and how many replaced ones. */
export const OUT_KEPT = 32

function browserChannel(): TabChannel | null {
  // As auth-js, which opens its own channel only in a browser.
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof BroadcastChannel !== 'function') return null
  return new BroadcastChannel(AUTH_CHANNEL)
}

function browserLocks(): TabLocks | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null
  const locks = globalThis.navigator?.locks
  return typeof locks?.request === 'function' && typeof locks.query === 'function' ? locks : null
}

function browserPage(): TabPage | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null
  return typeof window.addEventListener === 'function' ? window : null
}

function browserDocument(): TabDocument | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null
  return typeof document.addEventListener === 'function' ? document : null
}

/**
 * A copy's fingerprint: a 53-bit hash of its key and value (cyrb53), so a
 * sign-out can name the copy it removed without sending its tokens again.
 */
export function fingerprint(key: string, value: string): string {
  const s = key + '\n' + value
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

function isCopies(data: unknown): data is Record<string, string> {
  return typeof data === 'object' && data !== null && !Array.isArray(data) && Object.values(data).every((v) => typeof v === 'string')
}

/**
 * Where auth-js keeps the signed-in session (~2–3 KB, under its own key
 * `sb-<project>-auth-token`). auth-js writes it with no catch, and
 * signInWithPassword rethrows any error that isn't an auth error: on a device
 * whose storage was full, signing in threw a QuotaExceededError after the
 * server had said yes, so the session was lost and the form hung.
 *
 * The session is written like the user's own data (writeOwn): the derived
 * caches give way first. When it still doesn't fit, or site data is blocked,
 * it is kept in memory: the user stays signed in until the app closes. That
 * is what auth-js does itself when storage is blocked. A reload signs out
 * too: inMemory says when that is so.
 *
 * The app's open tabs share the memory copy, as they share the device's.
 * auth-js tells them of each sign-in, token refresh and sign-out, but a tab
 * beside the one holding it heard SIGNED_IN with no session to send, and
 * every sync it made failed. Each change of the memory copy now goes to the
 * other tabs' adapters over a BroadcastChannel of their own: same origin
 * only, as the device's copy, and a sign-out takes every copy. What the
 * device holds is never sent.
 *
 * A page opened later, or reloaded, asks for it. A tab holds a shared Web
 * Lock while it holds a copy, and lets go of it while the page is in the
 * back/forward cache (pagehide to pageshow) or frozen in the background
 * (freeze to resume): it answers no one then. At its first miss, a page with
 * no copy looks at the locks, and only when a tab holds one asks the others:
 * one question for every key, as auth-js first reads <key>-code-verifier,
 * which no tab holds. A guest's page, or one whose session is on the
 * device, asks nothing and waits for nothing. A page with no copy that
 * hears the answer to another page asks again: auth-js on that page tells
 * it SIGNED_IN, with no copy.
 *
 * A sign-out in one tab can cross a token refresh in another: the refresh
 * is saved before the sign-out's note arrives, and its note reaches the tab
 * that signed out after that tab dropped its copy. Taken, it signed that
 * tab in again, with a refresh token the sign-out had revoked. So a
 * sign-out names the copy it removed, and a copy sent names the one it
 * replaced: every tab leaves a refresh of a copy signed out (and the
 * refreshes of that), and that copy itself. A new sign-in replaces nothing,
 * and is taken, in whichever tab it was made, a page opened since
 * included. Not by the clock: the tabs' clocks may differ, and a refresh
 * saved a moment after the sign-out was still the older.
 *
 * A page in the back/forward cache hears nothing (a channel's messages go
 * only to fully active documents), a sign-out or a token refresh in another
 * tab included. Back, it held a copy signed out, or one whose refresh token
 * was spent: auth-js read it at the visibilitychange and told every tab
 * SIGNED_IN with it, and a page opened after took it by answer. So a page
 * back from the cache, holding a copy, asks the other tabs as a page opened
 * later does, naming its copies by fingerprint. A tab that knows one was
 * signed out or replaced says so, and the page drops it; a tab holding a
 * copy sends it, and the page takes it. It asks whether or not a tab holds
 * the lock: the tab that signed out holds none. Until the answer, or
 * ASK_MS, it holds no lock and answers no one, and its reads wait. No tab
 * that knows (all closed since, or of an older build): it keeps its copy.
 *
 * Without Web Locks a page asks no one, as before: it starts signed out,
 * and only a token refresh in a tab holding the copy reaches it. auth-js
 * refreshes only in a visible tab, so while that tab stays hidden, or once
 * it closes, the page stays signed out.
 */
export function createAuthStorage(o: AuthStorageOptions = {}): AuthStorage {
  const askMs = o.askMs ?? ASK_MS
  const memory = new Map<string, string>()
  const held = shallowRef(false)
  const takers = new Set<() => void>()
  const droppers = new Set<() => void>()
  let channel: TabChannel | null | undefined // undefined: not opened yet
  let locks: TabLocks | null | undefined // undefined: not looked for yet
  /** Lets go of this page's lock; null: it holds none. */
  let unlock: (() => void) | null = null
  /** From pagehide to pageshow: the page is in the back/forward cache, or going. */
  let away = false
  /** From freeze to resume: the browser has frozen the page in the background. */
  let frozen = false
  let watching = false // pagehide, pageshow, freeze and resume
  /** The fingerprints of the last copies signed out, here or in another tab (oldest first). */
  const out = new Set<string>()
  /**
   * The fingerprints of the last copies replaced by another, here or in
   * another tab (oldest first): a token refresh spends the refresh token of
   * the copy it replaces. Told to a page back from the cache.
   */
  const replaced = new Set<string>()
  /** Whether this page has looked at its first miss yet. */
  let asked = false
  /** The wait for the question under way, which reads wait for too; null: none. */
  let waiting: Promise<void> | null = null
  /**
   * While it asks: the question's id, the keys changed since (heard from
   * another tab, or written here), and the end of the wait. A changed key is
   * newer than any answer: the tab answering may not have heard of it yet.
   * `have`: back from the back/forward cache, the fingerprints of the copies
   * it asks about.
   */
  let asking: { id: string; changed: Set<string>; end: () => void; have?: string[] } | null = null

  /** The memory copy of `key` is now `value` (null: there is none). */
  function keep(key: string, value: string | null) {
    if (value === null) memory.delete(key)
    else memory.set(key, value)
    held.value = memory.size > 0
    hold()
  }

  /**
   * Holds the lock while this page holds a copy: a page opened later sees it,
   * and asks. Not while the page is away: in the back/forward cache it
   * answers no one, and Chrome and Firefox keep a page that holds a lock out
   * of that cache. Back then loaded it again, signed out. Nor while it is
   * frozen: it answers no one either, and each page opened meanwhile waited
   * ASK_MS for it. Nor, back from the cache, while it asks whether its
   * copies are still good: a page opened meanwhile would ask it.
   */
  function hold(want = memory.size > 0 && !away && !frozen && !asking?.have) {
    if (want === (unlock !== null)) return
    if (!want) { unlock!(); unlock = null; return }
    // No channel: no tab could ask this one.
    const l = lockManager()
    if (!l || !channel) return
    watchPage()
    let release = () => {}
    const released = new Promise<void>((r) => { release = r })
    unlock = release
    try {
      l.request(AUTH_LOCK, { mode: 'shared' }, () => released).catch(() => { /* refused: no page asks, as without locks */ })
    } catch { /* as refused */ }
  }

  /**
   * From the first lock on: lets go of it at pagehide and at freeze, and
   * takes it again at pageshow and at resume. A guest's page listens for
   * none of them. A frozen page runs no more tasks: the promise holding the
   * lock settles in the freeze listener's own turn, before the page stops.
   * Back from the cache (persisted), it first asks about its copies. A
   * frozen page loses nothing: what is posted to it arrives at resume.
   */
  function watchPage() {
    if (watching) return
    watching = true
    try {
      const page = (o.page ?? browserPage)()
      page?.addEventListener('pagehide', () => { away = true; hold() })
      page?.addEventListener('pageshow', (e) => {
        away = false
        if (e?.persisted && memory.size > 0) inquire([...memory].map(([key, value]) => fingerprint(key, value)))
        hold()
      })
    } catch { /* no page: the lock is held as before */ }
    try {
      const doc = (o.doc ?? browserDocument)()
      doc?.addEventListener('freeze', () => { frozen = true; hold() })
      doc?.addEventListener('resume', () => { frozen = false; hold() })
    } catch { /* no document: as never frozen */ }
  }

  function lockManager(): TabLocks | null {
    if (locks === undefined) { try { locks = (o.locks ?? browserLocks)() } catch { locks = null } }
    return locks
  }

  function device(key: string): string | null {
    try { return globalThis.localStorage.getItem(key) } catch { return null /* blocked */ }
  }

  /**
   * A refused write removes the device copy (setItem), so a copy there is
   * newer: another tab's. Tabs share one session, as with auth-js's own
   * storage.
   */
  function read(key: string): string | null {
    const stored = device(key)
    if (stored !== null) { keep(key, null); return stored }
    return memory.get(key) ?? null
  }

  /** Opens the channel at the first call: auth-js's first read, as the page loads. */
  function open() {
    if (channel !== undefined) return
    try { channel = (o.channel ?? browserChannel)() } catch { channel = null }
    channel?.addEventListener('message', (e) => heard(e.data))
  }

  function say(note: Note) {
    try { channel?.postMessage(note) } catch { /* closed */ }
  }

  function tell(listeners: Set<() => void>) {
    for (const listener of [...listeners]) { try { listener() } catch { /* the listener's own */ } }
  }
  const taken = () => tell(takers)

  /** What this page holds for `key` now: its memory copy, or the device's. */
  function current(key: string): string | null {
    return memory.get(key) ?? device(key)
  }

  /** Adds a fingerprint to `prints`, which keeps the last OUT_KEPT. */
  function remember(prints: Set<string>, print: string) {
    prints.delete(print)
    prints.add(print)
    if (prints.size > OUT_KEPT) prints.delete(prints.values().next().value!)
  }

  /** Remembers a copy signed out (its fingerprint), here or in another tab. */
  const signedOut = (print: string) => remember(out, print)

  /**
   * Whether another tab's copy is one signed out, or (`was`) a refresh of
   * one: it crossed that sign-out on its way. Taken, it would sign this
   * page in again.
   */
  function stale(key: string, value: string, was?: unknown): boolean {
    return out.has(fingerprint(key, value)) || (typeof was === 'string' && out.has(was))
  }

  function heard(data: unknown) {
    if (typeof data !== 'object' || data === null) return
    const n = data as Record<string, unknown>
    if ('ask' in n) {
      if (typeof n.ask !== 'string') return
      // Back from the cache, the asker names its copies: those this page
      // knows were signed out, or replaced, are spent.
      const spent = Array.isArray(n.have) ? n.have.filter((p): p is string => typeof p === 'string' && (out.has(p) || replaced.has(p))) : []
      // Every memory copy: the asker has none, or old ones. Never the
      // device's, nor copies this page is asking about itself.
      const copies = asking?.have ? {} : Object.fromEntries(memory)
      if (spent.length > 0) say({ re: n.ask, copies, out: spent })
      else if (Object.keys(copies).length > 0) say({ re: n.ask, copies })
      return
    }
    if ('re' in n) {
      // Only an answer to this page's question, while it waits. Taken late,
      // or by a page that didn't ask, it could put back a copy whose refresh
      // token a refresh since has spent.
      const copies = n.copies
      if (!isCopies(copies)) return
      if (asking) { if (n.re === asking.id) answered(copies, asking, n.out); return }
      // Another page's answer, or one too late for this page: a tab holds a
      // copy this page lacks. The page that takes it tells this one SIGNED_IN
      // (auth-js, at its load) with no copy, and each sync here would go
      // without a session. Ask again: a question of its own.
      const lacks = (key: string) => device(key) === null && !stale(key, copies[key])
      if (memory.size === 0 && Object.keys(copies).some(lacks)) inquire()
      return
    }
    if (typeof n.key !== 'string' || (typeof n.value !== 'string' && n.value !== null)) return
    // Left, a refresh of a copy signed out is signed out too: a refresh of it
    // that follows is left as well.
    if (n.value !== null && stale(n.key, n.value, n.was)) { signedOut(fingerprint(n.key, n.value)); return }
    asking?.changed.add(n.key)
    if (n.value === null && typeof n.out === 'string') signedOut(n.out)
    if (n.value !== null && typeof n.was === 'string' && n.was !== fingerprint(n.key, n.value)) remember(replaced, n.was)
    keep(n.key, n.value)
    if (n.value !== null) taken()
  }

  function answered(copies: Record<string, string>, q: NonNullable<typeof asking>, spent: unknown) {
    let took = false
    let dropped = false
    // Back from the cache: each copy another tab says was signed out, or
    // replaced, is dropped, and left from then on, as a copy signed out.
    if (q.have && Array.isArray(spent)) {
      for (const [key, value] of [...memory]) {
        const print = fingerprint(key, value)
        if (q.changed.has(key) || !spent.includes(print)) continue
        keep(key, null)
        signedOut(print)
        dropped = true
      }
    }
    for (const [key, value] of Object.entries(copies)) {
      // A change since is newer, and the device's copy wins, as at any read.
      // A copy signed out is left, as in a change.
      if (q.changed.has(key) || device(key) !== null || stale(key, value)) continue
      keep(key, value)
      took = true
    }
    q.end()
    if (took) taken()
    if (dropped) tell(droppers)
  }

  /**
   * At the first miss, asks the other tabs for their memory copies; after
   * that, only when it hears another's answer (heard). The wait it returns,
   * or the one under way, ends at the first answer or after askMs; null:
   * nothing to wait for.
   */
  function ask(): Promise<void> | null {
    if (!asked) { asked = true; inquire() }
    return waiting
  }

  /**
   * Asks, when this page has no copy, asks nothing yet, and a tab holds the
   * lock. The cap runs from the start, the look at the locks included: one
   * that never settled held auth-js's first read, and the page's start.
   * `have`: back from the back/forward cache, it asks about the copies it
   * holds (their fingerprints), and whether or not a tab holds the lock. It
   * takes the lock again at the end.
   */
  function inquire(have?: string[]) {
    const l = lockManager()
    if (!channel || !l || (memory.size > 0 && !have) || asking) return
    const q = { id: Math.random().toString(36).slice(2) + Date.now().toString(36), changed: new Set<string>(), end: () => {}, have }
    asking = q
    const wait: Promise<void> = new Promise<void>((resolve) => {
      const timer = setTimeout(() => q.end(), askMs)
      q.end = () => {
        clearTimeout(timer)
        if (asking === q) asking = null
        if (have) hold()
        resolve()
      }
      void (async () => {
        let others = !!have
        if (!have) { try { others = ((await l.query()).held ?? []).some((x) => x.name === AUTH_LOCK) } catch { /* refused: as without locks */ } }
        if (asking !== q) return // the time is up, or the page closed: too late to ask
        if (!others || !channel) { q.end(); return }
        say(have ? { ask: q.id, have } : { ask: q.id })
      })()
    }).finally(() => {
      if (waiting === wait) waiting = null
    })
    waiting = wait
  }

  return {
    get inMemory() { return held.value },
    getItem(key) {
      open()
      // Back from the cache, its copies may be spent: auth-js's read at the
      // visibilitychange waits for the answer, and tells no tab SIGNED_IN
      // with a copy signed out.
      if (asking?.have && waiting) return waiting.then(() => read(key))
      const found = read(key)
      if (found !== null) return found
      // Another tab may hold one in its memory. auth-js awaits the answer.
      const wait = ask()
      return wait ? wait.then(() => read(key)) : null
    },
    setItem(key, value) {
      open()
      asking?.changed.add(key)
      const before = current(key)
      // The copy it replaces holds a spent refresh token (a token refresh rotates it).
      if (before !== null && before !== value) remember(replaced, fingerprint(key, before))
      if (writeOwn(key, value)) {
        keep(key, null)
        say({ key, value: null }) // the other tabs read it on the device now
        return
      }
      keep(key, value)
      // With the copy it replaces (a token refresh's), if any: a tab where
      // that one was signed out leaves this one (heard).
      say(before === null ? { key, value } : { key, value, was: fingerprint(key, before) })
      // The copy it couldn't replace holds a spent refresh token (a token
      // refresh rotates it). Loaded by the next tab or visit, it would sign
      // that out, and reusing it can make the server revoke this session too.
      try { globalThis.localStorage.removeItem(key) } catch { /* blocked: nothing stored */ }
    },
    removeItem(key) {
      open()
      asking?.changed.add(key)
      // A sign-out (or auth-js clearing a key it is done with) names the copy
      // it removes: a refresh of it on its way from another tab is left (heard).
      const before = current(key)
      keep(key, null)
      if (before === null) say({ key, value: null })
      else {
        const print = fingerprint(key, before)
        signedOut(print)
        say({ key, value: null, out: print })
      }
      try { globalThis.localStorage.removeItem(key) } catch { /* blocked: nothing stored */ }
    },
    onTake(listener) {
      open()
      takers.add(listener)
      return () => { takers.delete(listener) }
    },
    onDrop(listener) {
      droppers.add(listener)
      return () => { droppers.delete(listener) }
    },
    close() {
      channel?.close()
      channel = null
      asking?.end()
      hold(false)
    },
  }
}

/** The app's: lib/supabase gives it to the client, main.ts reads inMemory, and stores/auth listens to it. */
export const authStorage = createAuthStorage()
