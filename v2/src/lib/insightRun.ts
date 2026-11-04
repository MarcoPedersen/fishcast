/**
 * Runs the Modeltjek analysis, and holds every entry's bite-score — the one
 * module of the insight view that fetches. A card's "Beregn bid-score" and
 * the panel write to the same store, so a card and the panel never show two
 * numbers for one entry.
 *
 * A result is stored with a fingerprint of everything it was computed from
 * (the entry's date, time or span, spot, method and kind; the spot's
 * coordinates and details; the target species). A result whose fingerprint
 * no longer matches is simply not there: no watcher has to clear anything
 * when the setup changes or a pull replaces the log — and a pull that only
 * brings another device's note leaves the scores alone.
 */
import { reactive } from 'vue'
import { localDayUTC } from './clock'
import {
  MAX_SCORE_AGE_DAYS, bestMethod, catchesMaybeInside, entryWindow, findCatchLocation, isEmptyTrip, sampleWindow, scoreBlocker, scoreEntry, spotKey, tripOutings,
} from './catchScore'
import { baselineWindows, catchTrips, mergeOuting, type Groups, type WindowSample } from './catchInsights'
import { cachedHistory, cachedSpan, loadSpan, planSpans, type DaySpan, type HistoryCache } from './history'
import type { Availability, CatchEntry, Location } from './types'

const DAY = 86400000
/** The baseline's neighbourhood, and so the history fetched around each entry. */
export const PAD_DAYS = 7

/** A scored entry; null = no data for it; 'failed' = the weather fetch failed (worth a retry). */
export type EntryResult = WindowSample | null | 'failed'

export function entryFingerprint(e: CatchEntry, locations: Location[], targets: string[]): string {
  const loc = findCatchLocation(e, locations)
  const spot = loc ? [loc.id, loc.lat, loc.lon, loc.waterType ?? '', loc.depth ?? '', loc.species ?? null] : null
  return JSON.stringify([e.outcome ?? '', e.date, e.time ?? '', e.from ?? '', e.to ?? '', e.method ?? '', spot, [...targets].sort()])
}

/** What a whole run depends on: its entries as above, plus the time windows of the baseline. */
export function runFingerprint(entries: CatchEntry[], locations: Location[], availability: Availability[], targets: string[]): string {
  const es = entries.filter((e) => !scoreBlocker(e, locations)).map((e) => e.id + entryFingerprint(e, locations, targets)).sort()
  const av = availability.map((a) => [a.days, a.from, a.to, a.methods])
  return JSON.stringify([es, av])
}

export const insight = reactive({
  results: new Map<string, { fp: string; result: EntryResult }>(),
  loading: new Set<string>(),
  /** The last completed run: its baseline, and the inputs it belongs to. */
  run: null as null | { fp: string; base: WindowSample[] },
  running: false,
  progress: { i: 0, n: 0 },
})

/** Fetched history for the session: a re-run, or a card after a run, fetches nothing again. */
const cache: HistoryCache = new Map()

/** The entry's result, if one was computed from what the entry is now. */
export function resultFor(e: CatchEntry, locations: Location[], targets: string[]): EntryResult | undefined {
  const r = insight.results.get(e.id)
  return r && r.fp === entryFingerprint(e, locations, targets) ? r.result : undefined
}

/** Forget results for entries that are gone (a delete, or a pull that removed them). */
export function pruneResults(ids: Set<string>) {
  for (const id of [...insight.results.keys()]) if (!ids.has(id)) insight.results.delete(id)
}

async function score(e: CatchEntry, locations: Location[], targets: string[]) {
  const fp = entryFingerprint(e, locations, targets)
  let result: EntryResult
  try { result = await scoreEntry(e, locations, targets, cache) } catch { result = 'failed' }
  insight.results.set(e.id, { fp, result })
}

/** One card's "Beregn bid-score" (or its retry). */
export async function scoreOne(e: CatchEntry, locations: Location[], targets: string[]) {
  if (insight.loading.has(e.id)) return
  insight.loading.add(e.id)
  try { await score(e, locations, targets) } finally { insight.loading.delete(e.id) }
}

const covers = (outer: DaySpan, inner: DaySpan) => outer.start <= inner.start && inner.end <= outer.end
const yieldToUi = () => new Promise((r) => setTimeout(r, 0))

/**
 * Score every analysable entry and the baseline windows around them. The
 * history comes first, one planned span per spot and stretch of weeks, in
 * sequence — free shared APIs, no reason to hammer them — and everything
 * after that is scored from the cache without another request.
 */
