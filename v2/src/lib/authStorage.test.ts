import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { computed } from 'vue'
import { GoTrueClient, type SupportedStorage } from '@supabase/supabase-js'
import { fakeQuota } from '@/test/fakeQuota'
import { AUTH_CHANNEL, createAuthStorage, type TabChannel } from './authStorage'

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
  /** Lets every message under way arrive. */
  const delivered = () => new Promise((r) => setTimeout(r, 0))
  /** A tab of the app: its adapter on the hub, and its client, loaded (auth-js's first read opens the channel). */
  async function tab(h: ReturnType<typeof hub>, fetch: typeof globalThis.fetch) {
    const storage = createAuthStorage({ channel: h.channel })
    const auth = client(storage, fetch)
    await auth.initialize()
    return { storage, auth }
  }
  const session = async (t: { auth: GoTrueClient }) => (await t.auth.getSession()).data.session

  afterEach(() => { vi.unstubAllGlobals() })

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

  // Asking the open tabs at load was left out: auth-js reads a key no tab
  // ever holds (<key>-code-verifier) at every load, so each page would wait
  // out the question. The next refresh (within the hour) reaches it.
  it('a tab opened later starts signed out, and is handed the next refresh', async () => {
    const server = authServer()
    const h = hub()
    const a = await tab(h, server.fetch)
    fillDevice({ derived: false })
    await a.auth.signInWithPassword(creds)
    const later = await tab(h, server.fetch)
    expect(await session(later)).toBeNull()
    expect(later.storage.inMemory).toBe(false)
    await a.auth.refreshSession()
    await delivered()
    expect((await session(later))?.refresh_token).toBe('refresh-2')
  })

  it('never sends what the device holds', async () => {
    const h = hub()
    const a = createAuthStorage({ channel: h.channel })
    a.setItem(KEY, '{"refresh_token":"device"}')
    expect(a.getItem(KEY)).toBe('{"refresh_token":"device"}')
    a.removeItem(KEY)
    expect(h.sent).toEqual([{ key: KEY, value: null }, { key: KEY, value: null }]) // only: no memory copy wanted elsewhere
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
