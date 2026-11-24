/**
 * The catch log's unsaved form: half a catch typed in, then off to
 * Lokationer to add the spot — and back to a blank form, since the view
 * starts afresh on every visit. Kept for the tab in sessionStorage
 * (safeStorage), so it is there while the app is open and over a reload of
 * the tab; never synced, and never the device's (not localStorage). The view
 * keeps it as it leaves (CatchLogView), and clears it once the form is saved
 * or cancelled, or the entry it edits is deleted; logout forgets it
 * (forgetOnLogout).
 *
 * It belongs to the account it was typed under. A logout in another tab,
 * or a switch to another account, runs no logout in this tab, and the next
 * account to open the catch log here found the last one's half-typed catch
 * in its form. So it is read back only for the account whose catch log the
 * page holds (CatchLogView: the account signed in, else the one the log on
 * the device belongs to), and goes when read for another. A token refresh
 * the server refused leaves the account's log, and so its draft. A guest's
 * goes on into a sign-in: a guest who signs in is still the one at the
 * screen (as with the finder's search).
 */
import { readSession, removeSession, writeSession } from './safeStorage'
import { DRAFT_KEY, forgotten } from './forgetOnLogout'
import type { CatchEntry, FishingMethod } from './types'

export { DRAFT_KEY }

/** The form's fields, as CatchLogView holds them. */
export interface DraftForm {
  date: string; time: string; from: string; to: string; speciesId: string; locationName: string
  count: number | ''; lengthCm: number | ''; weightKg: number | ''
  released: boolean | null; method: FishingMethod | null; notes: string
}
/** What the form was last prefilled with: fields still holding it roll over with the day. */
export interface DraftPrefill { date: string; time: string; from: string; to: string; loc: string; method: FishingMethod | null }
/** The form's times: the catch's, and the trip's start and end. */
export type DraftTime = 'time' | 'from' | 'to'

export interface CatchDraft {
  /** The account signed in as it was typed; null: a guest's. */
  who: string | null
  mode: 'catch' | 'empty'
  /**
   * The entry being edited, and the copy of it the form opened on (catches.update
   * merges against it); null for a new one. `place`: the place as ✎ put it in
   * the form, so a pull changing the spots meanwhile doesn't read as a change
   * (none in a draft kept before it was recorded).
   */
  editing: { id: string; opened: CatchEntry; place?: string } | null
  /** The fields and their prefill; null when nothing was typed: then only the mode is kept. */
  form: DraftForm | null
  prefill: DraftPrefill | null
  /**
   * The times typed by hand: one typed as it was prefilled has its prefill's
   * value, so the value can't tell. None in a draft kept before they were
   * recorded: a time unlike its prefill was typed then.
   */
  byHand?: DraftTime[]
  /** The date of the form not shown, kept for a time or span typed there, or for a draft put back on it (CatchLogView setMode). */
  otherDate?: string
  /**
   * The day each form's time or span was last suggested for (CatchLogView
   * suggestedFor); null: none suggested. None in a draft kept before they
   * were recorded: the date stays then as that version kept it.
   */
  suggestedFor?: SuggestedDays
}
/** The day the catch form's time (`catch`) and the trip form's span (`empty`) were suggested for. */
export interface SuggestedDays { catch: string | null; empty: string | null }

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const METHODS: readonly unknown[] = ['shore', 'boat', 'waders'] satisfies FishingMethod[]
const TIMES: readonly unknown[] = ['time', 'from', 'to'] satisfies DraftTime[]
const strings = (o: Record<string, unknown>, keys: string[]) => keys.every((k) => typeof o[k] === 'string')
const amount = (x: unknown) => x === '' || (typeof x === 'number' && Number.isFinite(x))
const method = (x: unknown) => x === null || METHODS.includes(x)

function isForm(f: unknown): f is DraftForm {
  return isObj(f) && strings(f, ['date', 'time', 'from', 'to', 'speciesId', 'locationName', 'notes'])
    && amount(f.count) && amount(f.lengthCm) && amount(f.weightKg)
    && (f.released === null || typeof f.released === 'boolean') && method(f.method)
}
const isPrefill = (p: unknown): p is DraftPrefill => isObj(p) && strings(p, ['date', 'time', 'from', 'to', 'loc']) && method(p.method)
const isDays = (s: unknown): s is SuggestedDays => isObj(s) && [s.catch, s.empty].every((x) => x === null || typeof x === 'string')

/**
 * The tab's draft, if it holds one this version can show to `who` (the
 * account whose catch log the page holds; null: a guest's, or none;
 * undefined: not known yet); else null (corrupt, another format, or none).
 * Another account's is dropped. Not known yet, only a guest's shows, and an
 * account's stays. One kept before the account was recorded (v 1) reads as
 * none: whose it is can't be told.
 */
export function readCatchDraft(who: string | null | undefined): CatchDraft | null {
  let d: unknown
  try { d = JSON.parse(readSession(DRAFT_KEY) ?? 'null') } catch { return null }
  if (!isObj(d) || d.v !== 2 || (d.mode !== 'catch' && d.mode !== 'empty')) return null
  if (d.who !== null && typeof d.who !== 'string') return null
  const typed = d.form !== null || d.prefill !== null
  if (typed && !(isForm(d.form) && isPrefill(d.prefill))) return null
  const e = d.editing
  if (e !== null && !(isObj(e) && typeof e.id === 'string' && isObj(e.opened) && e.opened.id === e.id && typed
    && (e.place === undefined || typeof e.place === 'string'))) return null
  const { byHand, otherDate, suggestedFor } = d
  if (byHand !== undefined && !(Array.isArray(byHand) && byHand.every((k) => TIMES.includes(k)))) return null
  if (otherDate !== undefined && typeof otherDate !== 'string') return null
  if (suggestedFor !== undefined && !isDays(suggestedFor)) return null
  if (d.who !== null && d.who !== who) {
    if (who !== undefined) removeSession(DRAFT_KEY)
    return null
  }
  return {
    who: d.who, mode: d.mode, editing: e as CatchDraft['editing'], form: typed ? d.form as DraftForm : null, prefill: typed ? d.prefill as DraftPrefill : null,
    ...(typed && byHand !== undefined ? { byHand: byHand as DraftTime[] } : {}),
    ...(typed && otherDate !== undefined ? { otherDate: otherDate as string } : {}),
    ...(typed && suggestedFor !== undefined ? { suggestedFor: suggestedFor as SuggestedDays } : {}),
  }
}

/** Taken by the form when it opens, and handed back to keepCatchDraft: a logout since, and it keeps nothing. */
export const draftEpoch = forgotten

/** Keep `d` as the tab's draft (null: none) — unless the account's data was forgotten since the form opened at `openedAt`. */
export function keepCatchDraft(d: CatchDraft | null, openedAt: number): void {
  if (openedAt !== forgotten()) return
  if (!d) removeSession(DRAFT_KEY)
  else writeSession(DRAFT_KEY, JSON.stringify({ v: 2, ...d }))
}

/** The form was saved or cancelled, or the entry it edits deleted: nothing to come back to. */
export function clearCatchDraft(): void {
  removeSession(DRAFT_KEY)
}
