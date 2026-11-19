import { availDays, clockMinutes, isOvernight } from './scoring'
import type { Availability } from './types'

/**
 * Why a window's times can't be scored, or null when they can (isValidWindow):
 * a time cleared or unreadable ('missing'), or the same start and end
 * ('same'). A cleared field used to get the same-time message, though one of
 * the times was not there at all.
 */
export function timeIssue(from: string, to: string): 'missing' | 'same' | null {
  const f = clockMinutes(from)
  const u = clockMinutes(to)
  if (isNaN(f) || isNaN(u)) return 'missing'
  return f === u ? 'same' : null
}

/**
 * True for a window that ends at 00:00 (22:00–00:00). It counts as one
 * that crosses midnight (isOvernight), but it ends at midnight, not in the
 * morning, and the editor's night note says so.
 */
export function endsAtMidnight(from: string, to: string): boolean {
  return isOvernight(from, to) && clockMinutes(to) === 0
}

/**
 * Time windows that can't leave the availability step, by reason. A window
 * with no days never matches a day in getScoredWindows, so it saved and
 * synced, made the setup look complete, and the dashboard then said "No time
 * windows found". Its warning also sat behind the overnight note in the
 * editor, so 22:00–02:00 with no days only said "That's fine".
 */
export function availabilityBlockers(list: Availability[]): { sameTime: number; noTime: number; noDays: number } {
  return {
    sameTime: list.filter((a) => timeIssue(a.from, a.to) === 'same').length,
    noTime: list.filter((a) => timeIssue(a.from, a.to) === 'missing').length,
    noDays: list.filter((a) => !availDays(a).length).length,
  }
}
