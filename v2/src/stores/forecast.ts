import { defineStore } from 'pinia'
import { computed, markRaw, ref, shallowReactive } from 'vue'
import { fetchForecast, fetchForecasts, fetchLightningStatus, forecastKey } from '@/lib/weather'
import type { FetchedForecast } from '@/lib/weather'
import { dismissToast, showToast } from '@/lib/toast'
// officialCache, not officialCompare: that would pull the spot catalogue into the main bundle.
import { clearOfficialForecasts } from '@/lib/officialCache'
import { t } from '@/lib/i18n'
// Shared with the map compare's official spots, so both refetch alike.
import { freshEnough, mergeRefetch, wavesNotLoaded as wavesMissingIn } from '@/lib/forecastFreshness'
import type { LightningStatus, Location } from '@/lib/types'

// Weather is worth keeping across reloads. Refetching every location on each
// page load meant ~3 requests per location (weather + marine + tides), a ~30s
// settle with 18 locations, and enough burst traffic that the final batch
// intermittently failed and showed "no weather data" before recovering.
// Anything younger than FRESH_MS (forecastFreshness.ts) is served from cache
// without a refetch; one whose tides or waves failed, after PART_RETRY_MS.
// Older entries are still KEPT, just refetched: an evening's 7-day forecast is
// far better than nothing at a dawn spot with no signal. Dropping everything
// over 3 h on load turned that into 18 "data missing" cards; the card's
// "updated 8 h ago" label already shows the age honestly.
const KEEP_MS = 48 * 60 * 60 * 1000
const LS_KEY = 'fc2-forecasts'

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false
// A request aborted by its deadline. Browsers that predate abort reasons
// reject with AbortError instead; nothing else aborts these requests.
const isTimeout = (e: unknown) => {
  const name = (e as { name?: unknown } | null)?.name
  return name === 'TimeoutError' || name === 'AbortError'
}

/** Cached forecasts, minus anything too old to be worth showing. */
function loadCache(): Record<string, FetchedForecast> {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, FetchedForecast>
    const now = Date.now()
    const out: Record<string, FetchedForecast> = {}
    // Forecast holds only numeric timestamps, so JSON round-trips losslessly.
    for (const [id, f] of Object.entries(parsed)) {
      if (f && typeof f.fetched === 'number' && now - f.fetched < KEEP_MS) out[id] = markRaw(f)
    }
    return out
  } catch {
    return {} // corrupt cache is not worth recovering — refetch instead
  }
}

