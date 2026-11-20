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
 * The latest end, in minutes after midnight, that still ends in the night:
 * 04:00. Danish says "klokken 3 om natten" but "klokken 5 om morgenen", and at
 * midsummer the sun is up by about 04:30 here, so a window that ends later
 * ends at dawn or after it: in the morning. 04:00 itself is still night.
 */
const NIGHT_ENDS_BY = 4 * 60

/**
 * When a window that crosses midnight (isOvernight) ends: at midnight
 * (22:00–00:00), in the night (after 00:00 up to and including 04:00) or
 * in the morning (later). Null for a window that does not cross midnight.
 * The editor's night note goes by it: it said "slutter næste morgen" of
 * 22:00–01:00, which ends long before the morning.
 */
export function overnightEnd(from: string, to: string): 'midnight' | 'night' | 'morning' | null {
  if (!isOvernight(from, to)) return null
  const u = clockMinutes(to)
  return u === 0 ? 'midnight' : u <= NIGHT_ENDS_BY ? 'night' : 'morning'
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
