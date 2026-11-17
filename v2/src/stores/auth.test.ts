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
