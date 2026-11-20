import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { fakeDb, fakeSupabase } from '@/test/fakeSupabase'
import { lang, langReady, t } from '@/lib/i18n'
import { authStorage, createAuthStorage, type AuthStorage } from '@/lib/authStorage'
import { STRINGS } from '@/test/strings'
import { authErrorKey, useAuthStore } from './auth'

/**
 * Regression — Supabase's raw English `message` was shown as-is, so the Danish
 * UI said "Invalid login credentials" or "email rate limit exceeded".
 */
describe('auth error messages', () => {
  beforeEach(() => {
    fakeDb.reset()
    setActivePinia(createPinia())
  })
  afterEach(() => {
    lang.value = 'da'
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it.each([
    ['invalid_credentials', 'auth_err_invalid_credentials'],
    ['email_not_confirmed', 'auth_err_email_not_confirmed'],
    ['user_already_exists', 'auth_err_user_exists'],
    ['email_exists', 'auth_err_user_exists'],
    ['weak_password', 'auth_err_weak_password'],
    ['over_email_send_rate_limit', 'auth_err_rate_limit'],
    ['over_request_rate_limit', 'auth_err_rate_limit'],
    ['email_address_invalid', 'auth_err_email_invalid'],
    ['same_password', 'auth_err_same_password'],
    ['signup_disabled', 'auth_err_signup_disabled'],
  ])('maps %s to a translated message', (code, key) => {
    expect(authErrorKey({ code, message: 'raw' })).toBe(key)
    expect(STRINGS.da[key]).toBeTruthy()
    expect(STRINGS.en[key]).toBeTruthy()
  })

  it('maps a dropped connection and anything unknown to translated fallbacks', () => {
    expect(authErrorKey({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' })).toBe('auth_err_network')
    expect(authErrorKey({ code: 'something_new', message: 'raw' })).toBe('auth_err_generic')
    expect(authErrorKey({ message: 'raw' })).toBe('auth_err_generic')
  })

  it('shows a failed sign-in in the UI language', async () => {
    fakeDb.authError = { name: 'AuthApiError', code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' }
    const auth = useAuthStore()
    expect(await auth.signIn('a@b.dk', 'wrongpass')).toBe(false)
    expect(t(auth.error!)).toBe(STRINGS.da.auth_err_invalid_credentials)
    lang.value = 'en'
    await langReady() // the English table is a chunk of its own
    expect(t(auth.error!)).toBe('Wrong email or password.')
  })

  it('translates sign-up, reset and password-update failures too', async () => {
    vi.stubGlobal('location', { origin: 'https://example.test', pathname: '/fishcast/v2/' }) // resetPassword's redirect
    const auth = useAuthStore()
    fakeDb.authError = { code: 'user_already_exists', message: 'User already registered' }
    await auth.signUp('a@b.dk', 'secret1')
    expect(auth.error).toBe('auth_err_user_exists')
    fakeDb.authError = { code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' }
    await auth.resetPassword('a@b.dk')
    expect(auth.error).toBe('auth_err_rate_limit')
    fakeDb.authError = { code: 'same_password', message: 'New password should be different' }
    await auth.updatePassword('secret1')
    expect(auth.error).toBe('auth_err_same_password')
  })

  it('says a call that throws went wrong, instead of leaving the form on "…"', async () => {
    // auth-js returns auth errors but rethrows the rest: a full device's
    // storage did, before lib/authStorage. AuthView awaits these with no catch,
    // so its button stayed on "…" and nothing was said.
    vi.stubGlobal('location', { origin: 'https://example.test', pathname: '/fishcast/v2/' })
    const thrown = new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    for (const m of ['signInWithPassword', 'signUp', 'resetPasswordForEmail', 'updateUser'] as const) {
      vi.spyOn(fakeSupabase.auth, m).mockRejectedValue(thrown)
    }
    const auth = useAuthStore()
    auth.recovering = true
    const results = [
      await auth.signIn('a@b.dk', 'secret1'), auth.error,
      await auth.signUp('a@b.dk', 'secret1'), auth.error,
      await auth.resetPassword('a@b.dk'), auth.error,
      await auth.updatePassword('secret1'), auth.error,
    ]
    expect(results).toEqual([false, 'auth_err_generic', false, 'auth_err_generic', false, 'auth_err_generic', false, 'auth_err_generic'])
    expect(auth.recovering).toBe(true) // the new-password form stays
  })
})

/**
 * A sign-in another tab keeps only in memory reaches this one through
 * lib/authStorage. auth-js tells the store with an event of its own, on its
 * own channel: it can come before the copy, and none comes with the answer
 * to a page's question. The store reads the session again when the adapter
 * takes in a copy.
 *
 * The app's adapter talks to the other tabs over a real BroadcastChannel
 * here (a browser's window and document are stood in for); the fake client
 * reads fakeDb.session where auth-js reads the adapter.
 */
describe('a sign-in another tab keeps in memory', () => {
  const KEY = 'sb-fishcast-test-auth-token'
  const others: AuthStorage[] = []
  beforeEach(() => {
    fakeDb.reset()
    setActivePinia(createPinia())
    vi.stubGlobal('window', {})
    vi.stubGlobal('document', {})
    vi.stubGlobal('navigator', {}) // no Web Locks: the copies come as changes
    // The other tab's device is full: its sign-in lives in its memory.
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
  })
  afterEach(() => {
    for (const t of others.splice(0)) t.close()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
  // The app's adapter: its channel stays open for the tests below, then closes.
  afterAll(() => authStorage.close())

  /** Another tab of the app, on a device with no room: its adapter. */
  function otherTab() {
    const t = createAuthStorage()
    others.push(t)
    return t
  }

  it('reads the session again when the adapter takes in its copy', async () => {
    const auth = useAuthStore()
    await auth.init()
    expect(auth.user).toBeNull()
    fakeDb.session = { user: { id: 'u-1', email: 'a@b.dk' } } // what auth-js reads once the adapter holds the copy
    otherTab().setItem(KEY, '{"refresh_token":"r1"}') // signs in; no auth-js event reaches this tab
    await vi.waitFor(() => expect(auth.user?.id).toBe('u-1'), { interval: 5 })
  })

  it('an auth event heard while it reads is newer than what it read', async () => {
    const auth = useAuthStore()
    await auth.init()
    const reads: ((v: unknown) => void)[] = []
    vi.spyOn(fakeSupabase.auth, 'getSession').mockImplementation(() => new Promise((r) => { reads.push(r) }) as never)
    otherTab().setItem(KEY, '{"refresh_token":"r1"}')
    await vi.waitFor(() => expect(reads.length).toBeGreaterThan(0), { interval: 5 })
    for (const cb of fakeDb.listeners) await cb('SIGNED_OUT', null) // that tab signs out, and auth-js says so here
    for (const answer of reads) answer({ data: { session: { user: { id: 'u-1' } } }, error: null })
    await new Promise((r) => setTimeout(r, 0))
    expect(auth.user).toBeNull()
  })

  /**
   * Round F review, probed with auth-js 2.108's own channel on: the user
   * signs out here while another tab's token refresh is on its way. That
   * tab saves it, and lib/authStorage here leaves its copy (it crossed the
   * sign-out), but auth-js tells this tab TOKEN_REFRESHED with the session
   * all the same. Taken, the tab the user had just signed out of showed
   * them signed in again, with no session to send. A tab signed out reads
   * its storage then, as when the adapter takes a copy.
   */
  it('a signed-out tab takes no session from another tab\'s token refresh that its storage lacks', async () => {
    const auth = useAuthStore()
    await auth.init()
    expect(auth.user).toBeNull()
    for (const cb of fakeDb.listeners) await cb('TOKEN_REFRESHED', { user: { id: 'u-1', email: 'a@b.dk' } })
    await new Promise((r) => setTimeout(r, 0))
    expect(auth.user).toBeNull()
    // One its storage holds (the device's, or a copy taken) signs it in, as a read would.
    fakeDb.session = { user: { id: 'u-1', email: 'a@b.dk' } }
    for (const cb of fakeDb.listeners) await cb('TOKEN_REFRESHED', { user: { id: 'u-1', email: 'a@b.dk' } })
    await vi.waitFor(() => expect(auth.user?.id).toBe('u-1'), { interval: 5 })
  })

  it('a signed-in tab takes a token refresh, and any other event, as auth-js gives it', async () => {
    fakeDb.session = { user: { id: 'u-1', email: 'a@b.dk' } }
    const auth = useAuthStore()
    await auth.init()
    const read = vi.spyOn(fakeSupabase.auth, 'getSession')
    for (const cb of fakeDb.listeners) await cb('TOKEN_REFRESHED', { user: { id: 'u-1', email: 'new@b.dk' } })
    expect(auth.user?.email).toBe('new@b.dk') // at once, with no read
    // Signed in already (a sign-in heard while signed out reads the storage: below).
    for (const cb of fakeDb.listeners) await cb('SIGNED_IN', { user: { id: 'u-2' } })
    expect(auth.user?.id).toBe('u-2')
    for (const cb of fakeDb.listeners) await cb('SIGNED_OUT', null)
    expect(auth.user).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })

  /**
   * Round H review: a page back from the back/forward cache, holding a copy
   * signed out meanwhile in another tab, made auth-js there tell every tab
   * SIGNED_IN with it (its read at the visibilitychange). Each tab signed out
   * showed the user signed in, with no session to send: the round E
   * symptom. A sign-in heard while signed out still shows at once (AuthView
   * reads the user as soon as signIn returns), and the storage then decides.
   */
  it('a sign-in another tab announces, with no session in this tab\'s storage, shows for no longer than a read', async () => {
    const auth = useAuthStore()
    await auth.init()
    for (const cb of fakeDb.listeners) void cb('SIGNED_IN', { user: { id: 'u-1', email: 'a@b.dk' } })
    expect(auth.user?.id).toBe('u-1') // at once, as before
    await vi.waitFor(() => expect(auth.user).toBeNull(), { interval: 5 })
  })

  it('its own sign-in stays: its storage holds the session', async () => {
    const auth = useAuthStore()
    await auth.init()
    const read = vi.spyOn(fakeSupabase.auth, 'getSession')
    expect(await auth.signIn('a@b.dk', 'secret1')).toBe(true)
    expect(auth.user?.id).toBe('u-a@b.dk')
    await vi.waitFor(() => expect(read).toHaveBeenCalled(), { interval: 5 })
    await new Promise((r) => setTimeout(r, 0))
    expect(auth.user?.id).toBe('u-a@b.dk')
  })

  it('takes no sign-out from a failed read, nor from one older than an event or a copy taken', async () => {
    const auth = useAuthStore()
    await auth.init()
    // A read that fails (a refresh on a flaky connection) is no sign-out.
    fakeDb.session = { user: { id: 'u-1', email: 'a@b.dk' } }
    fakeDb.tokenLost = true
    for (const cb of fakeDb.listeners) await cb('SIGNED_IN', { user: { id: 'u-1', email: 'a@b.dk' } })
    await new Promise((r) => setTimeout(r, 0))
    expect(auth.user?.id).toBe('u-1')
    fakeDb.tokenLost = false
    for (const cb of fakeDb.listeners) await cb('SIGNED_OUT', null)
    // A copy taken during the read: its own read is newer, even answered first.
    const reads: ((v: unknown) => void)[] = []
    vi.spyOn(fakeSupabase.auth, 'getSession').mockImplementation(() => new Promise((r) => { reads.push(r) }) as never)
    for (const cb of fakeDb.listeners) await cb('SIGNED_IN', { user: { id: 'u-1', email: 'a@b.dk' } })
    expect(reads).toHaveLength(1)
    const check = reads[0]
    otherTab().setItem(KEY, '{"refresh_token":"r1"}')
    // The stores of the tests above listen to the app's adapter too: this one's read is the last.
    await vi.waitFor(() => expect(reads.length).toBeGreaterThan(1), { interval: 5 })
    reads.at(-1)!({ data: { session: { user: { id: 'u-1', email: 'a@b.dk' } } }, error: null })
    check({ data: { session: null }, error: null })
    await new Promise((r) => setTimeout(r, 0))
    expect(auth.user?.id).toBe('u-1')
    // An event during the read: newer than what it read.
    for (const cb of fakeDb.listeners) await cb('SIGNED_OUT', null)
    const before = reads.length
    for (const cb of fakeDb.listeners) await cb('SIGNED_IN', { user: { id: 'u-1', email: 'a@b.dk' } })
    expect(reads).toHaveLength(before + 1)
    for (const cb of fakeDb.listeners) await cb('USER_UPDATED', { user: { id: 'u-1', email: 'new@b.dk' } })
    reads.at(-1)!({ data: { session: null }, error: null })
    await new Promise((r) => setTimeout(r, 0))
    expect(auth.user?.email).toBe('new@b.dk')
  })

  // Back from the back/forward cache, the adapter drops a copy another tab
  // says was signed out meanwhile. auth-js here heard nothing of it.
  it('reads the session again when the adapter drops a copy, and is signed out when it holds none', async () => {
    let dropped = () => {}
    vi.spyOn(authStorage, 'onDrop').mockImplementation((fn) => { dropped = fn; return () => {} })
    fakeDb.session = { user: { id: 'u-1', email: 'a@b.dk' } }
    const auth = useAuthStore()
    await auth.init()
    expect(auth.user?.id).toBe('u-1')
    fakeDb.tokenLost = true // a read that fails says nothing
    dropped()
    await new Promise((r) => setTimeout(r, 0))
    expect(auth.user?.id).toBe('u-1')
    fakeDb.tokenLost = false
    fakeDb.session = null // what auth-js reads once the copy is dropped
    dropped()
    await vi.waitFor(() => expect(auth.user).toBeNull(), { interval: 5 })
  })

  // Round I review: a session kept on the device, signed out in another tab
  // while this page was in the back/forward cache. auth-js reads none as the
  // page is shown again, and says nothing (no SIGNED_OUT): the user stayed
  // signed in. stores/session asks for this read then, and waits for it.
  it('reads the session again when asked, and is signed out when the storage holds none', async () => {
    fakeDb.session = { user: { id: 'u-1', email: 'a@b.dk' } }
    const auth = useAuthStore()
    await auth.init()
    await auth.recheck()
    expect(auth.user?.id).toBe('u-1')
    fakeDb.tokenLost = true // a read that fails is no sign-out
    await auth.recheck()
    expect(auth.user?.id).toBe('u-1')
    fakeDb.tokenLost = false
    fakeDb.session = null // signed out in another tab
    await auth.recheck()
    expect(auth.user).toBeNull()
    // An event heard during the read is newer than what it read.
    const reads: ((v: unknown) => void)[] = []
    vi.spyOn(fakeSupabase.auth, 'getSession').mockImplementation(() => new Promise((r) => { reads.push(r) }) as never)
    const asked = auth.recheck()
    for (const cb of fakeDb.listeners) await cb('SIGNED_IN', { user: { id: 'u-2' } })
    reads[0]({ data: { session: null }, error: null })
    await asked
    expect(auth.user?.id).toBe('u-2')
  })

  it('reads the session again when asked before init too', async () => {
    fakeDb.session = null
    const auth = useAuthStore()
    auth.user = { id: 'u-1' } as never
    await auth.recheck()
    expect(auth.user).toBeNull()
  })

  it('takes no session from a failed read: a network blip is not a sign-out', async () => {
    fakeDb.session = { user: { id: 'u-1', email: 'a@b.dk' } }
    const auth = useAuthStore()
    await auth.init()
    expect(auth.user?.id).toBe('u-1')
    fakeDb.tokenLost = true // getSession now fails, with no session
    const read = vi.spyOn(fakeSupabase.auth, 'getSession')
    otherTab().setItem(KEY, '{"refresh_token":"r2"}')
    await vi.waitFor(() => expect(read).toHaveBeenCalled(), { interval: 5 })
    await new Promise((r) => setTimeout(r, 0))
    expect(auth.user?.id).toBe('u-1')
  })
})

/**
 * Until the session is read (auth.loading) the catch log's form may wait
 * for it: with a guest's log on the device, an account's draft does. A read
 * that threw left the page loading for its life.
 */
describe('auth.init', () => {
  beforeEach(() => {
    fakeDb.reset()
    setActivePinia(createPinia())
  })
  afterEach(() => vi.restoreAllMocks())

  it('ends loading when the session read throws', async () => {
    vi.spyOn(fakeSupabase.auth, 'getSession').mockRejectedValueOnce(new Error('lock lost'))
    const auth = useAuthStore()
    await auth.init().catch(() => {})
    expect(auth.loading).toBe(false)
    expect(auth.user).toBeNull()
  })

  // The read rethrew: auth-js's events and the other tabs' copies were never
  // listened for, so the page stayed signed out for its life, and main.ts's
  // start stopped before it hydrated the stores. It stays signed out now,
  // and the next event signs it in.
  it('stays signed out when the session read throws, and listens all the same', async () => {
    vi.spyOn(fakeSupabase.auth, 'getSession').mockRejectedValueOnce(new Error('lock lost'))
    let took = () => {}
    let dropped = () => {}
    vi.spyOn(authStorage, 'onTake').mockImplementation((fn) => { took = fn; return () => {} })
    vi.spyOn(authStorage, 'onDrop').mockImplementation((fn) => { dropped = fn; return () => {} })
    const auth = useAuthStore()
    await expect(auth.init()).resolves.toBeUndefined()
    expect([auth.loading, auth.user]).toEqual([false, null])
    expect(fakeDb.listeners).toHaveLength(1)
    // auth-js reads the session again and says so.
    fakeDb.session = { user: { id: 'u-1' } }
    for (const cb of fakeDb.listeners) await cb('SIGNED_IN', fakeDb.session)
    await vi.waitFor(() => expect(auth.user?.id).toBe('u-1'), { interval: 5 })
    // Another tab's sign-in kept in memory, and its sign-out: heard too.
    fakeDb.session = null
    dropped()
    await vi.waitFor(() => expect(auth.user).toBeNull(), { interval: 5 })
    fakeDb.session = { user: { id: 'u-2' } }
    took()
    await vi.waitFor(() => expect(auth.user?.id).toBe('u-2'), { interval: 5 })
  })

  it('ends loading once the session is read', async () => {
    fakeDb.session = { user: { id: 'u-1' } }
    const auth = useAuthStore()
    const read = auth.init()
    expect(auth.loading).toBe(true)
    await read
    expect([auth.loading, auth.user?.id]).toEqual([false, 'u-1'])
  })
})
