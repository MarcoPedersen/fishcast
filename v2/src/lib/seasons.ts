/**
 * The Seasons tab's grouping: in season now, with restrictions, or closed.
 * Pure, so it can be tested; SeasonsTab.vue only renders it.
 *
 * The tab has no location, so each species is judged in every water it lives
 * in (salt for salt/brackish, fresh for fresh). Closed in all of them → closed;
 * closed in some, or under a hedged rule today (a named area, fish in spawning
 * colours, an area ban) → restrictions. A protection that holds all year in one
 * named water (sea trout in Ringkøbing Fjord) is a standing local rule, listed
 * on the card, not a reason to drop the species from "in season".
 *
 * It used to go by `status` and a location-blind isInSeason alone: helt (no
 * closure in the data) showed "in season" with a peak badge inside its closed
 * season, and the fully protected stenbider sat under "in season".
 */
import { DK_REGULATIONS } from './regulations'

export interface SeasonReg {
  id: string; name: string; nameEn: string; emoji: string
  waterType: string[]
  sizes?: { area: string; minCm: number; areaNote?: string; waterNote?: string }[]
  bagLimit?: string; bagLimitEn?: string; closedSeasons?: Closure[]
  restrictions?: { note: string; noteEn?: string; year?: number | number[] }[]
  bestMonths?: number[]; status: string; venom?: boolean; venomWarning?: string; venomWarningEn?: string; notes?: string
}
export interface Closure {
  startMonth: number; startDay: number; endMonth: number; endDay: number
  where?: string; whereEn?: string; water?: string; region?: string; area?: string; kind?: string
  year?: number[]; fromYear?: number
}

/** The legal waters a species lives in: brackish water is salt water in law. */
function watersOf(s: SeasonReg): ('salt' | 'fresh')[] {
  const w: ('salt' | 'fresh')[] = []
  if (s.waterType.includes('salt') || s.waterType.includes('brackish')) w.push('salt')
  if (s.waterType.includes('fresh')) w.push('fresh')
  return w
}

export const isAllYear = (c: Closure) => c.startMonth === 1 && c.startDay === 1 && c.endMonth === 12 && c.endDay === 31

/** All-year protections in one named water (Ringkøbing Fjord…), for the card. */
export function standingLocalRules(s: SeasonReg, year: number): Closure[] {
  return (DK_REGULATIONS.closuresInYear(s, year) as Closure[]).filter((c) => c.region && isAllYear(c))
}

export function seasonGroups(date: Date): { open: SeasonReg[]; restricted: SeasonReg[]; closed: SeasonReg[] } {
  const open: SeasonReg[] = [], restricted: SeasonReg[] = [], closed: SeasonReg[] = []
  for (const s of DK_REGULATIONS.species as SeasonReg[]) {
    if (s.status === 'closed') { closed.push(s); continue }
    const waters = watersOf(s)
    const closedIn = waters.filter((w) => !DK_REGULATIONS.isInSeason(s, date, w))
    if (waters.length && closedIn.length === waters.length) { closed.push(s); continue }
    const hedgedNow = waters.some((w) =>
      (DK_REGULATIONS.regionalClosuresOn(s, date, w) as Closure[]).some((c) => !(c.region && isAllYear(c))))
    if (s.status === 'restricted' || closedIn.length || hedgedNow) restricted.push(s)
    else open.push(s)
  }
  return { open, restricted, closed }
}
