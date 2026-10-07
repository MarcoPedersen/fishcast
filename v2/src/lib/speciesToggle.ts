import { SPECIES_PREFS } from './species'

/**
 * Tapping a species card. A banned species can't be ADDED (the caller shows
 * the ban notice instead) — but one already selected must still come off:
 * the check used to block both directions, so torsk arriving via a shared
 * setup stayed selected forever, every tap re-opening the ⛔ notice, and the
 * only way out was "Reset choices", which also wipes every time window.
 */
export function toggleTarget(selected: string[], id: string): { selected: string[]; blocked: boolean } {
  if (selected.includes(id)) return { selected: selected.filter((x) => x !== id), blocked: false }
  if (SPECIES_PREFS[id]?.banned) return { selected, blocked: true }
  return { selected: [...selected, id], blocked: false }
}
