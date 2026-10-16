import { describe, it, expect, beforeEach } from 'vitest'
import { fakeDb, fakeSupabase as sb } from './fakeSupabase'

/**
 * The fake has to be as strict as the server on exactly the points the sync
 * relies on: an update conditioned on `updated_at` touches no row once another
 * device has written, an insert over an existing row is a unique violation,
 * and timestamps come back in PostgREST's format ('+00:00', microseconds when
 * the column holds them) — a client that string-compared them, or rounded
 * them to ms, would never match its own condition again.
 */

const A = 'user-a'
const at = (s: string) => `2026-09-01T00:00:${s}`

beforeEach(() => {
  fakeDb.reset()
  fakeDb.session = { user: { id: A } }
})

describe('fake supabase — conditional update', () => {
  it('updates the row only while it still holds the stamp the client built on', async () => {
    fakeDb.seed('catches', { user_id: A, entries: [1], updated_at: at('00.000Z') })
    const hit = await sb.from('catches').update({ entries: [1, 2], updated_at: at('05.000Z') })
      .eq('user_id', A).eq('updated_at', at('00.000Z')).select('updated_at')
    expect(hit).toEqual({ data: [{ updated_at: '2026-09-01T00:00:05+00:00' }], error: null })
    expect(fakeDb.row('catches', A)!.entries).toEqual([1, 2])

    // Same condition again: the row has moved on, so nothing matches — and no error.
    const miss = await sb.from('catches').update({ entries: [9], updated_at: at('09.000Z') })
      .eq('user_id', A).eq('updated_at', at('00.000Z')).select('updated_at')
    expect(miss).toEqual({ data: [], error: null })
    expect(fakeDb.row('catches', A)!.entries).toEqual([1, 2])
    expect(fakeDb.writesTo('catches')).toHaveLength(1)
  })

  it('compares the stamps as timestamps, not as text', async () => {
    fakeDb.seed('setups', { user_id: A, setup: {}, updated_at: '2026-09-01T00:00:00.120+00:00' })
    const res = await sb.from('setups').update({ setup: { x: 1 }, updated_at: at('01.000Z') })
      .eq('user_id', A).eq('updated_at', '2026-09-01T00:00:00.12Z').select('updated_at')
    expect(res.data).toHaveLength(1)
  })

  it('keeps microseconds: a ms-rounded condition does not match a µs stamp', async () => {
    fakeDb.seed('setups', { user_id: A, setup: {}, updated_at: '2026-09-01T00:00:00.123456+00:00' })
    const { data } = await sb.from('setups').select('setup, updated_at').eq('user_id', A).maybeSingle()
    expect(data!.updated_at).toBe('2026-09-01T00:00:00.123456+00:00')
    const rounded = await sb.from('setups').update({ setup: {}, updated_at: at('01.000Z') })
      .eq('user_id', A).eq('updated_at', new Date(Date.parse(data!.updated_at)).toISOString()).select('updated_at')
    expect(rounded.data).toEqual([])
    const exact = await sb.from('setups').update({ setup: {}, updated_at: at('01.000Z') })
      .eq('user_id', A).eq('updated_at', data!.updated_at).select('updated_at')
    expect(exact.data).toHaveLength(1)
  })

  it("matches no row under another user's token (RLS), without an error", async () => {
    fakeDb.seed('setups', { user_id: A, setup: {}, updated_at: at('00.000Z') })
    fakeDb.session = { user: { id: 'someone-else' } }
    const res = await sb.from('setups').update({ setup: { x: 1 }, updated_at: at('01.000Z') })
      .eq('user_id', A).eq('updated_at', at('00.000Z')).select('updated_at')
    expect(res).toEqual({ data: [], error: null })
  })
})

describe('fake supabase — insert', () => {
  it('creates the row, and refuses a second one with a unique violation', async () => {
    const first = await sb.from('catches').insert({ user_id: A, entries: [1], updated_at: at('00.000Z') }).select('updated_at')
    expect(first).toEqual({ data: [{ updated_at: '2026-09-01T00:00:00+00:00' }], error: null })
    const second = await sb.from('catches').insert({ user_id: A, entries: [2], updated_at: at('01.000Z') }).select('updated_at')
    expect(second.data).toBeNull()
    expect((second.error as { code: string }).code).toBe('23505')
    expect(fakeDb.row('catches', A)!.entries).toEqual([1])
  })

  it('is refused by RLS for another user', async () => {
    fakeDb.session = null
    const res = await sb.from('catches').insert({ user_id: A, entries: [], updated_at: at('00.000Z') }).select('updated_at')
    expect((res.error as { code: string }).code).toBe('42501')
  })
})

describe('fake supabase — another device', () => {
  it('runs a hook right before the next write to that table reaches the server', async () => {
    fakeDb.seed('catches', { user_id: A, entries: [1], updated_at: at('00.000Z') })
    // An old app version's blind upsert lands between this client's read and its write.
    fakeDb.onNextWrite('catches', () => fakeDb.seed('catches', { user_id: A, entries: [1, 'old-app'], updated_at: at('03.000Z') }))
    const res = await sb.from('catches').update({ entries: [1, 'mine'], updated_at: at('05.000Z') })
      .eq('user_id', A).eq('updated_at', at('00.000Z')).select('updated_at')
    expect(res.data).toEqual([])
    expect(fakeDb.row('catches', A)!.entries).toEqual([1, 'old-app'])
    // One-shot: the next write goes straight through.
    await sb.from('catches').update({ entries: [2], updated_at: at('06.000Z') }).eq('user_id', A).eq('updated_at', at('03.000Z')).select('updated_at')
    expect(fakeDb.row('catches', A)!.entries).toEqual([2])
  })

  it('evaluates a held write when it is released, against the row as it is then', async () => {
    fakeDb.seed('catches', { user_id: A, entries: [0], updated_at: at('00.000Z') })
    fakeDb.holdWrites = true
    const send = (n: number) => sb.from('catches').update({ entries: [n], updated_at: at(`0${n}.000Z`) })
      .eq('user_id', A).eq('updated_at', at('00.000Z')).select('updated_at')
    const one = send(1)
    const two = send(2)
    await fakeDb.releaseWrites('newest-first')
    expect((await two).data).toHaveLength(1)
    expect((await one).data).toEqual([]) // the row had moved by the time it arrived
    expect(fakeDb.row('catches', A)!.entries).toEqual([2])
  })

  it('logs every write request with its outcome', async () => {
    fakeDb.seed('catches', { user_id: A, entries: [], updated_at: at('00.000Z') })
    await sb.from('catches').update({ entries: [1], updated_at: at('01.000Z') }).eq('user_id', A).eq('updated_at', at('09.000Z')).select('updated_at')
    await sb.from('catches').insert({ user_id: A, entries: [1], updated_at: at('01.000Z') }).select('updated_at')
    fakeDb.failWrites = true
    await sb.from('catches').update({ entries: [1], updated_at: at('01.000Z') }).eq('user_id', A).eq('updated_at', at('00.000Z')).select('updated_at')
    expect(fakeDb.requests.map((r) => `${r.kind}:${r.outcome}`)).toEqual(['update:no-rows', 'insert:conflict', 'update:offline'])
    expect(fakeDb.writes).toHaveLength(0)
  })
})
