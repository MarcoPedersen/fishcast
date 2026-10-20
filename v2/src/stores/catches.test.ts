import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { CATCH_PLACE, useCatchStore } from './catches'
import { mergeRecord } from '@/lib/merge'

// Mirrors setup.test.ts: the catch log has the same guards (no stamp on a wipe
// or on its own load, un-armed edits still stamped) but had no tests at all.
// Pull/push against the Supabase fake lives in storeSync.test.ts.

const LS_KEY = 'fc2-catches'
const read = () => {
  const raw = localStorage.getItem(LS_KEY)
  return raw ? JSON.parse(raw) : null
}
const CATCH = { date: '2026-09-30', speciesId: 'torsk', locationName: 'Mole' }

describe('catch store — local persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('stamps updatedAt on a genuine edit once sync is armed', async () => {
    const c = useCatchStore()
    c.markReady()
    c.add(CATCH)
    await nextTick()
    const saved = read()
    expect(saved.entries).toHaveLength(1)
    expect(saved.updatedAt).toBeGreaterThan(0)
    expect(saved.dirty).toBe(true)
  })

  it('stamps an edit made before markReady (pull still in flight)', async () => {
    const c = useCatchStore()
    c.add(CATCH)
    await nextTick()
    expect(read().updatedAt).toBeGreaterThan(0)
  })

  it('does not stamp or rewrite its own local load', async () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ entries: [{ ...CATCH, id: 'x' }], updatedAt: 1000, ownerId: null, dirty: false }))
    const c = useCatchStore()
    c.markReady()
    c.loadLocal()
    await nextTick()
    await nextTick()
    expect(c.entries).toHaveLength(1)
    expect(read().updatedAt).toBe(1000)
  })

  it('loads the old bare-array format', () => {
    localStorage.setItem(LS_KEY, JSON.stringify([{ ...CATCH, id: 'old' }]))
    const c = useCatchStore()
    c.loadLocal()
    expect(c.entries.map((e) => e.id)).toEqual(['old'])
  })

  it('survives corrupt local state', () => {
    localStorage.setItem(LS_KEY, '{not json')
    const c = useCatchStore()
    c.loadLocal()
    expect(c.entries).toEqual([])
  })

  // See setup.test.ts — the sign-out data-loss bug: a wipe must not be re-saved
  // with a fresh stamp, or it beats the account's real log on the next login.
  it('clear() leaves no rewritten state behind (no fresh stamp on a wipe)', async () => {
    const c = useCatchStore()
    c.markReady()
    c.add(CATCH)
    await nextTick()
    expect(read().entries).toHaveLength(1)

    c.clear()
    await nextTick()
    await nextTick() // watcher flush + the clearing-flag release

    expect(localStorage.getItem(LS_KEY)).toBeNull()
    expect(c.entries).toHaveLength(0)
  })

  it('resumes stamping normally after a clear', async () => {
    const c = useCatchStore()
    c.markReady()
    c.clear()
    await nextTick()
    await nextTick()

    c.add(CATCH)
    await nextTick()
    expect(read().entries).toHaveLength(1)
    expect(read().updatedAt).toBeGreaterThan(0)
  })
})

describe('catch store — history order', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  /**
   * Regression — sorted by date only, so same-day entries kept insertion
   * order: a backfilled 06:15 catch sat above that evening's 19:30, and
   * editing an entry's time never moved it.
   */
  it('is newest first by date, then by time within the day', () => {
    const c = useCatchStore()
    c.add({ ...CATCH, date: '2026-09-30', time: '19:30', notes: 'evening' })
    c.add({ ...CATCH, date: '2026-09-30', time: '06:15', notes: 'morning' }) // backfilled afterwards
    c.add({ ...CATCH, date: '2026-09-29', time: '23:00', notes: 'day before' })
    c.add({ ...CATCH, date: '2026-10-01', notes: 'no time' })
    c.add({ ...CATCH, date: '2026-09-30', notes: 'same day, no time' })
    expect(c.sorted.map((e) => e.notes)).toEqual(['no time', 'evening', 'morning', 'same day, no time', 'day before'])
  })

  it('moves an entry when its time is edited', () => {
    const c = useCatchStore()
    c.add({ ...CATCH, time: '08:00', notes: 'a' })
    c.add({ ...CATCH, time: '12:00', notes: 'b' })
    expect(c.sorted.map((e) => e.notes)).toEqual(['b', 'a'])
    const a = c.entries.find((e) => e.notes === 'a')!
    c.update(a.id, { ...CATCH, time: '18:00', notes: 'a' })
    expect(c.sorted.map((e) => e.notes)).toEqual(['a', 'b'])
  })
})

