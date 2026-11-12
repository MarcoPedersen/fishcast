/**
 * What the catch log keeps outside the stores, which logout wipes with them
 * (session.logout): the bite-scores kept on the device (insightSaved,
 * localStorage) and the unsaved form kept for the tab (catchDraft,
 * sessionStorage). Their keys live here, not in those modules: they load
 * with the catch log, and importing them into session.ts put 2.7 kB of
 * reading, writing and checking into the main bundle for a wipe of two keys.
 *
 * A module that is loaded hears of the wipe (onForget) and drops what it
 * holds in memory. Work begun before it — a score still fetching, the form
 * still open — finds forgotten() moved on, and keeps nothing.
 */
import { removeSession, removeStored } from './safeStorage'

/** The bite-scores kept on the device (insightSaved). */
export const SCORES_KEY = 'fc2-insight-results'
/** The catch log's unsaved form, kept for the tab (catchDraft). */
export const DRAFT_KEY = 'fc2-catch-draft'

let wipes = 0
/** Taken when work begins; changed by a wipe since, the work keeps nothing. */
export const forgotten = () => wipes

const listeners = new Set<() => void>()
/** `fn` runs at every wipe: drop what the module holds in memory. */
export function onForget(fn: () => void): void { listeners.add(fn) }

/** Logout: the next user on this device finds none of it. */
export function forgetAccountData(): void {
  wipes++
  removeStored(SCORES_KEY)
  removeSession(DRAFT_KEY)
  for (const fn of listeners) fn()
}
