import { isValidWindow } from './scoring'
import type { Availability } from './types'

/**
 * Time windows that can't leave the availability step, by reason. A window
 * with no days never matches a day in getScoredWindows, so it saved and
 * synced, made the setup look complete, and the dashboard then said "No time
 * windows found". Its warning also sat behind the overnight note in the
 * editor, so 22:00–02:00 with no days only said "That's fine".
 */
export function availabilityBlockers(list: Availability[]): { badTime: number; noDays: number } {
  return {
    badTime: list.filter((a) => !isValidWindow(a.from, a.to)).length,
    noDays: list.filter((a) => !a.days?.length).length,
  }
}
