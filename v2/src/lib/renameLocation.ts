/**
 * Committing a rename typed into the Lokationer list.
 *
 * The rename input used to be `v-model="l.name"` on the live store object, so
 * every keystroke saved and synced: clearing the field to retype it and
 * clicking away left a spot called "" (a bare 📍 in the list, the dashboard
 * and the catch-log picker). And catches link to their spot by NAME only
 * (catchScore.findCatchLocation), so renaming "Strandvejen, Kalundborg" to
 * "Kalundborg slæbested" detached all 15 catches logged there — no bite-score,
 * out of the model check — until the old name came back.
 */
import type { CatchEntry, Location } from './types'

// Same normalisation as catchScore.findCatchLocation, so "linked" means the same.
const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase()

/** What a rename needs of the two stores (the Pinia stores pass as they are). */
export interface RenameSetup { locations: Location[] }
export interface RenameCatchLog { entries: CatchEntry[]; pullRemote(): Promise<unknown> }

/**
 * Rename spot `id` to the trimmed draft and carry its catches along. A blank
 * draft keeps the old name. Resolves to whether the spot was renamed.
 *
 * The spot itself is renamed at once — a setup edit like any other. Its
 * catches are rewritten only after the catch log has been re-read: rewriting
 * them stamps and pushes the WHOLE log, and a window that stays focused holds
 * a copy up to RESYNC_EVERY_MS old. Rewritten straight away, a catch the phone
 * had logged meanwhile was overwritten by the rename's newer stamp and gone
 * from both devices. A re-read that fails (offline) still moves them: the log
 * then syncs like any other offline edit, through reconcile on the next pull —
 * leaving them behind would detach them from the spot instead.
 */
export async function renameLocation(
  id: string, draft: string, setup: RenameSetup, catches: RenameCatchLog,
): Promise<boolean> {
  const loc = setup.locations.find((l) => l.id === id)
  const next = draft.trim()
  if (!loc || !next || next === loc.name) return false
  const prev = loc.name
  loc.name = next
  try { await catches.pullRemote() } catch { /* moved anyway — see above */ }
  // Looked up again, on the stores as they are now: the pull may have swapped
  // in the account's log, and the spot may have been renamed once more, or be
  // gone (deleted, or the account signed out) while the log was being read.
  const now = setup.locations.find((l) => l.id === id)
  if (now) moveCatches(prev, now, setup.locations, catches.entries)
  return true
}

/** Re-point the catches logged under `prev` to `loc`'s current name, in place. */
function moveCatches(prev: string, loc: Location, locations: Location[], catches: CatchEntry[]) {
  const old = norm(prev)
  // Renamed back while the log was read: nothing to move.
  if (loc.name === prev) return
  // While another spot still has the old name, the catches resolve to it and
  // are left there. An empty old name would adopt every catch with no place.
  if (!old || locations.some((l) => l.id !== loc.id && norm(l.name) === old)) return
  for (const c of catches) {
    if (norm(c.locationName) === old) c.locationName = loc.name
  }
}
