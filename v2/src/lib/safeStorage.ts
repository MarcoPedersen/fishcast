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
