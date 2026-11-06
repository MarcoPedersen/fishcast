/**
 * What the catch log's "∅ Uden fangst" form is prefilled with. Kept out of
 * CatchLogView so the node tests can check it against the form's own rules
 * (catchScore.ts tripFormIssues).
 */
import { catchPlaceName, linkCatchLocation, tripFormIssues, tripSlot } from './catchScore'
import type { Availability, CatchEntry, FishingMethod, Location } from './types'

export interface TripPrefill { date: string; from: string; to: string; loc: string; method: FishingMethod | null }

const pad2 = (n: number) => String(n).padStart(2, '0')
const hhmm = (min: number) => `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`

/**
 * The time window just fished (tripSlot) or the last two hours; the spot and
 * method of the newest entry today; that window's method if it allows only
 * one. `newestFirst` is the log, newest first. `withSpot` false leaves the
 * place empty.
 *
 * The spot only where that makes a trip the form can save. Right after a
 * catch, the newest entry is that catch: its spot and the last two hours
 * made a trip holding it, and the form opened on "Du har allerede
 * registreret en fangst her i det tidsrum." with Save disabled. Left empty,
 * the form asks where the fishless trip was.
 */
export function tripPrefill(
  availability: Availability[], newestFirst: CatchEntry[], locations: Location[], nowMs: number, withSpot = true,
): TripPrefill {
  const now = new Date(nowMs)
  const today = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
  const mins = now.getHours() * 60 + now.getMinutes()
  const span = tripSlot(availability, nowMs) ?? { date: today, from: hhmm(Math.max(0, mins - 120)), to: hhmm(mins), methods: [] }
  const latest = newestFirst.find((e) => e.date === today)
  const method = span.methods.length === 1 ? span.methods[0] : latest?.method ?? null
  let loc = withSpot && latest ? catchPlaceName(latest, locations) : ''
  if (loc) {
    const trip: CatchEntry = {
      id: '', outcome: 'empty', date: span.date, from: span.from, to: span.to, speciesId: '',
      locationName: loc, locationId: linkCatchLocation(loc, locations),
    }
    const issues = tripFormIssues(trip, newestFirst, locations, nowMs)
    if (issues.includes('catch') || issues.includes('trip')) loc = ''
  }
  return { date: span.date, from: span.from, to: span.to, loc, method }
}
