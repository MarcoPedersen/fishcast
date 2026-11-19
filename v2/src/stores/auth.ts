import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { authStorage } from '@/lib/authStorage'

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

  /**
   * Counts auth-js's events, and the copies taken from another tab: one
   * heard during a read below is newer than what it read.
   */
  let events = 0
  /**
   * Reads the session again, and takes the user it holds, unless an event
   * came meanwhile. A read that fails (a refresh on a flaky connection) is
   * not a sign-out. One that finds none is, when `none` says so: the
   * storage holds no session.
   */
  function reread(none: 'sign-out' | 'keep' = 'keep'): Promise<void> {
    const sb = supabase
    if (!sb) return Promise.resolve()
    const at = events
    return sb.auth.getSession().then(({ data: d, error: e }) => {
      if (at !== events) return
      if (d.session) user.value = d.session.user
      else if (none === 'sign-out' && !e) user.value = null
    }, () => {})
  }

  /**
   * Reads the session again, and is signed out when the storage holds none.
   * stores/session asks as the page comes back from the back/forward cache,
   * and re-pulls once it is done. A sign-out another tab made meanwhile
   * reached the page in no event: with the session on the device, auth-js
   * reads none as the page is shown and says nothing (no SIGNED_OUT), so the
   * page stayed signed in, and its re-pull went without a session.
   */
  function recheck(): Promise<void> {
    return reread('sign-out')
  }

  async function init() {
    if (!supabase) { loading.value = false; return }
    const sb = supabase
    const { data } = await sb.auth.getSession()
    user.value = data.session?.user ?? null
    loading.value = false
    sb.auth.onAuthStateChange((event, session) => {
      events++
      // A token refresh never signs anyone in. Heard by a tab signed out, it
      // is another tab's, and may have crossed this tab's sign-out: auth-js
      // tells every tab, but lib/authStorage leaves the copy then, and the
      // user showed signed in again with no session to send. What the
      // storage holds decides.
      if (event === 'TOKEN_REFRESHED' && !user.value) { void reread(); return }
      // A sign-in heard while signed out: this tab's own, whose storage holds
      // it, or another tab's. A page back from the back/forward cache told
      // every tab SIGNED_IN with a copy signed out while it was there (auth-js
      // reads the session at each visibilitychange), and the tabs signed out
      // showed the user signed in with no session. It still shows at once
      // (AuthView reads the user as soon as signIn returns); the storage
      // then decides.
      const check = event === 'SIGNED_IN' && !user.value && !!session
      user.value = session?.user ?? null
      if (event === 'PASSWORD_RECOVERY') recovering.value = true
      if (check) void reread('sign-out')
    })
    // A sign-in another tab keeps only in memory reaches this one through
    // lib/authStorage. auth-js says so on a channel of its own: its event can
    // come before the copy, and none comes with an answer to this page's
    // question. Read the session again then.
    authStorage.onTake(() => { events++; void reread() })
    // Back from the back/forward cache, lib/authStorage drops a copy another
    // tab says was signed out meanwhile. auth-js here heard nothing of it.
    authStorage.onDrop(() => { void reread('sign-out') })
  }

  /**
   * Run an auth call; false, with `error` set, when it fails. auth-js returns
   * auth errors but rethrows the rest (a full device's storage did, before
   * lib/authStorage). AuthView awaits these with no catch, so a throw left
   * its button on "…" and said nothing.
   */
  async function attempt(call: (sb: SupabaseClient) => Promise<{ error: unknown }>): Promise<boolean> {
    if (!supabase) { error.value = 'auth_err_unavailable'; return false }
    error.value = null
    let err: unknown
    try { err = (await call(supabase)).error } catch (e) { err = e ?? new Error('auth call failed') }
    if (err) { error.value = authErrorKey(err as Parameters<typeof authErrorKey>[0]); return false }
    return true
  }

  function signUp(email: string, password: string): Promise<boolean> {
    return attempt((sb) => sb.auth.signUp({ email, password }))
  }

  function signIn(email: string, password: string): Promise<boolean> {
    return attempt((sb) => sb.auth.signInWithPassword({ email, password }))
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
  function resetPassword(email: string): Promise<boolean> {
    // Bare base URL (no route hash) — Supabase appends its recovery token to the
    // fragment, which it parses on load and fires PASSWORD_RECOVERY. App.vue then
    // routes to /auth where the new-password form lives.
    return attempt((sb) => sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }))
  }

  /** Set a new password during a recovery session. */
  async function updatePassword(password: string): Promise<boolean> {
    if (!(await attempt((sb) => sb.auth.updateUser({ password })))) return false
    recovering.value = false
    return true
  }

  return {
    user, loading, error, recovering, isLoggedIn, supabaseConfigured,
    init, recheck, signUp, signIn, signOut, resetPassword, updatePassword,
  }
})
