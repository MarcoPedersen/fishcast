import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { computed } from 'vue'
import { GoTrueClient, type SupportedStorage } from '@supabase/supabase-js'
import { fakeQuota } from '@/test/fakeQuota'
import { createAuthStorage } from './authStorage'

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
function tokenBody() {
  const now = new Date().toISOString()
  return {
    access_token: 'eyJhbGciOiJIUzI1NiJ9.' + 'a'.repeat(1100) + '.sig',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'refresh-1',
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

/** The fake auth server: answers sign-in and sign-out, and refuses any other host. */
function authServer() {
  const calls: string[] = []
  const fetch = vi.fn(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input)
    if (!url.startsWith(HOST + '/auth/v1/')) throw new Error('unexpected request: ' + url)
    calls.push(url.slice(HOST.length))
    if (url.includes('/token?grant_type=password')) {
      return new Response(JSON.stringify(tokenBody()), { status: 200, headers: { 'content-type': 'application/json' } })
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
