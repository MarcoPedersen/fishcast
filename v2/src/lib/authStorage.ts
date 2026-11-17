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

export interface AuthStorageOptions {
  /** Opens the channel to the app's other tabs; null: none. Default: a BroadcastChannel, in a browser. */
  channel?: () => TabChannel | null
  /** The origin's Web Locks; null: none, and a page asks no tab. Default: navigator.locks, in a browser. */
  locks?: () => TabLocks | null
  /** How long a page waits for an answer once it has asked (ms). */
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
 * cannot answer (frozen in the background) makes a page wait this long, once.
 */
export const ASK_MS = 100

/**
 * What the adapters say to each other:
 *  - { key, value }: my memory copy of `key` is now `value`; null: I have
 *    none (signed out, or the device holds it now). Each tab does the same.
 *  - { ask }: a page with no copy asks for the others'. `ask` is its id.
 *  - { re, copies }: the answer to question `re`: every memory copy, by key.
 */
type Note = { key: string; value: string | null } | { ask: string } | { re: string; copies: Record<string, string> }

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
 * Lock while it holds a copy. At its first miss, a page with no copy looks at
 * the locks, and only when a tab holds one asks the others: one question for
 * every key, as auth-js first reads <key>-code-verifier, which no tab holds.
 * A guest's page, or one whose session is on the device, asks nothing and
 * waits for nothing. Without Web Locks a page asks no one, as before: it
 * starts signed out, and only a token refresh in a tab holding the copy
 * reaches it. auth-js refreshes only in a visible tab, so while that tab
 * stays hidden, or once it closes, the page stays signed out.
 */
export function createAuthStorage(o: AuthStorageOptions = {}): AuthStorage {
  const askMs = o.askMs ?? ASK_MS
  const memory = new Map<string, string>()
  const held = shallowRef(false)
  const takers = new Set<() => void>()
  let channel: TabChannel | null | undefined // undefined: not opened yet
  let locks: TabLocks | null | undefined // undefined: not looked for yet
  /** Lets go of this page's lock; null: it holds none. */
  let unlock: (() => void) | null = null
  /** This page's one question: undefined before its first miss, the wait while it waits, else null. */
  let question: Promise<void> | null | undefined
  /**
   * While it asks: the question's id, the keys changed since (heard from
   * another tab, or written here), and the end of the wait. A changed key is
   * newer than any answer: the tab answering may not have heard of it yet.
   */
  let asking: { id: string; changed: Set<string>; end: () => void } | null = null

  /** The memory copy of `key` is now `value` (null: there is none). */
  function keep(key: string, value: string | null) {
    if (value === null) memory.delete(key)
    else memory.set(key, value)
    held.value = memory.size > 0
    hold(held.value)
  }

  /** Holds the lock while this page holds a copy: a page opened later sees it, and asks. */
  function hold(want: boolean) {
    if (want === (unlock !== null)) return
    if (!want) { unlock!(); unlock = null; return }
    // No channel: no tab could ask this one.
    const l = lockManager()
    if (!l || !channel) return
    let release = () => {}
    const released = new Promise<void>((r) => { release = r })
    unlock = release
    try {
      l.request(AUTH_LOCK, { mode: 'shared' }, () => released).catch(() => { /* refused: no page asks, as without locks */ })
    } catch { /* as refused */ }
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

  function taken() {
    for (const listener of [...takers]) { try { listener() } catch { /* the listener's own */ } }
  }

  function heard(data: unknown) {
    if (typeof data !== 'object' || data === null) return
    const n = data as Record<string, unknown>
    if ('ask' in n) {
      // Every memory copy: the asker has none. Never the device's.
      if (typeof n.ask === 'string' && memory.size > 0) say({ re: n.ask, copies: Object.fromEntries(memory) })
      return
    }
    if ('re' in n) {
      // Only an answer to this page's question, while it waits. Taken late,
      // or by a page that didn't ask, it could put back a copy whose refresh
      // token a refresh since has spent.
      if (asking && n.re === asking.id && isCopies(n.copies)) answered(n.copies, asking)
      return
    }
    if (typeof n.key !== 'string' || (typeof n.value !== 'string' && n.value !== null)) return
    asking?.changed.add(n.key)
    keep(n.key, n.value)
    if (n.value !== null) taken()
  }

  function answered(copies: Record<string, string>, q: NonNullable<typeof asking>) {
    let took = false
    for (const [key, value] of Object.entries(copies)) {
      // A change since is newer, and the device's copy wins, as at any read.
      if (q.changed.has(key) || device(key) !== null) continue
      keep(key, value)
      took = true
    }
    q.end()
    if (took) taken()
  }

  /**
   * At the first miss, asks the other tabs once for their memory copies:
   * only when this page has none, and a tab holds the lock. The promise ends
   * at the first answer, or after askMs; null: nothing to wait for.
   */
  function ask(): Promise<void> | null {
    if (question !== undefined) return question
    question = null
    const l = lockManager()
    if (!channel || !l || memory.size > 0) return null
    const q = { id: Math.random().toString(36).slice(2) + Date.now().toString(36), changed: new Set<string>(), end: () => {} }
    asking = q
    question = (async () => {
      let others = false
      try { others = ((await l.query()).held ?? []).some((x) => x.name === AUTH_LOCK) } catch { /* refused: as without locks */ }
      if (!others || !channel) return
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => q.end(), askMs)
        // At once: a second tab's answer may already be on its way.
        q.end = () => { clearTimeout(timer); if (asking === q) asking = null; resolve() }
        say({ ask: q.id })
      })
    })().finally(() => {
      if (asking === q) asking = null
      question = null
    })
    return question
  }

  return {
    get inMemory() { return held.value },
    getItem(key) {
      open()
      const found = read(key)
      if (found !== null) return found
      // Another tab may hold one in its memory. auth-js awaits the answer.
      const wait = ask()
      return wait ? wait.then(() => read(key)) : null
    },
    setItem(key, value) {
      open()
      asking?.changed.add(key)
      if (writeOwn(key, value)) {
        keep(key, null)
        say({ key, value: null }) // the other tabs read it on the device now
        return
      }
      keep(key, value)
      say({ key, value })
      // The copy it couldn't replace holds a spent refresh token (a token
      // refresh rotates it). Loaded by the next tab or visit, it would sign
      // that out, and reusing it can make the server revoke this session too.
      try { globalThis.localStorage.removeItem(key) } catch { /* blocked: nothing stored */ }
    },
    removeItem(key) {
      open()
      asking?.changed.add(key)
      keep(key, null)
      say({ key, value: null })
      try { globalThis.localStorage.removeItem(key) } catch { /* blocked: nothing stored */ }
    },
    onTake(listener) {
      open()
      takers.add(listener)
      return () => { takers.delete(listener) }
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