describe('catch store — editing', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  /**
   * The edit form holds the entry's id while it is open. A pull can remove
   * the entry meanwhile — another device deleted it, and this device's copy
   * was untouched, so the merge applied the delete — and update() then found
   * no entry and dropped the edit without a word. An edit beats a stale
   * delete everywhere else in sync; the form is no exception.
   */
  it('keeps an edit saved after the entry vanished from under the form', async () => {
    const c = useCatchStore()
    c.markReady()
    c.add(CATCH)
    const id = c.entries[0].id
    c.entries = [] // a pull applied another device's delete
    c.update(id, { ...CATCH, lengthCm: 62 })
    expect(c.entries).toEqual([{ ...CATCH, lengthCm: 62, id }])
    await nextTick()
    expect(read().entries).toHaveLength(1)
    expect(read().dirty).toBe(true)
  })

  it('replaces the entry in place when it is still there', () => {
    const c = useCatchStore()
    c.add({ ...CATCH, notes: 'a' })
    c.add({ ...CATCH, notes: 'b' })
    const a = c.entries.find((e) => e.notes === 'a')!
    c.update(a.id, { ...CATCH, notes: 'a2' })
    expect(c.entries.map((e) => e.notes)).toEqual(['b', 'a2'])
  })

  /**
   * The form opens on a copy of the entry and saves every field it shows.
   * update() replaced the entry with that, so a pull that landed while the
   * form was open — the phone's note on this very catch — was written over
   * by the form's stale copy of the note when only the length was changed,
   * and the merge couldn't help: it arrived as a fresh local edit.
   */
  it('keeps what a pull changed while the form was open, in the fields the form left alone', () => {
    const c = useCatchStore()
    c.add({ ...CATCH, notes: 'c1' })
    const opened = JSON.parse(JSON.stringify(c.entries[0])) // CatchLogView.edit()
    const { id, ...fields } = opened
    c.entries = [{ ...opened, notes: 'big one, phone', weightKg: 2.4 }] // a pull adopted the phone's edit
    c.update(id, { ...fields, lengthCm: 70, weightKg: undefined }, opened) // the form saves every field
    expect(c.entries).toEqual([{ ...CATCH, id, notes: 'big one, phone', weightKg: 2.4, lengthCm: 70 }])
  })

  it('clears a field the form cleared, and wins a field both changed', () => {
    const c = useCatchStore()
    c.add({ ...CATCH, notes: 'c1', weightKg: 1.2 })
    const opened = JSON.parse(JSON.stringify(c.entries[0]))
    const { id, ...fields } = opened
    c.entries = [{ ...opened, notes: 'remote' }]
    c.update(id, { ...fields, weightKg: undefined, notes: 'form' }, opened)
    expect(c.entries).toEqual([{ ...CATCH, id, notes: 'form' }])
  })

  /** A member a newer app version added (or one this form doesn't show) must survive an edit here. */
  it("keeps fields it doesn't know through an edit", () => {
    const c = useCatchStore()
    c.entries = [{ ...CATCH, id: 'c1', photo: { url: 'x' } } as any]
    const opened = JSON.parse(JSON.stringify(c.entries[0]))
    c.update('c1', { ...CATCH, lengthCm: 70 }, opened)
    expect((c.entries[0] as any).photo).toEqual({ url: 'x' })
    c.update('c1', { ...CATCH, lengthCm: 71 })
    expect((c.entries[0] as any).photo).toEqual({ url: 'x' })
  })
})

// ── Empty trips ("Fisket uden fangst") ───────────────────────────────
// An empty trip is an entry in the same synced list: outcome 'empty', a
// from–to span instead of a time, count 0 and no species. The shape is chosen
// so the app versions still cached on a phone handle it harmlessly.
const TRIP = { outcome: 'empty' as const, date: '2026-10-18', from: '06:00', to: '09:30', speciesId: '', count: 0, locationName: 'Mole', method: 'shore' as const }

describe('catch store — empty trips', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('persists an empty trip with its span, count 0 and no time', async () => {
    const c = useCatchStore()
    c.markReady()
    c.add(TRIP)
    await nextTick()
    const saved = read().entries[0]
    expect(saved).toMatchObject({ outcome: 'empty', from: '06:00', to: '09:30', count: 0, speciesId: '' })
    expect('time' in saved).toBe(false)
  })

  /**
   * A trip has no `time`, so it sorted last within its day like an entry
   * without one: a 06:00–09:30 trip sat below that evening's catch AND below
   * the 05:00 one before it. It sorts by when it started.
   */
  it('sorts a trip by its start, among the same day’s catches', () => {
    const c = useCatchStore()
    c.add({ ...CATCH, date: '2026-10-18', time: '05:00', notes: '05' })
    c.add({ ...TRIP, notes: 'trip 06' })
    c.add({ ...CATCH, date: '2026-10-18', time: '08:00', notes: '08' })
    expect(c.sorted.map((e) => e.notes)).toEqual(['08', 'trip 06', '05'])
  })
})

/**
 * What an app version from before empty trips does with one: it doesn't know
 * `outcome`, `from` or `to`. These replay its rules (CatchLogView and
 * catchScore at ed34b06) against a log with a trip in it.
 */
describe('catch store — an empty trip seen by an older app version', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })
  const LOG = [{ ...CATCH, id: 'c1', count: 3 }, { ...CATCH, id: 'c2' }]

  it('adds nothing to its fish count (count ?? 1, summed)', () => {
    const oldTotal = (es: { count?: number }[]) => es.reduce((n, e) => n + (e.count ?? 1), 0)
    expect(oldTotal([...LOG, { ...TRIP, id: 't1' }])).toBe(oldTotal(LOG))
  })

  it('leaves it out of its model check, which needed a time', () => {
    const oldCanScore = (e: { time?: string }) => !!e.time
    expect(oldCanScore({ ...TRIP })).toBe(false)
  })

  it('keeps outcome, from and to through its edit of the notes', () => {
    const c = useCatchStore()
    c.entries = [{ ...TRIP, id: 't1', notes: 'klart vand' }]
    const opened = JSON.parse(JSON.stringify(c.entries[0]))
    // The old form knew neither field, so its payload has none of them…
    const { outcome, from, to, ...oldForm } = opened
    void outcome; void from; void to
    const edited = { ...opened, ...oldForm, notes: 'ingen hug' }
    // …and the old update() merged with the place group only.
    c.entries = [mergeRecord(opened, edited, c.entries[0], CATCH_PLACE)]
    expect(c.entries[0]).toMatchObject({ outcome: 'empty', from: '06:00', to: '09:30', notes: 'ingen hug' })
  })

  it('cannot save it from its edit form (count 0 is out of range)', () => {
    const inRange = (v: string | number, min: number, max: number) => v === '' || (Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max)
    expect(inRange(TRIP.count, 1, 9999)).toBe(false)
  })
})