export const useForecastStore = defineStore('forecast', () => {
  const forecasts = ref<Record<string, FetchedForecast>>(loadCache())
  const status = ref<Record<string, 'loading' | 'ok' | 'error'>>({})
  const lightning = ref<Record<string, LightningStatus>>({})
  /** When each location's lightning was last read successfully. */
  const lightningCheckedAt = ref<Record<string, number>>({})
  /** When each location's last lightning check failed; gone once one succeeds. */
  const lightningFailedAt = ref<Record<string, number>>({})
  // Bumped by clearWeather. A fetch started before the wipe — a batch still
  // loading when "Log ud" was pressed — lands after it, and used to put the
  // old account's spots back into the store and into fc2-forecasts. Every
  // await below checks it and drops what was fetched for a wiped store.
  let generation = 0

  // Debounced: a bulk refresh would otherwise re-serialise the whole cache
  // once per location.
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  function saveCache() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      // Freshest first, so if we have to shed entries we keep the useful ones.
      const entries = Object.entries(forecasts.value).sort((a, b) => b[1].fetched - a[1].fetched)
      // ~64 KB per location in practice, so a big setup can exceed the ~5 MB
      // localStorage quota. Shrink and retry rather than lose caching entirely.
      const limits = [entries.length, 24, 8].filter((n, i) => i === 0 || n < entries.length)
      for (const limit of limits) {
        try {
          localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, limit))))
          return
        } catch { /* over quota — try a smaller slice */ }
      }
      try { localStorage.removeItem(LS_KEY) } catch { /* nothing left to do */ }
    }, 800)
  }

  /**
   * Young enough, fetched today (forecastFreshness.ts freshEnough) AND for
   * the location as it is now. The coordinates drive everything and fresh
   * water skips tides, so a key mismatch is the wrong data however young: a
   * spot corrected from fresh to salt sat without tides for up to 3 h, and
   * one switched salt→fresh kept its tide points.
   */
  function isFresh(loc: Location): boolean {
    const f = forecasts.value[loc.id]
    return !!f && f.fetchedFor === forecastKey(loc) && freshEnough(f)
  }

  /** A refetch keeps the tides and waves the spot had where it failed to get them (mergeRefetch). */
  function putForecast(loc: Location, fetched: FetchedForecast) {
    const f = mergeRefetch(forecasts.value[loc.id], fetched)
    if (!f) return
    // Raw: a forecast is replaced whole, never edited, so the map's own
    // reactivity (this assignment) is all that has to be tracked. Held deeply
    // reactive, every read of its ~200 hours and ~1,200 tide points went through
    // a proxy: scoring 18 spots took ~2.7 s in a computed instead of ~50 ms,
    // twice per load (dashboard + reminders), freezing the app for ~5 s.
    forecasts.value[loc.id] = markRaw(f)
  }

  /**
   * A sea spot whose marine request failed with no waves from before to keep
   * (putForecast): the first load, after "Ryd vejrdata", or a spot added or
   * moved during the outage. Its windows score with no wave row, which reads
   * as calm water (35 instead of 7 in a 1.8 m swell), so the dashboard says
   * so on them until the retry (PART_RETRY_MS) gets the waves.
   */
  function wavesNotLoaded(loc: Location): boolean {
    return wavesMissingIn(forecasts.value[loc.id], loc)
  }

  // Lightning needs to stay fresher than the weather (it's safety data), but not
  // per visit: the dashboard calls fetchAll on every mount, so navigating away
  // and back re-fired one request per location — 18 on this setup — even when
  // everything was cached and nothing could have changed.
  const LIGHTNING_FRESH_MS = 15 * 60 * 1000
  // A failed re-check keeps the last reading (below), so a 'danger' can only
  // outlive its storm while no check gets through. Past this it is history, not
  // a forecast: still flagged ("keep watch", no distance), no longer capping
  // every one of today's windows. Never 'clear' — that needs a real answer.
  const LIGHTNING_STALE_MS = 2 * 60 * 60 * 1000
  const lightningAt: Record<string, number> = {}
  // When the check behind each current reading STARTED. An answer from a check
  // started earlier is older, however late it lands.
  const readingStartedAt: Record<string, number> = {}
  const sameLightning = (a: LightningStatus | undefined, b: LightningStatus) =>
    !!a && a.level === b.level && a.closestKm === b.closestKm

  /**
   * The readings scoring acts on: every one but 'clear', which scores exactly
   * like no reading (getScoredWindows). The first check after every start
   * answers 'clear' for each spot, a change from "no reading" that rescored
   * every window for the result already on screen (~100 ms per scored list on
   * 18 spots). The same object comes back until one of these readings changes,
   * so a list scored from it is not re-run. `lightning` keeps the 'clear'
   * ones: the map compare's inheritLightning goes by which spots have a reading.
   */
  const scoringLightning = computed<Record<string, LightningStatus>>((prev) => {
    const next: Record<string, LightningStatus> = {}
    for (const [id, s] of Object.entries(lightning.value)) if (s.level !== 'clear') next[id] = s
    const ids = Object.keys(next)
    if (prev && ids.length === Object.keys(prev).length && ids.every((id) => sameLightning(prev[id], next[id]))) return prev
    return next
  })
  // How old a reading may be and still count as checked. The app polls every
  // 5 min while visible and re-asks after 15, so a working check never is.
  const LIGHTNING_UNCHECKED_MS = 30 * 60 * 1000

  /**
   * Whether lightning at this spot has gone unchecked: the last check failed
   * and none has succeeded in the last 30 min. A check that failed before any
   * reading left nothing behind (no ⚡, no cap), so today's windows looked
   * exactly like "no lightning" — most likely during a storm, when DMI
   * answers 429. A check still running is not counted.
   */
  function lightningUnchecked(locId: string, now = Date.now()): boolean {
    if (lightningFailedAt.value[locId] === undefined) return false
    const ok = lightningCheckedAt.value[locId]
    return ok === undefined || now - ok >= LIGHTNING_UNCHECKED_MS
  }

  /** Record failed checks (and clear them for `cleared`), in one write and none when nothing changes. */
  function noteLightningFailures(failed: Record<string, number>, cleared: string[] = []) {
    const drop = cleared.filter((id) => id in lightningFailedAt.value)
    if (!Object.keys(failed).length && !drop.length) return
    const next = { ...lightningFailedAt.value, ...failed }
    for (const id of drop) delete next[id]
    lightningFailedAt.value = next
  }

  /**
   * Re-check lightning where the last attempt is over 15 min old (all of them
   * when forced). Never rejects, so it can't fail a forecast fetch.
   */
  async function refreshLightning(locations: Location[], force = false): Promise<void> {
    const started = Date.now()
    const due = force
      ? locations
      : locations.filter((l) => started - (lightningAt[l.id] ?? 0) > LIGHTNING_FRESH_MS)
    if (!due.length) return
    // Stamp before awaiting, so a remount mid-flight doesn't duplicate the
    // request; cleared again on failure so the next pass retries.
    for (const l of due) lightningAt[l.id] = started
    const gen = generation
    const results = await Promise.allSettled(due.map((l) => fetchLightningStatus(l)))
    if (gen !== generation) return // wiped meanwhile — see `generation`
    const now = Date.now()
    const changed: Record<string, LightningStatus> = {}
    const checked: Record<string, number> = {}
    const failed: Record<string, number> = {}
    results.forEach((r, i) => {
      const id = due[i].id
      // A check started later already answered; this answer is older. (Landing
      // times can't tell: a slow poll landing mid-way through an "Update all"
      // threw away the newer answer that came after it.)
      if ((readingStartedAt[id] ?? -Infinity) > started) return
      const prev = lightning.value[id]
      let next: LightningStatus | undefined
      if (r.status === 'fulfilled') {
        next = r.value
        checked[id] = now
        readingStartedAt[id] = started
      } else {
        // Keep the previous status. Overwriting it with 'clear' here lifted the
        // danger cap from a spot with a strike 6 km away on one flaky request.
        if (lightningAt[id] === started) delete lightningAt[id]
        failed[id] = now
        const last = lightningCheckedAt.value[id]
        if (prev && (prev.level === 'danger' || prev.level === 'warning')
          && last !== undefined && now - last > LIGHTNING_STALE_MS) {
          next = { level: 'caution', closestKm: null }
        }
      }
      if (next && !sameLightning(prev, next)) changed[id] = next
    })
    // ONE write for the whole refresh, and none when nothing changed: each
    // response used to be written on its own, and every write rescored every
    // window — 18 rescorings per refresh, even for 'clear' → 'clear'.
    if (Object.keys(checked).length) lightningCheckedAt.value = { ...lightningCheckedAt.value, ...checked }
    noteLightningFailures(failed, Object.keys(checked))
    if (Object.keys(changed).length) lightning.value = { ...lightning.value, ...changed }
  }

  /**
   * One location, with retries. Reports nothing — the caller decides how.
   * False only for a failure worth reporting: a fetch the wipe overtook is
   * dropped silently (see `generation`).
   */
  async function fetchOne(loc: Location, retries: number): Promise<boolean> {
    const gen = generation
    status.value[loc.id] = 'loading'
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt))
        if (gen !== generation) return true
        const f = await fetchForecast(loc)
        if (gen !== generation) return true
        putForecast(loc, f)
        status.value[loc.id] = 'ok'
        saveCache()
        void refreshLightning([loc], true)
        return true
      } catch (e) {
        if (gen !== generation) return true
        if (attempt === retries) {
          console.error('Forecast failed:', loc.name, e)
          status.value[loc.id] = 'error'
        }
      }
    }
    return false
  }

  // The failure toast: one, about every spot whose weather failed to load and
  // hasn't loaded since. Under one key, so a newer report replaces it in its
  // place, worded from the newest failure. Each report used to raise a toast
  // of its own: back online, "Du er offline" stood beside the 503 of the one
  // spot that then failed.
  const FAIL_KEY = 'weather-failed'
  // The spots it is about, as last reported: it names these, and its Retry
  // fetches them. It goes once they have loaded (resolveFailToasts). A toast
  // with a Retry is sticky, and the "offline" error sat next to fresh data
  // until closed by hand. Reactive, so the toast's text follows it.
  const failing = shallowReactive(new Map<string, Location>())
  let failToast: number | undefined
  // Spots told "you're offline" since the connection went down. Offline, a
  // fetch that comes by itself (a screen opened, the tab shown again) tells
  // them no more: each said so again, and a closed "Du er offline" came back
  // every time. A fetch made online forgets them (offlineNow).
  const toldOffline = new Set<string>()
  // Spots that left the setup (forgetSpots): when, by the count of calls. A
  // fetch under way as its spot left reports nothing for it.
  let forgets = 0
  const forgottenAt = new Map<string, number>()

  /** Whether the app is offline. Online, the spots told it are forgotten: a reconnect starts afresh. */
  function offlineNow(): boolean {
    const offline = isOffline()
    if (!offline) toldOffline.clear()
    return offline
  }

  /**
   * One toast for any number of failed locations. Each used to bring its own:
   * offline, 18 identical "you're offline" toasts with 18 Retry buttons.
   * `since` is the count of forgetSpots calls when the fetch began.
   */
  function reportFailed(failed: Location[], since = forgets) {
    // Not one that left the setup while it was fetched, nor one another
    // fetch has loaded meanwhile.
    const still = failed.filter((l) => (forgottenAt.get(l.id) ?? 0) <= since && status.value[l.id] !== 'ok')
    if (!still.length) return
    // Decided now, worded when read: the toast stands until its spots load,
    // and a language switch meanwhile re-renders it (lib/toast). Offline or
    // not as this failure is. The spots it names are those failing as it is
    // read: one that has left or loaded since is not counted.
    const offline = isOffline()
    for (const l of still) {
      failing.set(l.id, l)
      if (offline) toldOffline.add(l.id)
    }
    dropLoaded()
    const msg = () => {
      if (offline) return '📡 ' + t('toast_offline')
      const [first] = failing.values()
      return failing.size === 1
        ? '⚠️ ' + t('toast_fetch_failed') + ' ' + first.name
        : '⚠️ ' + t('toast_fetch_failed_n').replace('{n}', String(failing.size))
    }
    const gen = generation
    failToast = showToast(msg, {
      key: FAIL_KEY,
      type: 'error',
      // The spots still failing when it is pressed: none that has loaded or
      // left the setup since. Not after a wipe: these are the spots of
      // whoever was signed in then.
      action: { label: () => t('toast_retry'), run: () => { if (gen === generation) void fetchAll([...failing.values()], { force: true }) } },
    })
  }

  /** Drops the failing spots that have loaded since. */
  function dropLoaded() {
    for (const id of [...failing.keys()]) if (status.value[id] === 'ok') failing.delete(id)
  }

  /** Take the failure toast down once its locations have all loaded, or left the setup. */
  function resolveFailToasts() {
    dropLoaded()
    if (failing.size || failToast === undefined) return
    dismissToast(failToast)
    failToast = undefined
  }

  /**
   * Spots that left the setup (App.vue watches it): deleted, or gone with a
   * shared setup taken in. Each used to keep its 'error' and its place in the
   * failure toast, which then never went, and its Retry fetched the spot back
   * into the weather cache. A fetch under way keeps its 'loading': it lands
   * anyway, and a spot brought straight back is left to it.
   */
  function forgetSpots(ids: string[]) {
    forgets++
    for (const id of ids) {
      forgottenAt.set(id, forgets)
      failing.delete(id)
      toldOffline.delete(id)
      if (status.value[id] !== 'loading') delete status.value[id]
    }
    resolveFailToasts()
  }

  async function fetchFor(loc: Location, retries = 2): Promise<boolean> {
    const since = forgets
    const ok = await fetchOne(loc, retries)
    if (!ok) reportFailed([loc], since)
    else resolveFailToasts()
    return ok
  }

  /** Bulk-refresh progress for the UI. total = 0 means "not refreshing". */
  const progress = ref({ done: 0, total: 0 })
  // Overlapping refreshes (App's and the dashboard's on a cold start, a focus
  // refresh mid-batch) share the bar, which resets when the LAST one is done —
  // the first to finish used to zero it while the other was still loading.
  let running = 0
  const tick = () => { progress.value = { ...progress.value, done: progress.value.done + 1 } }

  /**
   * Fetch every location that needs it. Cached-and-fresh locations are skipped
   * unless `force` is set (the explicit "update all" button); locations another
   * call is already fetching are always left to it.
   *
   * One whose last fetch failed needs one, however young the weather it kept:
   * "Update all" offline fails every spot, cached weather and all. Skipped as
   * fresh, nothing was fetched back online, and its "Du er offline" toast
   * stood on screen with the connection back (resolveFailToasts).
   */
  async function fetchAll(locations: Location[], opts: { force?: boolean } = {}) {
    if (!locations.length) return
    const idle = locations.filter((l) => status.value[l.id] !== 'loading')
    const todo = opts.force ? idle : idle.filter((l) => !isFresh(l) || status.value[l.id] === 'error')
    // Lightning is safety information and cheap, so keep it live even where the
    // weather itself came from cache — otherwise a cached load has no strike data.
    const skipped = idle.filter((l) => !todo.includes(l))
    if (skipped.length) void refreshLightning(skipped, opts.force)
    if (!todo.length) return

    // Offline there is nothing to try. Every location used to run its own
    // three attempts first — ~18 s of retries before saying so. Whatever is
    // cached stays on screen, and the 'online' handler retries the failures.
    if (offlineNow()) {
      for (const l of todo) status.value[l.id] = 'error'
      // Nor can lightning be checked: say so on today's windows (lightningUnchecked).
      noteLightningFailures(Object.fromEntries(todo.map((l) => [l.id, Date.now()])))
      // Said once per spot until the connection is back (toldOffline). A
      // press of "Opdater alle" or Retry (force) is answered every time.
      // The toast's Retry fetches each spot as it is now: one moved since.
      for (const l of todo) if (failing.has(l.id)) failing.set(l.id, l)
      const untold = opts.force ? todo : todo.filter((l) => !toldOffline.has(l.id))
      if (untold.length) reportFailed(untold)
      return
    }

    running++
    progress.value = { done: progress.value.done, total: progress.value.total + todo.length }
    for (const l of todo) status.value[l.id] = 'loading'
    const gen = generation
    const since = forgets
    const failed = new Set<string>()
    const attempt = (l: Location) =>
      fetchOne(l, 2).then((ok) => { if (!ok) failed.add(l.id) }).finally(tick)
    try {
      // One request for all weather, one for all marine — see fetchForecasts.
      const results = await fetchForecasts(todo)
      if (gen !== generation) return // wiped meanwhile — see `generation`
      const stragglers: Location[] = []
      results.forEach((f, i) => {
        const l = todo[i]
        if (f) {
          putForecast(l, f)
          status.value[l.id] = 'ok'
        } else {
          stragglers.push(l)
        }
      })
      progress.value = { ...progress.value, done: progress.value.done + todo.length - stragglers.length }
      saveCache()
      void refreshLightning(todo, opts.force)
      // Only the stragglers go through the per-location path, which retries.
      await Promise.all(stragglers.map(attempt))
    } catch (e) {
      if (gen !== generation) return
      if (isTimeout(e)) {
        // The batch waited out its whole deadline (weather.ts): this
        // connection can't deliver right now. The fallback below would send
        // 3 single requests per spot, each waiting out its own deadline —
        // spots 'loading' and "Update all" disabled for ~9 min. Fail them now;
        // the toast's Retry and the next focus/online refresh try again.
        console.error('Batched forecast timed out:', e)
        for (const l of todo) { status.value[l.id] = 'error'; failed.add(l.id) }
        progress.value = { ...progress.value, done: progress.value.done + todo.length }
      } else {
        // The batch endpoint itself failed (a bad response, a dropped request).
        // Fall back to the old three-at-a-time loop so a batch problem can't take
        // the whole refresh down with it.
        console.error('Batched forecast failed, falling back per location:', e)
        const BATCH = 3
        for (let i = 0; i < todo.length; i += BATCH) {
          await Promise.all(todo.slice(i, i + BATCH).map(attempt))
        }
      }
    } finally {
      if (--running === 0) progress.value = { done: 0, total: 0 }
    }
    if (gen !== generation) return
    if (failed.size) reportFailed(todo.filter((l) => failed.has(l.id)), since)
    else resolveFailToasts()
  }

  /**
   * Focus and reconnect. Refetches, in one batch, every location whose weather
   * is stale or whose last fetch failed — and, with `all`, any never loaded
   * (reminders need data for views nobody opened). Lightning older than 15 min
   * is re-checked for the rest, however young their weather.
   */
  async function refreshOnResume(locations: Location[], opts: { reasonKey: string; all?: boolean }) {
    // A failed fetch is retried however young the weather it left (fetchAll).
    const need = locations.filter((l) =>
      status.value[l.id] !== 'loading'
      && (status.value[l.id] === 'error' || (!isFresh(l) && (!!forecasts.value[l.id] || !!opts.all))))
    const rest = locations.filter((l) => forecasts.value[l.id] && !need.includes(l))
    if (rest.length) void refreshLightning(rest)
    // Offline, fetchAll says so itself; "refreshing…" first would be a fib.
    // Asked before the return: a reconnect with nothing to fetch starts afresh too.
    const offline = offlineNow()
    if (!need.length) return
    if (!offline) showToast('⟳ ' + t(opts.reasonKey), { type: 'info', ttl: 3000 })
    await fetchAll(need)
  }

  /**
   * "🗑 Ryd vejrdata", and logout. Includes the map compare's official-spot
   * forecasts: that cache lives in officialCompare's module scope, outlived
   * the wipe, and compare kept serving the old weather for up to 3 h.
   */
  function clearWeather() {
    generation++
    // Its Retry would only refetch what was just wiped.
    if (failToast !== undefined) dismissToast(failToast)
    failToast = undefined
    failing.clear()
    toldOffline.clear()
    forgottenAt.clear()
    clearOfficialForecasts()
    forecasts.value = {}
    status.value = {}
    lightning.value = {}
    lightningCheckedAt.value = {}
    lightningFailedAt.value = {}
    for (const k of Object.keys(lightningAt)) delete lightningAt[k]
    for (const k of Object.keys(readingStartedAt)) delete readingStartedAt[k]
    clearTimeout(saveTimer)
    try { localStorage.removeItem(LS_KEY) } catch { /* already gone */ }
  }

  return {
    forecasts, status, lightning, scoringLightning, lightningCheckedAt, progress,
    isFresh, fetchFor, fetchAll, refreshOnResume, refreshLightning, lightningUnchecked, wavesNotLoaded, clearWeather,
    forgetSpots,
  }
})
