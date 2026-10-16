/**
 * Committing a rename typed into the Lokationer list.
 *
 * The rename input used to be `v-model="l.name"` on the live store object, so
 * every keystroke saved and synced: clearing the field to retype it and
 * clicking away left a spot called "" (a bare 📍 in the list, the dashboard
 * and the catch-log picker). And catches linked to their spot by NAME only
 * (catchScore.findCatchLocation), so renaming "Strandvejen, Kalundborg" to
 * "Kalundborg slæbested" detached all 15 catches logged there — no bite-score,
 * out of the model check — until the old name came back. Catches saved now
 * also carry the spot's id and stay linked whatever their name says; the
 * names are still rewritten, for display and for the entries without an id.
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
 * catches are rewritten only after the catch log has been re-read: a window
 * that stays focused holds a copy up to RESYNC_EVERY_MS old. Under
 * last-write-wins, rewriting that copy straight away overwrote a catch the
 * phone had logged meanwhile and it was gone from both devices; the merge
 * keeps it now, but only the re-read lets the rename move it along with the
 * rest. A re-read that fails (offline) still moves the ones this device has:
 * the log then syncs like any other offline edit, merged on the next pull —
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

/** Re-point the catches logged under `prev` (or linked to `loc`) to `loc`'s current name, in place. */
function moveCatches(prev: string, loc: Location, locations: Location[], catches: CatchEntry[]) {
  const old = norm(prev)
  // Renamed back while the log was read: nothing to move.
  if (loc.name === prev) return
  // While another spot still has the old name, the catches that link by name
  // resolve to it and are left there. An empty old name would adopt every
  // catch with no place.
  const byName = !!old && !locations.some((l) => l.id !== loc.id && norm(l.name) === old)
  for (const c of catches) {
    // Linked by id to a spot that exists: it follows that spot only — even
    // when its stored name is out of date, or happens to be this old name.
    if (c.locationId && locations.some((l) => l.id === c.locationId)) {
      if (c.locationId === loc.id && c.locationName !== loc.name) c.locationName = loc.name
    } else if (byName && norm(c.locationName) === old) {
      c.locationName = loc.name
    }
  }
}
