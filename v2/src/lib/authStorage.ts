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
 * it is kept in memory: the user stays signed in until the tab closes. That
 * is what auth-js does itself when storage is blocked. A reload signs out
 * too: inMemory says when that is so.
 */
export function createAuthStorage(): AuthStorage {
  const memory = new Map<string, string>()
  const held = shallowRef(false)
  /** The memory copy of `key` is now `value` (null: there is none). */
  function keep(key: string, value: string | null) {
    if (value === null) memory.delete(key)
    else memory.set(key, value)
    held.value = memory.size > 0
  }
  return {
    get inMemory() { return held.value },
    getItem(key) {
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
      if (writeOwn(key, value)) { keep(key, null); return }
      keep(key, value)
      // The copy it couldn't replace holds a spent refresh token (a token
      // refresh rotates it). Loaded by the next tab or visit, it would sign
      // that out, and reusing it can make the server revoke this session too.
      try { globalThis.localStorage.removeItem(key) } catch { /* blocked: nothing stored */ }
    },
    removeItem(key) {
      keep(key, null)
      try { globalThis.localStorage.removeItem(key) } catch { /* blocked: nothing stored */ }
    },
  }
}

/** The app's: lib/supabase gives it to the client, and main.ts reads inMemory. */
export const authStorage = createAuthStorage()
