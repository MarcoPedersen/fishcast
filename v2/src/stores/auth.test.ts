import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { fakeDb } from '@/test/fakeSupabase'
import { lang, t } from '@/lib/i18n'
import { STRINGS } from '@/lib/strings'
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
})
