/**
 * The catch log's unsaved form: half a catch typed in, then off to
 * Lokationer to add the spot — and back to a blank form, since the view
 * starts afresh on every visit. Kept for the tab in sessionStorage
 * (safeStorage), so it is there while the app is open and over a reload of
 * the tab; never synced, and never the device's (not localStorage). The view
 * keeps it as it leaves (CatchLogView), and clears it once the form is saved
 * or cancelled, or the entry it edits is deleted; logout forgets it
 * (forgetOnLogout).
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

export interface CatchDraft {
  mode: 'catch' | 'empty'
  /** The entry being edited, and the copy of it the form opened on (catches.update merges against it); null for a new one. */
  editing: { id: string; opened: CatchEntry } | null
  /** The fields and their prefill; null when nothing was typed: then only the mode is kept. */
  form: DraftForm | null
  prefill: DraftPrefill | null
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const METHODS: readonly unknown[] = ['shore', 'boat', 'waders'] satisfies FishingMethod[]
const strings = (o: Record<string, unknown>, keys: string[]) => keys.every((k) => typeof o[k] === 'string')
const amount = (x: unknown) => x === '' || (typeof x === 'number' && Number.isFinite(x))
const method = (x: unknown) => x === null || METHODS.includes(x)

function isForm(f: unknown): f is DraftForm {
  return isObj(f) && strings(f, ['date', 'time', 'from', 'to', 'speciesId', 'locationName', 'notes'])
    && amount(f.count) && amount(f.lengthCm) && amount(f.weightKg)
    && (f.released === null || typeof f.released === 'boolean') && method(f.method)
}
const isPrefill = (p: unknown): p is DraftPrefill => isObj(p) && strings(p, ['date', 'time', 'from', 'to', 'loc']) && method(p.method)

/** The tab's draft, if it holds one this version can show; else null (corrupt, another format, or none). */
export function readCatchDraft(): CatchDraft | null {
  let d: unknown
  try { d = JSON.parse(readSession(DRAFT_KEY) ?? 'null') } catch { return null }
  if (!isObj(d) || d.v !== 1 || (d.mode !== 'catch' && d.mode !== 'empty')) return null
  const typed = d.form !== null || d.prefill !== null
  if (typed && !(isForm(d.form) && isPrefill(d.prefill))) return null
  const e = d.editing
  if (e !== null && !(isObj(e) && typeof e.id === 'string' && isObj(e.opened) && e.opened.id === e.id && typed)) return null
  return { mode: d.mode, editing: e as CatchDraft['editing'], form: typed ? d.form as DraftForm : null, prefill: typed ? d.prefill as DraftPrefill : null }
}

/** Taken by the form when it opens, and handed back to keepCatchDraft: a logout since, and it keeps nothing. */
export const draftEpoch = forgotten

/** Keep `d` as the tab's draft (null: none) — unless the account's data was forgotten since the form opened at `openedAt`. */
export function keepCatchDraft(d: CatchDraft | null, openedAt: number): void {
  if (openedAt !== forgotten()) return
  if (!d) removeSession(DRAFT_KEY)
  else writeSession(DRAFT_KEY, JSON.stringify({ v: 1, ...d }))
}

/** The form was saved or cancelled, or the entry it edits deleted: nothing to come back to. */
export function clearCatchDraft(): void {
  removeSession(DRAFT_KEY)
}