export async function runAnalysis(entries: CatchEntry[], locations: Location[], availability: Availability[], targets: string[]) {
  if (insight.running) return
  insight.running = true
  try {
    const fp = runFingerprint(entries, locations, availability, targets)
    const analysable = entries.filter((e) => !scoreBlocker(e, locations))
    const anchors = analysable.map((e) => ({ e, loc: findCatchLocation(e, locations)!, day: entryWindow(e)!.day }))
    const locById = new Map(anchors.map((a) => [a.loc.id, a.loc]))
    const today = localDayUTC(Date.now())
    const plan = planSpans(anchors.map((a) => ({ locId: a.loc.id, day: a.day })), PAD_DAYS, today, MAX_SCORE_AGE_DAYS)
    const jobs = [...plan].flatMap(([locId, spans]) => spans.map((span) => ({ loc: locById.get(locId)!, span })))

    insight.progress = { i: 0, n: jobs.length }
    const failed: { locId: string; span: DaySpan }[] = []
    for (const job of jobs) {
      insight.progress.i++
      // Already fetched this session (an earlier run over the same weeks)?
      const hit = cachedSpan(job.loc, job.span, cache)
      if (hit) {
        try { await hit; continue } catch { /* evicted: fetch again below */ }
      }
      try { await loadSpan(job.loc, job.span, cache) } catch { failed.push({ locId: job.loc.id, span: job.span }) }
    }

    for (const { e, loc, day } of anchors) {
      // Its weather already failed this run: say so, rather than asking again entry by entry.
      if (failed.some((f) => f.locId === loc.id && covers(f.span, { start: day, end: day }))) {
        insight.results.set(e.id, { fp: entryFingerprint(e, locations, targets), result: 'failed' })
        continue
      }
      await score(e, locations, targets)
    }

    const base: WindowSample[] = []
    const windows = baselineWindows(anchors.map((a) => ({ locId: a.loc.id, day: a.day })), availability, Date.now(), {
      padDays: PAD_DAYS, oldestDay: today - MAX_SCORE_AGE_DAYS * DAY,
    })
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i]
      const loc = locById.get(w.locId)!
      // From the spans already fetched only: a baseline window never costs a request.
      const f = await cachedHistory(loc, w.day, cache)?.catch(() => null)
      if (f) {
        const s = sampleWindow(loc, w.day, w.from, w.to, f, targets, bestMethod(loc, w.day, w.from, w.to, w.methods, f, targets))
        if (s) base.push(s)
      }
      // A few hundred windows of up to 13 scored hours each: let the page breathe.
      if (i % 25 === 24) await yieldToUi()
    }
    insight.run = { fp, base }
  } finally {
    insight.running = false
  }
}

/**
 * Whether a catch belongs among the trips with a catch: its species is one
 * of the targets, or unknown. Every entry is scored for the dashboard's
 * targets, so a bycatch — a skrubbe at night, a hornfisk at sunny midday —
 * would count as a trip with a catch for a score computed for other fish,
 * and at five trips one such entry moves the mean by several points. Only
 * the grouping depends on it: the card keeps its score.
 */
export function countsAsCatch(e: CatchEntry, targets: string[]): boolean {
  return !e.speciesId || targets.includes(e.speciesId)
}

export interface InsightGroups {
  groups: Groups
  /** Analysable catches of a species outside the targets, left out. */
  otherSpecies: number
  /** Analysable empty trips left out because a catch lies inside them. */
  overlapping: number
  /** Analysable entries whose weather couldn't be fetched. */
  failed: number
}

/**
 * The three groups as the panel compares them, from the current results.
 * Catches from one outing (same date, same spot) are one trip with a catch;
 * empty trips whose spans overlap at one spot are one trip without
 * (tripOutings) — the form refuses such a copy, but two devices logging
 * offline keep both. An empty trip that may hold a catch is left out — one
 * inside its span, or one logged without a time at its spot that day: the
 * catch form asks to delete it, but "No", two devices logging offline, or an
 * edit that moves a catch into it can all leave one behind, and "uden
 * fangst" would be false.
 */
export function insightGroups(entries: CatchEntry[], locations: Location[], targets: string[], base: WindowSample[]): InsightGroups {
  const catches: { key: string; sample: WindowSample }[] = []
  const trips = new Map<CatchEntry, WindowSample>()
  let overlapping = 0, failed = 0, otherSpecies = 0
  for (const e of entries) {
    if (scoreBlocker(e, locations)) continue
    if (!isEmptyTrip(e) && !countsAsCatch(e, targets)) { otherSpecies++; continue }
    const r = resultFor(e, locations, targets)
    if (r === 'failed') { failed++; continue }
    if (!r) continue
    if (!isEmptyTrip(e)) catches.push({ key: `${e.date}|${spotKey(e, locations)}`, sample: r })
    else if (catchesMaybeInside(e, entries, locations).length) overlapping++
    else trips.set(e, r)
  }
  const empty = tripOutings([...trips.keys()], locations).map((o) => mergeOuting(o.map((e) => trips.get(e)!)))
  return { groups: { catch: catchTrips(catches), empty, base }, overlapping, failed, otherSpecies }
}
