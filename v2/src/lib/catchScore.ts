/**
 * Retrospective bite-score for a logged catch or an empty trip: resolve its
 * saved location, fetch the archived weather for that date, and run the same
 * scoring engine as the dashboard over the hour it was caught or the span it
 * was fished. Null when it can't be scored (no time or span, location not
 * saved with coords, too old, or no data).
 */
import { availDays, availMethods, isOvernight, isValidWindow, scoreWindow, windowHours } from './scoring'
import { resolveShore, type Shore, type ShoreMap } from './coast'
import { classifyHour, type HourSample, type WindowSample } from './catchInsights'
import { historyFor, type HistoryCache } from './history'
import type { Availability, CatchEntry, FishingMethod, Forecast, Location } from './types'

export type { HourSample, WindowSample } from './catchInsights'

const DAY_MS = 86400000
/**
 * How far back an entry is scored. The weather archive reaches back to 2022
 * (complete for late 2024, checked); two years keeps the requested spans sane.
 * The limit is the app's choice, not the archive's.
 */
export const MAX_SCORE_AGE_DAYS = 730

/**
 * An empty trip ("Fisket uden fangst"). The outcome is the only mark: an
 * older app version may have cleared its count, and '' is a catch's
 * "unknown species" as well.
 */
export const isEmptyTrip = (e: Pick<CatchEntry, 'outcome'>) => e.outcome === 'empty'

/**
 * The location field is a free-text input with a datalist of saved spots, so the
 * typed name won't always match byte-for-byte — "dragør mole " should still
 * resolve. Case and surrounding whitespace are ignored.
 */
const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase()

export function findCatchLocation(entry: Pick<CatchEntry, 'locationName' | 'locationId'>, locations: Location[]): Location | undefined {
  // By id first: catches used to link by name only, so a spot renamed on one
  // device detached every catch the other device's log still had under the
  // old name. A link to a spot that has since been deleted falls back to the name.
  const linked = entry.locationId ? locations.find((l) => l.id === entry.locationId) : undefined
  if (linked) return linked
  const want = norm(entry.locationName)
  return want ? locations.find((l) => norm(l.name) === want) : undefined
}

/**
 * The location id to save with a catch whose location field reads `name`.
 * `prev` is the entry being edited: while the field still names the spot it
 * is linked to — by the entry's stored name, or by the spot's current one,
 * which is what the form opens on (catchPlaceName) — and that spot still
 * exists, the link stays. The stored name may predate a rename made on
 * another device, and re-resolving a name would detach the catch, or attach
 * it to a different spot that has (or shares) that name. Otherwise the link
 * follows the name, by the same rule.
 */
export function linkCatchLocation(
  name: string, locations: Location[], prev?: Pick<CatchEntry, 'locationName' | 'locationId'>,
): string | undefined {
  const linked = prev?.locationId ? locations.find((l) => l.id === prev.locationId) : undefined
  if (linked && (norm(name) === norm(prev!.locationName) || norm(name) === norm(linked.name))) return linked.id
  return findCatchLocation({ locationName: name }, locations)?.id
}

/**
 * What a catch shows as its place: the linked spot's current name, else the
 * text it was saved with. A catch logged offline under a spot's old name,
 * after another device renamed the spot, is linked by id but keeps that old
 * name — the rename rewrote the log before the catch existed — and the list
 * said "Strandvejen" for a catch that scores at "Dragør mole". Read-time
 * only: rewriting stored names on load would be an edit, and push.
 */
export function catchPlaceName(entry: Pick<CatchEntry, 'locationName' | 'locationId'>, locations: Location[]): string {
  const linked = entry.locationId ? locations.find((l) => l.id === entry.locationId) : undefined
  return linked ? linked.name : entry.locationName
}

/** The entry's LOCAL calendar day, as UTC midnight of its date parts (the app-wide encoding). */
export function entryDay(entry: Pick<CatchEntry, 'date'>): number | null {
  const [y, m, d] = String(entry.date ?? '').split('-').map(Number)
  return y ? Date.UTC(y, (m || 1) - 1, d || 1) : null
}

const minutes = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0) }
const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * The local day and the window to score. A catch: its nearest whole hour,
 * as the one-hour window HH:00–HH:30 (07:29 → 07, 07:30 → 08, 23:45 → 23).
 * It was h:00–(h+1):00, which averaged two hours and dropped the minutes, so
 * a 07:50 catch counted 07:00 as much as 08:00. A trip: its span.
 */
