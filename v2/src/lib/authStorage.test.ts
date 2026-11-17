import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { computed } from 'vue'
import { GoTrueClient, type SupportedStorage } from '@supabase/supabase-js'
import { fakeQuota } from '@/test/fakeQuota'
import { ASK_MS, AUTH_CHANNEL, AUTH_LOCK, createAuthStorage, type TabChannel, type TabLocks } from './authStorage'

/**
 * Regression — auth-js (2.108) writes the session to localStorage with no
 * catch, and signInWithPassword rethrows any error that isn't an auth error.
 * On a device whose storage was full (a guest's save had already been
 * refused), signing in threw a QuotaExceededError after the server had said
 * yes: the session was lost and AuthView's form hung on "…".
 *
 * These tests drive a real GoTrueClient. Its requests go to a fake auth
 * server (a fetch that answers here), never to a real project.
 */
const HOST = 'https://fishcast-test.supabase.co'
const KEY = 'sb-fishcast-test-auth-token' // auth-js's own key for that host
const OWN = 'fc2-catches'
const LIMIT = 60_000

/** What the auth server answers a password sign-in with: ~2.5 KB, like a real session. */
function tokenBody(refresh = 'refresh-1') {
  const now = new Date().toISOString()
  return {
    access_token: 'eyJhbGciOiJIUzI1NiJ9.' + 'a'.repeat(1100) + '.sig',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: refresh,
    user: {
      id: 'user-1', aud: 'authenticated', role: 'authenticated', email: 'a@b.dk',
      email_confirmed_at: now, last_sign_in_at: now, created_at: now, updated_at: now,
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: { email: 'a@b.dk', email_verified: true, phone_verified: false, sub: 'user-1' },
      identities: [{
        identity_id: 'identity-1', id: 'user-1', user_id: 'user-1', provider: 'email', email: 'a@b.dk',
        identity_data: { email: 'a@b.dk', email_verified: true, phone_verified: false, sub: 'user-1' },
        last_sign_in_at: now, created_at: now, updated_at: now,
      }],
      is_anonymous: false,
    },
  }
}

/**
 * The fake auth server: answers sign-in, sign-out and a token refresh, and
 * refuses any other host. A refresh rotates the refresh token, and one used
 * already is refused, as Supabase does past its short reuse window.
 */
function authServer() {
  const calls: string[] = []
  const spent = new Set<string>()
  let rotations = 1
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    if (!url.startsWith(HOST + '/auth/v1/')) throw new Error('unexpected request: ' + url)
    calls.push(url.slice(HOST.length))
    if (url.includes('/token?grant_type=password')) return json(tokenBody())
    if (url.includes('/token?grant_type=refresh_token')) {
      const used = JSON.parse(String(init?.body)).refresh_token as string
      if (spent.has(used)) return json({ code: 'refresh_token_already_used', message: 'Invalid Refresh Token: Already Used' }, 400)
      spent.add(used)
      return json(tokenBody('refresh-' + ++rotations))
    }
    if (url.includes('/logout')) return new Response(null, { status: 204 })
    throw new Error('unexpected request: ' + url)
  })
  return { calls, fetch }
}

function client(storage: SupportedStorage, fetch: typeof globalThis.fetch) {
  return new GoTrueClient({
    url: HOST + '/auth/v1', headers: { apikey: 'test-anon-key' }, storageKey: KEY, storage, fetch,
    persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
  })
}

const creds = { email: 'a@b.dk', password: 'secret1' }

/** A device with no room left: the user's own data, and the derived caches when asked. */
function fillDevice(o: { derived: boolean }) {
  localStorage.clear()
  if (o.derived) {
    localStorage.setItem('fc2-insight-results', 'x'.repeat(4000))
    localStorage.setItem('fc2-forecasts', 'x'.repeat(4000))
  }
  let used = 0
  for (let i = 0; i < localStorage.length; i++) used += localStorage.getItem(localStorage.key(i)!)!.length
  localStorage.setItem(OWN, 'x'.repeat(LIMIT - used))
  fakeQuota(LIMIT)
}

const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!
function blockStorage() {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      const e = new Error("Failed to read the 'localStorage' property from 'Window': Access is denied for this document.")
      e.name = 'SecurityError'
      throw e
    },
  })
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', real)
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('auth-js on a full device, without the adapter', () => {
  it('throws from signInWithPassword once the server has said yes, and keeps no session', async () => {
    const server = authServer()
    // In a browser auth-js picks localStorage itself when a tiny test write
    // succeeds (supportsLocalStorage); node has no window, so it is given here.
    const auth = client(globalThis.localStorage, server.fetch)
    fillDevice({ derived: false })
    await expect(auth.signInWithPassword(creds)).rejects.toMatchObject({ name: 'QuotaExceededError' })
    expect(server.calls).toEqual(['/auth/v1/token?grant_type=password'])
    expect((await auth.getSession()).data.session).toBeNull()
  })
})

