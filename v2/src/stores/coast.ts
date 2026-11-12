/**
 * The automatic coast of each saved spot, per device (onshore spec §1.3–1.4).
 *
 * Results live in localStorage `fc2-coast`, never in the synced setup:
 * writing them there on load would be an edit, stamped, saved and pushed on
 * every device after every update. Each device derives its own — same
 * algorithm, same map data, so the same answer.
 *
 * Order per spot: the official catalogue (spotCoast.gen.ts, a lazy chunk; by
 * slug, else the official spot within 30 m of its pin or of a former one —
 * startFromSpot drops spotSlug, and a copy keeps the pin it was saved at:
 * spots.catalogueSpotAt),
 * then the worker (coastClient.ts → VersaTiles tiles). A failure is recorded
 * with a backoff, and the score leaves the factor out meanwhile.
 */
import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowRef, watch, type ShallowRef } from 'vue'
import {
  COAST_ALGO_VERSION, angDist, coordKey, isCoastAuto, isCoastOverride, isTransient, resolveShore,
  type CoastAuto, type CoastCacheEntry, type CoastFailure, type ShoreMap,
} from '@/lib/coast'
import { deriveCoast, terminate } from '@/lib/coastClient'
import type { Location } from '@/lib/types'
import { useSetupStore } from './setup'

const KEY = 'fc2-coast'
const MAX_ENTRIES = 120
const DEBOUNCE_MS = 1500
/** The first run after boot waits this much more, so the forecast batch goes first. */
const BOOT_DELAY_MS = 3000
/** Results land in the store at most this often while the queue runs (critique suggestion 2): each landing re-scores every view. */
const LAND_EVERY_MS = 5000
/** A failure is retried after 1 h, 6 h, then 24 h. */
const BACKOFF_MS = [3600_000, 6 * 3600_000, 24 * 3600_000]
/**
 * A failure on the way to the tiles (CoastFailure.net) waits this long, and
 * no more each time: it says nothing about VersaTiles. Short, as a weak
 * signal that never goes offline fires no 'online'; not none, as each start
 * would otherwise ask a server that is timing out again. Only ensure() and
 * 'online' run the queue, so this is "at the next start after 10 min".
 */
const NET_RETRY_MS = 10 * 60_000

/** Read afresh each time: the connection can drop in the middle of a run. */
const offline = () => globalThis.navigator?.onLine === false

const timeOf = (e: CoastCacheEntry) => (isCoastAuto(e) ? e.at : e.failedAt)

/**
 * Of this tab's entry and another tab's, the newer; `mine` on a tie. A tie is
 * the same derivation, and "Ser rigtigt ud" from either side is kept:
 * confirm() doesn't change `at`, so the other tab never took the confirmed
 * copy, and its next save overwrote it — the prompt came back on reload.
 */
function newerOf(mine: CoastCacheEntry, theirs: CoastCacheEntry): CoastCacheEntry {
  const tm = timeOf(mine), tt = timeOf(theirs)
  if (tm !== tt) return tm > tt ? mine : theirs
  return isCoastAuto(mine) && isCoastAuto(theirs) && theirs.ok && !mine.ok ? markRaw({ ...mine, ok: true as const }) : mine
}
const isFailure = (e: unknown): e is CoastFailure =>
  typeof e === 'object' && e !== null && typeof (e as CoastFailure).failedAt === 'number' && typeof (e as CoastFailure).tries === 'number'

/** fc2-coast as stored, entries checked one by one: a corrupt entry is dropped, not the file. */
function readStored(): Record<string, CoastCacheEntry> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    const out: Record<string, CoastCacheEntry> = {}
    if (raw && typeof raw.entries === 'object') {
      for (const [k, e] of Object.entries(raw.entries as Record<string, unknown>)) {
        if (isCoastAuto(e) || isFailure(e)) out[k] = markRaw(e as CoastCacheEntry)
      }
    }
    return out
  } catch {
    return {}
  }
}

/** Whether the user's choice leaves nothing to derive: an override, or 'none'. A value this version can't read is automatic. */
const hasChoice = (l: Location) => l.coast === 'none' || isCoastOverride(l.coast)
/** A spot whose coast comes from the derivation: salt or brackish water, and no choice of the user's. */
const wantsAuto = (l: Location) => l.waterType !== 'fresh' && !hasChoice(l)

