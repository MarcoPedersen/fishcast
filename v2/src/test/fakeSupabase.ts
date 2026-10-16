/**
 * In-memory stand-in for the Supabase client. test-setup.ts installs it for
 * every test file in place of '@/lib/supabase', so no test can reach the real
 * project: Vitest loads v2/.env, which made the real client live in local runs
 * (and null in CI), so a store test that signed a user in would have talked to
 * production.
 *
 * Covers only what the stores call: from(t).select().eq().maybeSingle(),
 * from(t).insert(row).select(), from(t).update(patch).eq()….select(), the
 * blind from(t).upsert(row) older app versions still send, and the handful of
 * auth methods. Failures and in-flight requests are switchable per test, and
 * every request is answered under the tables' RLS for whoever's token it
 * carries — so a test that signs a user in sets `fakeDb.session` as well as
 * `auth.user`.
 *
 * Writes are as strict as Postgres on what the sync relies on: an update's
 * filters are evaluated when the request reaches the server (a held write sees
 * the row as it is when released), `updated_at` filters compare as timestamps
 * with microsecond precision, an insert over an existing row is a unique
 * violation, and timestamps come back the way PostgREST formats timestamptz
 * ('…+00:00', trailing zeros trimmed) — never as the client sent them.
 */
type Row = Record<string, any>
type AuthCallback = (event: string, session: any) => void | Promise<void>
type WriteKind = 'upsert' | 'insert' | 'update'
type Outcome = 'ok' | 'no-rows' | 'conflict' | 'denied' | 'offline'

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

/** µs since the epoch: what a timestamptz holds (a JS Date only keeps ms). */
export function toMicros(ts: string): number {
  const frac = /\.(\d+)/.exec(ts)?.[1] ?? ''
  const whole = Date.parse(ts.replace(/\.\d+/, ''))
  return whole * 1000 + Number((frac + '000000').slice(0, 6))
}
/** How PostgREST renders a timestamptz in JSON: '2026-09-01T00:00:00.12+00:00'. */
export function pgTimestamp(ts: string): string {
  const us = toMicros(ts)
  if (!Number.isFinite(us)) return ts
  const ms = Math.floor(us / 1000)
  const frac = String(((us % 1_000_000) + 1_000_000) % 1_000_000).padStart(6, '0').replace(/0+$/, '')
  return new Date(ms).toISOString().slice(0, 19) + (frac ? '.' + frac : '') + '+00:00'
}
/** A row as the server sends it back. */
const served = (row: Row): Row => (typeof row.updated_at === 'string' ? { ...clone(row), updated_at: pgTimestamp(row.updated_at) } : clone(row))
const pick = (row: Row, cols: string) => {
  const out: Row = {}
  for (const c of cols.split(',').map((s) => s.trim()).filter(Boolean)) out[c] = row[c]
  return out
}

