/**
 * Species a user can attach to a location by hand.
 *
 * Some spots have no official fishing spot within the 12 km lookup radius, so
 * `speciesFromNearby` can never fill them in — and without species a location
 * can't earn the spot-relevance bonus, scoring up to 12 points below an
 * equivalent official spot. This is the manual escape hatch.
 *
 * Two sources, deliberately:
 *  - `nameEn` comes from SPECIES_PREFS, because that is the exact string
 *    scoreWindow compares against. DK_REGULATIONS spells sandart
 *    "Pike-Perch / Zander" where SPECIES_PREFS says "Zander" — storing the
 *    regulations spelling would look selected and earn nothing.
 *  - `months` are the months the species is IN SEASON, derived from its closed
 *    seasons via the existing DK_REGULATIONS.isInSeason. NOT `bestMonths` —
 *    that's the peak season (6 months for sea trout), whereas the official spot
 *    data records broad presence (sea trout is listed all 12 months at Tejn
 *    mole). Using bestMonths would make a hand-picked species score in half the
 *    year where an official spot scores all of it: the same unfairness this is
 *    meant to remove, just seasonally. The user is never asked about months.
 *
 * Only species present in BOTH are offered: one missing from SPECIES_PREFS can
 * never score, so offering it would be a no-op dressed up as a choice.
 */
import { SPECIES_PREFS } from './species'
import { DK_REGULATIONS } from './regulations'
import type { WaterType } from './types'

export interface Pickable {
  id: string
  months: number[]
}

/**
 * Months where the species is legally in season. A month counts as open if any
 * part of it is — closed seasons start and end mid-month (sea trout is closed
 * 15 Nov – 15 Jan), and a half-open month is still a month you can fish it.
 */
function openMonths(reg: unknown): number[] {
  const out: number[] = []
  for (let m = 1; m <= 12; m++) {
    // 2026 is arbitrary: isInSeason only reads month + day.
    const open = [5, 25].some((day) => DK_REGULATIONS.isInSeason(reg, new Date(2026, m - 1, day)))
    if (open) out.push(m)
  }
  return out
}

const CANDIDATES: Pickable[] = (DK_REGULATIONS.species as { id: string }[])
  .filter((r) => SPECIES_PREFS[r.id]?.nameEn)
  .map((r) => ({ id: r.id, months: openMonths(r) }))
  .filter((c) => c.months.length > 0)

/** Species worth offering for a location, narrowed to its water type. */
export function pickableSpecies(waterType?: WaterType): Pickable[] {
  if (!waterType || waterType === 'both') return CANDIDATES
  return CANDIDATES.filter((c) => {
    const wt = SPECIES_PREFS[c.id].waterType
    return !wt?.length || wt.includes(waterType)
  })
}

/** The stored shape on `Location.species` for one species id. */
export function speciesEntry(id: string): { nameEn: string; months: number[] } | null {
  const pref = SPECIES_PREFS[id]
  const cand = CANDIDATES.find((c) => c.id === id)
  return pref?.nameEn && cand ? { nameEn: pref.nameEn, months: cand.months } : null
}

/** Which pickable ids a location currently has stored (matched on nameEn). */
export function selectedSpeciesIds(species: { nameEn?: string }[] | undefined): string[] {
  const have = new Set((species ?? []).map((s) => s.nameEn?.toLowerCase()).filter(Boolean))
  return CANDIDATES
    .filter((c) => have.has(SPECIES_PREFS[c.id].nameEn!.toLowerCase()))
    .map((c) => c.id)
}
