import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from '@/lib/supabase'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const loading = ref(true)
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
    if (!supabase) { error.value = 'Supabase not configured'; return false }
    error.value = null
    const { error: err } = await supabase.auth.signUp({ email, password })
    if (err) { error.value = err.message; return false }
    return true
  }

  async function signIn(email: string, password: string): Promise<boolean> {
    if (!supabase) { error.value = 'Supabase not configured'; return false }
    error.value = null
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) { error.value = err.message; return false }
    return true
  }

  async function signOut() {
    if (!supabase) return
    await supabase.auth.signOut()
    user.value = null
  }

  /** Send a password-reset email; the link returns to the app and fires PASSWORD_RECOVERY. */
  async function resetPassword(email: string): Promise<boolean> {
    if (!supabase) { error.value = 'Supabase not configured'; return false }
    error.value = null
    // Bare base URL (no route hash) — Supabase appends its recovery token to the
    // fragment, which it parses on load and fires PASSWORD_RECOVERY. App.vue then
    // routes to /auth where the new-password form lives.
    const redirectTo = location.origin + location.pathname
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    if (err) { error.value = err.message; return false }
    return true
  }

  /** Set a new password during a recovery session. */
  async function updatePassword(password: string): Promise<boolean> {
    if (!supabase) { error.value = 'Supabase not configured'; return false }
    error.value = null
    const { error: err } = await supabase.auth.updateUser({ password })
    if (err) { error.value = err.message; return false }
    recovering.value = false
    return true
  }

  return {
    user, loading, error, recovering, isLoggedIn, supabaseConfigured,
    init, signUp, signIn, signOut, resetPassword, updatePassword,
  }
})
