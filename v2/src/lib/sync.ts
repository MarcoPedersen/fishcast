/**
 * Last-write-wins reconciliation for the single-document-per-user stores
 * (setup, catches). Both sides carry an `updatedAt` wall-clock stamp set when
 * the data was last edited; on pull we keep whichever edit is newer instead of
 * blindly overwriting local — so offline edits aren't discarded and the most
 * recent device wins across devices.
 *
 * Pure + side-effect free so it can be unit-tested without Supabase.
 */
export interface RemoteDoc<T> { data: T | null; updatedAt: number }

/**
 * Decide what to do with a freshly-pulled remote document.
 * - 'take-remote'  → adopt remote (it's newer, or local has no real edits)
 * - 'keep-local'   → local has newer un-synced edits; keep them (caller re-pushes)
 * - 'noop'         → nothing to adopt (no remote data)
 *
 * `localIsEmpty` is a safety net: a completely empty local document must never
 * win over real remote data, however new its timestamp looks. Normal editing
 * can't produce a fully-empty document (resetChoices keeps locations), so an
 * empty local side means a wipe/fresh install, not an intentional deletion —
 * and treating it as "newer" is what silently destroyed accounts before.
 */
export function reconcile<T>(
  localUpdatedAt: number, remote: RemoteDoc<T>, localIsEmpty = false,
): 'take-remote' | 'keep-local' | 'noop' {
  if (remote.data == null) return 'noop'
  if (localIsEmpty) return 'take-remote'
  // Strictly-newer local edits win; ties and older-local defer to remote.
  return localUpdatedAt > remote.updatedAt ? 'keep-local' : 'take-remote'
}
