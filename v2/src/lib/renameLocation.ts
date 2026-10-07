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

/**
 * Rename `loc` to the trimmed draft and carry its catches along. A blank draft
 * keeps the old name. Catches are rewritten in place, so the catch store's own
 * watcher saves and syncs them. Returns whether anything changed.
 */
export function renameLocation(
  loc: Location, draft: string, locations: Location[], catches: CatchEntry[],
): boolean {
  const next = draft.trim()
  const prev = loc.name
  if (!next || next === prev) return false
  loc.name = next
  const old = norm(prev)
  // While another spot still has the old name, the catches resolve to it and
  // are left there. An empty old name would adopt every catch with no place.
  if (!old || locations.some((l) => l.id !== loc.id && norm(l.name) === old)) return true
  for (const c of catches) {
    if (norm(c.locationName) === old) c.locationName = next
  }
  return true
}
