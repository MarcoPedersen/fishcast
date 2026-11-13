/**
 * Species a user can attach to a location by hand.
 *
 * Some spots have no official fishing spot within the 12 km lookup radius, so
 * `speciesFromNearby` can never fill them in — and without species a location
 * can't earn the spot-relevance bonus, scoring up to 15 points
 * (SCORE_WEIGHTS.relevanceMax) below an equivalent official spot. This is the
 * manual escape hatch.
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
 * Candidates come from SPECIES_PREFS: one missing there can never score, so
 * offering it would be a no-op dressed up as a choice. A species with no
 * regulations row has no closed season, so it is open all 12 months — building
 * the list from DK_REGULATIONS instead silently dropped garfish (listed at 44
 * of the 57 official spots) and tench.
 */
import { SPECIES_PREFS } from './species'
import { DK_REGULATIONS } from './regulations'
import { waterCompatible } from './waterCompat'
import type { WaterType } from './types'

export interface Pickable {
  id: string
  months: number[]
}

/**
 * Months where the species is legally in season at a location of this water
 * type. A month counts as open if any part of it is — closed seasons start and
 * end mid-month (sea trout in fresh water is closed 16 Nov – end of February),
 * and a half-open month is still a month you can fish it.
 *
 * The water type matters: on the coast only sea trout in spawning colours are
 * protected in winter (bright fish may be kept), so the coast keeps December,
 * while a river loses it. An unknown water type takes both rule sets.
 */
function openMonths(reg: unknown, waterType?: WaterType): number[] {
  const out: number[] = []
  // The current year, not a fixed one: closures can be pinned to years (grayling
  // was totally protected in 2026 only), so the year changes the answer.
  const year = new Date().getFullYear()
  for (let m = 1; m <= 12; m++) {
    const open = [5, 25].some((day) => DK_REGULATIONS.isInSeason(reg, new Date(year, m - 1, day), waterType))
    if (open) out.push(m)
  }
  return out
}

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

const REGS = DK_REGULATIONS.species as { id: string; waterType?: string[] }[]

/**
 * The water a species can be fished in here: SPECIES_PREFS's water types and
 * the regulations' together. Sea trout run up the rivers — the regulations
 * give havørred salt and fresh ("Åer, strande, havkyster"), SPECIES_PREFS
 * salt and brackish — so by SPECIES_PREFS alone a river spot set to
 * Ferskvand lost its Havørred. SPECIES_PREFS itself stays as it is: the
 * scorer and the spot finder read it.
 */
const WATER: Record<string, string[]> = Object.fromEntries(Object.values(SPECIES_PREFS).map((p) => [
  p.id, [...new Set([...(p.waterType ?? []), ...(REGS.find((r) => r.id === p.id)?.waterType ?? [])])],
]))

const candidateCache = new Map<string, Pickable[]>()
/** Every species worth offering, with its open months for this water type. */
function candidates(waterType?: WaterType): Pickable[] {
  const key = waterType ?? ''
  let list = candidateCache.get(key)
  if (!list) {
    list = Object.values(SPECIES_PREFS)
      .filter((p) => p.nameEn)
      .map((p) => {
        const reg = REGS.find((r) => r.id === p.id)
        return { id: p.id, months: reg ? openMonths(reg, waterType) : ALL_MONTHS }
      })
      .filter((c) => c.months.length > 0)
    candidateCache.set(key, list)
  }
  return list
}

/** Species worth offering for a location, narrowed to its water type. */
export function pickableSpecies(waterType?: WaterType): Pickable[] {
  if (!waterType || waterType === 'both') return candidates()
  return candidates(waterType).filter((c) => waterCompatible(WATER[c.id], waterType))
}

/** The stored shape on `Location.species` for one species id, at a location of this water type. */
export function speciesEntry(id: string, waterType?: WaterType): { nameEn: string; months: number[] } | null {
  const pref = SPECIES_PREFS[id]
  const cand = candidates(waterType === 'both' ? undefined : waterType).find((c) => c.id === id)
  return pref?.nameEn && cand ? { nameEn: pref.nameEn, months: cand.months } : null
}

/** Which pickable ids a location currently has stored (matched on nameEn). */
export function selectedSpeciesIds(species: { nameEn?: string }[] | undefined): string[] {
  const have = new Set((species ?? []).map((s) => s.nameEn?.toLowerCase()).filter(Boolean))
  return candidates()
    .filter((c) => have.has(SPECIES_PREFS[c.id].nameEn!.toLowerCase()))
    .map((c) => c.id)
}

// ── Species and the water type ───────────────────────────────────────
// A spot's species must fit its water type, or the picker hides them while
// they still count: Hornbæk took a lake's and the coast's species from 12 km
// around, and changed to Saltvand it kept pike, zander and carp out of sight
// ("7 arter valgt", 4 chips lit), scoring them whenever they were targets.

const PREF_BY_NAME = new Map(Object.values(SPECIES_PREFS)
  .filter((p) => p.nameEn).map((p) => [p.nameEn!.toLowerCase(), p]))

/**
 * Whether a stored species fits this water type, as the picker
 * (pickableSpecies) judges it. A name SPECIES_PREFS doesn't know stays: it is
 * never offered nor scored, and nothing here can judge it.
 */
function fits(nameEn: string | undefined, waterType?: WaterType): boolean {
  const pref = nameEn ? PREF_BY_NAME.get(nameEn.toLowerCase()) : undefined
  return !pref || !waterType || waterType === 'both' || waterCompatible(WATER[pref.id], waterType)
}

