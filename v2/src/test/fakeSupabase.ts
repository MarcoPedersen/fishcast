/**
 * In-memory stand-in for the Supabase client. test-setup.ts installs it for
 * every test file in place of '@/lib/supabase', so no test can reach the real
 * project: Vitest loads v2/.env, which made the real client live in local runs
 * (and null in CI), so a store test that signed a user in would have talked to
 * production.
 *
 * Covers only what the stores call: from(t).select().eq().maybeSingle(),
 * from(t).upsert(row), and the handful of auth methods. Failures and in-flight
 * requests are switchable per test.
 */
type Row = Record<string, any>
type AuthCallback = (event: string, session: any) => void | Promise<void>

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)))

export const fakeDb = {
  /** table → user_id → row */
  tables: new Map<string, Map<string, Row>>(),
  /** Reads/writes resolve with `{ error }`, like postgrest-js on a dropped connection. */
  failReads: false,
  failWrites: false,
  /** Reads wait for releaseReads() — a pull still in flight. */
  holdReads: false,
  heldReads: [] as (() => void)[],
  reads: [] as { table: string; userId: string }[],
  upserts: [] as { table: string; row: Row }[],
  /** What auth.signOut() resolves with (null = success). */
  signOutError: null as unknown,
  /** What the other auth calls resolve with (null = success). */
  authError: null as unknown,
  session: null as { user: { id: string; email?: string } } | null,
  listeners: [] as AuthCallback[],

  reset() {
    this.tables = new Map()
    this.failReads = false
    this.failWrites = false
    this.holdReads = false
    this.heldReads = []
    this.reads = []
    this.upserts = []
    this.signOutError = null
    this.authError = null
    this.session = null
    this.listeners = []
  },
  /** Seed a row as the server would hold it. */
  seed(table: string, row: Row) {
    if (!this.tables.has(table)) this.tables.set(table, new Map())
    this.tables.get(table)!.set(row.user_id, clone(row))
  },
  row(table: string, userId: string): Row | undefined {
    return clone(this.tables.get(table)?.get(userId))
  },
  releaseReads() {
    const held = this.heldReads
    this.heldReads = []
    held.forEach((r) => r())
  },
  upsertsTo(table: string) {
    return this.upserts.filter((u) => u.table === table).map((u) => u.row)
  },
}

const OFFLINE = { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' }

function from(table: string) {
  return {
    select(_cols: string) {
      return {
        eq(_col: string, userId: string) {
          return {
            maybeSingle(): Promise<{ data: Row | null; error: unknown }> {
              fakeDb.reads.push({ table, userId })
              // The server answers from the row as it is when the request arrives.
              const res = fakeDb.failReads
                ? { data: null, error: OFFLINE }
                : { data: clone(fakeDb.tables.get(table)?.get(userId)) ?? null, error: null }
              if (!fakeDb.holdReads) return Promise.resolve(res)
              return new Promise((resolve) => fakeDb.heldReads.push(() => resolve(res)))
            },
          }
        },
      }
    },
    upsert(row: Row): Promise<{ error: unknown }> {
      if (fakeDb.failWrites) return Promise.resolve({ error: OFFLINE })
      fakeDb.upserts.push({ table, row: clone(row) })
      fakeDb.seed(table, row)
      return Promise.resolve({ error: null })
    },
  }
}

async function notify(event: string) {
  for (const cb of fakeDb.listeners) await cb(event, fakeDb.session)
}

export const fakeSupabase = {
  from,
  auth: {
    async getSession() { return { data: { session: fakeDb.session }, error: null } },
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
