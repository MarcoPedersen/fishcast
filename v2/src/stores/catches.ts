import { defineStore } from 'pinia'
import { nextTick, ref, computed, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'
import { showToast } from '@/lib/toast'
import { t } from '@/lib/i18n'
import { keepAside, readAside, removeStored } from '@/lib/safeStorage'
import { decidePull } from '@/lib/sync'
import { fingerprint, jsonEqual, mergeList, mergeRecord, notIn } from '@/lib/merge'
import { PUSH_ATTEMPTS, nextStamp, readRow, rememberSent, sameStamp, stampIso, storedSent, writeRow, type RemoteRow, type SentWrite } from '@/lib/syncRow'
import { normalizeEntries } from '@/lib/normalize'
import type { CatchEntry } from '@/lib/types'

const LS_KEY = 'fc2-catches'
/** Where an older version's entries the account lacks are kept on the device (see `legacy`). */
const LEGACY_KEY = 'fc2-catches-legacy'
export const uid = () => Math.random().toString(36).slice(2, 10)
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const idsOf = (list: readonly CatchEntry[]) => new Set(list.map((e) => e.id).filter((id) => typeof id === 'string'))
/** A catch's place is one choice — merged whole, never name from one device and link from the other. */
export const CATCH_PLACE = [['locationName', 'locationId']] as const
/**
 * An entry's when is one choice too: the phone moving the start while the
 * desktop moved the end must not merge into a span nobody chose (a trip
 * 05:00–11:00 out of 05:00–09:00 and 07:00–11:00), nor the phone's new day
 * with the desktop's new hours — scored from archived weather for a day
 * nobody fished, and wide enough to swallow a catch logged that morning. A
 * catch's date and time are one moment the same way. Taken whole from one side.
 */
export const CATCH_WHEN = ['date', 'time', 'from', 'to'] as const
/** Every field group of a log entry, for both merges (sync and the edit form). */
const ENTRY_GROUPS = [...CATCH_PLACE, CATCH_WHEN]

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
  // See setup.ts — `dirty` is a guess for a log saved before the flag existed.
  let dirtyGuessed = false
  // See setup.ts — the row version this log was last reconciled with, and the
  // log as of that version (the merge's common ancestor). Without it a phone's
  // offline catch on a Saturday copy pushed its 6 entries over the 8 the
  // desktop had saved that evening. Persisted; null = never reconciled.
  let baseAt: number | null = null
  let baseStamp: string | null = null
  let base: CatchEntry[] | null = null
  let baseGen = 0
  let edits = 0
  // See setup.ts — writes sent on this base whose answer never came back.
  // Persisted; recorded before each request leaves.
  let unanswered: SentWrite[] = []
  // The entries of a log saved before the log named its account. Builds from
  // 19 Jun to 19 Aug 2026 synced it but stored no `ownerId`, signed in or
  // not, so such a log may be a guest's, the account's own as it stood before
  // another device deleted a catch, or another account's. Joined to the
  // account on sign-in like a guest's, the deleted catch came back on every
  // device. They never join by themselves: see setAsideLegacy. Persisted;
  // what is logged after them is a guest's as usual.
  let legacy = new Set<string>()

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
  // An empty trip has no time: it sorts by when it started.
  const when = (e: CatchEntry) => `${e.date} ${e.time ?? e.from ?? ''}`
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
    unanswered = [] // built on the base just left behind: none of them can land now
  }

  function applyStored(s: any) {
    // Back-compat: old format stored the bare array (no stamp, no owner, no base).
    if (Array.isArray(s)) {
      entries.value = normalizeEntries(s)
      updatedAt = 0
      ownerId = null
      dirty = true
      dirtyGuessed = false // no account named: whose log it is decides, not this flag
      legacy = idsOf(entries.value)
      setBase(null, null, null)
      return
    }
    entries.value = normalizeEntries(s?.entries)
    updatedAt = typeof s?.updatedAt === 'number' ? s.updatedAt : 0
    ownerId = typeof s?.ownerId === 'string' ? s.ownerId : null
    // No `ownerId` key at all (a guest's is null): saved before the log named its account.
    legacy = typeof s === 'object' && s !== null && !('ownerId' in s)
      ? idsOf(entries.value)
      : new Set(Array.isArray(s?.legacy) ? s.legacy.filter((id: unknown) => typeof id === 'string') : [])
    // See setup.ts: a log saved before `dirty` existed is assumed unsynced —
    // for logout; the first pull decides it as that build would have.
    dirty = typeof s?.dirty === 'boolean' ? s.dirty : !!s
    dirtyGuessed = !!s && typeof s.dirty !== 'boolean'
    // See setup.ts: no base → a union merge on the next pull.
    const ok = typeof s?.baseAt === 'number' && Array.isArray(s?.base)
    setBase(ok ? (typeof s.baseStamp === 'string' ? s.baseStamp : new Date(s.baseAt).toISOString()) : null, ok ? s.baseAt : null, ok ? normalizeEntries(s.base) : null)
    unanswered = storedSent(s?.unanswered)
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
      localStorage.setItem(LS_KEY, JSON.stringify({ entries: entries.value, updatedAt, ownerId, dirty: dirtyGuessed ? undefined : dirty, baseAt, baseStamp, base, unanswered, legacy: legacy.size ? [...legacy] : undefined }))
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
    // See setup.ts: with no base, the newer side wins where both hold a field.
    const merged = mergeList(ancestor, entries.value, remote, { groups: ENTRY_GROUPS, prefer: updatedAt > row.at ? 'local' : 'remote' })
    if (jsonEqual(merged, remote)) { adoptRemote(row, userId); return 'done' }
    const combined = !jsonEqual(merged, entries.value)
    if (combined) {
      const next = clone(merged)
      apply(() => { entries.value = next })
    }
    ownerId = userId
    dirty = true
    setBase(row.stamp, row.at, remote)
    saveLocal()
    if (combined) showToast('⟳ ' + t('toast_sync_merged'), { type: 'info' }) // see setup.ts
    return 'push'
  }

  /**
   * A guest log joins the account's row (decidePull 'join'): the entries of
   * `guest` (its own — not an older version's, see `legacy`) the row lacks
   * are added to it, and an entry both hold — told apart by id, as
   * the merges do — stays as the row has it. The log is then the account's,
   * built on the row, so the push that follows is conditional on it. Said
   * once: the list just grew under the user's hands, on purpose.
   */
  function joinGuest(row: RemoteRow, userId: string, guest: CatchEntry[]): 'push' | 'done' {
    const remote = normalizeEntries<CatchEntry>(row.data)
    const added = notIn(remote, guest)
    if (!added.length) { adoptRemote(row, userId); return 'done' }
    const next = clone([...added, ...remote])
    apply(() => { entries.value = next })
    ownerId = userId
    dirty = true
    setBase(row.stamp, row.at, remote)
    saveLocal()
    const n = added.length
    showToast('📒 ' + (n === 1 ? t('toast_guest_log_one') : t('toast_guest_log_many').replace('{n}', String(n))), { type: 'info' })
    return 'push'
  }

  /**
   * An older version's entries (`legacy`) the account's row doesn't hold are
   * kept aside on the device, and the user is asked whether to add them —
   * never added by themselves: they may be catches deleted on another device
   * since, or another account's. Taking the row over them silently, as
   * sign-in once did, lost them if they were the user's own.
   */
  function setAsideLegacy(row: RemoteRow, userId: string) {
    const lacking = notIn(normalizeEntries<CatchEntry>(row.data), entries.value.filter((e) => legacy.has(e.id)))
    legacy = new Set()
    if (!lacking.length) return
    keepAside(LEGACY_KEY, lacking)
    const n = lacking.length
    showToast('📒 ' + (n === 1 ? t('toast_legacy_log_one') : t('toast_legacy_log_many').replace('{n}', String(n))), {
      type: 'info',
      action: { label: t('toast_legacy_log_add'), run: () => restoreLegacy(userId) },
    })
  }

  /** The user said yes: what setAsideLegacy kept is added to the log, as an edit — so it syncs. */
  /**
   * The entries that are, or on this sign-in become, `userId`'s: the log once
   * it is the account's; a guest's own before they join it — not an older
   * version's (see `legacy`); nothing of another account's. (stores/setup.ts
   * keeps the spots they were logged at.)
   */
  function entriesFor(userId: string): CatchEntry[] {
    if (ownerId === userId) return entries.value
    return ownerId === null ? entries.value.filter((e) => !legacy.has(e.id)) : []
  }

  function restoreLegacy(userId: string) {
    if (ownerId !== userId) return // signed out, or into another account, since
    const missing = notIn(entries.value, normalizeEntries<CatchEntry>(readAside(LEGACY_KEY)))
    removeStored(LEGACY_KEY)
    if (missing.length) entries.value = [...clone(missing), ...entries.value]
  }

  /** See setup.ts — reconcile with the account's row (null = none); 'push' when the result must be sent. */
  function reconcileWith(row: RemoteRow | null, userId: string): 'push' | 'done' {
    // See setup.ts: a guessed `dirty` unioned a stale log from the build before
    // the flag with the row — the deleted catch came back, the desktop's
    // correction was reverted. Decide as that build did: unsynced = an edit
    // stamp past the row's.
    if (dirtyGuessed && row && base === null) dirty = updatedAt > row.at
    dirtyGuessed = false
    // See setup.ts: the row is this device's own write whose answer was lost.
    if (row && ownerId === userId && unanswered.length) {
      const log = normalizeEntries<CatchEntry>(row.data)
      const sum = fingerprint(log)
      if (unanswered.some((w) => sameStamp(w.stamp, row.stamp) && w.sum === sum)) {
        setBase(row.stamp, row.at, log)
        dirty = !jsonEqual(entries.value, log)
        saveLocal()
      }
    }
    // A guest's own entries join the row; an older version's don't (see `legacy`).
    const guest = entries.value.filter((e) => !legacy.has(e.id))
    const verdict = decidePull({
      remote: !row ? 'none' : sameStamp(row.stamp, baseStamp) ? 'base' : 'moved',
      localEmpty: !entries.value.length,
      owner: ownerId === userId ? 'own' : ownerId === null ? 'guest' : 'foreign',
      dirty,
      hasBase: base !== null,
      guest: guest.length ? 'join' : 'replace', // the log holds only the user's own catches — see sync.ts
    })
    if (row && ownerId === null) setAsideLegacy(row, userId)
    switch (verdict) {
      case 'ignore': return 'done'
      case 'claim':
        // No row yet: claim the guest log (persisted) — see setup.ts.
        ownerId = userId
        legacy = new Set() // with no row to tell, an older version's log becomes the account's, as before
        setBase(null, null, null)
        if (entries.value.length) dirty = true
        saveLocal()
        return entries.value.length ? 'push' : 'done'
      case 'take-remote': adoptRemote(row!, userId); return 'done'
      case 'none': return 'done'
      case 'push': return 'push'
      case 'merge': return mergeRemote(row!, base, userId)
      case 'union': return mergeRemote(row!, null, userId)
      case 'join': return joinGuest(row!, userId, guest)
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
        const builtOn = baseStamp
        const sent = clone(entries.value)
        // On record before it leaves — see setup.ts.
        const at = nextStamp(baseAt)
        const mine = { stamp: stampIso(at), sum: fingerprint(normalizeEntries(sent)) }
        unanswered = rememberSent(unanswered, mine)
        saveLocal()
        const res = await writeRow('catches', 'entries', userId, sent, builtOn, at)
        if (useAuthStore().user?.id !== userId) return
        // Table missing or offline — the local copy is still saved, and still
        // dirty. (Or it landed and the answer was lost: `unanswered` says so.)
        if (res.status === 'error') { showToast('⚠️ ' + t('toast_sync_failed'), { type: 'error' }); return }
        if (res.status === 'moved') unanswered = unanswered.filter((w) => w.stamp !== mine.stamp) // answered: not written
        if (res.status === 'ok') {
          if (gen !== baseGen) {
            // Another tab's copy replaced this one — still on the base this
            // write replaced: the write is its base now (see setup.ts).
            if (sameStamp(baseStamp, builtOn)) {
              setBase(res.stamp, res.at, sent)
              dirty = !jsonEqual(entries.value, sent)
              saveLocal()
            }
            return
          }
          setBase(res.stamp, res.at, sent)
          if (edits === seq) dirty = false
          saveLocal()
          return
        }
        const read = await readRow('catches', 'entries', userId)
        if (useAuthStore().user?.id !== userId) return
        if (!read.ok) { showToast('⚠️ ' + t('toast_sync_failed'), { type: 'error' }); return }
        // Refused, not beaten: the row hasn't moved off this write's base — see setup.ts.
        if (read.row && sameStamp(read.row.stamp, builtOn)) { showToast('⚠️ ' + t('toast_sync_failed'), { type: 'error' }); return }
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
    dirtyGuessed = false
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
    dirtyGuessed = false
    legacy = new Set()
    setBase(null, null, null)
    editedWhileDisarmed = false
    pulled = false
    removeStored(LS_KEY) // guarded — see setup.ts
    nextTick(() => { clearing = false })
  }

  function add(entry: Omit<CatchEntry, 'id'>) {
    entries.value.unshift({ ...entry, id: uid() })
  }
  /**
   * Save an edit. `opened` is the entry as the edit form copied it when it
   * opened: the form sends every field it shows, and replacing the entry with
   * that wrote its stale copies over whatever a pull had brought in meanwhile
   * — the phone's note on this very catch, gone when the desktop saved only a
   * length; the merge couldn't help, the old note arrived as a fresh local
   * edit. So the form's changes are merged onto the entry as it is now, field
   * by field against `opened`: what the form changed wins, what it left alone
   * stays as the entry has it. Either way fields the form doesn't know (a
   * newer version's) are kept — they used to be dropped by every edit.
   */
  function update(id: string, patch: Omit<CatchEntry, 'id'>, opened?: CatchEntry) {
    const i = entries.value.findIndex((e) => e.id === id)
    const edited = { ...opened, ...patch, id }
    if (i !== -1) {
      const now = entries.value[i]
      entries.value[i] = opened ? mergeRecord<CatchEntry>(opened, edited, now, ENTRY_GROUPS) : { ...now, ...patch, id }
    }
    // Gone from under the edit form — a pull applied another device's delete
    // of an entry this device hadn't touched yet. Dropping the edit silently
    // is the one loss the merge never allows elsewhere: the edit wins.
    else entries.value.unshift(edited)
  }
  function remove(id: string) {
    entries.value = entries.value.filter((e) => e.id !== id)
  }

  return {
    entries, sorted, syncing,
    loadLocal, reloadLocal, pullRemote, pushRemote, flush, markReady, pauseSync, clear, add, update, remove, entriesFor,
  }
})