export const fakeDb = {
  /** table → user_id → row */
  tables: new Map<string, Map<string, Row>>(),
  /** Reads/writes resolve with `{ error }`, like postgrest-js on a dropped connection. */
  failReads: false,
  failWrites: false,
  /** Reads wait for releaseReads() — a pull still in flight. */
  holdReads: false,
  heldReads: [] as (() => void)[],
  /** Writes wait for releaseWrites() — a push stalled on a slow mobile link. */
  holdWrites: false,
  heldWrites: [] as (() => void)[],
  reads: [] as { table: string; userId: string }[],
  /** Every write that changed a row, with the row as it was left. */
  writes: [] as { table: string; kind: WriteKind; row: Row }[],
  /** Every write request that reached the server, and what became of it. */
  requests: [] as { table: string; kind: WriteKind; outcome: Outcome }[],
  /** One-shot hooks run just before the next write to a table is evaluated. */
  beforeWrite: [] as { table: string; run: () => void }[],
  /** What auth.signOut() resolves with (null = success). */
  signOutError: null as unknown,
  /** What the other auth calls resolve with (null = success). */
  authError: null as unknown,
  session: null as { user: { id: string; email?: string } } | null,
  /**
   * auth-js lost the session to a token refresh that failed on a flaky
   * connection (a retryable error): getSession() returns none, while
   * auth.user stays set and no SIGNED_OUT fires. Requests then carry the
   * anon key — see requester().
   */
  tokenLost: false,
  listeners: [] as AuthCallback[],

  reset() {
    this.tables = new Map()
    this.failReads = false
    this.failWrites = false
    this.holdReads = false
    this.heldReads = []
    this.holdWrites = false
    this.heldWrites = []
    this.reads = []
    this.writes = []
    this.requests = []
    this.beforeWrite = []
    this.signOutError = null
    this.authError = null
    this.session = null
    this.tokenLost = false
    this.listeners = []
  },
  /** Seed a row as the server would hold it (also: another device's write, landing now). */
  seed(table: string, row: Row) {
    if (!this.tables.has(table)) this.tables.set(table, new Map())
    this.tables.get(table)!.set(row.user_id, clone(row))
  },
  row(table: string, userId: string): Row | undefined {
    return clone(this.tables.get(table)?.get(userId))
  },
  /**
   * Another device writes between this client's read and its next write to
   * `table` — the moment a conditional update exists for. Runs once.
   */
  onNextWrite(table: string, run: () => void) {
    this.beforeWrite.push({ table, run })
  },
  /**
   * Answer the held reads. Waits a few microtasks first: a pull awaits
   * getSession() before it sends its read, so a read "in flight" when the test
   * releases may not have reached the fake yet.
   */
  async releaseReads() {
    for (let i = 0; i < 10; i++) await Promise.resolve()
    const held = this.heldReads
    this.heldReads = []
    held.forEach((r) => r())
  },
  /**
   * Let the held writes reach the server, newest first when asked — the order
   * two requests on separate connections can commit in. Each is evaluated
   * against the row as it is when it arrives.
   */
  async releaseWrites(order: 'oldest-first' | 'newest-first' = 'oldest-first') {
    const held = this.heldWrites
    this.heldWrites = []
    for (const w of order === 'newest-first' ? held.reverse() : held) {
      w()
      for (let i = 0; i < 10; i++) await Promise.resolve()
    }
  },
  /** The rows each committed write to `table` left behind, oldest first. */
  writesTo(table: string) {
    return this.writes.filter((u) => u.table === table).map((u) => u.row)
  },
}

