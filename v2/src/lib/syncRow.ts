/**
 * Reading and writing the one row per user that each synced store keeps
 * (`setups.setup`, `catches.entries`). Shared so the two stores can't drift.
 *
 * A push used to be a blind upsert: two devices pushing close together simply
 * overwrote each other, and an old copy pushed late replaced a newer row. Now
 * a write names the row version it was built on — `.eq('updated_at', base)` —
 * and touches nothing when another device has written since. No schema change:
 * the condition is an ordinary filter on the existing column.
 */
import { supabase } from './supabase'

export type SyncTable = 'setups' | 'catches'
export type SyncColumn = 'setup' | 'entries'

/** The account's row: its document, and its `updated_at` as the server sent it (and in ms). */
export interface RemoteRow { data: unknown; stamp: string; at: number }

/**
 * How many times one push may find the row moved, merge, and write again.
 * Another device writing faster than that is better caught by the next pull
 * (focus, 'online', the 5-minute resync) than by a tight loop on a phone link.
 */
export const PUSH_ATTEMPTS = 3

/**
 * µs since the epoch. A timestamptz keeps microseconds and a JS Date doesn't:
 * a row stamped by Postgres itself (now(), the SQL editor) parsed to ms would
 * never match its own condition again, and that push would never land.
 */
function micros(ts: string): number {
  const frac = /\.(\d+)/.exec(ts)?.[1] ?? ''
  return Date.parse(ts.replace(/\.\d+/, '')) * 1000 + Number((frac + '000000').slice(0, 6))
}

/**
 * The same instant? PostgREST spells a stamp '…+00:00' and toISOString '…Z',
 * so the client compares instants, never text.
 */
export function sameStamp(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false
  const x = micros(a)
  return Number.isFinite(x) && x === micros(b)
}

/**
 * The `updated_at` for a write over the row at `baseAt`: now, but always past
 * the row it replaces. Only equality is ever tested, but a stamp that never
 * repeats is what makes "the row moved" detectable at all — two pushes in one
 * millisecond, or a row stamped by a clock running ahead, would otherwise be
 * indistinguishable from the version they replaced.
 */
export function nextStamp(baseAt: number | null): number {
  return Math.max(Date.now(), (baseAt ?? -Infinity) + 1)
}

export type RowRead = { ok: true; row: RemoteRow | null } | { ok: false; error: unknown }

export async function readRow(table: SyncTable, column: SyncColumn, userId: string): Promise<RowRead> {
  try {
    // Only a read sent with THIS user's token can say "the account has no
    // row". supabase-js sends the anon key whenever getSession() has no
    // session — which auth-js returns after a token refresh failed on a
    // flaky connection, while auth.user stays set and no SIGNED_OUT fires.
    // RLS then hides the row with no error, and the no-row path claimed a
    // guest document for the account; the next pull pushed its 3 spots over
    // the 18 locations. Counted as a failed read instead. (A session returned
    // here has over a minute left, so the select's own getSession() sends
    // this same token.)
    const { data: { session } } = await supabase!.auth.getSession()
    if (session?.user?.id !== userId) return { ok: false, error: new Error('no session for the signed-in user') }
    const { data, error } = await supabase!
      .from(table)
      .select(`${column}, updated_at`)
      .eq('user_id', userId)
      .maybeSingle()
    if (error) return { ok: false, error }
    if (!data) return { ok: true, row: null }
    const stamp = String((data as Record<string, unknown>).updated_at)
    return { ok: true, row: { data: (data as Record<string, unknown>)[column] ?? null, stamp, at: Date.parse(stamp) } }
  } catch (error) {
    return { ok: false, error }
  }
}

/**
 * - 'ok'    → written; `stamp` is the row's new updated_at as the server holds it
 * - 'moved' → nothing written: another device wrote since `baseStamp` (or
 *             created the row first) — read it, merge, and try again
 * - 'error' → offline, refused, or the table is missing
 */
export type RowWrite = { status: 'ok'; stamp: string; at: number } | { status: 'moved' } | { status: 'error'; error: unknown }

const UNIQUE_VIOLATION = '23505'

/**
 * Write `doc` as the new row version, stamped `at`. `baseStamp` is the row
 * version it was built on, exactly as the server sent it; null = the account
 * had no row, so it is created (and another device creating it first is a
 * conflict, not an overwrite).
 */
export async function writeRow(
  table: SyncTable, column: SyncColumn, userId: string, doc: unknown, baseStamp: string | null, at: number,
): Promise<RowWrite> {
  const updated_at = new Date(at).toISOString()
  try {
    if (baseStamp === null) {
      const { data, error } = await supabase!
        .from(table)
        .insert({ user_id: userId, [column]: doc, updated_at })
        .select('updated_at')
      if (error) return (error as { code?: string }).code === UNIQUE_VIOLATION ? { status: 'moved' } : { status: 'error', error }
      return written(data, updated_at)
    }
    // An update the row's RLS hides (a lost session) matches nothing either;
    // the read that follows a 'moved' then fails on the session check.
    const { data, error } = await supabase!
      .from(table)
      .update({ [column]: doc, updated_at })
      .eq('user_id', userId)
      .eq('updated_at', baseStamp)
      .select('updated_at')
    if (error) return { status: 'error', error }
    if (!Array.isArray(data) || !data.length) return { status: 'moved' }
    return written(data, updated_at)
  } catch (error) {
    return { status: 'error', error }
  }
}

function written(data: unknown, sent: string): RowWrite {
  const back = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined)?.updated_at : undefined
  const stamp = typeof back === 'string' ? back : sent
  return { status: 'ok', stamp, at: Date.parse(stamp) }
}
