import { defineStore } from 'pinia'
import { nextTick, ref, computed, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'
import { showToast } from '@/lib/toast'
import { t } from '@/lib/i18n'
import { decidePull } from '@/lib/sync'
import { jsonEqual, mergeList } from '@/lib/merge'
import { PUSH_ATTEMPTS, nextStamp, readRow, sameStamp, writeRow, type RemoteRow } from '@/lib/syncRow'
import { normalizeEntries } from '@/lib/normalize'
import type { CatchEntry } from '@/lib/types'

const LS_KEY = 'fc2-catches'
export const uid = () => Math.random().toString(36).slice(2, 10)
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

/**
 * Catch log — a personal history of landed fish. Persists locally and, for
 * logged-in users, syncs to a single `catches` row per user (mirrors the setup
 * store: the same base, merge and conditional push). Degrades to local-only
 * if the Supabase table is absent.
 */
export const useCatchStore = defineStore('catches', () => {
  const entries = ref<CatchEntry[]>([])
  const syncing = ref(false)
  // See setup.ts — the last local edit's time; no sync decision reads it any more.
  let updatedAt = 0
  // See setup.ts — which account this local log belongs to (null = guest).
  let ownerId: string | null = null
  // See setup.ts — an edit the account hasn't confirmed receiving. Persisted.
  let dirty = false
  // See setup.ts — the row version this log was last reconciled with, and the
  // log as of that version (the merge's common ancestor). Without it a phone's
  // offline catch on a Saturday copy pushed its 6 entries over the 8 the
  // desktop had saved that evening. Persisted; null = never reconciled.
  let baseAt: number | null = null
  let baseStamp: string | null = null
  let base: CatchEntry[] | null = null
  let baseGen = 0
  let edits = 0

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

  function setBase(stamp: string | null, at: number | null, doc: CatchEntry[] | null) {
    baseStamp = stamp
    baseAt = at
    base = doc && clone(doc)
    baseGen++
  }

  function applyStored(s: any) {
    // Back-compat: old format stored the bare array (no stamp, no owner, no base).
    if (Array.isArray(s)) {
      entries.value = normalizeEntries(s)
      updatedAt = 0
      ownerId = null
      dirty = true
      setBase(null, null, null)
      return
    }
    entries.value = normalizeEntries(s?.entries)
    updatedAt = typeof s?.updatedAt === 'number' ? s.updatedAt : 0
    ownerId = typeof s?.ownerId === 'string' ? s.ownerId : null
    // See setup.ts: a log saved before `dirty` existed is assumed unsynced.
    dirty = typeof s?.dirty === 'boolean' ? s.dirty : !!s
    // See setup.ts: no base → a union merge on the next pull.
    const ok = typeof s?.baseAt === 'number' && Array.isArray(s?.base)
    setBase(ok ? (typeof s.baseStamp === 'string' ? s.baseStamp : new Date(s.baseAt).toISOString()) : null, ok ? s.baseAt : null, ok ? normalizeEntries(s.base) : null)
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (!raw) return
      const s = JSON.parse(raw)
      apply(() => applyStored(s))
    } catch { /* corrupt local state — start fresh */ }
  }

  /** Another tab saved (or wiped) the log: take its copy, base included — see setup.ts. */
  function reloadLocal() {
    let s: any
    try { s = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null') } catch { return }
    apply(() => applyStored(s))
  }

  function saveLocal() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ entries: entries.value, updatedAt, ownerId, dirty, baseAt, baseStamp, base }))
    } catch { /* storage full or blocked — the push still carries the edit */ }
  }

  function adoptRemote(row: RemoteRow, userId: string) {
    const log = normalizeEntries<CatchEntry>(row.data)
    // See setup.ts: the row we already hold (a re-pull on focus) isn't re-applied.
    if (!(ownerId === userId && jsonEqual(log, entries.value))) apply(() => { entries.value = log })
    updatedAt = row.at
    ownerId = userId
    dirty = false
    setBase(row.stamp, row.at, log)
    saveLocal()
  }

  /** See setup.ts — merge with a row that moved on; 'done' when the result is the row itself. */
  function mergeRemote(row: RemoteRow, ancestor: CatchEntry[] | null, userId: string): 'push' | 'done' {
    const remote = normalizeEntries<CatchEntry>(row.data)
    const merged = mergeList(ancestor, entries.value, remote)
    if (jsonEqual(merged, remote)) { adoptRemote(row, userId); return 'done' }
    if (!jsonEqual(merged, entries.value)) {
      const next = clone(merged)
      apply(() => { entries.value = next })
    }
    ownerId = userId
    dirty = true
    setBase(row.stamp, row.at, remote)
    saveLocal()
    return 'push'
  }

  /** See setup.ts — reconcile with the account's row (null = none); 'push' when the result must be sent. */
  function reconcileWith(row: RemoteRow | null, userId: string): 'push' | 'done' {
    const verdict = decidePull({
      remote: !row ? 'none' : sameStamp(row.stamp, baseStamp) ? 'base' : 'moved',
      localEmpty: !entries.value.length,
      owner: ownerId === userId ? 'own' : ownerId === null ? 'guest' : 'foreign',
      dirty,
      hasBase: base !== null,
    })
    switch (verdict) {
      case 'ignore': return 'done'
      case 'claim':
        // No row yet: claim the guest log (persisted) — see setup.ts.
        ownerId = userId
        setBase(null, null, null)
        if (entries.value.length) dirty = true
        saveLocal()
        return entries.value.length ? 'push' : 'done'
      case 'take-remote': adoptRemote(row!, userId); return 'done'
      case 'none': return 'done'
      case 'push': return 'push'
      case 'merge': return mergeRemote(row!, base, userId)
      case 'union': return mergeRemote(row!, null, userId)
    }
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
    for (let i = 0; i < PUSH_ATTEMPTS; i++) {
      if (pushing) await pushing.catch(() => {}) // see setup.ts: decide after it lands
      const gen = baseGen
      const read = await readRow('catches', 'entries', userId)
      if (useAuthStore().user?.id !== userId) return // signed out / switched mid-pull — see setup.ts
      if (!read.ok) return // table missing, read blocked or offline — keep local, stay un-pulled
      if (pushing || gen !== baseGen) continue // a write moved the base mid-read — see setup.ts
      const next = reconcileWith(read.row, userId)
      pulled = true
      if (next === 'push') await pushRemote() // unsynced edits, a merge, or no row yet → send it up
      return
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
    // One push at a time, so an older one can't commit last — see setup.ts.
    if (pushing) {
      await pushing
      if (dirty) await pushRemote()
      return
    }
    const p: Promise<void> = sendPush(userId).finally(() => { if (pushing === p) pushing = null })
    pushing = p
    await p
  }

  let pushing: Promise<void> | null = null
  /** See setup.ts — a write conditional on the base; on a moved row: read, merge, retry (bounded). */
  async function sendPush(userId: string) {
    clearTimeout(pushTimer)
    editedWhileDisarmed = false
    syncing.value = true
    try {
      for (let attempt = 0; attempt < PUSH_ATTEMPTS; attempt++) {
        const seq = edits
        const gen = baseGen
        const sent = clone(entries.value)
        const res = await writeRow('catches', 'entries', userId, sent, baseStamp, nextStamp(baseAt))
        if (useAuthStore().user?.id !== userId) return
        // Table missing or offline — the local copy is still saved, and still dirty.
        if (res.status === 'error') { showToast('⚠️ ' + t('toast_sync_failed'), { type: 'error' }); return }
        if (res.status === 'ok') {
          if (gen !== baseGen) return
          setBase(res.stamp, res.at, sent)
          if (edits === seq) dirty = false
          saveLocal()
          return
        }
        const read = await readRow('catches', 'entries', userId)
        if (useAuthStore().user?.id !== userId) return
        if (!read.ok) { showToast('⚠️ ' + t('toast_sync_failed'), { type: 'error' }); return }
        if (reconcileWith(read.row, userId) !== 'push') return
      }
    } finally {
      syncing.value = false
    }
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
  // guard it would mark the wiped state as a fresh, unsynced edit.
  let clearing = false

  let pushTimer: ReturnType<typeof setTimeout> | undefined
  function schedulePush() {
    clearTimeout(pushTimer)
    pushTimer = setTimeout(pushRemote, 1500)
  }
  watch(entries, () => {
    if (clearing || applying) return
    // A genuine edit, marked even while disarmed (pull in flight) — see setup.ts.
    updatedAt = Date.now()
    edits++
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
    setBase(null, null, null)
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
    // Gone from under the edit form — a pull applied another device's delete
    // of an entry this device hadn't touched yet. Dropping the edit silently
    // is the one loss the merge never allows elsewhere: the edit wins.
    else entries.value.unshift({ ...patch, id })
  }
  function remove(id: string) {
    entries.value = entries.value.filter((e) => e.id !== id)
  }

  return {
    entries, sorted, syncing,
    loadLocal, reloadLocal, pullRemote, pushRemote, flush, markReady, pauseSync, clear, add, update, remove,
  }
})