export function entryWindow(e: CatchEntry): { day: number; from: string; to: string } | null {
  const day = entryDay(e)
  if (day == null) return null
  if (isEmptyTrip(e)) return e.from && e.to && isValidWindow(e.from, e.to) ? { day, from: e.from, to: e.to } : null
  if (typeof e.time !== 'string' || !e.time) return null
  const m = minutes(e.time)
  if (!Number.isFinite(m)) return null
  const h = Math.min(23, Math.floor(m / 60) + (m % 60 < 30 ? 0 : 1))
  return { day, from: `${pad2(h)}:00`, to: `${pad2(h)}:30` }
}

/**
 * Why an entry can't be scored, so the UI can say so instead of showing nothing.
 * 'old' comes first: past the scored history nothing the user adds will help,
 * and without it such entries were counted as analysable and then quietly
 * came back "no data". 'time' is a catch without a time, or a trip without a
 * valid from–to.
 */
export type ScoreBlocker = 'old' | 'time' | 'location' | null
export function scoreBlocker(entry: CatchEntry, locations: Location[]): ScoreBlocker {
  const day = entryDay(entry)
  const n = new Date()
  if (day != null && (Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) - day) / DAY_MS > MAX_SCORE_AGE_DAYS) return 'old'
  if (!entryWindow(entry)) return 'time'
  if (!findCatchLocation(entry, locations)) return 'location'
  return null
}

export function canScoreCatch(entry: CatchEntry, locations: Location[]): boolean {
  return scoreBlocker(entry, locations) === null
}

/**
 * A window's score — the number its card shows — and one sample per hour it
 * covers, each scored as that single hour, with the hour's conditions. The
 * hours feed the insight view's good-hour share, condition table and points
 * table; the card's score stays the window's own. Hours the weather doesn't
 * cover are left out; null when none is left.
 */
export function sampleWindow(
  loc: Location, day: number, from: string, to: string, forecast: Forecast, targets: string[], method: FishingMethod,
  shore: Shore | null = resolveShore(loc) ?? null,
): WindowSample | null {
  const window = scoreWindow(loc, new Date(day), from, to, forecast, targets, method, shore)
  if (window.noData) return null
  const hours: HourSample[] = []
  for (const { hour, dayOffset } of windowHours(parseInt(from), parseInt(to), isOvernight(from, to))) {
    // After midnight an overnight window's hours are the next day's, as in scoreWindow.
    const d = new Date(day + dayOffset * DAY_MS)
    const w = scoreWindow(loc, d, `${pad2(hour)}:00`, `${pad2(hour)}:30`, forecast, targets, method, shore)
    if (w.noData) continue
    const at = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour).getTime()
    hours.push({ at, score: w.score, breakdown: w.breakdown ?? [], cond: classifyHour(forecast, loc, at) })
  }
  return hours.length ? { window, hours } : null
}

/**
 * The method a window allowing several is scored with: the best one, as on
 * the dashboard (the angler would pick whichever fishes best). The method
 * only moves the wave rows, so without marine data the first one stands.
 */
export function bestMethod(
  loc: Location, day: number, from: string, to: string, methods: FishingMethod[], forecast: Forecast, targets: string[],
  shore: Shore | null = resolveShore(loc) ?? null,
): FishingMethod {
  let best = methods[0] ?? 'shore'
  if (!forecast.marine?.length || methods.length < 2) return best
  let top = scoreWindow(loc, new Date(day), from, to, forecast, targets, best, shore).score
  for (const m of methods.slice(1)) {
    const s = scoreWindow(loc, new Date(day), from, to, forecast, targets, m, shore).score
    if (s > top) { best = m; top = s }
  }
  return best
}

/**
 * Score an entry from archived weather. Every entry is scored with `targets`
 * — the dashboard's target species — not the catch's own: the score is the
 * one the dashboard would have shown, and scoring a catch for its own
 * species moved it by about 17 points against the windows it is compared
 * with. Rejects when the weather can't be fetched (worth a retry).
 */
export async function scoreEntry(
  e: CatchEntry, locations: Location[], targets: string[], cache: HistoryCache = new Map(), shores: ShoreMap = {},
): Promise<WindowSample | null> {
  if (scoreBlocker(e, locations)) return null
  const loc = findCatchLocation(e, locations)!
  const w = entryWindow(e)!
  const forecast = await historyFor(loc, w.day, cache)
  return forecast ? sampleWindow(loc, w.day, w.from, w.to, forecast, targets, e.method ?? 'shore', shoreOf(loc, shores)) : null
}

/** A spot's coast as the dashboard scores it: from the coast store's map, else its own override. */
export const shoreOf = (loc: Location, shores: ShoreMap): Shore | null =>
  loc.id in shores ? shores[loc.id] : resolveShore(loc) ?? null

