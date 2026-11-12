import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DRAFT_KEY, clearCatchDraft, draftEpoch, forgetCatchDraft, keepCatchDraft, readCatchDraft, type CatchDraft } from './catchDraft'

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
const DRAFT: CatchDraft = { mode: 'catch', editing: null, form: FORM, prefill: PREFILL }
const EDIT: CatchDraft = {
  mode: 'empty', form: { ...FORM, from: '05:00', to: '08:00', speciesId: '', count: '', weightKg: '', released: null }, prefill: PREFILL,
  editing: { id: 't1', opened: { id: 't1', outcome: 'empty', date: '2026-11-10', from: '05:00', to: '07:00', speciesId: '', count: 0, locationName: 'Sydmolen' } },
}

beforeEach(() => {
  vi.stubGlobal('sessionStorage', sessionStub())
  clearCatchDraft()
})
afterEach(() => vi.unstubAllGlobals())

describe('the catch form draft', () => {
  it('is kept for the tab, and read back as it was left', () => {
    for (const d of [DRAFT, EDIT, { mode: 'empty', editing: null, form: null, prefill: null } as CatchDraft]) {
      keepCatchDraft(d, draftEpoch())
      expect(readCatchDraft()).toEqual(d)
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
    expect(readCatchDraft()).toBeNull()
    keepCatchDraft(DRAFT, draftEpoch())
    keepCatchDraft(null, draftEpoch())
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it('reads past corrupt, other-format or wrong-shaped data', () => {
    const doc = (over: Record<string, unknown>) => JSON.stringify({ v: 1, ...DRAFT, ...over })
    for (const bad of [
      '{bad', 'null', '[]', '"draft"', JSON.stringify({ ...DRAFT }), JSON.stringify({ v: 2, ...DRAFT }),
      doc({ mode: 'fish' }), doc({ form: { ...FORM, count: 'mange' } }), doc({ form: { ...FORM, released: 'ja' } }),
      doc({ form: { ...FORM, method: 'kajak' } }), doc({ form: { ...FORM, notes: 7 } }), doc({ form: { ...FORM, date: undefined } }),
      doc({ prefill: null }), doc({ prefill: { ...PREFILL, time: 10 } }), doc({ editing: { id: 5 } }),
      doc({ editing: { id: 't1', opened: { id: 'another' } } }), doc({ editing: { id: 't1' }, form: null, prefill: null }),
    ]) {
      sessionStorage.setItem(DRAFT_KEY, bad)
      expect(readCatchDraft(), bad).toBeNull()
    }
  })

  it('lives for the visit where the browser blocks sessionStorage', () => {
    const blocked = () => { throw new DOMException('blocked', 'SecurityError') }
    vi.stubGlobal('sessionStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
    keepCatchDraft(DRAFT, draftEpoch())
    expect(readCatchDraft()).toEqual(DRAFT)
    clearCatchDraft()
    expect(readCatchDraft()).toBeNull()
  })

  /** Logout: the next user of this tab must not find the last one's half-typed catch — nor a form still open put it back. */
  it('is forgotten at logout, and a form open since cannot keep it again', () => {
    const opened = draftEpoch()
    keepCatchDraft(DRAFT, opened)
    forgetCatchDraft()
    expect(readCatchDraft()).toBeNull()
    keepCatchDraft(DRAFT, opened)
    expect(readCatchDraft()).toBeNull()
    keepCatchDraft(DRAFT, draftEpoch())
    expect(readCatchDraft()).toEqual(DRAFT)
  })
})
