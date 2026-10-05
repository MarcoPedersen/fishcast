import { defineStore } from 'pinia'
import { nextTick, ref, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'
import { lang, setLang, t } from '@/lib/i18n'
import { showToast } from '@/lib/toast'
import { reconcile } from '@/lib/sync'
import type { Availability, Location } from '@/lib/types'

const LS_KEY = 'fc2-setup'
export const uid = () => Math.random().toString(36).slice(2, 10)

export const useSetupStore = defineStore('setup', () => {
  const locations = ref<Location[]>([])
  const targetSpecies = ref<string[]>([])
  const availability = ref<Availability[]>([])
  const syncing = ref(false)
  // Wall-clock ms of the last genuine local edit — drives last-write-wins sync.
  let updatedAt = 0
  // Which account this local document belongs to (null = written while signed
  // out). Guest data must not beat an account's own row on a timestamp compare.
  let ownerId: string | null = null
  // True while this document holds an edit the account hasn't confirmed
  // receiving (push pending, failed, or made offline). Persisted, so logout can
  // tell "safe to wipe" from "this is the only copy" even after a restart.
  let dirty = false

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

  function applyStored(s: any) {
    locations.value = s?.locations ?? []
    targetSpecies.value = s?.targetSpecies ?? []
    availability.value = s?.availability ?? []
    updatedAt = typeof s?.updatedAt === 'number' ? s.updatedAt : 0
    ownerId = typeof s?.ownerId === 'string' ? s.ownerId : null
    // A document saved before `dirty` existed can't say; assume it holds
    // something unsynced, so logout asks rather than wipes. The next
    // successful pull settles it either way.
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

  /**
   * Another tab saved (or wiped) the document: take its copy into memory. With
   * no `storage` listener the two tabs overwrote each other's localStorage on
   * every edit, each from its own stale in-memory copy.
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
        updatedAt,
        ownerId,
        dirty,
      }))
    } catch { /* storage full or blocked — the push still carries the edit */ }
  }

  function adoptRemote(s: any, remoteAt: number, userId: string) {
    // The row is the very version we already hold — the usual result of a
    // re-pull on focus. Swapping in fresh copies of the same data would
    // re-render every list and re-score every window for nothing.
    const same = remoteAt > 0 && remoteAt === updatedAt && ownerId === userId
    apply(() => {
      if (!same) {
        locations.value = s?.locations ?? []
        targetSpecies.value = s?.targetSpecies ?? []
        availability.value = s?.availability ?? []
      }
      // setLang, not lang.value: fc2-lang is what the next cold start reads, so
      // without it every start showed the device's old language until the pull
      // landed — and a keep-local push sent that stale language back.
      if (s?.lang === 'da' || s?.lang === 'en') setLang(s.lang)
    })
    updatedAt = remoteAt
    ownerId = userId // this document is now the account's
    dirty = false
    saveLocal()
  }

  // True once a pull has actually COMPLETED for the signed-in user. Until then
  // nothing local may be pushed: it hasn't been reconciled with the account's
  // row, so it could be guest data, a blank, or a stale copy.
  let pulled = false
  // One pull at a time per account: the retry a push triggers, a focus re-pull
  // and a hydration can otherwise overlap and each push the same document.
  let pulling: Promise<void> | null = null
  let pullingFor: string | null = null

  /** Pull the setup for the logged-in user, keeping whichever side is newer. */
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
        .from('setups')
        .select('setup, updated_at')
        .eq('user_id', userId)
        .maybeSingle())
    } catch (e) { error = e }
    // Signed out, or into another account, while the request was in flight:
    // the row isn't for whoever is signed in now. Reading `auth.user.id` here
    // used to throw on a null user and leave sync disarmed for the session.
    if (useAuthStore().user?.id !== userId) return
    if (error) {
      // A failed read used to be indistinguishable from "no row": both left the
      // app showing an empty profile, with sync armed and nothing to warn you.
      showToast('⚠️ ' + t('toast_sync_failed'), { type: 'error' })
      return
    }
    const remoteAt = data?.updated_at ? Date.parse(data.updated_at) : 0
    const verdict = reconcile(
      updatedAt,
      { data: data?.setup ?? null, updatedAt: remoteAt },
      isEmpty(),
      ownerId !== userId, // guest / other-account data can't outrank the row
    )
    if (verdict === 'take-remote') adoptRemote(data!.setup, remoteAt, userId)
    else if (verdict === 'noop' && (ownerId === null || ownerId === userId)) {
      // The account has no row yet: this guest document (or the account's own,
      // whose first push never landed) becomes the account's — saved now, or
      // the next start still reads "guest" and discards it as foreign the
      // moment another device creates the row. Another account's leftovers
      // are left alone and never pushed.
      ownerId = userId
      if (!isEmpty()) dirty = true // there is no row, so none of it is synced
      saveLocal()
    }
    pulled = true
    // keep-local: this account's own newer work (offline edits) → send it up.
    // A claimed document on an account with no row → create the row from it.
    if (verdict === 'keep-local' || (verdict === 'noop' && ownerId === userId && !isEmpty())) {
      await pushRemote()
    }
  }

  /** Push the current setup to Supabase (upsert keyed by user). */
  async function pushRemote() {
    const auth = useAuthStore()
    if (!supabase || !auth.user) return
    const userId = auth.user.id
    // Never send a document this session hasn't reconciled with the account's
    // row. A failed pull used to leave sync armed, and the first edit then
    // upserted whatever was local — 3 guest spots over 18 locations — with no
    // reconcile at all. Pull instead: its verdict pushes (keep-local, or a
    // claimed document on a new account) or adopts, so the account's own
    // offline edit still goes up, and returning here can't push it twice.
    if (!pulled) { await pullRemote(); return }
    // After a successful pull the document is this account's in every case
    // but one — another account's leftovers where this account has no row —
    // and those must never reach it.
    if (ownerId !== userId) return
    clearTimeout(pushTimer) // this push carries the latest state; a queued one would only repeat it
    editedWhileDisarmed = false
    const stamp = updatedAt
    syncing.value = true
    let error: unknown = null
    try {
      ;({ error } = await supabase.from('setups').upsert({
        user_id: userId,
        setup: {
          locations: locations.value,
          targetSpecies: targetSpecies.value,
          availability: availability.value,
          lang: lang.value,
        },
        // Send the local edit time (not server now) so pull comparisons are
        // wall-clock-vs-wall-clock rather than mixing a server clock in.
        updated_at: new Date(updatedAt || Date.now()).toISOString(),
      }))
    } catch (e) { error = e }
    syncing.value = false
    if (error) { showToast('⚠️ ' + t('toast_sync_failed'), { type: 'error' }); return }
    // Signed out mid-push: clear() has wiped this document — don't re-save it.
    if (useAuthStore().user?.id !== userId) return
    // An edit made during the push is still unsynced; its own push follows.
    if (updatedAt === stamp) { dirty = false; saveLocal() }
  }

  /**
   * Send whatever is still unsynced right now instead of after the debounce.
   * True when nothing unsynced is left — logout wipes this document, so false
   * means it holds the only copy of an edit.
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
    // …so arming sync sends it, unless the pull already did (keep-local) or
    // failed (pushes wait for a successful one: focus, 'online', next edit).
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
  // *after* clear() returns, so without this it would stamp a fresh updatedAt
  // onto the empty state and re-save it — making the wipe look like the newest
  // edit, which then beat real remote data on the next login and destroyed it.
  let clearing = false

  let pushTimer: ReturnType<typeof setTimeout> | undefined
  function schedulePush() {
    clearTimeout(pushTimer)
    pushTimer = setTimeout(pushRemote, 1500) // debounce remote sync
  }
  // `lang` is watched too: pushRemote() sends it and adoptRemote() applies it,
  // so leaving it out meant a language switch never bumped updatedAt and never
  // pushed — then the next pull won on timestamp and reset the language back to
  // whatever the remote still held.
  watch([locations, targetSpecies, availability, lang], () => {
    if (clearing || applying) return
    // Anything else is a genuine edit — stamped even while sync is disarmed.
    // An edit made during the hydration pull used to keep the old stamp, so
    // the pull's tie went to the remote and silently reverted it.
    updatedAt = Date.now()
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
    updatedAt = 0
    ownerId = null
    dirty = false
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