/** Where an entry was, for matching entries: its saved spot's id, else its typed name. */
export function spotKey(e: Pick<CatchEntry, 'locationName' | 'locationId'>, locations: Location[]): string | null {
  const loc = findCatchLocation(e, locations)
  if (loc) return 'id:' + loc.id
  const name = norm(e.locationName)
  return name ? 'name:' + name : null
}

/** Whether an empty trip's span holds a catch's time at the same spot — past midnight too, for an overnight trip. */
function holds(trip: CatchEntry, c: CatchEntry, locations: Location[]): boolean {
  if (!isEmptyTrip(trip) || isEmptyTrip(c) || typeof c.time !== 'string' || !c.time) return false
  const w = entryWindow(trip)
  const cd = entryDay(c)
  const key = spotKey(trip, locations)
  if (!w || cd == null || !key || key !== spotKey(c, locations)) return false
  const at = ((cd - w.day) / DAY_MS) * 1440 + minutes(c.time)
  return at >= minutes(w.from) && at <= minutes(w.to) + (isOvernight(w.from, w.to) ? 1440 : 0)
}

/** The empty trips in `entries` that hold catch `c`. */
export function tripsContaining(c: CatchEntry, entries: CatchEntry[], locations: Location[]): CatchEntry[] {
  return entries.filter((t) => t.id !== c.id && holds(t, c, locations))
}

/** The catches in `entries` that an empty trip holds. */
export function catchesInside(trip: CatchEntry, entries: CatchEntry[], locations: Location[]): CatchEntry[] {
  return entries.filter((c) => c.id !== trip.id && holds(trip, c, locations))
}

/**
 * catchesInside, plus the catches logged without a time at the trip's spot on
 * its day (or the next, for an overnight trip). The time field can be
 * cleared, and such a fish may well have come inside the trip, so the
 * analysis can't count the trip as "uden fangst". The form keeps to
 * catchesInside: refusing a trip for a fish that may have come that
 * morning would block logging a fishless evening.
 */
export function catchesMaybeInside(trip: CatchEntry, entries: CatchEntry[], locations: Location[]): CatchEntry[] {
  const w = isEmptyTrip(trip) ? entryWindow(trip) : null
  const key = spotKey(trip, locations)
  return entries.filter((c) => {
    if (c.id === trip.id || isEmptyTrip(c)) return false
    if (holds(trip, c, locations)) return true
    if (!w || !key || (typeof c.time === 'string' && c.time)) return false
    const cd = entryDay(c)
    return cd != null && (cd === w.day || (isOvernight(w.from, w.to) && cd === w.day + DAY_MS)) && spotKey(c, locations) === key
  })
}

/** An empty trip's span in absolute minutes (its day's encoding plus clock minutes), into the next day if overnight. */
function tripSpan(e: CatchEntry): { start: number; end: number } | null {
  const w = isEmptyTrip(e) ? entryWindow(e) : null
  if (!w) return null
  const base = w.day / 60000
  return { start: base + minutes(w.from), end: base + minutes(w.to) + (isOvernight(w.from, w.to) ? 1440 : 0) }
}

/**
 * The other empty trips at `trip`'s spot whose spans overlap its own: the
 * same outing logged twice. After "Gem tur uden fangst" the form looked as
 * before — same date, span and spot, the list below the fold on a phone — so
 * a second tap stored a second copy, and two copies of one fishless morning
 * counted as two trips without a catch: the pseudo-replication catchTrips
 * removes for catches. Back-to-back spans are two trips.
 */
export function overlappingTrips(trip: CatchEntry, entries: CatchEntry[], locations: Location[]): CatchEntry[] {
  const a = tripSpan(trip)
  const key = spotKey(trip, locations)
  if (!a || !key) return []
  return entries.filter((t) => {
    if (t.id === trip.id) return false
    const b = tripSpan(t)
    return !!b && a.start < b.end && b.start < a.end && spotKey(t, locations) === key
  })
}

/**
 * Empty trips as outings: trips at one spot whose spans overlap, chained, are
 * one outing. The form refuses an overlapping trip, but two devices logging
 * the same trip offline both keep theirs (different ids, union merge), and a
 * log from before the check may hold a double tap. A trip without a span or
 * a place overlaps nothing and is an outing of its own.
 */
export function tripOutings(trips: CatchEntry[], locations: Location[]): CatchEntry[][] {
  const items = trips.map((t) => ({ t, key: spotKey(t, locations), span: tripSpan(t) }))
  const out: CatchEntry[][] = []
  const open = new Map<string, { end: number; members: CatchEntry[] }>()
  const timed = items.filter((i) => i.key && i.span).sort((a, b) => a.span!.start - b.span!.start)
  for (const { t, key, span } of timed) {
    const cur = open.get(key!)
    if (cur && span!.start < cur.end) {
      cur.members.push(t)
      cur.end = Math.max(cur.end, span!.end)
    } else {
      const next = { end: span!.end, members: [t] }
      open.set(key!, next)
      out.push(next.members)
    }
  }
  for (const i of items) if (!i.key || !i.span) out.push([i.t])
  return out
}

