/**
 * localStorage for small preferences (language, dashboard density and
 * horizon, reminders), never throwing. With site data blocked (Chrome's
 * "don't allow sites to save data", Firefox with cookies off, some in-app
 * browsers) even reading `window.localStorage` throws a SecurityError; i18n.ts
 * did that while it loaded, every module imports it, and the app was a blank
 * page. Then a preference lives in memory for the visit instead — it just
 * isn't remembered. (The synced documents guard their own storage: stores/.)
 */
const memory = new Map<string, string>()

export function readStored(key: string): string | null {
  try { return globalThis.localStorage.getItem(key) } catch { return memory.get(key) ?? null }
}

/** False when the value is kept for this visit only. */
export function writeStored(key: string, value: string): boolean {
  try {
    globalThis.localStorage.setItem(key, value)
    return true
  } catch {
    memory.set(key, value)
    return false
  }
}

export function removeStored(key: string): void {
  memory.delete(key)
  try { globalThis.localStorage.removeItem(key) } catch { /* blocked: nothing stored */ }
}

/**
 * What the app derives and keeps on the device, which it can compute or fetch
 * again: the kept bite-scores (lib/insightSaved, forgetOnLogout SCORES_KEY),
 * then the weather cache (stores/forecast). Up to ~1.6 MB together, in an
 * origin quota of ~5 MB (Safari: about half that in characters).
 */
export const DERIVED_KEYS = ['fc2-insight-results', 'fc2-forecasts'] as const

/**
 * Writes the user's own data — the catch log, the spots — that only this
 * device may hold (a guest's, or an edit not yet pushed). With the storage
 * full, derived data gives way, one key at a time, until it fits: their
 * stores write it again, smaller, next time. False when it never fits or the
 * storage is blocked; never throws.
 */
export function writeOwn(key: string, value: string): boolean {
  for (let i = 0; ; i++) {
    try {
      globalThis.localStorage.setItem(key, value)
      return true
    } catch { /* full, or blocked */ }
    if (i >= DERIVED_KEYS.length) return false
    try { globalThis.localStorage.removeItem(DERIVED_KEYS[i]) } catch { return false }
  }
}

/**
 * True when the site may keep nothing at all — site data blocked, so even
 * reading `localStorage` throws, or a web view with no storage (null) —
 * rather than a storage that is full. The user is told which of the two to
 * fix (stores/localSave).
 */
export function storageBlocked(): boolean {
  try { return typeof globalThis.localStorage?.setItem !== 'function' } catch { return true }
}

/**
 * The same for sessionStorage — this tab's, gone with it, kept over a reload
 * (the catch log's unsaved form: lib/catchDraft). Blocked or full, it lives
 * in memory for the visit — and a value in memory is the newer one.
 */
const sessionMemory = new Map<string, string>()

export function readSession(key: string): string | null {
  if (sessionMemory.has(key)) return sessionMemory.get(key)!
  try { return globalThis.sessionStorage.getItem(key) } catch { return null }
}

/** False when the value is kept for this visit only. */
export function writeSession(key: string, value: string): boolean {
  try {
    globalThis.sessionStorage.setItem(key, value)
    sessionMemory.delete(key)
    return true
  } catch {
    sessionMemory.set(key, value)
    return false
  }
}

export function removeSession(key: string): void {
  sessionMemory.delete(key)
  try { globalThis.sessionStorage.removeItem(key) } catch { /* blocked: nothing stored */ }
}

/** The list kept aside under `key` (keepAside); [] when there is none, or it can't be read. */
export function readAside<T>(key: string): T[] {
  try {
    const v = JSON.parse(readStored(key) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'object' && x !== null) : []
  } catch { return [] }
}

/**
 * Keep `items` on this device under `key`, added to what is kept there
 * already (by id: an item kept before stays as it was). For what a sign-in
 * takes off the screen but nothing says may be thrown away. Never throws.
 */
export function keepAside<T extends { id: string }>(key: string, items: readonly T[]): void {
  if (!items.length) return
  const kept = readAside<T>(key)
  const have = new Set(kept.map((k) => k.id))
  writeStored(key, JSON.stringify([...kept, ...items.filter((i) => !have.has(i.id))]))
}
