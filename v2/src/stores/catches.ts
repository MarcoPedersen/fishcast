import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'
import type { CatchEntry } from '@/lib/types'

const LS_KEY = 'fc2-catches'
export const uid = () => Math.random().toString(36).slice(2, 10)

/**
 * Catch log — a personal history of landed fish. Persists locally and, for
 * logged-in users, syncs to a single `catches` row per user (mirrors the setup
 * store). Degrades to local-only if the Supabase table is absent.
 */
export const useCatchStore = defineStore('catches', () => {
  const entries = ref<CatchEntry[]>([])
  const syncing = ref(false)

  // Newest first
  const sorted = computed(() =>
    [...entries.value].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
  )

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) entries.value = JSON.parse(raw) ?? []
    } catch { /* corrupt local state — start fresh */ }
  }

  function saveLocal() {
    localStorage.setItem(LS_KEY, JSON.stringify(entries.value))
  }

  async function pullRemote() {
    const auth = useAuthStore()
    if (!supabase || !auth.user) return
    try {
      const { data } = await supabase
        .from('catches')
        .select('entries')
        .eq('user_id', auth.user.id)
        .maybeSingle()
      if (data?.entries) { entries.value = data.entries; saveLocal() }
    } catch { /* table missing or offline — keep local */ }
  }

  async function pushRemote() {
    const auth = useAuthStore()
    if (!supabase || !auth.user) return
    syncing.value = true
    try {
      await supabase.from('catches').upsert({
        user_id: auth.user.id,
        entries: entries.value,
        updated_at: new Date().toISOString(),
      })
    } catch { /* table missing or offline — local copy is still saved */ }
    syncing.value = false
  }

  // Don't push until the initial local load + remote pull are done.
  let ready = false
  function markReady() { ready = true }

  let pushTimer: ReturnType<typeof setTimeout> | undefined
  watch(entries, () => {
    saveLocal()
    if (!ready) return
    clearTimeout(pushTimer)
    pushTimer = setTimeout(pushRemote, 1500)
  }, { deep: true })

  function add(entry: Omit<CatchEntry, 'id'>) {
    entries.value.unshift({ ...entry, id: uid() })
  }
  function remove(id: string) {
    entries.value = entries.value.filter((e) => e.id !== id)
  }

  return {
    entries, sorted, syncing,
    loadLocal, pullRemote, pushRemote, markReady, add, remove,
  }
})
