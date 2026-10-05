import { defineStore } from 'pinia'
import { nextTick, ref, computed, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'
import { showToast } from '@/lib/toast'
import { t } from '@/lib/i18n'
import { reconcile } from '@/lib/sync'
import { normalizeEntries } from '@/lib/normalize'
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
  // See setup.ts — which account this local log belongs to (null = guest).
  let ownerId: string | null = null
  // See setup.ts — an edit the account hasn't confirmed receiving. Persisted.
  let dirty = false

  // See setup.ts — >0 while the store writes its own hydration, so the watcher
  // doesn't stamp an adopted log as a fresh edit and push it straight back.
  let applying = 0
  function apply(fn: () => void) {
    applying++
    try { fn() } finally { nextTick(() => { applying-- }) }
  }

  // Newest first: by date, then by time within the day (no time sorts last).
  // Date alone left same-day entries in insertion order, so a backfilled
  // morning catch sat above that evening's, and editing a time never moved it.
  const when = (e: CatchEntry) => `${e.date} ${e.time ?? ''}`
  const sorted = computed(() =>
    [...entries.value].sort((a, b) => {
      const x = when(a)
      const y = when(b)
      return x < y ? 1 : x > y ? -1 : 0
    }),
  )

  function applyStored(s: any) {
    // Back-compat: old format stored the bare array (no stamp, no owner).
    if (Array.isArray(s)) { entries.value = normalizeEntries(s); updatedAt = 0; ownerId = null; dirty = true; return }
    entries.value = normalizeEntries(s?.entries)
    updatedAt = typeof s?.updatedAt === 'number' ? s.updatedAt : 0
    ownerId = typeof s?.ownerId === 'string' ? s.ownerId : null
    // See setup.ts: a log saved before `dirty` existed is assumed unsynced.
    dirty = typeof s?.dirty === 'boolean' ? s.dirty : !!s
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (!raw) return
      const s = JSON.parse(raw)
      apply(() => applyStored(s))
    } catch { /* corrupt local state — start fresh */ }
  }

  /** Another tab saved (or wiped) the log: take its copy — see setup.ts. */
  function reloadLocal() {
    let s: any
    try { s = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null') } catch { return }
    apply(() => applyStored(s))
  }

  function saveLocal() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ entries: entries.value, updatedAt, ownerId, dirty }))
    } catch { /* storage full or blocked — the push still carries the edit */ }
  }

  function adoptRemote(remote: unknown, remoteAt: number, userId: string) {
    // See setup.ts: the row we already hold (a re-pull on focus) isn't re-applied.
    const same = remoteAt > 0 && remoteAt === updatedAt && ownerId === userId
    if (!same) apply(() => { entries.value = normalizeEntries(remote) })
    updatedAt = remoteAt
    ownerId = userId
    dirty = false
    saveLocal()
  }

  // See setup.ts: true only once a pull has COMPLETED for the signed-in user —
  // nothing local is pushed before it has been reconciled with the account's row.
  let pulled = false
  let pulling: Promise<void> | null = null
  let pullingFor: string | null = null

  function pullRemote(): Promise<void> {
    const auth = useAuthStore()
    if (!supabase || !auth.user) return Promise.resolve()
    const userId = auth.user.id
    if (pulling && pullingFor === userId) return pulling
    pullingFor = userId
    const p: Promise<void> = doPull(userId).finally(() => { if (pulling === p) pulling = null })
    pulling = p
    return p
  }

  async function doPull(userId: string) {
    let data: any = null
    let error: unknown = null
    try {
      ;({ data, error } = await supabase!
        .from('catches')
        .select('entries, updated_at')
        .eq('user_id', userId)
        .maybeSingle())
    } catch (e) { error = e }
    if (useAuthStore().user?.id !== userId) return // signed out / switched mid-pull — see setup.ts
    if (error) return // table missing, read blocked or offline — keep local, stay un-pulled
    const remoteAt = data?.updated_at ? Date.parse(data.updated_at) : 0
    const verdict = reconcile(
      updatedAt,
      { data: data?.entries ?? null, updatedAt: remoteAt },
      !entries.value.length,
      ownerId !== userId, // guest / other-account log can't outrank the row
    )
    if (verdict === 'take-remote') adoptRemote(data!.entries, remoteAt, userId)
    else if (verdict === 'noop' && (ownerId === null || ownerId === userId)) {
      // No row yet: claim the guest log (persisted) — see setup.ts.
      ownerId = userId
      if (entries.value.length) dirty = true
      saveLocal()
    }
    pulled = true
    if (verdict === 'keep-local' || (verdict === 'noop' && ownerId === userId && entries.value.length)) {
      await pushRemote() // local has newer edits, or the account has no row → reconcile up
    }
  }

  async function pushRemote() {
    const auth = useAuthStore()
    if (!supabase || !auth.user) return
    const userId = auth.user.id
    // See setup.ts: never push a log no pull has reconciled — pull instead,
    // and let its verdict push. (This was `!pulled && !entries.length`, so a
    // failed pull let a 1-catch log replace the account's 50.)
    if (!pulled) { await pullRemote(); return }
    if (ownerId !== userId) return // another account's leftovers never reach this one
    clearTimeout(pushTimer)
    editedWhileDisarmed = false
    const stamp = updatedAt
    syncing.value = true
    let error: unknown = null
    try {
      ;({ error } = await supabase.from('catches').upsert({
        user_id: userId,
        entries: entries.value,
        updated_at: new Date(updatedAt || Date.now()).toISOString(),
      }))
      if (error) showToast('⚠️ ' + t('toast_sync_failed'), { type: 'error' })
    } catch (e) { error = e /* table missing or offline — local copy is still saved */ }
    syncing.value = false
    if (error || useAuthStore().user?.id !== userId) return
    if (updatedAt === stamp) { dirty = false; saveLocal() }
  }

  /** See setup.ts — push what's unsynced now; true when nothing is left unsynced. */
  async function flush(): Promise<boolean> {
    if (!dirty) return true
    clearTimeout(pushTimer)
    await pushRemote()
    return !dirty
  }

  // Don't push until the initial local load + remote pull are done.
  let ready = false
  let editedWhileDisarmed = false
  function markReady() {
    ready = true
    if (editedWhileDisarmed && dirty && pulled) schedulePush() // see setup.ts
    editedWhileDisarmed = false
  }
  /** Disarm sync while (re)hydrating an account — see setup.ts. */
  function pauseSync() {
    ready = false
    pulled = false
    clearTimeout(pushTimer)
  }

  // See setup.ts: the deep watcher fires after clear() returns, so without this
  // guard it would stamp a fresh updatedAt onto the wiped state and let that
  // beat real remote data on the next login.
  let clearing = false

  let pushTimer: ReturnType<typeof setTimeout> | undefined
  function schedulePush() {
    clearTimeout(pushTimer)
    pushTimer = setTimeout(pushRemote, 1500)
  }
  watch(entries, () => {
    if (clearing || applying) return
    // A genuine edit, stamped even while disarmed (pull in flight) — see setup.ts.
    updatedAt = Date.now()
    dirty = true
    saveLocal()
    if (!ready) { editedWhileDisarmed = true; return }
    schedulePush()
  }, { deep: true })

  /** Wipe local state (sign-out): cancel pending sync, clear memory + storage. */
  function clear() {
    clearing = true
    clearTimeout(pushTimer)
    entries.value = []
    updatedAt = 0
    ownerId = null
    dirty = false
    editedWhileDisarmed = false
    pulled = false
    localStorage.removeItem(LS_KEY)
    nextTick(() => { clearing = false })
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
    loadLocal, reloadLocal, pullRemote, pushRemote, flush, markReady, pauseSync, clear, add, update, remove,
  }
})
