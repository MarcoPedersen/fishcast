import { defineStore } from 'pinia'
import { nextTick, ref, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'
import { lang, setLang, t } from '@/lib/i18n'
import { showToast } from '@/lib/toast'
import { decidePull } from '@/lib/sync'
import { jsonEqual, mergeDoc } from '@/lib/merge'
import { PUSH_ATTEMPTS, nextStamp, readRow, sameStamp, writeRow, type RemoteRow } from '@/lib/syncRow'
import { normalizeAvailability, normalizeLocations, normalizeSpecies } from '@/lib/normalize'
import type { Availability, Location } from '@/lib/types'

const LS_KEY = 'fc2-setup'
export const uid = () => Math.random().toString(36).slice(2, 10)

/** The synced setup document. Members this version doesn't know ride along untouched. */
interface SetupDoc {
  locations: Location[]
  targetSpecies: string[]
  availability: Availability[]
  lang?: unknown
  [member: string]: unknown
}
const KNOWN = ['locations', 'targetSpecies', 'availability', 'lang']
/** How mergeDoc treats each member; lang and unknown members are scalars. */
const SHAPE = { collections: ['locations', 'availability'], sets: ['targetSpecies'] }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
/** The members of a setup document this version doesn't know (a newer version's). */
const unknownMembers = (s: unknown): Record<string, unknown> =>
  isObj(s) ? Object.fromEntries(Object.entries(s).filter(([k]) => !KNOWN.includes(k))) : {}

/**
 * A stored or pulled document, repaired. Every load and adopt goes through
 * normalize: a document poisoned by an unvalidated share link (a window with
 * no `days`) blanked the whole app on every synced device, and fixing
 * share.ts alone wouldn't heal it.
 */
function normalizeDoc(s: any): SetupDoc {
  return {
    ...unknownMembers(s),
    locations: normalizeLocations(s?.locations),
    targetSpecies: normalizeSpecies(s?.targetSpecies),
    availability: normalizeAvailability(s?.availability),
    lang: s?.lang,
  }
}

export const useSetupStore = defineStore('setup', () => {
  const locations = ref<Location[]>([])
  const targetSpecies = ref<string[]>([])
  const availability = ref<Availability[]>([])
  const syncing = ref(false)
  // Wall-clock ms of the last genuine local edit (or of the row last adopted).
  // Informational only now: no sync decision compares wall clocks any more.
  let updatedAt = 0
  // Which account this local document belongs to (null = written while signed
  // out). Guest data must never be pushed over, or merged into, an account's row.
  let ownerId: string | null = null
  // True while this document holds an edit the account hasn't confirmed
  // receiving (push pending, failed, or made offline). Persisted, so logout can
  // tell "safe to wipe" from "this is the only copy" even after a restart.
  let dirty = false
  // A newer app version's document members, kept so its next read finds them.
  let extra: Record<string, unknown> = {}

  // The row version this document was last reconciled with — set by an
  // adopt, by a push that landed, and by a merge — and a copy of the document
  // AS OF that version: the common ancestor of a three-way merge. Without it
  // "the row changed too" looked exactly like "only I changed", and a phone's
  // ★ toggled offline on a Saturday copy pushed away the desktop's new spots.
  // `baseStamp` is updated_at exactly as the server sent it (a write is
  // conditional on it); null = never reconciled (guest data, or a document
  // saved by the previous app version). Persisted with the document.
  let baseAt: number | null = null
  let baseStamp: string | null = null
  let base: SetupDoc | null = null
  // Bumped whenever the base changes, so a pull or push that started before
  // can tell its answer is stale.
  let baseGen = 0
  // Counts genuine edits: a push only marks the document synced when no edit
  // arrived while it was in flight.
  let edits = 0

  // >0 while the store writes its OWN hydration (local load, adopted row,
  // another tab's copy). Released after the watcher has flushed, like
  // `clearing`. Without it the deep watcher stamped an adopted row as a fresh
  // edit and pushed it straight back. A counter, not a flag: a load and an
  // adopt in the same tick would otherwise release each other early.
  let applying = 0
  function apply(fn: () => void) {
    applying++
    try { fn() } finally { nextTick(() => { applying-- }) }
  }

  function currentDoc(): SetupDoc {
    return { ...extra, locations: locations.value, targetSpecies: targetSpecies.value, availability: availability.value, lang: lang.value }
  }

  function setBase(stamp: string | null, at: number | null, doc: SetupDoc | null) {
    baseStamp = stamp
    baseAt = at
    base = doc && clone(doc)
    baseGen++
  }

  function applyStored(s: any) {
    const doc = normalizeDoc(s)
    locations.value = doc.locations
    targetSpecies.value = doc.targetSpecies
    availability.value = doc.availability
    extra = isObj(s?.extra) ? s.extra : {}
    updatedAt = typeof s?.updatedAt === 'number' ? s.updatedAt : 0
    ownerId = typeof s?.ownerId === 'string' ? s.ownerId : null
    // A document saved before `dirty` existed can't say; assume it holds
    // something unsynced, so logout asks rather than wipes. The next
    // successful pull settles it either way.
    dirty = typeof s?.dirty === 'boolean' ? s.dirty : !!s
    // No base (or half of one): reconciled by a union merge on the next pull,
    // which can resurrect a deletion but never loses anything.
    const ok = typeof s?.baseAt === 'number' && isObj(s?.base)
    setBase(ok ? (typeof s.baseStamp === 'string' ? s.baseStamp : new Date(s.baseAt).toISOString()) : null, ok ? s.baseAt : null, ok ? normalizeDoc(s.base) : null)
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (!raw) return
      const s = JSON.parse(raw)
      apply(() => applyStored(s))
    } catch { /* corrupt local state — start fresh */ }
  }

  /**
   * Another tab saved (or wiped) the document: take its copy into memory —
   * its base too, so this tab's next push builds on the version that tab
   * wrote. With no `storage` listener the two tabs overwrote each other's
   * localStorage on every edit, each from its own stale in-memory copy.
   */
  function reloadLocal() {
    let s: any
    try { s = JSON.parse(localStorage.getItem(LS_KEY) ?? 'null') } catch { return }
    apply(() => {
      applyStored(s) // null = the other tab logged out and wiped it
      // That tab's language switch is part of this document too; without it
      // this tab's next edit pushed its old language back to the account.
      const l = localStorage.getItem('fc2-lang')
      if (l === 'da' || l === 'en') lang.value = l
    })
  }

  function saveLocal() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        locations: locations.value,
        targetSpecies: targetSpecies.value,
        availability: availability.value,
        extra,
        updatedAt,
        ownerId,
        dirty,
        baseAt,
        baseStamp,
        base,
      }))
    } catch { /* storage full or blocked — the push still carries the edit */ }
  }

  /** Put `doc` on screen as the store's own write (not an edit). */
  function show(doc: SetupDoc) {
    apply(() => {
      locations.value = doc.locations
      targetSpecies.value = doc.targetSpecies
      availability.value = doc.availability
      // setLang, not lang.value: fc2-lang is what the next cold start reads, so
      // without it every start showed the device's old language until the pull
      // landed — and the next push sent that stale language back.
      // Guarded like saveLocal: with storage full or blocked, its write threw
      // mid-adopt — rows swapped, but no stamp, owner or `pulled` — so every
      // push re-pulled, took the row as foreign over the edit, and threw again.
      if (doc.lang === 'da' || doc.lang === 'en') {
        try { setLang(doc.lang) } catch { lang.value = doc.lang }
      }
    })
    extra = unknownMembers(doc)
  }

  function adoptRemote(row: RemoteRow, userId: string) {
    const doc = normalizeDoc(row.data)
    // The row is the very version we already hold — the usual result of a
    // re-pull on focus. Swapping in fresh copies of the same data would
    // re-render every list and re-score every window for nothing.
    if (!(ownerId === userId && jsonEqual(doc, currentDoc()))) show(clone(doc))
    updatedAt = row.at
    ownerId = userId // this document is now the account's
    dirty = false
    setBase(row.stamp, row.at, doc)
    saveLocal()
  }

  /**
   * Both this document and the row changed since the base (or there is no
   * base): merge them, show the result, and leave it dirty for the push.
   * 'done' when the merge comes out as the row itself — nothing to send.
   */
  function mergeRemote(row: RemoteRow, ancestor: SetupDoc | null, userId: string): 'push' | 'done' {
    const remote = normalizeDoc(row.data)
    const local = currentDoc()
    const merged = mergeDoc(ancestor, local, remote, SHAPE) as SetupDoc
    if (jsonEqual(merged, remote)) { adoptRemote(row, userId); return 'done' }
    if (!jsonEqual(merged, local)) show(clone(merged))
    ownerId = userId
    dirty = true
    setBase(row.stamp, row.at, remote)
    saveLocal()
    return 'push'
  }

  /**
   * Bring the document in line with the account's row (null = no row), as
   * decidePull says. 'push' when what is now local has to be sent.
   */
  function reconcileWith(row: RemoteRow | null, userId: string): 'push' | 'done' {
    const verdict = decidePull({
      remote: !row ? 'none' : sameStamp(row.stamp, baseStamp) ? 'base' : 'moved',
      localEmpty: isEmpty(),
      owner: ownerId === userId ? 'own' : ownerId === null ? 'guest' : 'foreign',
      dirty,
      hasBase: base !== null,
    })
    switch (verdict) {
      case 'ignore': return 'done' // another account's leftovers: never pushed
      case 'claim':
        // The account has no row yet: this guest document (or the account's own,
        // whose first push never landed) becomes the account's — saved now, or
        // the next start still reads "guest" and discards it as foreign the
        // moment another device creates the row.
        ownerId = userId
        setBase(null, null, null) // no row to build on: the push creates it
        if (!isEmpty()) dirty = true // there is no row, so none of it is synced
        saveLocal()
        return isEmpty() ? 'done' : 'push'
      case 'take-remote': adoptRemote(row!, userId); return 'done'
      case 'none': return 'done'
      case 'push': return 'push'
      case 'merge': return mergeRemote(row!, base, userId)
      case 'union': return mergeRemote(row!, null, userId)
    }
  }

  // True once a pull has actually COMPLETED for the signed-in user. Until then
  // nothing local may be pushed: it hasn't been reconciled with the account's
  // row, so it could be guest data, a blank, or a stale copy.
  let pulled = false
  // One pull at a time per account: the retry a push triggers, a focus re-pull
  // and a hydration can otherwise overlap and each push the same document.
  let pulling: Promise<void> | null = null
  let pullingFor: string | null = null

  /**
   * Pull the account's setup and reconcile with it (adopt, push, or merge).
   * `quiet`: a background re-pull (focus, reconnect) fails without a toast —
   * on a flaky connection that would pop up on every app switch.
   */
  function pullRemote(opts: { quiet?: boolean } = {}): Promise<void> {
    const auth = useAuthStore()
    if (!supabase || !auth.user) return Promise.resolve()
    const userId = auth.user.id
    if (pulling && pullingFor === userId) return pulling
    pullingFor = userId
    const p: Promise<void> = doPull(userId, !!opts.quiet).finally(() => { if (pulling === p) pulling = null })
    pulling = p
    return p
  }

  async function doPull(userId: string, quiet: boolean) {
    for (let i = 0; i < PUSH_ATTEMPTS; i++) {
      // A push in flight is about to move the base; a row read before it
      // lands would be decided against the wrong version.
      if (pushing) await pushing.catch(() => {})
      const gen = baseGen
      const read = await readRow('setups', 'setup', userId)
      // Signed out, or into another account, while the request was in flight:
      // the row isn't for whoever is signed in now. Reading `auth.user.id` here
      // used to throw on a null user and leave sync disarmed for the session.
      if (useAuthStore().user?.id !== userId) return
      if (!read.ok) {
        // A failed read used to be indistinguishable from "no row": both left the
        // app showing an empty profile, with sync armed and nothing to warn you.
        if (!quiet) showToast('⚠️ ' + t('toast_sync_failed'), { type: 'error' })
        return
      }
      // A push started (or another tab's copy arrived) while this read was in
      // flight: the row may predate that write, and adopting it would show the
      // version just replaced. Read again once the push is done.
      if (pushing || gen !== baseGen) continue
      const next = reconcileWith(read.row, userId)
      pulled = true
      if (next === 'push') await pushRemote()
      return
    }
  }

  /** Push the current setup to the account's row, conditional on the base it was built on. */
  async function pushRemote() {
    const auth = useAuthStore()
    if (!supabase || !auth.user) return
    const userId = auth.user.id
    // Never send a document this session hasn't reconciled with the account's
    // row. A failed pull used to leave sync armed, and the first edit then
    // upserted whatever was local — 3 guest spots over 18 locations — with no
    // reconcile at all. Pull instead: its verdict pushes (unsynced edits, a
    // merge, or a claimed document on a new account) or adopts, so the
    // account's own offline edit still goes up, and returning here can't push
    // it twice.
    if (!pulled) { await pullRemote(); return }
    // After a successful pull the document is this account's in every case
    // but one — another account's leftovers where this account has no row —
    // and those must never reach it.
    if (ownerId !== userId) return
    // One push at a time. Two in flight could commit out of order — an
    // edit's push overtaking an earlier one stalled on a mobile link — and
    // leave the row on the OLDER document while the newer push had already
    // marked everything synced, so logout's flush() said "safe" and wiped the
    // only copy. Wait for it, then send whatever it didn't carry.
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
  async function sendPush(userId: string) {
    clearTimeout(pushTimer) // this push carries the latest state; a queued one would only repeat it
    editedWhileDisarmed = false
    syncing.value = true
    try {
      for (let attempt = 0; attempt < PUSH_ATTEMPTS; attempt++) {
        const seq = edits
        const gen = baseGen
        // The body leaves with the request as it is now; it is also the next base.
        const sent = clone(currentDoc())
        // Built on `baseStamp`: if another device (or an old app version's
        // blind upsert) wrote since, this touches nothing and says so.
        const res = await writeRow('setups', 'setup', userId, sent, baseStamp, nextStamp(baseAt))
        // Signed out mid-push: clear() has wiped this document — don't re-save it.
        if (useAuthStore().user?.id !== userId) return
        if (res.status === 'error') { showToast('⚠️ ' + t('toast_sync_failed'), { type: 'error' }); return }
        if (res.status === 'ok') {
          // Another tab's copy replaced this one meanwhile: it carries its own
          // base, and the next pull reconciles it with what this push wrote.
          if (gen !== baseGen) return
          setBase(res.stamp, res.at, sent)
          // An edit made during the push is still unsynced; its own push follows.
          if (edits === seq) dirty = false
          saveLocal()
          return
        }
        // The row moved under us: read it, merge, and try again on top of it.
        const read = await readRow('setups', 'setup', userId)
        if (useAuthStore().user?.id !== userId) return
        if (!read.ok) { showToast('⚠️ ' + t('toast_sync_failed'), { type: 'error' }); return }
        if (reconcileWith(read.row, userId) !== 'push') return
      }
      // Still moving after a few rounds: give up quietly, still dirty. The next
      // pull (focus, 'online', the periodic resync) merges and pushes again.
    } finally {
      syncing.value = false
    }
  }

  /**
   * Send whatever is still unsynced right now instead of after the debounce.
   * True when nothing unsynced is left — logout wipes this document, so false
   * means it holds the only copy of an edit. A push in flight is waited for
   * (pushRemote queues behind it) before that is decided.
   */
  async function flush(): Promise<boolean> {
    if (!dirty) return true
    clearTimeout(pushTimer)
    await pushRemote()
    return !dirty
  }

  // Guard: don't push to Supabase until the initial local load + remote pull
  // are done, otherwise the hydration writes can overwrite good remote data.
  let ready = false
  // An edit made while sync was disarmed is stamped and saved but not queued.
  let editedWhileDisarmed = false
  function markReady() {
    ready = true
    // …so arming sync sends it, unless the pull already did (a push or merge)
    // or failed (pushes wait for a successful one: focus, 'online', next edit).
    if (editedWhileDisarmed && dirty && pulled) schedulePush()
    editedWhileDisarmed = false
  }
  /**
   * Disarm sync while (re)hydrating an account. Signing in mid-session used to
   * leave `ready` true over empty local state, so the first edit afterwards
   * pushed that blank over the real remote row.
   */
  function pauseSync() {
    ready = false
    pulled = false // a different account may be signing in
    clearTimeout(pushTimer)
  }

  // True while clear() is wiping state. The deep watcher fires asynchronously
  // *after* clear() returns, so without this it would stamp the empty state as
  // a fresh, unsynced edit and re-save it — which, under last-write-wins, then
  // beat real remote data on the next login and destroyed it.
  let clearing = false

  let pushTimer: ReturnType<typeof setTimeout> | undefined
  function schedulePush() {
    clearTimeout(pushTimer)
    pushTimer = setTimeout(pushRemote, 1500) // debounce remote sync
  }
  // `lang` is watched too: the push sends it and an adopt applies it, so
  // leaving it out meant a language switch was never marked unsynced and never
  // pushed — and the next pull reset the language to whatever the row held.
  watch([locations, targetSpecies, availability, lang], () => {
    if (clearing || applying) return
    // Anything else is a genuine edit — marked even while sync is disarmed.
    // An edit made during the hydration pull used to be left unmarked, so
    // the pull silently reverted it.
    updatedAt = Date.now()
    edits++
    dirty = true
    saveLocal()
    if (!ready) { editedWhileDisarmed = true; return }
    // Locations added from search or the map arrive with no species data, so
    // they'd score below an equivalent official spot until the next app start
    // (bootstrap used to be the only caller). Idempotent per location, so this
    // costs a filter on every other edit; its own write reschedules the push.
    enrichMissingSpecies()
    schedulePush()
  }, { deep: true })

  const hasSetup = () => locations.value.length > 0 && availability.value.length > 0

  // Reset target species + time slots, keep locations
  function resetChoices() {
    targetSpecies.value = []
    availability.value = []
  }

  /** Wipe local state (sign-out): cancel pending sync, clear memory + storage. */
  function clear() {
    clearing = true
    clearTimeout(pushTimer)
    locations.value = []
    targetSpecies.value = []
    availability.value = []
    extra = {}
    updatedAt = 0
    ownerId = null
    dirty = false
    setBase(null, null, null)
    editedWhileDisarmed = false
    pulled = false
    enrichAttempted.clear() // next account's locations must be looked up afresh
    localStorage.removeItem(LS_KEY)
    // Release after the watcher has flushed, so it skips this wipe entirely.
    nextTick(() => { clearing = false })
  }

  /** No real content — a wipe or fresh install, not an intentional deletion. */
  const isEmpty = () =>
    !locations.value.length && !targetSpecies.value.length && !availability.value.length

  // Locations we've already looked up this session. Some spots genuinely have no
  // official spot within range, so without this a permanently-empty location
  // would re-trigger the lookup on every single edit.
  const enrichAttempted = new Set<string>()

  /**
   * Backfill species data on locations that lack it (spots added from search or
   * the map, or imported from a shared setup). Without it they can't earn the
   * spot-relevance bonus and score up to 12 points below an official spot in
   * the same place. Dynamic import so the spot dataset stays out of startup.
   */
  async function enrichMissingSpecies() {
    const missing = locations.value.filter((l) => !l.species?.length && !enrichAttempted.has(l.id))
    if (!missing.length) return 0
    const { speciesFromNearby } = await import('@/lib/geo')
    let changed = 0
    for (const l of missing) {
      enrichAttempted.add(l.id)
      const species = speciesFromNearby(l.lat, l.lon)
      if (species.length) { l.species = species; changed++ }
    }
    return changed
  }

  return {
    locations, targetSpecies, availability, syncing,
    loadLocal, reloadLocal, pullRemote, pushRemote, flush, hasSetup, resetChoices,
    markReady, pauseSync, clear, enrichMissingSpecies,
  }
})
