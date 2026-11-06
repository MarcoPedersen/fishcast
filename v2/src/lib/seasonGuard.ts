/**
 * Is a target species protected at a window's spot on the window's day?
 *
 * The dashboard scored and labelled windows for a target in its closed season
 * with nothing on the card: a pike target at Arresø read "70 Godt" on 12 Apr,
 * inside the freshwater closure (15 Mar – 30 Apr). This names the targets that
 * are protected there that day, for the card to say so. It never touches the
 * score: the weather is what it is; whether to fish is the angler's call.
 *
 * - 'closed': the rules close it there for certain (pike at a lake in April,
 *   cod at a Baltic spot during the ban).
 * - 'maybe': a hedged rule — only fish in spawning colours (sea trout on the
 *   coast in winter), only catch and release (sea bass in February–March), or
 *   a named water the spot may lie in (ruleArea.ts).
 * A target that doesn't live in the spot's water (sea trout at a lake) is
 * left out, as the scorer leaves it out of the spot.
 */
import { DK_REGULATIONS } from './regulations'
import { rulePlaceAt } from './ruleArea'
import { regulationFor } from './catchGuard'
import { SPECIES_PREFS } from './species'
import { waterCompatible } from './waterCompat'
import { isOvernight } from './scoring'
import type { Closure } from './seasons'
import type { Location, ScoredWindow } from './types'

export interface SeasonFlag {
  id: string
  level: 'closed' | 'maybe'
  /** The rules behind it, for their `where` text. */
  closures: Closure[]
}

/** The flags for `targets` at `loc` on one local calendar day. */
export function seasonFlagsOn(targets: string[], loc: Pick<Location, 'lat' | 'lon' | 'waterType'>, day: Date): SeasonFlag[] {
  const place = rulePlaceAt(loc.lat, loc.lon)
  const out: SeasonFlag[] = []
  for (const id of targets) {
    const reg = regulationFor(id)
    if (!reg) continue
    if (loc.waterType && !waterCompatible(SPECIES_PREFS[id]?.waterType, loc.waterType)) continue
    const all = DK_REGULATIONS.closuresOn(reg, day, loc.waterType, place) as Closure[]
    if (reg.status === 'closed' || !DK_REGULATIONS.isInSeason(reg, day, loc.waterType, place)) {
      out.push({ id, level: 'closed', closures: all.filter((c) => DK_REGULATIONS.closureLevel(c, day, loc.waterType, place) === 'closed') })
    } else if (all.length) {
      out.push({ id, level: 'maybe', closures: all })
    }
  }
  return out
}

/**
 * The flags for a dashboard window: its own day, and for an overnight window
 * the next day too (a 15 Nov 22:00 – 02:00 session ends inside a closure that
 * starts on 16 Nov). The stricter level wins.
 */
export function windowSeasonFlags(w: ScoredWindow, targets: string[]): SeasonFlag[] {
  // ScoredWindow.date is UTC midnight of the local calendar day.
  const d = w.date
  const days = [new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12)]
  if (isOvernight(w.from, w.to)) days.push(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 12))
  const byId = new Map<string, SeasonFlag>()
  for (const day of days) {
    for (const f of seasonFlagsOn(targets, w.location, day)) {
      const had = byId.get(f.id)
      if (!had) byId.set(f.id, f)
      else if (had.level === 'maybe' && f.level === 'closed') byId.set(f.id, f)
      else if (had.level === f.level) had.closures = [...new Set([...had.closures, ...f.closures])]
    }
  }
  return targets.flatMap((id) => byId.get(id) ?? [])
}
