import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DRAFT_KEY, clearCatchDraft, draftEpoch, keepCatchDraft, readCatchDraft, type CatchDraft } from './catchDraft'
import { forgetAccountData } from './forgetOnLogout'

/**
 * The catch log's unsaved form (catchDraft): kept for the tab in
 * sessionStorage, read back only when it is one.
 */
function sessionStub() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)) }, removeItem: (k: string) => { m.delete(k) } }
}
const FORM: NonNullable<CatchDraft['form']> = {
  date: '2026-11-10', time: '05:15', from: '', to: '', speciesId: 'torsk', locationName: 'Sydmolen',
  count: 2, lengthCm: '', weightKg: 1.5, released: false, method: 'boat', notes: 'halvt skrevet',
}
const PREFILL: NonNullable<CatchDraft['prefill']> = { date: '2026-11-12', time: '10:00', from: '', to: '', loc: '', method: null }
/** The account signed in as the drafts below were typed, and another one. */
const A = 'user-a', B = 'user-b'
const DRAFT: CatchDraft = { who: A, mode: 'catch', editing: null, form: FORM, prefill: PREFILL }
const EDIT: CatchDraft = {
  who: A, mode: 'empty', form: { ...FORM, from: '05:00', to: '08:00', speciesId: '', count: '', weightKg: '', released: null }, prefill: PREFILL,
  editing: { id: 't1', opened: { id: 't1', outcome: 'empty', date: '2026-11-10', from: '05:00', to: '07:00', speciesId: '', count: 0, locationName: 'Sydmolen' } },
}

beforeEach(() => {
  vi.stubGlobal('sessionStorage', sessionStub())
  clearCatchDraft()
})
afterEach(() => vi.unstubAllGlobals())

describe('the catch form draft', () => {
  it('is kept for the tab, and read back as it was left', () => {
    for (const d of [DRAFT, EDIT, { who: A, mode: 'empty', editing: null, form: null, prefill: null } as CatchDraft]) {
      keepCatchDraft(d, draftEpoch())
      expect(readCatchDraft(A)).toEqual(d)
    }
    expect(JSON.parse(sessionStorage.getItem(DRAFT_KEY)!).form).toBeNull()
  })

  /** Never synced, and not the device's either: only this tab's sessionStorage holds it. */
  it('is never in localStorage', () => {
    keepCatchDraft(DRAFT, draftEpoch())
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull()
    for (let i = 0; i < localStorage.length; i++) expect(localStorage.getItem(localStorage.key(i)!)).not.toContain('halvt skrevet')
  })

  it('is gone once cleared, or kept as none', () => {
    keepCatchDraft(DRAFT, draftEpoch())
    clearCatchDraft()
    expect(readCatchDraft(A)).toBeNull()
    keepCatchDraft(DRAFT, draftEpoch())
    keepCatchDraft(null, draftEpoch())
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it('reads past corrupt, other-format or wrong-shaped data', () => {
    const doc = (over: Record<string, unknown>) => JSON.stringify({ v: 2, ...DRAFT, ...over })
    const { who: _, ...unrecorded } = DRAFT
    for (const bad of [
      '{bad', 'null', '[]', '"draft"', JSON.stringify({ ...DRAFT }), JSON.stringify({ v: 3, ...DRAFT }),
      // Kept before the account was recorded: whose it is can't be told.
      JSON.stringify({ v: 1, ...unrecorded }), doc({ who: undefined }), doc({ who: 7 }),
      doc({ mode: 'fish' }), doc({ form: { ...FORM, count: 'mange' } }), doc({ form: { ...FORM, released: 'ja' } }),
      doc({ form: { ...FORM, method: 'kajak' } }), doc({ form: { ...FORM, notes: 7 } }), doc({ form: { ...FORM, date: undefined } }),
      doc({ prefill: null }), doc({ prefill: { ...PREFILL, time: 10 } }), doc({ editing: { id: 5 } }),
      doc({ editing: { id: 't1', opened: { id: 'another' } } }), doc({ editing: { id: 't1' }, form: null, prefill: null }),
    ]) {
      sessionStorage.setItem(DRAFT_KEY, bad)
      expect(readCatchDraft(A), bad).toBeNull()
    }
  })

  it('lives for the visit where the browser blocks sessionStorage', () => {
    const blocked = () => { throw new DOMException('blocked', 'SecurityError') }
    vi.stubGlobal('sessionStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
    keepCatchDraft(DRAFT, draftEpoch())
    expect(readCatchDraft(A)).toEqual(DRAFT)
    clearCatchDraft()
    expect(readCatchDraft(A)).toBeNull()
  })

  /** A draft kept in memory while the tab's storage was full is not read over the next one it does store. */
  it('gives way to the next draft once the tab can store again', () => {
    const tab = sessionStub()
    let full = true
    vi.stubGlobal('sessionStorage', { ...tab, setItem: (k: string, v: string) => { if (full) throw new DOMException('full', 'QuotaExceededError'); tab.setItem(k, v) } })
    keepCatchDraft(DRAFT, draftEpoch())
    expect(readCatchDraft(A)).toEqual(DRAFT)
    full = false
    keepCatchDraft(EDIT, draftEpoch())
    expect(readCatchDraft(A)).toEqual(EDIT)
  })

  /** Logout: the next user of this tab must not find the last one's half-typed catch — nor a form still open put it back. */
  it('is forgotten at logout, and a form open since cannot keep it again', () => {
    const opened = draftEpoch()
    keepCatchDraft(DRAFT, opened)
    forgetAccountData()
    expect(readCatchDraft(A)).toBeNull()
    keepCatchDraft(DRAFT, opened)
    expect(readCatchDraft(A)).toBeNull()
    keepCatchDraft(DRAFT, draftEpoch())
    expect(readCatchDraft(A)).toEqual(DRAFT)
  })

  // Logged out in another tab, or into another account: no logout runs in
  // this tab, and the next account to open the catch log here found the last
  // one's half-typed catch. Read for the account whose log the page holds
  // (CatchLogView); null: a guest's, or none.
  it('is read back for the account it was kept under only, and goes when read for another or none', () => {
    for (const who of [B, null]) {
      keepCatchDraft(DRAFT, draftEpoch())
      expect(readCatchDraft(who), String(who)).toBeNull()
      // Gone, not hidden: back in the account, it is not there either.
      expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull()
      expect(readCatchDraft(A)).toBeNull()
    }
    keepCatchDraft(EDIT, draftEpoch())
    expect(readCatchDraft(A)).toEqual(EDIT)
  })

  // A guest who signs in is still the one at the screen.
  it('a guest’s is read back signed out, and for whoever signs in', () => {
    const guest: CatchDraft = { ...DRAFT, who: null }
    keepCatchDraft(guest, draftEpoch())
    expect(readCatchDraft(null)).toEqual(guest)
    expect(readCatchDraft(B)).toEqual(guest)
  })

  // Before the page knows whose log it holds (the session not read yet): a
  // guest's goes on into whichever account, so it shows; an account's waits.
  it('read before whose log is known, a guest’s shows, and an account’s stays for later', () => {
    keepCatchDraft(DRAFT, draftEpoch())
    expect(readCatchDraft(undefined)).toBeNull()
    expect(readCatchDraft(A)).toEqual(DRAFT)
    const guest: CatchDraft = { ...DRAFT, who: null }
    keepCatchDraft(guest, draftEpoch())
    expect(readCatchDraft(undefined)).toEqual(guest)
  })
})