describe('createAuthStorage', () => {
  it('signs in on a full device: the derived caches give way, the session stays on the device under its key', async () => {
    const server = authServer()
    const auth = client(createAuthStorage(), server.fetch)
    fillDevice({ derived: true })
    const { data, error } = await auth.signInWithPassword(creds)
    expect(error).toBeNull()
    expect(data.session?.user.id).toBe('user-1')
    expect(JSON.parse(localStorage.getItem(KEY)!).refresh_token).toBe('refresh-1')
    expect(localStorage.getItem(KEY)!.length).toBeGreaterThan(2000)
    // The kept bite-scores went first, and that was enough.
    expect(localStorage.getItem('fc2-insight-results')).toBeNull()
    expect(localStorage.getItem('fc2-forecasts')).not.toBeNull()
    expect(localStorage.getItem(OWN)!.length).toBeGreaterThan(40_000)
  })

  it('keeps the session in memory when it still does not fit: signed in for the visit, then signs out', async () => {
    const server = authServer()
    const auth = client(createAuthStorage(), server.fetch)
    fillDevice({ derived: false })
    const { data, error } = await auth.signInWithPassword(creds)
    expect(error).toBeNull()
    expect(data.session?.user.id).toBe('user-1')
    expect((await auth.getSession()).data.session?.refresh_token).toBe('refresh-1')
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(localStorage.getItem(OWN)!.length).toBe(LIMIT) // the user's own data is untouched
    // The next visit (a new page, so a new adapter) starts signed out.
    expect(createAuthStorage().getItem(KEY)).toBeNull()
    expect((await auth.signOut()).error).toBeNull()
    expect((await auth.getSession()).data.session).toBeNull()
  })

  it('keeps the session in memory with site data blocked', async () => {
    const server = authServer()
    blockStorage()
    const auth = client(createAuthStorage(), server.fetch)
    const { data, error } = await auth.signInWithPassword(creds)
    expect(error).toBeNull()
    expect(data.session?.user.id).toBe('user-1')
    expect((await auth.getSession()).data.session?.user.id).toBe('user-1')
    expect((await auth.signOut()).error).toBeNull()
    expect((await auth.getSession()).data.session).toBeNull()
  })

  it('drops the device copy a refused write could not replace: its refresh token is spent', () => {
    const storage = createAuthStorage()
    localStorage.setItem(KEY, '{"refresh_token":"old"}') // what a token refresh replaces
    localStorage.setItem(OWN, 'x'.repeat(LIMIT - localStorage.getItem(KEY)!.length))
    fakeQuota(LIMIT)
    expect(() => storage.setItem(KEY, '{"refresh_token":"new","pad":"' + 'x'.repeat(3000) + '"}')).not.toThrow()
    expect(JSON.parse(storage.getItem(KEY) as string).refresh_token).toBe('new')
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('writes to the device again once there is room, and reads a copy another tab wrote there', () => {
    const storage = createAuthStorage()
    fillDevice({ derived: false })
    storage.setItem(KEY, '{"refresh_token":"memory"}')
    expect(localStorage.getItem(KEY)).toBeNull()
    // Room is made, and another tab signs in: tabs share one session, as with auth-js's own storage.
    localStorage.removeItem(OWN)
    localStorage.setItem(KEY, '{"refresh_token":"other-tab"}')
    expect(storage.getItem(KEY)).toBe('{"refresh_token":"other-tab"}')
    storage.setItem(KEY, '{"refresh_token":"refreshed"}')
    expect(localStorage.getItem(KEY)).toBe('{"refresh_token":"refreshed"}')
    storage.removeItem(KEY)
    expect(storage.getItem(KEY)).toBeNull()
  })

  // Once the device holds the session, the memory copy must go. Kept, it
  // outlived the device copy: when another tab signed out, this tab carried
  // on with that old session, whose refresh token was spent.
  it('forgets its memory copy once it writes the session to the device: another tab signing out signs it out too', () => {
    const storage = createAuthStorage()
    fillDevice({ derived: false })
    storage.setItem(KEY, '{"refresh_token":"memory"}')
    localStorage.removeItem(OWN) // room is made
    storage.setItem(KEY, '{"refresh_token":"refreshed"}') // the next token refresh fits
    expect(localStorage.getItem(KEY)).toBe('{"refresh_token":"refreshed"}')
    localStorage.removeItem(KEY) // another tab signs out
    expect(storage.getItem(KEY)).toBeNull()
  })

  it('forgets its memory copy once it reads another tab\'s copy: that tab signing out signs it out too', () => {
    const storage = createAuthStorage()
    fillDevice({ derived: false })
    storage.setItem(KEY, '{"refresh_token":"memory"}')
    localStorage.removeItem(OWN) // room is made
    localStorage.setItem(KEY, '{"refresh_token":"other-tab"}') // another tab signs in
    expect(storage.getItem(KEY)).toBe('{"refresh_token":"other-tab"}')
    localStorage.removeItem(KEY) // and signs out
    expect(storage.getItem(KEY)).toBeNull()
  })

  // Round E review: a reload the app makes by itself (lib/swUpdate) signed
  // out a user whose session lived only in memory, and said nothing. main.ts
  // asks this before every such reload, and tells the user once.
  it('says while it holds the session only in memory, and no longer once the device holds it', () => {
    const storage = createAuthStorage()
    const seen = computed(() => storage.inMemory)
    expect(seen.value).toBe(false)
    fillDevice({ derived: false })
    storage.setItem(KEY, '{"refresh_token":"memory"}')
    expect(seen.value).toBe(true)
    localStorage.removeItem(OWN) // room is made
    storage.setItem(KEY, '{"refresh_token":"refreshed"}') // the next token refresh fits
    expect(seen.value).toBe(false)
  })

  it('no longer once signed out, or once it reads a copy another tab wrote to the device', () => {
    const storage = createAuthStorage()
    blockStorage()
    storage.setItem(KEY, '{"refresh_token":"memory"}')
    expect(storage.inMemory).toBe(true)
    storage.removeItem(KEY)
    expect(storage.inMemory).toBe(false)
    Object.defineProperty(globalThis, 'localStorage', real)
    fillDevice({ derived: false })
    storage.setItem(KEY, '{"refresh_token":"memory"}')
    expect(storage.inMemory).toBe(true)
    localStorage.removeItem(OWN)
    localStorage.setItem(KEY, '{"refresh_token":"other-tab"}')
    expect(storage.getItem(KEY)).toBe('{"refresh_token":"other-tab"}')
    expect(storage.inMemory).toBe(false)
  })

  it('says so for a real sign-in on a full device, until signing out', async () => {
    const server = authServer()
    const storage = createAuthStorage()
    const auth = client(storage, server.fetch)
    fillDevice({ derived: false })
    expect((await auth.signInWithPassword(creds)).error).toBeNull()
    expect(storage.inMemory).toBe(true)
    expect((await auth.signOut()).error).toBeNull()
    expect(storage.inMemory).toBe(false)
  })

  it('never throws with site data blocked', () => {
    blockStorage()
    const storage = createAuthStorage()
    expect(storage.getItem(KEY)).toBeNull()
    expect(() => storage.setItem(KEY, 'v')).not.toThrow()
    expect(storage.getItem(KEY)).toBe('v')
    expect(() => storage.removeItem(KEY)).not.toThrow()
    expect(storage.getItem(KEY)).toBeNull()
  })
})

/**
 * Round E review: auth-js tells the app's other tabs of a sign-in, a token
 * refresh or a sign-out (its own BroadcastChannel), but with the session in
 * one tab's memory they could not read it. A tab open beside it heard
 * SIGNED_IN and showed the user signed in with no session to send, so every
 * sync it made failed. The adapters now share the memory copy over a channel
 * of their own, as the device's copy is shared: same origin only, as
 * BroadcastChannel is, and dropped on sign-out.
 */
describe('other tabs', () => {
  /**
   * BroadcastChannel's behaviour, for the tests: a message reaches every
   * other open channel of the hub, as a copy, a moment later (a microtask).
   * `sent` is every message, in order.
   */
  function hub() {
    type Listener = (e: { data: unknown }) => void
    const open = new Map<TabChannel, Listener[]>()
    const sent: unknown[] = []
    function channel(): TabChannel {
      const listeners: Listener[] = []
      const self: TabChannel = {
        postMessage(data) {
          sent.push(data)
          const copy = structuredClone(data)
          for (const [other, fns] of open) {
            if (other !== self) queueMicrotask(() => { if (open.has(other)) fns.forEach((fn) => fn({ data: copy })) })
          }
        },
        addEventListener(_type, fn) { listeners.push(fn) },
        close() { open.delete(self) },
      }
      open.set(self, listeners)
      return self
    }
    return { channel, sent }
  }
  /**
   * Web Locks (navigator.locks) for the tests, one origin's: a shared lock is
   * granted a moment later (a microtask), and held until the promise its
   * callback returns settles. `held` is what query() reports; `queries`
   * counts the calls to it.
   */
  function locksHub() {
    const held: { name: string; mode: string }[] = []
    let queries = 0
    const locks: TabLocks = {
      request(name, options, granted) {
        return Promise.resolve().then(async () => {
          const lock = { name, mode: options.mode }
          held.push(lock)
          try { await granted() } finally { held.splice(held.indexOf(lock), 1) }
        })
      },
      async query() { queries++; return { held: held.map((x) => ({ ...x })) } },
    }
    /** A tab that has held a copy for a while, and cannot answer: frozen in the background. */
    const frozen = () => { held.push({ name: AUTH_LOCK, mode: 'shared' }) }
    return { locks: () => locks, held, frozen, get queries() { return queries } }
  }
  /** A page's pagehide and pageshow, for the tests: fire() calls its listeners. */
  function pageEvents() {
    const on: Record<string, ((e: { persisted: boolean }) => void)[]> = {}
    return {
      page: () => ({ addEventListener(type: string, fn: (e: { persisted: boolean }) => void) { (on[type] ??= []).push(fn) } }),
      fire(type: 'pagehide' | 'pageshow', persisted: boolean) { for (const fn of on[type] ?? []) fn({ persisted }) },
    }
  }
  /** The questions on the hub. */
  const asks = (sent: unknown[]) => sent.filter((m): m is { ask: string } => typeof m === 'object' && m !== null && 'ask' in m)
  /** Lets every message under way arrive. */
  const delivered = () => new Promise((r) => setTimeout(r, 0))
  /** A tab of the app: its adapter on the hub, and its client, loaded (auth-js's first read opens the channel). */
  async function tab(h: ReturnType<typeof hub>, fetch: typeof globalThis.fetch, l?: ReturnType<typeof locksHub>) {
    const storage = createAuthStorage({ channel: h.channel, locks: l?.locks })
    const auth = client(storage, fetch)
    await auth.initialize()
    return { storage, auth }
  }
  const session = async (t: { auth: GoTrueClient }) => (await t.auth.getSession()).data.session

  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('hands a sign-in kept in memory to the tabs open beside it', async () => {
    const server = authServer()
    const h = hub()
    const a = await tab(h, server.fetch)
    const b = await tab(h, server.fetch)
    fillDevice({ derived: false })
    expect((await a.auth.signInWithPassword(creds)).error).toBeNull()
    await delivered()
    expect((await session(b))?.user.id).toBe('user-1')
    expect((await session(b))?.refresh_token).toBe('refresh-1')
    expect(b.storage.inMemory).toBe(true)
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  // The refresh token is spent once used: a tab left with the old one is
  // refused at its next refresh, and auth-js then signs it out.
  it('hands on each token refresh: no tab keeps the spent refresh token', async () => {
    const server = authServer()
    const h = hub()
    const a = await tab(h, server.fetch)
    const b = await tab(h, server.fetch)
    fillDevice({ derived: false })
    await a.auth.signInWithPassword(creds)
    expect((await a.auth.refreshSession()).error).toBeNull()
    await delivered()
    expect((await session(b))?.refresh_token).toBe('refresh-2')
    expect((await b.auth.refreshSession()).error).toBeNull() // with refresh-2, which is good
    await delivered()
    expect((await session(a))?.refresh_token).toBe('refresh-3')
  })

  it('signing out in one tab signs the others out', async () => {
    const server = authServer()
    const h = hub()
    const a = await tab(h, server.fetch)
    const b = await tab(h, server.fetch)
    fillDevice({ derived: false })
    await a.auth.signInWithPassword(creds)
    await delivered()
    expect(b.storage.inMemory).toBe(true)
    expect((await a.auth.signOut()).error).toBeNull()
    await delivered()
    expect(await session(b)).toBeNull()
    expect(b.storage.inMemory).toBe(false)
  })

  it('once the session fits on the device again, the other tabs read it there and keep no copy', async () => {
    const server = authServer()
    const h = hub()
    const a = await tab(h, server.fetch)
    const b = await tab(h, server.fetch)
    fillDevice({ derived: false })
    await a.auth.signInWithPassword(creds)
    await delivered()
    localStorage.removeItem(OWN) // room is made
    await a.auth.refreshSession()
    await delivered()
    expect(JSON.parse(localStorage.getItem(KEY)!).refresh_token).toBe('refresh-2')
    expect(b.storage.inMemory).toBe(false)
    expect((await session(b))?.refresh_token).toBe('refresh-2')
  })

  // Without Web Locks a page can't tell whether any tab holds a copy, and
  // asks none: auth-js reads a key no tab holds (<key>-code-verifier) at
  // every load, so each page would wait out the question. It starts signed
  // out. Only a token refresh in a tab holding the copy reaches it, and
  // auth-js refreshes only in a visible tab: while that tab stays hidden, or
  // once it closes, this one stays signed out, an hour or more.
  it('without Web Locks, a tab opened later starts signed out, and is handed the next refresh', async () => {
    const server = authServer()
    const h = hub()
    const a = await tab(h, server.fetch)
    fillDevice({ derived: false })
    await a.auth.signInWithPassword(creds)
    const later = await tab(h, server.fetch)
    expect(await session(later)).toBeNull()
    expect(later.storage.inMemory).toBe(false)
    expect(asks(h.sent)).toEqual([])
    await a.auth.refreshSession()
    await delivered()
    expect((await session(later))?.refresh_token).toBe('refresh-2')
  })

  it('never sends what the device holds: a device copy answers no question, and tells the others to drop theirs', async () => {
    const h = hub()
    const a = createAuthStorage({ channel: h.channel })
    a.setItem(KEY, '{"refresh_token":"device"}')
    expect(a.getItem(KEY)).toBe('{"refresh_token":"device"}')
    h.channel().postMessage({ ask: 'q1' }) // a page opened later asks
    await delivered()
    a.removeItem(KEY)
    expect(h.sent).toEqual([{ key: KEY, value: null }, { ask: 'q1' }, { key: KEY, value: null }]) // no memory copy wanted elsewhere
  })

  it('ignores what is not a message of its own', async () => {
    const h = hub()
    const speak = h.channel() // another tab's channel, spoken on by hand
    blockStorage()
    const a = createAuthStorage({ channel: h.channel })
    a.setItem(KEY, 'r1')
    for (const junk of [null, 'r0', 7, {}, { key: 7, value: 'r0' }, { key: KEY, value: 7 }, { key: KEY }, { event: 'SIGNED_IN', session: {} }]) speak.postMessage(junk)
    await delivered()
    expect(a.getItem(KEY)).toBe('r1')
    speak.postMessage({ key: KEY, value: 'r2' })
    await delivered()
    expect(a.getItem(KEY)).toBe('r2')
  })

  it('in a browser, talks over a BroadcastChannel of its own, and closes it', async () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', {})
    vi.stubGlobal('navigator', {}) // no Web Locks: as before, no question at the first read
    const opened: string[] = []
    const Real = globalThis.BroadcastChannel
    vi.stubGlobal('BroadcastChannel', class extends Real { constructor(name: string) { super(name); opened.push(name) } })
    const a = createAuthStorage()
    const b = createAuthStorage()
    try {
      blockStorage()
      expect(b.getItem(KEY)).toBeNull() // auth-js's first read, as the page loads
      a.setItem(KEY, '{"refresh_token":"memory"}')
      await vi.waitFor(() => expect(b.getItem(KEY)).toBe('{"refresh_token":"memory"}'), { interval: 5 })
      expect(opened).toEqual([AUTH_CHANNEL, AUTH_CHANNEL])
      expect(AUTH_CHANNEL).not.toBe(KEY) // auth-js's own channel is named after its key, and takes every message for its own
    } finally { a.close(); b.close() }
  })

  // A browser may refuse a BroadcastChannel to a page whose site data is
  // blocked: the constructor throws a SecurityError. That is the page that
  // keeps the session in memory.
  it('keeps the session in memory as before where the browser refuses the channel', () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', {})
    vi.stubGlobal('BroadcastChannel', class { constructor() { throw Object.assign(new Error('The operation is insecure.'), { name: 'SecurityError' }) } })
    blockStorage()
    const storage = createAuthStorage()
    expect(storage.getItem(KEY)).toBeNull()
    expect(() => storage.setItem(KEY, 'v')).not.toThrow()
    expect(storage.getItem(KEY)).toBe('v')
    expect(storage.inMemory).toBe(true)
    expect(() => storage.removeItem(KEY)).not.toThrow()
    expect(storage.inMemory).toBe(false)
  })

  it('opens no channel outside a browser', () => {
    const opened: string[] = []
    vi.stubGlobal('BroadcastChannel', class { constructor(name: string) { opened.push(name) } })
    blockStorage()
    const storage = createAuthStorage()
    storage.setItem(KEY, 'v')
    expect(storage.getItem(KEY)).toBe('v')
    expect(opened).toEqual([])
  })

  /**
   * Round F left this: a tab opened later, or reloaded, started signed out
   * while another tab held the sign-in in memory. A tab holding a copy now
   * holds a shared Web Lock while it does. A page with no copy looks at the
   * locks at its first miss, and only when a tab holds one asks the others
   * over the channel: one question for every key, answered in milliseconds,
   * and waited for ASK_MS at most. A guest's page, or one whose session is on
   * the device, asks nothing and waits for nothing.
   */
  describe('a page opened later', () => {
    /** What a read gives once the messages and locks under way have had their turn, but no timer: 'waiting' while it waits. */
    async function settled(read: string | null | Promise<string | null>) {
      let value: unknown = 'waiting'
      void Promise.resolve(read).then((v) => { value = v })
      await vi.advanceTimersByTimeAsync(0)
      return value
    }
    const shared = { name: AUTH_LOCK, mode: 'shared' }

    it('asks the tabs holding a copy, and starts signed in', async () => {
      const server = authServer()
      const h = hub()
      const l = locksHub()
      const a = await tab(h, server.fetch, l)
      fillDevice({ derived: false })
      await a.auth.signInWithPassword(creds)
      await delivered()
      expect(l.held).toEqual([shared])
      const later = await tab(h, server.fetch, l)
      expect((await session(later))?.refresh_token).toBe('refresh-1')
      expect(later.storage.inMemory).toBe(true)
      expect(asks(h.sent)).toHaveLength(1)
      // A tab like the others now: it holds the lock, and its refresh reaches them.
      expect((await later.auth.refreshSession()).error).toBeNull()
      await delivered()
      expect((await session(a))?.refresh_token).toBe('refresh-2')
      expect(l.held).toEqual([shared, shared])
    })

    it('reloaded beside a tab holding the copy, starts signed in again', async () => {
      const server = authServer()
      const h = hub()
      const l = locksHub()
      const a = await tab(h, server.fetch, l)
      const b = await tab(h, server.fetch, l)
      fillDevice({ derived: false })
      await a.auth.signInWithPassword(creds)
      await delivered()
      a.storage.close() // a reloads: its page and its memory are gone, and its lock with them
      await delivered()
      expect(l.held).toEqual([shared]) // b's
      const reloaded = await tab(h, server.fetch, l)
      expect((await session(reloaded))?.refresh_token).toBe('refresh-1')
      expect(b.storage.inMemory).toBe(true)
    })

    // auth-js reads <key>-code-verifier at every load in a browser, before
    // the session: no tab holds it, so a question per key waited out one
    // for it at every load.
    it('asks once, for every key', async () => {
      const h = hub()
      const l = locksHub()
      blockStorage()
      const a = createAuthStorage({ channel: h.channel, locks: l.locks })
      a.setItem(KEY, 'r1')
      await delivered()
      const page = createAuthStorage({ channel: h.channel, locks: l.locks })
      const verifier = page.getItem(KEY + '-code-verifier')
      const own = page.getItem(KEY)
      expect([await verifier, await own]).toEqual([null, 'r1'])
      expect(page.getItem(KEY + '-code-verifier')).toBeNull() // no second question: it has heard every change since
      expect(asks(h.sent)).toHaveLength(1)
      expect(l.queries).toBe(1)
    })

    it('a guest page, and one whose session is on the device, ask nothing and wait for nothing', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const h = hub()
      const l = locksHub()
      const guest = createAuthStorage({ channel: h.channel, locks: l.locks })
      expect(await settled(guest.getItem(KEY + '-code-verifier'))).toBeNull()
      expect(guest.getItem(KEY)).toBeNull()
      localStorage.setItem(KEY, 'device')
      const signedIn = createAuthStorage({ channel: h.channel, locks: l.locks })
      expect(await settled(signedIn.getItem(KEY + '-code-verifier'))).toBeNull()
      expect(signedIn.getItem(KEY)).toBe('device')
      expect(vi.getTimerCount()).toBe(0)
      expect(asks(h.sent)).toEqual([])
      expect(l.queries).toBe(2) // one look at the locks each, at the first miss
    })

    it('waits ASK_MS at most for a tab that holds a copy but cannot answer, once, then starts signed out', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const h = hub()
      const l = locksHub()
      l.frozen()
      const page = createAuthStorage({ channel: h.channel, locks: l.locks })
      const first = page.getItem(KEY)
      expect(first).toBeInstanceOf(Promise)
      let read: unknown = 'waiting'
      void Promise.resolve(first).then((v) => { read = v })
      await vi.advanceTimersByTimeAsync(ASK_MS - 1)
      expect(read).toBe('waiting')
      await vi.advanceTimersByTimeAsync(1)
      expect(read).toBeNull()
      expect(page.getItem(KEY + '-code-verifier')).toBeNull() // asked once per page
      expect(asks(h.sent)).toHaveLength(1)
      expect(page.inMemory).toBe(false)
    })

    // Two tabs may answer one question, and a token refresh may be under
    // way: an answer taken late, or by a page that did not ask, could put
    // back a copy whose refresh token a newer one has spent.
    it('takes an answer only to its own question, while it waits', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const h = hub()
      const l = locksHub()
      const speak = h.channel() // the tabs holding a copy, spoken for by hand
      blockStorage()
      l.frozen()
      const page = createAuthStorage({ channel: h.channel, locks: l.locks })
      const read = page.getItem(KEY)
      await vi.advanceTimersByTimeAsync(0)
      const [{ ask: id }] = asks(h.sent)
      speak.postMessage({ re: 'another-page', copies: { [KEY]: 'stray' } })
      await vi.advanceTimersByTimeAsync(0)
      speak.postMessage({ re: id, copies: { [KEY]: 'r1' } })
      speak.postMessage({ re: id, copies: { [KEY]: 'r0' } }) // a second tab's answer, after the first
      expect(await settled(read)).toBe('r1')
      expect(page.getItem(KEY)).toBe('r1')
      expect(page.inMemory).toBe(true)
      page.close()
      // A page whose wait ran out takes no answer after.
      const late = createAuthStorage({ channel: h.channel, locks: l.locks })
      const lateRead = late.getItem(KEY)
      await vi.advanceTimersByTimeAsync(ASK_MS)
      expect(await settled(lateRead)).toBeNull()
      speak.postMessage({ re: asks(h.sent)[1].ask, copies: { [KEY]: 'r1' } })
      await vi.advanceTimersByTimeAsync(0)
      expect(late.getItem(KEY)).toBeNull()
      expect(late.inMemory).toBe(false)
    })

    it('keeps over the answer a change heard while it waits, and one of its own', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const h = hub()
      const l = locksHub()
      const speak = h.channel()
      blockStorage()
      l.frozen()
      const page = createAuthStorage({ channel: h.channel, locks: l.locks })
      const read = page.getItem(KEY)
      await vi.advanceTimersByTimeAsync(0)
      speak.postMessage({ key: KEY, value: 'r2' }) // a token refresh in one tab, heard first…
      page.removeItem(KEY + '-code-verifier') // …this page's own changes…
      page.setItem(KEY + '-mine', 'mine')
      // …and an answer from a tab that refresh had not reached yet.
      speak.postMessage({ re: asks(h.sent)[0].ask, copies: { [KEY]: 'r1', [KEY + '-code-verifier']: 'theirs', [KEY + '-mine']: 'theirs', [KEY + '-user']: 'u1' } })
      expect(await settled(read)).toBe('r2')
      expect(page.getItem(KEY + '-code-verifier')).toBeNull()
      expect(page.getItem(KEY + '-mine')).toBe('mine')
      expect(page.getItem(KEY + '-user')).toBe('u1') // the rest of the answer is taken
    })

    it('keeps over the answer a change heard while it looks at the locks', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const h = hub()
      const l = locksHub()
      const speak = h.channel()
      blockStorage()
      l.frozen()
      // A look at the locks that takes a while: a message can come meanwhile.
      let look = () => {}
      const slow: TabLocks = { request: l.locks().request, query: () => new Promise((r) => { look = () => r(l.locks().query()) }) }
      const page = createAuthStorage({ channel: h.channel, locks: () => slow })
      const read = page.getItem(KEY)
      speak.postMessage({ key: KEY, value: 'r2' }) // a token refresh in one tab, heard first…
      await vi.advanceTimersByTimeAsync(0)
      look()
      await vi.advanceTimersByTimeAsync(0)
      // …and an answer from a tab that refresh had not reached yet.
      speak.postMessage({ re: asks(h.sent)[0].ask, copies: { [KEY]: 'r1' } })
      expect(await settled(read)).toBe('r2')
      expect(page.getItem(KEY)).toBe('r2')
    })

    it('keeps the device\'s copy over an answer, as at any read', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const h = hub()
      const l = locksHub()
      const speak = h.channel()
      localStorage.setItem(KEY, 'device')
      l.frozen() // a tab holding a copy all the same
      const page = createAuthStorage({ channel: h.channel, locks: l.locks })
      let told = 0
      page.onTake(() => { told++ })
      const verifier = page.getItem(KEY + '-code-verifier') // auth-js's first read
      await vi.advanceTimersByTimeAsync(0)
      speak.postMessage({ re: asks(h.sent)[0].ask, copies: { [KEY]: 'memory' } })
      expect(await settled(verifier)).toBeNull()
      expect(page.inMemory).toBe(false)
      expect(told).toBe(0)
      expect(page.getItem(KEY)).toBe('device')
    })

    it('a page that holds a copy of its own asks nothing', async () => {
      const h = hub()
      const l = locksHub()
      blockStorage()
      const page = createAuthStorage({ channel: h.channel, locks: l.locks })
      page.setItem(KEY, 'r1') // its channel open since: it has heard every change
      await delivered()
      expect(page.getItem(KEY + '-code-verifier')).toBeNull()
      expect(asks(h.sent)).toEqual([])
      expect(l.queries).toBe(0)
    })

    it('a tab holds the lock while it holds a copy, and lets go once it has none', async () => {
      const h = hub()
      const l = locksHub()
      fillDevice({ derived: false })
      const a = createAuthStorage({ channel: h.channel, locks: l.locks })
      const b = createAuthStorage({ channel: h.channel, locks: l.locks })
      expect(await b.getItem(KEY)).toBeNull() // auth-js's first read, as b loads
      a.setItem(KEY, 'r1')
      await delivered()
      expect(l.held).toEqual([shared, shared]) // a, and b, which took a's copy
      a.removeItem(KEY) // signs out: every copy goes
      await delivered()
      expect(l.held).toEqual([])
      a.setItem(KEY, 'r2')
      await delivered()
      expect(l.held).toEqual([shared, shared])
      localStorage.removeItem(OWN) // room is made…
      a.setItem(KEY, 'r3') // …and the next token refresh fits: the device holds it now
      await delivered()
      expect(l.held).toEqual([])
      blockStorage()
      a.setItem(KEY, 'r4')
      await delivered()
      expect(l.held).toEqual([shared, shared])
      a.close() // the page goes
      b.close()
      await delivered()
      expect(l.held).toEqual([])
    })

    // Chrome and Firefox keep a page that holds a Web Lock out of the
    // back/forward cache (web-platform-tests: a held lock should not prevent
    // it; both fail). A page signed in only in memory, left in its tab and
    // come back to with Back, loaded again: signed out, and an edit it could
    // not save was gone. Cached, it can answer no tab either: a page opened
    // meanwhile would wait for it in vain.
    it('lets go of the lock while the page is hidden in the back/forward cache, and takes it again when it is shown', async () => {
      const h = hub()
      const l = locksHub()
      const p = pageEvents()
      blockStorage()
      const a = createAuthStorage({ channel: h.channel, locks: l.locks, page: p.page })
      a.setItem(KEY, 'r1')
      await delivered()
      expect(l.held).toEqual([shared])
      p.fire('pagehide', true) // the app is left in this tab
      await delivered()
      expect(l.held).toEqual([])
      const meanwhile = createAuthStorage({ channel: h.channel, locks: l.locks })
      expect(await meanwhile.getItem(KEY)).toBeNull() // asks no one: waits for no page that can't answer
      expect(asks(h.sent)).toEqual([])
      p.fire('pageshow', true) // Back: the page as it was left
      await delivered()
      expect(l.held).toEqual([shared])
      expect(a.inMemory).toBe(true)
      expect(a.getItem(KEY)).toBe('r1')
    })

    it('in a browser, hears pagehide and pageshow on its window', async () => {
      const l = locksHub()
      const on: Record<string, ((e: { persisted: boolean }) => void)[]> = {}
      vi.stubGlobal('window', { addEventListener: (type: string, fn: (e: { persisted: boolean }) => void) => { (on[type] ??= []).push(fn) } })
      vi.stubGlobal('document', {})
      vi.stubGlobal('navigator', { locks: l.locks() })
      const a = createAuthStorage()
      try {
        blockStorage()
        a.setItem(KEY, 'r1')
        await delivered()
        expect(l.held).toEqual([shared])
        for (const fn of on.pagehide ?? []) fn({ persisted: true })
        await delivered()
        expect(l.held).toEqual([])
        for (const fn of on.pageshow ?? []) fn({ persisted: true })
        await delivered()
        expect(l.held).toEqual([shared])
      } finally { a.close() }
    })

    it('answers with every memory copy it holds', async () => {
      const h = hub()
      const l = locksHub()
      blockStorage()
      const a = createAuthStorage({ channel: h.channel, locks: l.locks })
      a.setItem(KEY, 'r1')
      a.setItem(KEY + '-code-verifier', 'v1')
      h.channel().postMessage({ ask: 'q1' })
      await delivered()
      expect(h.sent.at(-1)).toEqual({ re: 'q1', copies: { [KEY]: 'r1', [KEY + '-code-verifier']: 'v1' } })
    })

    it('ignores a malformed question or answer', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const h = hub()
      const l = locksHub()
      const speak = h.channel()
      blockStorage()
      l.frozen()
      const page = createAuthStorage({ channel: h.channel, locks: l.locks })
      const read = page.getItem(KEY)
      await vi.advanceTimersByTimeAsync(0)
      const [{ ask: id }] = asks(h.sent)
      for (const junk of [{ re: id }, { re: id, copies: null }, { re: id, copies: 'r0' }, { re: id, copies: [] }, { re: id, copies: { [KEY]: 7 } }, { re: 7, copies: { [KEY]: 'r0' } }]) speak.postMessage(junk)
      expect(await settled(read)).toBe('waiting')
      speak.postMessage({ re: id, copies: { [KEY]: 'r1' } })
      expect(await settled(read)).toBe('r1')
      page.setItem(KEY, 'r2')
      const before = h.sent.length
      for (const junk of [{ ask: 7 }, { ask: null }]) speak.postMessage(junk)
      await vi.advanceTimersByTimeAsync(0)
      expect(h.sent.slice(before)).toEqual([{ ask: 7 }, { ask: null }]) // answered none
    })

    it('takes no lock and asks nothing without a channel: no tab could hear it', async () => {
      const l = locksHub()
      blockStorage()
      const storage = createAuthStorage({ channel: () => null, locks: l.locks })
      expect(storage.getItem(KEY)).toBeNull()
      storage.setItem(KEY, 'v')
      await delivered()
      expect(l.held).toEqual([])
      expect(l.queries).toBe(0)
    })

    // A browser may refuse Web Locks to a page whose site data is blocked:
    // request and query reject with a SecurityError.
    it('where the browser refuses the locks, asks no one, and keeps the session in memory as before', async () => {
      const h = hub()
      const refuse = () => Promise.reject(Object.assign(new Error('The request was denied.'), { name: 'SecurityError' }))
      const locks: TabLocks = { request: refuse, query: refuse }
      blockStorage()
      const page = createAuthStorage({ channel: h.channel, locks: () => locks })
      expect(await page.getItem(KEY)).toBeNull()
      page.setItem(KEY, 'v')
      await delivered()
      expect(page.getItem(KEY)).toBe('v')
      expect(page.inMemory).toBe(true)
      expect(asks(h.sent)).toEqual([])
    })

    it('in a browser, finds a tab holding a copy through navigator.locks, and asks it over its channel', async () => {
      const l = locksHub()
      vi.stubGlobal('window', {})
      vi.stubGlobal('document', {})
      vi.stubGlobal('navigator', { locks: l.locks() })
      const a = createAuthStorage()
      const later = createAuthStorage({ askMs: 10_000 }) // real channels: answered long before
      try {
        blockStorage()
        a.setItem(KEY, '{"refresh_token":"memory"}')
        await delivered()
        expect(l.held).toEqual([shared])
        expect(await later.getItem(KEY)).toBe('{"refresh_token":"memory"}')
        expect(l.queries).toBe(1)
      } finally { a.close(); later.close() }
    })

    it('outside a browser, uses no locks', async () => {
      const l = locksHub()
      vi.stubGlobal('navigator', { locks: l.locks() })
      const h = hub()
      blockStorage()
      const storage = createAuthStorage({ channel: h.channel })
      expect(storage.getItem(KEY)).toBeNull()
      storage.setItem(KEY, 'v')
      await delivered()
      expect(l.queries).toBe(0)
      expect(l.held).toEqual([])
    })

    // auth-js tells the app of another tab's sign-in with an event of its
    // own, on its own channel: it can come before the copy, and none comes
    // with an answer to a page's question. stores/auth reads the session
    // again on this word.
    it('tells its listeners each time it takes in another tab\'s copy, and only then', async () => {
      const h = hub()
      const l = locksHub()
      const speak = h.channel()
      blockStorage()
      const holder = createAuthStorage({ channel: h.channel, locks: l.locks })
      holder.setItem(KEY, 'r1')
      await delivered()
      const page = createAuthStorage({ channel: h.channel, locks: l.locks })
      let told = 0
      const stop = page.onTake(() => { told++ })
      expect(await page.getItem(KEY)).toBe('r1') // an answer
      expect(told).toBe(1)
      holder.setItem(KEY, 'r2') // a change
      await delivered()
      expect(told).toBe(2)
      page.setItem(KEY, 'r3') // its own
      holder.removeItem(KEY) // a copy dropped
      await delivered()
      expect(told).toBe(2)
      stop()
      speak.postMessage({ key: KEY, value: 'r4' })
      await delivered()
      expect(told).toBe(2)
      expect(page.getItem(KEY)).toBe('r4')
      // A listener opens the channel by itself: it hears with no read made.
      const quiet = createAuthStorage({ channel: h.channel, locks: l.locks })
      let heard = 0
      quiet.onTake(() => { heard++ })
      speak.postMessage({ key: KEY, value: 'r5' })
      await delivered()
      expect(heard).toBe(1)
    })
  })
})

