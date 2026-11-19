/**
 * What the catch log keeps outside the stores, which logout wipes with them
 * (session.logout): the bite-scores kept on the device (insightSaved,
 * localStorage) and the unsaved form kept for the tab (catchDraft,
 * sessionStorage). Their keys live here, not in those modules: they load
 * with the catch log, and importing them into session.ts put 2.7 kB of
 * reading, writing and checking into the main bundle for a wipe of two keys.
 *
 * A module that is loaded hears of the wipe (onForget) and drops what it
 * holds in memory. Work begun before it — a score still fetching
 * (accountEpoch, below), the form still open (forgotten) — finds its epoch
 * moved on, and keeps nothing.
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

/**
 * Out of an account without a logout here: logged out in another tab, or
 * into another account. Nothing above is wiped then (the draft records its
 * own account: catchDraft). But work begun for the account left keeps
 * nothing (accountEpoch), and a module drops what it holds for that account
 * only (onLeave). A token refresh the server refused signs the page out and
 * leaves the account's log on screen: that is no leaving (stores/session).
 */
let account: string | null = null
let left = 0
const leaving = new Set<() => void>()

/**
 * stores/session: whose catch log the page holds, `who` (null: a guest's,
 * or none). The account signed in, else the one the log on the device
 * belongs to. Into an account from a guest's log leaves nothing: a guest
 * who signs in is still the one at the screen.
 */
export function accountIs(who: string | null): void {
  if (account !== null && who !== account) {
    left++
    for (const fn of leaving) fn()
  }
  account = who
}

/** `fn` runs when the account is left without a logout here. */
export function onLeave(fn: () => void): void { leaving.add(fn) }

/** Taken when work for the account begins. Moved on since, by a logout here or the account left, the work keeps nothing. */
export const accountEpoch = () => wipes + left
