/**
 * What a pull does with the account's row, for the single-document-per-user
 * stores (setup, catches).
 *
 * This used to be last-write-wins on wall-clock stamps: a local edit stamped
 * after the row's updated_at pushed the WHOLE local document. Nothing said
 * which row version the local copy was built on, so "the row changed too" was
 * indistinguishable from "only I changed" — and a phone that logged a catch
 * offline on a Saturday-morning copy replaced the desktop's 8-catch row with
 * its 6. The stores now keep the row version they last agreed on (`baseAt` +
 * a snapshot, `base`), so the only question is whether the row has moved
 * since; device clocks decide nothing.
 *
 * Pure + side-effect free so it can be unit-tested without Supabase.
 */

/** Whose document the device holds: the signed-in account's, a guest's (no owner), or another account's. */
export type Owner = 'own' | 'guest' | 'foreign'

export interface PullState {
  /** No row for the account; a row still at this document's base; or a row someone else has written since. */
  remote: 'none' | 'base' | 'moved'
  /** No real content — a wipe or a fresh install, never an intentional deletion. */
  localEmpty: boolean
  owner: Owner
  /** Holds edits the account hasn't confirmed receiving. */
  dirty: boolean
  /** The document knows the row version it was built on (false: guest data, or saved by an older app version). */
  hasBase: boolean
}

/**
 * - 'claim'       → no row: the document becomes the account's (pushed if it has content)
 * - 'ignore'      → no row, and the document is another account's: leave it, never push it
 * - 'take-remote' → adopt the row
 * - 'none'        → already in sync
 * - 'push'        → unsynced edits sit on top of exactly what the row holds: send them
 * - 'merge'       → both changed since the base: three-way merge, then push the result
 * - 'union'       → both may have changed, and there is no base: keep everything from both, then push
 */
export type PullVerdict = 'claim' | 'ignore' | 'take-remote' | 'none' | 'push' | 'merge' | 'union'

export function decidePull(s: PullState): PullVerdict {
  if (s.remote === 'none') return s.owner === 'foreign' ? 'ignore' : 'claim'
  // An empty local side never beats real remote data: that is how a wipe once
  // overwrote an account. Normal editing can't empty a document entirely
  // (resetChoices keeps locations), so this costs no real deletion.
  if (s.localEmpty) return 'take-remote'
  // Guest data, or a previous user's on this device, is always "newer" simply
  // because it was just made — that is how 3 guest spots replaced an
  // 18-location account. The account's own row is authoritative over it, and
  // it is not merged in either: it isn't the account's work.
  if (s.owner !== 'own') return 'take-remote'
  if (!s.hasBase) return s.dirty ? 'union' : 'take-remote'
  if (s.remote === 'base') return s.dirty ? 'push' : 'none'
  return s.dirty ? 'merge' : 'take-remote'
}