/**
 * The species of `list` that fit the water type — never one the picker would
 * hide. The scorer reads a spot's species through this too (scoring.ts spot
 * relevance): a saved setup can hold species its water type hides, which are
 * left as they are, and count for nothing.
 */
export function fitWaterType<T extends { nameEn?: string }>(list: T[] | undefined, waterType?: WaterType): T[] {
  return (list ?? []).filter((s) => fits(s.nameEn, waterType))
}

/**
 * The species a spot card counts ("7 arter valgt"): exactly those the score
 * can use. Ones the app doesn't know, such as the official spots' "Brown
 * Trout (river/lake)", are never scored, and ones the water type hides
 * aren't either.
 */
export function countedSpeciesIds(species: { nameEn?: string }[] | undefined, waterType?: WaterType): string[] {
  return selectedSpeciesIds(fitWaterType(species, waterType))
}

const sameMonths = (a: number[], b: number[]) => a.length === b.length && a.every((m) => b.includes(m))

/**
 * The months a species picked by hand at a `from` location has at a `to` one,
 * or null to keep the entry's own. Picked by hand, its months are the open
 * months of the spot's water (speciesEntry), so they follow the water: kept,
 * a sea trout picked at a brackish guess (1–12) earned "active here" in a
 * river's December, inside its closure. Months that aren't the picker's are
 * an official spot's presence data and stay.
 */
function monthsAt(s: { nameEn?: string; months?: number[] }, from: WaterType | undefined, to: WaterType): number[] | null {
  const pref = s.nameEn ? PREF_BY_NAME.get(s.nameEn.toLowerCase()) : undefined
  const was = pref && speciesEntry(pref.id, from)
  const now = pref && speciesEntry(pref.id, to)
  if (!was || !now || !s.months || !sameMonths(s.months, was.months) || sameMonths(s.months, now.months)) return null
  return now.months
}

type Stored = { nameEn?: string; months?: number[] }
const listKey = (l: Stored[]) =>
  l.map((s) => `${s.nameEn?.toLowerCase()}:${[...(s.months ?? [])].sort((x, y) => x - y).join(',')}`).sort().join('|')
/** The same species with the same months, in any order: the map sheet saves the likeliest first. */
const sameSpecies = (a: Stored[], b: Stored[]) => a.length === b.length && listKey(a) === listKey(b)

/**
 * A location's species once its water type changes from `from` to `to`, the
 * ids that had to go, and those the lookup put on. The same array when
 * nothing changes.
 *
 * `lookup`, for a custom spot: what the official spots nearby give a spot of
 * a water type (geo.ts speciesFromNearby). A guess can change after it filled
 * the species in: a sea spot takes no lake's species, so a pin in mid-Arresø
 * guessed brackish had none and kept none when the map turned it fresh, and
 * Hornbæk turned fresh kept its sea trout alone. When the spot has no list,
 * or still exactly what the lookup gave the old water type, the lookup runs
 * again for the new one. An empty list where the lookup gave some is one the
 * user cleared, and stays empty, as the refill at a start leaves it
 * (stores/setup.ts enrichMissingSpecies); one where it gave none can't be
 * told from the lookup's own. The ids named are every one it took off
 * (`relooked`): the new water can still show them. A brackish spot takes no
 * lake's pike, though the picker offers pike there, and named only when the
 * water hid them, Silkeborg set to Brakvand lost its four species with no
 * toast to undo it. The lookup puts species on too, named as well
 * (`added`): only those the app knows, so the official spots' "Brown Trout
 * (river/lake)" never is. Named only when taken off, Hornbæk set from
 * Brakvand to Ferskvand gained perch, pike, carp and zander unnamed, and a
 * spot with none that gained a lake's fish had no toast to undo it. Species
 * picked by hand, or an official spot's own, are judged as above.
 */
export function changeWaterType<T extends Stored>(
  species: T[] | undefined, to: WaterType, from: WaterType | undefined,
  lookup?: (waterType: WaterType | undefined) => T[],
): { species: T[] | undefined; dropped: string[]; added?: string[]; relooked?: true } {
  if (lookup && (species === undefined || sameSpecies(species, lookup(from)))) {
    const next = lookup(to)
    if (!next.length && !species?.length) return { species, dropped: [] }
    const had = selectedSpeciesIds(species)
    const left = selectedSpeciesIds(next)
    const added = left.filter((id) => !had.includes(id))
    if (!species?.length) return { species: next, dropped: [], added }
    return {
      species: sameSpecies(species, next) ? species : next,
      dropped: had.filter((id) => !left.includes(id)),
      added,
      relooked: true,
    }
  }
  if (!species) return { species, dropped: [] }
  const kept = fitWaterType(species, to)
  const dropped = kept.length === species.length
    ? [] : selectedSpeciesIds(species).filter((id) => !fits(SPECIES_PREFS[id].nameEn, to))
  let moved = false
  const next = kept.map((s) => {
    const months = monthsAt(s, from, to)
    if (!months) return s
    moved = true
    return { ...s, months }
  })
  return { species: dropped.length || moved ? next : species, dropped }
}

/** Selected ids the picker hides at this water type: a setup from before the drop on change holds them. */
export function hiddenSpeciesIds(species: { nameEn?: string }[] | undefined, waterType?: WaterType): string[] {
  return selectedSpeciesIds(species).filter((id) => !fits(SPECIES_PREFS[id].nameEn, waterType))
}