describe('lib/supabase', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('gives the real client this storage: signing in works on a full device, under auth-js own key', async () => {
    // A made-up project, and a fetch that answers here: nothing leaves the test.
    vi.stubEnv('VITE_SUPABASE_URL', HOST)
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
    const server = authServer()
    vi.stubGlobal('fetch', server.fetch)
    vi.resetModules()
    const { supabase } = await vi.importActual<typeof import('./supabase')>('./supabase')
    fillDevice({ derived: true })
    const { error } = await supabase!.auth.signInWithPassword(creds)
    expect(error).toBeNull()
    expect(server.calls).toEqual(['/auth/v1/token?grant_type=password'])
    expect(JSON.parse(localStorage.getItem(KEY)!).refresh_token).toBe('refresh-1')
    expect(localStorage.getItem('fc2-insight-results')).toBeNull()
  })

  // main.ts reads the app's adapter (authStorage) before every reload it makes.
  it('gives the real client the app\'s adapter, whose word main.ts reads', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', HOST)
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'test-anon-key')
    vi.stubGlobal('fetch', authServer().fetch)
    vi.resetModules()
    const { supabase } = await vi.importActual<typeof import('./supabase')>('./supabase')
    const { authStorage } = await vi.importActual<typeof import('./authStorage')>('./authStorage')
    fillDevice({ derived: false })
    expect((await supabase!.auth.signInWithPassword(creds)).error).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(authStorage.inMemory).toBe(true)
    expect((await supabase!.auth.signOut()).error).toBeNull()
    expect(authStorage.inMemory).toBe(false)
  })
})
