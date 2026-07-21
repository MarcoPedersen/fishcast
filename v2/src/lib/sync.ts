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
 */
export function reconcile<T>(localUpdatedAt: number, remote: RemoteDoc<T>): 'take-remote' | 'keep-local' | 'noop' {
  if (remote.data == null) return 'noop'
  // Strictly-newer local edits win; ties and older-local defer to remote.
  return localUpdatedAt > remote.updatedAt ? 'keep-local' : 'take-remote'
}