/**
 * The trips without a catch among `trips`, as outings: one per outing
 * (tripOutings), and none that may hold a catch from `entries`
 * (catchesMaybeInside) — as insightGroups counts them. The log's tile and the
 * Modeltjek count line counted every trip marked empty, so a trip kept after
 * "Nej" to the delete question read "1 uden fangst" beside a table with none.
 */
export function fishlessOutings(trips: CatchEntry[], entries: CatchEntry[], locations: Location[]): CatchEntry[][] {
  return tripOutings(trips.filter((e) => isEmptyTrip(e) && !catchesMaybeInside(e, entries, locations).length), locations)
}

/** What stops the trip form from saving; see tripFormIssues. */
export type TripIssue = 'location' | 'date' | 'times' | 'same' | 'future' | 'catch' | 'trip'

/**
 * What stops an empty trip from being saved, in the order the form says it.
 * A place is required: without one the trip can't be analysed and means
 * little. A date too: a cleared date picker stored '', which sorts last and
 * is never analysed. It must have ended, since the analysis scores archived
 * weather and a running window is partly forecast. No catch may lie inside
 * it ("uden fangst" would be false), and no other trip may overlap it at
 * that spot (overlappingTrips).
 *
 * `nowMs` is the form's clock, which ticks once a minute (useNow) and so can
 * be up to 59 s behind the minute the prefill took as the end: at 10:02:10
 * against a tick at 10:01:40, 08:02–10:02 read as ending in the future, and
 * Save stayed disabled half the time. An end inside the current minute is
 * allowed — the span has minute resolution anyway.
 */
export function tripFormIssues(trip: CatchEntry, entries: CatchEntry[], locations: Location[], nowMs: number): TripIssue[] {
  const out: TripIssue[] = []
  if (!trip.locationName.trim()) out.push('location')
  const day = entryDay(trip)
  if (day == null) out.push('date')
  const from = trip.from ?? '', to = trip.to ?? ''
  if (!from || !to) out.push('times')
  else if (!isValidWindow(from, to)) out.push('same')
  else if (day != null) {
    const d = new Date(day)
    const end = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + (isOvernight(from, to) ? 1 : 0), 0, minutes(to)).getTime()
    if (end > nowMs + 60_000) out.push('future')
  }
  if (catchesInside(trip, entries, locations).length) out.push('catch')
  if (overlappingTrips(trip, entries, locations).length) out.push('trip')
  return out
}

/**
 * The span a new empty trip is prefilled with: today's time window being
 * fished now, or the one that ended within the last 3 hours (the latest, if
 * two qualify) — logged straight after a planned window, that's the trip.
 * Up to now if it is still running. Rows are merged as getScoredWindows
 * merges them, and an overnight window counts on the day it started, so at
 * 01:30 last night's 22:00–02:00 is the trip, dated yesterday. Null when no
 * window fits.
 */
export function tripSlot(availability: Availability[], nowMs: number): { date: string; from: string; to: string; methods: FishingMethod[] } | null {
  const now = new Date(nowMs)
  let best: { start: number; date: string; from: string; to: string; methods: FishingMethod[] } | null = null
  for (const back of [1, 0]) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back)
    const slots = new Map<string, { from: string; to: string; methods: FishingMethod[] }>()
    for (const a of availability) {
      if (!availDays(a).includes(d.getDay()) || !isValidWindow(a.from, a.to)) continue
      const key = `${a.from}-${a.to}`
      const slot = slots.get(key)
      if (!slot) slots.set(key, { from: a.from, to: a.to, methods: [...availMethods(a)] })
      else for (const m of availMethods(a)) if (!slot.methods.includes(m)) slot.methods.push(m)
    }
    for (const slot of slots.values()) {
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minutes(slot.from)).getTime()
      const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (isOvernight(slot.from, slot.to) ? 1 : 0), 0, minutes(slot.to)).getTime()
      if (start > nowMs || nowMs - end > 3 * 3600000) continue
      if (!best || start >= best.start) {
        const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
        const to = end <= nowMs ? slot.to : `${pad2(now.getHours())}:${pad2(now.getMinutes())}`
        best = { start, date, from: slot.from, to, methods: slot.methods }
      }
    }
  }
  return best && { date: best.date, from: best.from, to: best.to, methods: best.methods }
}
