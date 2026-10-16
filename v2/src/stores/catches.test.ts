import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useCatchStore } from './catches'

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
})
