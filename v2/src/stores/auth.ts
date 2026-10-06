import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from '@/lib/supabase'

/**
 * The i18n key for a Supabase auth error. Its raw `message` used to be shown
 * as-is, so the Danish UI said "Invalid login credentials" or "email rate
 * limit exceeded". Mapped on `code`, which the messages may change under.
 */
export function authErrorKey(err: { code?: string; name?: string; message?: string } | null | undefined): string {
  switch (err?.code) {
    case 'invalid_credentials': return 'auth_err_invalid_credentials'
    case 'email_not_confirmed': return 'auth_err_email_not_confirmed'
    case 'user_already_exists':
    case 'email_exists': return 'auth_err_user_exists'
    case 'weak_password': return 'auth_err_weak_password'
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit': return 'auth_err_rate_limit'
    case 'email_address_invalid': return 'auth_err_email_invalid'
    case 'same_password': return 'auth_err_same_password'
    case 'signup_disabled': return 'auth_err_signup_disabled'
  }
  // No code: the request never reached the server (offline, DNS, timeout).
  if (err?.name === 'AuthRetryableFetchError') return 'auth_err_network'
  return 'auth_err_generic'
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const loading = ref(true)
  // An i18n key (see authErrorKey), so the view translates it in the current language.
  const error = ref<string | null>(null)
  const recovering = ref(false) // true after a password-reset email link is opened

  const isLoggedIn = computed(() => user.value !== null)

  async function init() {
    if (!supabase) { loading.value = false; return }
    const { data } = await supabase.auth.getSession()
    user.value = data.session?.user ?? null
    loading.value = false
    supabase.auth.onAuthStateChange((event, session) => {
      user.value = session?.user ?? null
      if (event === 'PASSWORD_RECOVERY') recovering.value = true
    })
  }

  async function signUp(email: string, password: string): Promise<boolean> {
    if (!supabase) { error.value = 'auth_err_unavailable'; return false }
    error.value = null
    const { error: err } = await supabase.auth.signUp({ email, password })
    if (err) { error.value = authErrorKey(err); return false }
    return true
  }

  async function signIn(email: string, password: string): Promise<boolean> {
    if (!supabase) { error.value = 'auth_err_unavailable'; return false }
    error.value = null
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) { error.value = authErrorKey(err); return false }
    return true
  }

  /** False when signing out failed — the session, and this device's data, then stay. */
  async function signOut(): Promise<boolean> {
    if (!supabase) return false
    try {
      // auth-js keeps the session when the request fails (offline). Clearing
      // `user` regardless made the app wipe local data for a logout that never
      // happened, and the next start signed straight back in without it.
      const { error: err } = await supabase.auth.signOut()
      if (err) return false
    } catch { return false }
    user.value = null
    return true
  }

  /** Send a password-reset email; the link returns to the app and fires PASSWORD_RECOVERY. */
  async function resetPassword(email: string): Promise<boolean> {
    if (!supabase) { error.value = 'auth_err_unavailable'; return false }
    error.value = null
    // Bare base URL (no route hash) — Supabase appends its recovery token to the
    // fragment, which it parses on load and fires PASSWORD_RECOVERY. App.vue then
    // routes to /auth where the new-password form lives.
    const redirectTo = location.origin + location.pathname
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    if (err) { error.value = authErrorKey(err); return false }
    return true
  }

  /** Set a new password during a recovery session. */
  async function updatePassword(password: string): Promise<boolean> {
    if (!supabase) { error.value = 'auth_err_unavailable'; return false }
    error.value = null
    const { error: err } = await supabase.auth.updateUser({ password })
    if (err) { error.value = authErrorKey(err); return false }
    recovering.value = false
    return true
  }

  return {
    user, loading, error, recovering, isLoggedIn, supabaseConfigured,
    init, signUp, signIn, signOut, resetPassword, updatePassword,
  }
})
