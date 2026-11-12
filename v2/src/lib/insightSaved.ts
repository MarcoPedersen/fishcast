/**
 * The bite-scores insightRun has computed, kept on this device: a reload
 * used to lose them all, and each card asked "Beregn bid-score" again —
 * and fetched its weeks of history again. Derived data: never synced, and
 * any device can compute it again from the log and the weather archive.
 *
 * Read back into the one store the cards and the Modeltjek panel read
 * (insightRun's), under the rules it holds them by: a score shows only while
 * its fingerprint matches the entry as it is now, and says so when the spot's
 * coast changed since (coastOutdated). Kept are the scored results only: a
 * failed fetch is worth a retry, and "no data" may be data once the archive
 * catches up — the card offers no retry for it, a reload does. The run's
 * baseline (hundreds of windows) is not kept: the panel offers to run again.
 *
 * Kept for the build of the app that scored them (SAVED_BUILD). A score is
 * the model's output, and the fingerprint holds the entry, its spot and the
 * targets, not the code: an update that scores differently left the old
 * number on the card, which offers no "compute again" for a score it holds.
 * In memory a score never outlived the app version that computed it.
 *
 * Bounded: the newest entries' scores first, at most MAX_SAVED of them in
 * MAX_SAVED_CHARS characters. The catch log and the weather cache share the
 * origin's ~5 MB with it; a refused write keeps fewer scores, then none — an
 * older set never stays behind. And with the storage full, the log's and the
 * spots' own writes push the kept scores out (safeStorage writeOwn). Scores of deleted entries go with
 * insightRun's pruneResults, and all of them at logout (forgetOnLogout).
 */
import { readStored, removeStored, writeStored } from './safeStorage'
import { SCORES_KEY } from './forgetOnLogout'
import type { WindowSample } from './catchInsights'

export const SAVED_KEY = SCORES_KEY
/** This build of the app: vite.config.ts stamps each one; the tests and the model check have none ('dev'). */
export const SAVED_BUILD: string = typeof __FC_BUILD__ === 'string' ? __FC_BUILD__ : 'dev'
/** About the audit's biggest log, every entry scored. */
export const MAX_SAVED = 300
/** About 180 catches or 35 day-long trips (a catch's score is ~3.3 kB as JSON, a 13-hour trip's ~16 kB). */
export const MAX_SAVED_CHARS = 600_000

/** One kept score, as insightRun holds it. */
export interface SavedResult { fp: string; coast: string; result: WindowSample }
/** What insightRun holds per entry: a score, or none for the hour (null), or a failed fetch. */
interface Held { fp: string; coast: string; result: WindowSample | null | 'failed' }

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const isHour = (h: unknown) => isObj(h) && finite(h.at) && finite(h.score) && isObj(h.cond)
  && Array.isArray(h.breakdown) && h.breakdown.every((b) => isObj(b) && finite(b.points))

/**
 * A stored score as a WindowSample again — its window's date a Date — once
 * what the cards and the panel read checks out: the window's score, spot and
 * date, and each hour's time, score, conditions and points. Else null.
 */
function revive(s: unknown): WindowSample | null {
  if (!isObj(s) || !isObj(s.window) || !Array.isArray(s.hours) || !s.hours.every(isHour)) return null
  const w = s.window
  const date = typeof w.date === 'string' ? new Date(w.date) : null
  if (!date || isNaN(date.getTime()) || !finite(w.score) || !isObj(w.location) || typeof w.location.id !== 'string') return null
  return { ...s, window: { ...w, date } } as unknown as WindowSample
}

/** The scores kept on this device, by entry id; none from data that is corrupt, of another format or build, or out of reach. */
export function readSaved(): Map<string, SavedResult> {
  const out = new Map<string, SavedResult>()
  let doc: unknown
  try { doc = JSON.parse(readStored(SAVED_KEY) ?? 'null') } catch { return out }
  if (!isObj(doc) || doc.v !== 1 || doc.build !== SAVED_BUILD || !Array.isArray(doc.results)) return out
  for (const r of doc.results) {
    if (!Array.isArray(r) || r.length !== 4) continue
    const [id, fp, coast, s] = r
    if (typeof id !== 'string' || typeof fp !== 'string' || typeof coast !== 'string') continue
    const result = revive(s)
    if (result) out.set(id, { fp, coast, result })
  }
  return out
}

const dated = (r: Held): r is SavedResult =>
  isObj(r.result) && isObj(r.result.window) && r.result.window.date instanceof Date && !isNaN(r.result.window.date.getTime())

/** Keep `held`'s scores on the device, in place of what was kept; see the bounds above. */
export function writeSaved(held: ReadonlyMap<string, Held>): void {
  const scored = [...held].filter((x): x is [string, SavedResult] => dated(x[1]))
  // Newest entries first: the log lists them first, and a full run scores them all.
  scored.sort(([ia, a], [ib, b]) => b.result.window.date.getTime() - a.result.window.date.getTime()
    || (a.result.window.from < b.result.window.from ? 1 : a.result.window.from > b.result.window.from ? -1 : 0)
    || (ia < ib ? -1 : ia > ib ? 1 : 0))
  const parts: string[] = []
  const head = `{"v":1,"build":${JSON.stringify(SAVED_BUILD)},"results":[`
  let chars = head.length + ']}'.length
  for (const [id, r] of scored) {
    if (parts.length >= MAX_SAVED) break
    const json = JSON.stringify([id, r.fp, r.coast, r.result])
    if (chars + json.length + 1 > MAX_SAVED_CHARS) break
    parts.push(json)
    chars += json.length + 1
  }
  for (let n = parts.length; n > 0; n = Math.floor(n / 2)) {
    if (writeStored(SAVED_KEY, `${head}${parts.slice(0, n).join(',')}]}`)) return
  }
  removeStored(SAVED_KEY)
}
