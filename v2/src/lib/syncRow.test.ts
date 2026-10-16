import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { fakeDb } from '@/test/fakeSupabase'
import { nextStamp, readRow, sameStamp, writeRow } from './syncRow'

/**
 * The row I/O both stores share. A push used to be a blind upsert, so two
 * devices pushing close together simply overwrote each other. Now a push is
 * conditional on the row version the document was built on, and these are
 * the answers the stores act on.
 */

const A = 'user-a'
const iso = (ms: number) => new Date(ms).toISOString()
const T = Date.parse('2026-09-01T00:00:00.000Z')

beforeEach(() => {
  fakeDb.reset()
  fakeDb.session = { user: { id: A } }
})
afterEach(() => { vi.useRealTimers() })

describe('sameStamp', () => {
  it('compares timestamps, not their spelling', () => {
    expect(sameStamp('2026-09-01T00:00:00+00:00', '2026-09-01T00:00:00.000Z')).toBe(true)
    expect(sameStamp('2026-09-01T02:00:00.5+02:00', '2026-09-01T00:00:00.500Z')).toBe(true)
  })

  it('keeps the microseconds a timestamptz holds', () => {
    expect(sameStamp('2026-09-01T00:00:00.123456+00:00', '2026-09-01T00:00:00.123Z')).toBe(false)
    expect(sameStamp('2026-09-01T00:00:00.123456+00:00', '2026-09-01T00:00:00.123456Z')).toBe(true)
  })

  it('never matches a missing stamp', () => {
    expect(sameStamp(null, '2026-09-01T00:00:00Z')).toBe(false)
    expect(sameStamp('garbage', 'garbage')).toBe(false)
  })
})

describe('nextStamp', () => {
  it('is now, but always past the row it replaces — so the next reader sees that the row moved', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T)
    expect(nextStamp(null)).toBe(T)
    expect(nextStamp(T - 5000)).toBe(T)
    expect(nextStamp(T)).toBe(T + 1) // pushed twice in one millisecond
    expect(nextStamp(T + 60_000)).toBe(T + 60_001) // a row stamped by a clock that runs ahead
  })
})

describe('readRow', () => {
  it('returns the row with its stamp exactly as the server sent it', async () => {
    fakeDb.seed('catches', { user_id: A, entries: [1], updated_at: iso(T) })
    expect(await readRow('catches', 'entries', A)).toEqual({ ok: true, row: { data: [1], stamp: '2026-09-01T00:00:00+00:00', at: T } })
  })

  it('reports "no row" only for a read made with this user\'s session', async () => {
    expect(await readRow('catches', 'entries', A)).toEqual({ ok: true, row: null })
    fakeDb.tokenLost = true // RLS would answer an anon read with "no row"
    expect((await readRow('catches', 'entries', A)).ok).toBe(false)
  })

  it('reports a failed read as a failure, not as "no row"', async () => {
    fakeDb.failReads = true
    expect((await readRow('setups', 'setup', A)).ok).toBe(false)
  })
})

describe('writeRow', () => {
  it('creates the first row with an insert', async () => {
    const res = await writeRow('catches', 'entries', A, [1], null, T)
    expect(res).toEqual({ status: 'ok', stamp: '2026-09-01T00:00:00+00:00', at: T })
    expect(fakeDb.row('catches', A)).toEqual({ user_id: A, entries: [1], updated_at: iso(T) })
  })

  it('reports another device having created the row first as "moved"', async () => {
    fakeDb.seed('catches', { user_id: A, entries: [9], updated_at: iso(T) })
    expect(await writeRow('catches', 'entries', A, [1], null, T + 1)).toEqual({ status: 'moved' })
    expect(fakeDb.row('catches', A)!.entries).toEqual([9])
  })

  it('updates only while the row still holds the base stamp', async () => {
    fakeDb.seed('setups', { user_id: A, setup: { a: 1 }, updated_at: iso(T) })
    const ok = await writeRow('setups', 'setup', A, { a: 2 }, '2026-09-01T00:00:00+00:00', T + 5)
    expect(ok).toEqual({ status: 'ok', stamp: '2026-09-01T00:00:00.005+00:00', at: T + 5 })
    // Built on the old version again: the row has moved, nothing is written.
    expect(await writeRow('setups', 'setup', A, { a: 3 }, iso(T), T + 9)).toEqual({ status: 'moved' })
    expect(fakeDb.row('setups', A)!.setup).toEqual({ a: 2 })
  })

  it('reports a dropped connection as an error', async () => {
    fakeDb.failWrites = true
    expect((await writeRow('setups', 'setup', A, {}, null, T)).status).toBe('error')
    expect((await writeRow('setups', 'setup', A, {}, iso(T), T)).status).toBe('error')
  })
})
