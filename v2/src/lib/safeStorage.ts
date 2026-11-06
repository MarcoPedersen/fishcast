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
