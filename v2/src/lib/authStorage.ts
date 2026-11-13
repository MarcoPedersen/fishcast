import type { SupportedStorage } from '@supabase/supabase-js'
import { writeOwn } from './safeStorage'

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
 * is what auth-js does itself when storage is blocked.
 */
export function createAuthStorage(): SupportedStorage {
  const memory = new Map<string, string>()
  return {
    getItem(key) {
      // A refused write removes the device copy (setItem), so a copy there
      // is newer: another tab's. Tabs share one session, as with auth-js's
      // own storage.
      try {
        const stored = globalThis.localStorage.getItem(key)
        if (stored !== null) { memory.delete(key); return stored }
      } catch { /* blocked */ }
      return memory.get(key) ?? null
    },
    setItem(key, value) {
      if (writeOwn(key, value)) { memory.delete(key); return }
      memory.set(key, value)
      // The copy it couldn't replace holds a spent refresh token (a token
      // refresh rotates it). Loaded by the next tab or visit, it would sign
      // that out, and reusing it can make the server revoke this session too.
      try { globalThis.localStorage.removeItem(key) } catch { /* blocked: nothing stored */ }
    },
    removeItem(key) {
      memory.delete(key)
      try { globalThis.localStorage.removeItem(key) } catch { /* blocked: nothing stored */ }
    },
  }
}
