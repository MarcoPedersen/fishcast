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
  /** Stops listening to the other tabs. The app never does; the tests close what they open. */
  close(): void
}

/** What the adapter uses of a BroadcastChannel; the tests pass a stand-in. */
export interface TabChannel {
  postMessage(message: unknown): void
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void
  close(): void
}

export interface AuthStorageOptions {
  /** Opens the channel to the app's other tabs; null: none. Default: a BroadcastChannel, in a browser. */
  channel?: () => TabChannel | null
}

/**
 * The adapters' own channel. Not auth-js's: that one is named after its
 * storage key, and takes every message on it for an auth event.
 */
export const AUTH_CHANNEL = 'fc2-auth-memory'

/**
 * What the adapters tell each other: my memory copy of `key` is now `value`;
 * null: there is none (signed out, or the device holds it now).
 */
type Note = { key: string; value: string | null }

function browserChannel(): TabChannel | null {
  // As auth-js, which opens its own channel only in a browser.
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof BroadcastChannel !== 'function') return null
  return new BroadcastChannel(AUTH_CHANNEL)
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
 * device holds is never sent. A tab opened later starts signed out, as
 * before, until the next token refresh reaches it.
 */
export function createAuthStorage(o: AuthStorageOptions = {}): AuthStorage {
  const memory = new Map<string, string>()
  const held = shallowRef(false)
  let channel: TabChannel | null | undefined // undefined: not opened yet

  /** The memory copy of `key` is now `value` (null: there is none). */
  function keep(key: string, value: string | null) {
    if (value === null) memory.delete(key)
    else memory.set(key, value)
    held.value = memory.size > 0
  }

  /** Opens the channel at the first call: auth-js's first read, as the page loads. */
  function open() {
    if (channel !== undefined) return
    try { channel = (o.channel ?? browserChannel)() } catch { channel = null }
    channel?.addEventListener('message', (e) => heard(e.data))
  }

  function tell(note: Note) {
    try { channel?.postMessage(note) } catch { /* closed */ }
  }

  function heard(data: unknown) {
    if (typeof data !== 'object' || data === null) return
    const { key, value } = data as Record<string, unknown>
    if (typeof key !== 'string' || (typeof value !== 'string' && value !== null)) return
    keep(key, value)
  }

  return {
    get inMemory() { return held.value },
    getItem(key) {
      open()
      // A refused write removes the device copy (setItem), so a copy there
      // is newer: another tab's. Tabs share one session, as with auth-js's
      // own storage.
      try {
        const stored = globalThis.localStorage.getItem(key)
        if (stored !== null) { keep(key, null); return stored }
      } catch { /* blocked */ }
      return memory.get(key) ?? null
    },
    setItem(key, value) {
      open()
      if (writeOwn(key, value)) {
        keep(key, null)
        tell({ key, value: null }) // the other tabs read it on the device now
        return
      }
      keep(key, value)
      tell({ key, value })
      // The copy it couldn't replace holds a spent refresh token (a token
      // refresh rotates it). Loaded by the next tab or visit, it would sign
      // that out, and reusing it can make the server revoke this session too.
      try { globalThis.localStorage.removeItem(key) } catch { /* blocked: nothing stored */ }
    },
    removeItem(key) {
      open()
      keep(key, null)
      tell({ key, value: null })
      try { globalThis.localStorage.removeItem(key) } catch { /* blocked: nothing stored */ }
    },
    close() {
      channel?.close()
      channel = null
    },
  }
}

/** The app's: lib/supabase gives it to the client, and main.ts reads inMemory. */
export const authStorage = createAuthStorage()
