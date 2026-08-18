import { defineStore } from 'pinia'
import { nextTick, ref, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'
import { lang, t } from '@/lib/i18n'
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

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (!raw) return
      const s = JSON.parse(raw)
      locations.value = s.locations ?? []
      targetSpecies.value = s.targetSpecies ?? []
      availability.value = s.availability ?? []
      updatedAt = s.updatedAt ?? 0
    } catch { /* corrupt local state — start fresh */ }
  }

  function saveLocal() {
    localStorage.setItem(LS_KEY, JSON.stringify({
      locations: locations.value,
      targetSpecies: targetSpecies.value,
      availability: availability.value,
      updatedAt,
    }))
  }

  function adoptRemote(s: any, remoteAt: number) {
    locations.value = s.locations ?? []
    targetSpecies.value = s.targetSpecies ?? []
    availability.value = s.availability ?? []
    if (s.lang) lang.value = s.lang
    updatedAt = remoteAt
    saveLocal()
  }

  // True once a pull has actually COMPLETED for the signed-in user. Until then a
  // push must never send empty local state: the remote row is the only copy, and
  // overwriting it with a never-hydrated blank wipes the account.
  let pulled = false

  /** Pull the setup for the logged-in user, keeping whichever side is newer. */
  async function pullRemote() {
    const auth = useAuthStore()
    if (!supabase || !auth.user) return
    const { data, error } = await supabase
      .from('setups')
      .select('setup, updated_at')
      .eq('user_id', auth.user.id)
      .maybeSingle()
    if (error) {
      // A failed read used to be indistinguishable from "no row": both left the
      // app showing an empty profile, with sync armed and nothing to warn you.
      showToast('⚠️ ' + t('toast_sync_failed'), { type: 'error' })
      return
    }
    pulled = true
    const remoteAt = data?.updated_at ? Date.parse(data.updated_at) : 0
    const verdict = reconcile(updatedAt, { data: data?.setup ?? null, updatedAt: remoteAt }, isEmpty())
    if (verdict === 'take-remote') adoptRemote(data!.setup, remoteAt)
    else if (verdict === 'keep-local') pushRemote() // local has newer edits → reconcile up
  }

  /** Push the current setup to Supabase (upsert keyed by user). */
  async function pushRemote() {
    const auth = useAuthStore()
    if (!supabase || !auth.user) return
    // Refuse to overwrite the account with state we never hydrated. Someone who
    // genuinely deleted everything has pulled first, so `pulled` is true for them.
    if (!pulled && isEmpty()) return
    syncing.value = true
    const { error } = await supabase.from('setups').upsert({
      user_id: auth.user.id,
      setup: {
        locations: locations.value,
        targetSpecies: targetSpecies.value,
        availability: availability.value,
        lang: lang.value,
      },
      // Send the local edit time (not server now) so pull comparisons are
      // wall-clock-vs-wall-clock rather than mixing a server clock in.
      updated_at: new Date(updatedAt || Date.now()).toISOString(),
    })
    if (error) showToast('⚠️ ' + t('toast_sync_failed'), { type: 'error' })
    syncing.value = false
  }

  // Guard: don't push to Supabase until the initial local load + remote pull
  // are done, otherwise the hydration writes can overwrite good remote data.
  let ready = false
  function markReady() { ready = true }
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
  // `lang` is watched too: pushRemote() sends it and adoptRemote() applies it,
  // so leaving it out meant a language switch never bumped updatedAt and never
  // pushed — then the next pull won on timestamp and reset the language back to
  // whatever the remote still held.
  watch([locations, targetSpecies, availability, lang], () => {
    if (clearing) return
    if (ready) updatedAt = Date.now() // genuine edit (not hydration) → stamp it
    saveLocal()
    if (!ready) return
    // Locations added from search or the map arrive with no species data, so
    // they'd score below an equivalent official spot until the next app start
    // (bootstrap used to be the only caller). Idempotent per location, so this
    // costs a filter on every other edit; its own write reschedules the push.
    enrichMissingSpecies()
    clearTimeout(pushTimer)
    pushTimer = setTimeout(pushRemote, 1500) // debounce remote sync
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
    loadLocal, pullRemote, pushRemote, hasSetup, resetChoices, markReady, pauseSync, clear,
    enrichMissingSpecies,
  }
})
