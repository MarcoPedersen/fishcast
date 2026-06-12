import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { User } from '@supabase/supabase-js'
import { supabase, supabaseConfigured } from '@/lib/supabase'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const loading = ref(true)
  const error = ref<string | null>(null)

  const isLoggedIn = computed(() => user.value !== null)

  async function init() {
    if (!supabase) { loading.value = false; return }
    const { data } = await supabase.auth.getSession()
    user.value = data.session?.user ?? null
    loading.value = false
    supabase.auth.onAuthStateChange((_event, session) => {
      user.value = session?.user ?? null
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

  return { user, loading, error, isLoggedIn, supabaseConfigured, init, signUp, signIn, signOut }
})