export const useCoastStore = defineStore('coast', () => {
  const setup = useSetupStore()
  /** By coordKey. Held raw, as forecasts are: the scorer reads fetchKm per hour, and proxy reads cost (71d2038). */
  const entries = shallowRef<Record<string, CoastCacheEntry>>(readStored())
  /** By coordKey, this session only: queued or running (until the result lands), or failed. */
  const status = shallowRef<Record<string, 'pending' | 'failed'>>({})
  /** A run with spots to derive is under way: results land every LAND_EVERY_MS until it ends (useSettledShores). */
  const deriving = ref(false)

  // Results waiting to land (suggestion 2), the run's state, and the
  // generation clear() bumps so a job in flight can't write afterwards.
  let landed: Record<string, CoastCacheEntry> = {}
  let landTimer: ReturnType<typeof setTimeout> | null = null
  let runTimer: ReturnType<typeof setTimeout> | null = null
  let booted = false
  let running = false
  let again = false
  let generation = 0
  let latest: Location[] = []
  const forced = new Set<string>()
  /** Stale entries whose re-derivation failed, this session: retried no sooner than the backoff. */
  const staleRetryAt: Record<string, number> = {}
  let listening = false
  /** When the connection last came back: a failure on the way to the tiles before it is due again. */
  let onlineAt = 0

  const current = (key: string): CoastCacheEntry | undefined => landed[key] ?? entries.value[key]

  function autoFor(loc: { lat: number; lon: number }): CoastAuto | undefined {
    const e = entries.value[coordKey(loc)]
    return isCoastAuto(e) ? e : undefined
  }
  /**
   * 'failed' from this session, or from the stored failure: after a reload
   * the backoff keeps the spot from running again, and with the session map
   * alone it read "ikke fundet endnu" — the row's and the picker's "Prøv igen"
   * gone (review). Only for a spot that wants an automatic coast: one with
   * the user's own kept the stored failure for good (nothing is derived for
   * it), and the picker's "Prøv igen" beside it derived nothing (review).
   */
  function statusFor(loc: Location): 'pending' | 'failed' | undefined {
    if (!wantsAuto(loc)) return undefined
    const key = coordKey(loc)
    return status.value[key] ?? (isFailure(entries.value[key]) ? 'failed' : undefined)
  }

  /**
   * What the scorer reads, by location id. A spot that isn't known yet
   * (pending, failed, offline) is absent. One waiting for the user's pick
   * ('gap', 'enclosed') is known and unscored, null — as 'none' is: absent,
   * it held the official twins' coast back for as long as the user didn't
   * answer (officialCompare.ts twinShores).
   */
  const shoreById = computed<ShoreMap>(() => {
    const out: ShoreMap = {}
    for (const l of setup.locations) {
      const auto = autoFor(l)
      const r = resolveShore(l, auto)
      if (r !== undefined) out[l.id] = r
      else if (auto?.issues.includes('gap') || auto?.issues.includes('enclosed')) out[l.id] = null
    }
    return out
  })

  function save() {
    try {
      // Merge on write (suggestion 3): another tab deriving at the same time
      // keeps its entries, and the newer of two wins.
      const merged = { ...readStored() }
      for (const [k, e] of Object.entries(entries.value)) merged[k] = merged[k] ? newerOf(e, merged[k]) : e
      const keys = Object.keys(merged)
      if (keys.length > MAX_ENTRIES) {
        // Entries no current spot references go first, oldest first.
        const used = new Set(setup.locations.map(coordKey))
        keys.sort((a, b) => Number(used.has(a)) - Number(used.has(b)) || timeOf(merged[a]) - timeOf(merged[b]))
        for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete merged[k]
      }
      localStorage.setItem(KEY, JSON.stringify({ v: 1, entries: merged }))
    } catch { /* quota or blocked storage: the results still serve this session */ }
  }

  function setStatus(key: string, s: 'pending' | 'failed' | null) {
    const next = { ...status.value }
    if (s) next[key] = s
    else delete next[key]
    status.value = next
  }

  function flushLanded() {
    if (landTimer) { clearTimeout(landTimer); landTimer = null }
    const keys = Object.keys(landed)
    if (!keys.length) return
    entries.value = { ...entries.value, ...landed }
    // 'pending' ends as the result lands, not before: cleared on arrival, the
    // spot read "ikke fundet endnu" — or its old failure — until the landing.
    // Not a 'pending' "Prøv igen" set after this result: the retry is still
    // queued (runQueue drops the key from `forced` as it starts it).
    const ends = (k: string) => status.value[k] === 'pending' && !forced.has(k)
    if (keys.some(ends)) {
      const next = { ...status.value }
      for (const k of keys) if (ends(k)) delete next[k]
      status.value = next
    }
    landed = {}
    save()
  }
  function land(key: string, e: CoastCacheEntry) {
    landed[key] = markRaw(e)
    if (!landTimer) landTimer = setTimeout(flushLanded, LAND_EVERY_MS)
  }

  /**
   * A new result keeps "Ser rigtigt ud" only when it is the same answer:
   * facing within 22.5°, same shape, same exposure.
   */
  function keepOk(prev: CoastCacheEntry | undefined, next: CoastAuto): CoastAuto {
    if (!isCoastAuto(prev) || !prev.ok) return next
    const same = prev.facing != null && next.facing != null && angDist(prev.facing, next.facing) <= 22.5
      && prev.spread === next.spread && prev.exposure === next.exposure
    return same ? { ...next, ok: true } : next
  }

  function needs(l: Location, now: number): boolean {
    if (!wantsAuto(l)) return false
    const key = coordKey(l)
    if (forced.has(key)) return true
    const e = current(key)
    if (!e) return true
    if (isCoastAuto(e)) return e.v < COAST_ALGO_VERSION && now >= (staleRetryAt[key] ?? 0)
    if (e.net) return e.failedAt < onlineAt || now - e.failedAt >= NET_RETRY_MS
    return now - e.failedAt >= BACKOFF_MS[Math.min(Math.max(e.tries, 1), BACKOFF_MS.length) - 1]
  }

  let catalogue: Promise<{ coast: Record<string, Omit<CoastAuto, 'at'>>; spotAt: (lat: number, lon: number) => { slug: string } | undefined } | null> | null = null
  function loadCatalogue() {
    catalogue ??= Promise.all([import('@/lib/spotCoast.gen'), import('@/lib/spots')])
      .then(([c, s]) => {
        const coastal = s.DK_SPOTS.filter((x) => c.SPOT_COAST[x.slug])
        return { coast: c.SPOT_COAST, spotAt: (lat: number, lon: number) => s.catalogueSpotAt(lat, lon, coastal) }
      })
      .catch(() => { catalogue = null; return null })
    return catalogue
  }
  function fromCatalogue(l: Location, cat: Awaited<ReturnType<typeof loadCatalogue>>): CoastAuto | null {
    if (!cat) return null
    let hit = l.spotSlug ? cat.coast[l.spotSlug] : undefined
    if (!hit) {
      const near = cat.spotAt(l.lat, l.lon)
      if (near) hit = cat.coast[near.slug]
    }
    return hit && hit.v >= COAST_ALGO_VERSION ? { ...hit, at: Date.now(), src: 'catalogue' } : null
  }

  async function runQueue() {
    if (running) { again = true; return }
    running = true
    const gen = generation
    try {
      do {
        again = false
        if (offline()) { listenOnline(); break }
        const now = Date.now()
        const todo = latest.filter((l) => needs(l, now))
        const keys = [...new Set(todo.map(coordKey))]
        if (!keys.length) break
        deriving.value = true
        for (const k of keys) setStatus(k, 'pending')
        const cat = await loadCatalogue()
        if (gen !== generation) return
        const done = new Set<string>()
        for (const l of todo) {
          const key = coordKey(l)
          if (done.has(key)) continue
          done.add(key)
          forced.delete(key)
          const prev = current(key)
          const c = fromCatalogue(l, cat)
          if (c) { land(key, keepOk(prev, c)); continue }
          try {
            const r = await deriveCoast(l.lat, l.lon)
            if (gen !== generation) return
            land(key, keepOk(prev, r))
          } catch (err) {
            if (gen !== generation) return
            // No answer — no connection, a dropped or timed-out request, or the
            // device gone offline mid-run (review): not the server's doing.
            const net = isTransient(err) || offline()
            if (isCoastAuto(prev)) {
              // A stale entry keeps serving; its re-derivation waits out the backoff.
              staleRetryAt[key] = Date.now() + BACKOFF_MS[0]
              setStatus(key, null)
            } else {
              const tries = isFailure(prev) ? prev.tries : 0
              land(key, net
                ? { v: COAST_ALGO_VERSION, failedAt: Date.now(), tries, net: true }
                : { v: COAST_ALGO_VERSION, failedAt: Date.now(), tries: tries + 1 })
              setStatus(key, 'failed')
            }
          }
        }
        flushLanded()
      } while (again && gen === generation)
    } finally {
      if (gen === generation) { running = false; flushLanded(); deriving.value = false }
    }
  }

  function schedule(ms: number) {
    if (runTimer) clearTimeout(runTimer)
    runTimer = setTimeout(() => { runTimer = null; void runQueue() }, ms)
  }

  function listenOnline() {
    const w = globalThis.window as EventTarget | undefined
    if (listening || !w?.addEventListener) return
    listening = true
    w.addEventListener('online', () => { onlineAt = Date.now(); schedule(0) })
  }

  /**
   * Derive what the spots still lack: debounced 1.5 s, the first run after
   * boot 3 s later still. Offline it waits for the 'online' event. Never per
   * forecast or per rescore — App.vue calls it when the spots' coordinates,
   * water type or override presence change.
   */
  function ensure(locs: Location[]) {
    latest = locs
    listenOnline()
    schedule(DEBOUNCE_MS + (booted ? 0 : BOOT_DELAY_MS))
    booted = true
  }

  /** "Prøv igen" / "Brug automatisk retning": derive this spot now, whatever the backoff. */
  function retry(loc: Location) {
    const key = coordKey(loc)
    forced.add(key)
    delete staleRetryAt[key]
    if (!latest.some((l) => coordKey(l) === key)) latest = [...latest, loc]
    setStatus(key, 'pending')
    schedule(0)
  }

  /** "Ser rigtigt ud": this device only, by design (onshore spec §6). */
  function confirm(loc: { lat: number; lon: number }) {
    const key = coordKey(loc)
    const e = current(key)
    if (!isCoastAuto(e)) return
    entries.value = { ...entries.value, [key]: markRaw({ ...e, ok: true as const }) }
    if (landed[key]) landed[key] = entries.value[key]
    save()
  }

  /** Forget everything in memory, and drop the derivations in flight: the generation stops their results landing. */
  function wipe() {
    generation++
    running = false
    again = false
    if (runTimer) { clearTimeout(runTimer); runTimer = null }
    if (landTimer) { clearTimeout(landTimer); landTimer = null }
    landed = {}
    deriving.value = false
    forced.clear()
    for (const k of Object.keys(staleRetryAt)) delete staleRetryAt[k]
    terminate()
    entries.value = {}
    status.value = {}
  }

  /** Logout: the previous account's spot coordinates go with it. */
  function clear() {
    wipe()
    try { localStorage.removeItem(KEY) } catch { /* blocked storage */ }
  }

  /**
   * Another tab wrote fc2-coast: take its entries where they are newer, and
   * its confirmations of the same ones. Gone altogether, the other tab logged
   * out and wiped it (as setup.reloadLocal reads a null document): merging
   * nothing kept the old account's coordinates here, and this tab's next save
   * wrote them back.
   */
  function reloadLocal() {
    let gone: boolean
    try { gone = localStorage.getItem(KEY) === null } catch { return }
    if (gone) { wipe(); return }
    const theirs = readStored()
    const next = { ...entries.value }
    let changed = false
    for (const [k, e] of Object.entries(theirs)) {
      const o = next[k]
      const pick = o ? newerOf(o, e) : e
      if (pick !== o) { next[k] = pick; changed = true }
    }
    if (changed) entries.value = next
  }

  return { entries, status, deriving, autoFor, statusFor, shoreById, ensure, retry, confirm, clear, reloadLocal }
})

/**
 * The coasts a score-sorted list sorts by (DashboardView): shoreById, except
 * while a run is under way — then as it stood, until the run ends and its
 * results come in at once. They land every LAND_EVERY_MS meanwhile, and each
 * landing moved havørred scores by up to ~6, re-sorting the cards under the
 * user's thumb (review). The coasts are held rather than the cards, so
 * everything else stays live. `deriving` is false again after a failure,
 * offline, with nothing to do, and on logout, so the hold always ends.
 */
export function useSettledShores(): Readonly<ShallowRef<ShoreMap>> {
  const coast = useCoastStore()
  const held = shallowRef(coast.shoreById)
  // In step at once ('sync'), not in a watcher of its own later in the tick:
  // an edit that moves a coast (a water type, a pin, a coast picked by hand)
  // changes the spot and its coast together, and when the scored list's
  // reader (App's reminders) ran first, the list was scored with the old
  // coasts and then again with the new ones. Cheap: shoreById is a loop
  // over the spots, and while a run is under way it isn't read at all.
  watch(() => (coast.deriving ? held.value : coast.shoreById), (m) => { held.value = m }, { flush: 'sync' })
  return held
}