const OFFLINE = { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' }
const RLS_DENIED = { message: 'new row violates row-level security policy', code: '42501', details: null, hint: null }
const DUPLICATE = (table: string) => ({ message: `duplicate key value violates unique constraint "${table}_pkey"`, code: '23505', details: 'Key (user_id) already exists.', hint: null })

/**
 * Whose token a request carries, as supabase-js's _getAccessToken() picks it:
 * the session's access token, or — when getSession() has none — the anon key
 * (null here). The tables' RLS is `auth.uid() = user_id` (supabase/schema.sql).
 */
const requester = (): string | null => (fakeDb.tokenLost ? null : fakeDb.session?.user.id ?? null)

function rowsOf(table: string): Map<string, Row> {
  if (!fakeDb.tables.has(table)) fakeDb.tables.set(table, new Map())
  return fakeDb.tables.get(table)!
}

/**
 * Send a write: refused at once when offline; otherwise evaluated by `apply`
 * when it reaches the server — now, or on releaseWrites(). `apply` sees the
 * table as it is at that moment, after any other device's write queued for it.
 */
function send<R>(table: string, kind: WriteKind, apply: () => { outcome: Outcome; result: R }, offline: R): Promise<R> {
  if (fakeDb.failWrites) {
    fakeDb.requests.push({ table, kind, outcome: 'offline' })
    return Promise.resolve(offline)
  }
  const arrive = () => {
    const hooks = fakeDb.beforeWrite.filter((h) => h.table === table)
    fakeDb.beforeWrite = fakeDb.beforeWrite.filter((h) => h.table !== table)
    hooks.forEach((h) => h.run())
    const { outcome, result } = apply()
    fakeDb.requests.push({ table, kind, outcome })
    return result
  }
  if (!fakeDb.holdWrites) return Promise.resolve(arrive())
  return new Promise((resolve) => fakeDb.heldWrites.push(() => resolve(arrive())))
}

function commit(table: string, kind: WriteKind, row: Row) {
  rowsOf(table).set(row.user_id, clone(row))
  fakeDb.writes.push({ table, kind, row: clone(row) })
}

/** One `.eq()` filter, as Postgres evaluates it for these columns. */
function matches(row: Row, col: string, value: unknown): boolean {
  if (col === 'updated_at') return typeof row.updated_at === 'string' && typeof value === 'string' && toMicros(row.updated_at) === toMicros(value)
  return row[col] === value
}

function from(table: string) {
  return {
    select(_cols: string) {
      return {
        eq(_col: string, userId: string) {
          return {
            maybeSingle(): Promise<{ data: Row | null; error: unknown }> {
              fakeDb.reads.push({ table, userId })
              // The server answers from the row as it is when the request arrives.
              // RLS hides another user's row from an anon read without any
              // error: it looks exactly like "this account has no row".
              const row = fakeDb.tables.get(table)?.get(userId)
              const res = fakeDb.failReads
                ? { data: null, error: OFFLINE }
                : requester() !== userId
                  ? { data: null, error: null }
                  : { data: row ? served(row) : null, error: null }
              if (!fakeDb.holdReads) return Promise.resolve(res)
              return new Promise((resolve) => fakeDb.heldReads.push(() => resolve(res)))
            },
          }
        },
      }
    },
    /** A blind write, as the app sent before versioned saves (and old cached versions still do). */
    upsert(row: Row): Promise<{ error: unknown }> {
      const sent = clone(row) // the body leaves with the request, as it is now
      const who = requester()
      return send(table, 'upsert', () => {
        if (who !== sent.user_id) return { outcome: 'denied', result: { error: RLS_DENIED } }
        commit(table, 'upsert', sent)
        return { outcome: 'ok', result: { error: null } }
      }, { error: OFFLINE })
    },
    insert(row: Row) {
      const sent = clone(row)
      const who = requester()
      return {
        select(cols: string): Promise<{ data: Row[] | null; error: unknown }> {
          return send(table, 'insert', () => {
            if (who !== sent.user_id) return { outcome: 'denied', result: { data: null, error: RLS_DENIED } }
            if (rowsOf(table).has(sent.user_id)) return { outcome: 'conflict', result: { data: null, error: DUPLICATE(table) } }
            commit(table, 'insert', sent)
            return { outcome: 'ok', result: { data: [pick(served(sent), cols)], error: null } }
          }, { data: null, error: OFFLINE })
        },
      }
    },
    update(patch: Row) {
      const sent = clone(patch)
      const who = requester()
      const filters: [string, unknown][] = []
      const builder = {
        eq(col: string, value: unknown) {
          filters.push([col, value])
          return builder
        },
        select(cols: string): Promise<{ data: Row[] | null; error: unknown }> {
          return send(table, 'update', () => {
            // RLS's USING clause hides other users' rows: they simply don't match.
            const hit = [...rowsOf(table).values()].filter((r) => r.user_id === who && filters.every(([c, v]) => matches(r, c, v)))
            if (!hit.length) return { outcome: 'no-rows', result: { data: [], error: null } }
            const out = hit.map((r) => {
              const next = { ...r, ...sent }
              commit(table, 'update', next)
              return pick(served(next), cols)
            })
            return { outcome: 'ok', result: { data: out, error: null } }
          }, { data: null, error: OFFLINE })
        },
      }
      return builder
    },
  }
}

async function notify(event: string) {
  for (const cb of fakeDb.listeners) await cb(event, fakeDb.session)
}

export const fakeSupabase = {
  from,
  auth: {
    async getSession() {
      // What auth-js's __loadSession returns after a retryable refresh failure.
      if (fakeDb.tokenLost && fakeDb.session) return { data: { session: null }, error: { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 } }
      return { data: { session: fakeDb.session }, error: null }
    },
    onAuthStateChange(cb: AuthCallback) {
      fakeDb.listeners.push(cb)
      return { data: { subscription: { unsubscribe() { fakeDb.listeners = fakeDb.listeners.filter((x) => x !== cb) } } } }
    },
    async signInWithPassword({ email }: { email: string; password: string }) {
      if (fakeDb.authError) return { data: { user: null, session: null }, error: fakeDb.authError }
      fakeDb.session = { user: { id: 'u-' + email, email } }
      await notify('SIGNED_IN')
      return { data: { user: fakeDb.session.user, session: fakeDb.session }, error: null }
    },
    async signUp(_: { email: string; password: string }) {
      return { data: { user: null, session: null }, error: fakeDb.authError }
    },
    async signOut() {
      // auth-js keeps the session when the request fails (offline) — mirror that.
      if (fakeDb.signOutError) return { error: fakeDb.signOutError }
      fakeDb.session = null
      await notify('SIGNED_OUT')
      return { error: null }
    },
    async resetPasswordForEmail(_email: string, _opts?: unknown) {
      return { data: {}, error: fakeDb.authError }
    },
    async updateUser(_attrs: unknown) {
      return { data: { user: null }, error: fakeDb.authError }
    },
    async setSession(_tokens: unknown) {
      return { data: { session: null }, error: fakeDb.authError }
    },
  },
}
