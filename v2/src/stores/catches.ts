import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'
import { showToast } from '@/lib/toast'
import { t } from '@/lib/i18n'
import { reconcile } from '@/lib/sync'
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
  // Wall-clock ms of the last genuine local edit — drives last-write-wins sync.
  let updatedAt = 0

  // Newest first
  const sorted = computed(() =>
    [...entries.value].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
  )

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (!raw) return
      const s = JSON.parse(raw)
      // Back-compat: old format stored the bare array.
      if (Array.isArray(s)) { entries.value = s }
      else { entries.value = s.entries ?? []; updatedAt = s.updatedAt ?? 0 }
    } catch { /* corrupt local state — start fresh */ }
  }

  function saveLocal() {
    localStorage.setItem(LS_KEY, JSON.stringify({ entries: entries.value, updatedAt }))
  }

  async function pullRemote() {
    const auth = useAuthStore()
    if (!supabase || !auth.user) return
    try {
      const { data } = await supabase
        .from('catches')
        .select('entries, updated_at')
        .eq('user_id', auth.user.id)
        .maybeSingle()
      const remoteAt = data?.updated_at ? Date.parse(data.updated_at) : 0
      const verdict = reconcile(updatedAt, { data: data?.entries ?? null, updatedAt: remoteAt })
      if (verdict === 'take-remote') { entries.value = data!.entries; updatedAt = remoteAt; saveLocal() }
      else if (verdict === 'keep-local') pushRemote() // local has newer edits → reconcile up
    } catch { /* table missing or offline — keep local */ }
  }

  async function pushRemote() {
    const auth = useAuthStore()
    if (!supabase || !auth.user) return
    syncing.value = true
    try {
      const { error } = await supabase.from('catches').upsert({
        user_id: auth.user.id,
        entries: entries.value,
        updated_at: new Date(updatedAt || Date.now()).toISOString(),
      })
      if (error) showToast('⚠️ ' + t('toast_sync_failed'), { type: 'error' })
    } catch { /* table missing or offline — local copy is still saved */ }
    syncing.value = false
  }

  // Don't push until the initial local load + remote pull are done.
  let ready = false
  function markReady() { ready = true }

  let pushTimer: ReturnType<typeof setTimeout> | undefined
  watch(entries, () => {
    if (ready) updatedAt = Date.now() // genuine edit (not hydration) → stamp it
    saveLocal()
    if (!ready) return
    clearTimeout(pushTimer)
    pushTimer = setTimeout(pushRemote, 1500)
  }, { deep: true })

  /** Wipe local state (sign-out): cancel pending sync, clear memory + storage. */
  function clear() {
    clearTimeout(pushTimer)
    entries.value = []
    updatedAt = 0
    localStorage.removeItem(LS_KEY)
  }

  function add(entry: Omit<CatchEntry, 'id'>) {
    entries.value.unshift({ ...entry, id: uid() })
  }
  function update(id: string, patch: Omit<CatchEntry, 'id'>) {
    const i = entries.value.findIndex((e) => e.id === id)
    if (i !== -1) entries.value[i] = { ...patch, id }
  }
  function remove(id: string) {
    entries.value = entries.value.filter((e) => e.id !== id)
  }

  return {
    entries, sorted, syncing,
    loadLocal, pullRemote, pushRemote, markReady, clear, add, update, remove,
  }
})
