import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetchForecast, fetchForecasts, fetchLightningStatus, forecastKey, isYoung } from '@/lib/weather'
import { showToast } from '@/lib/toast'
import { clearOfficialForecasts } from '@/lib/officialCompare'
import { t } from '@/lib/i18n'
import type { Forecast, LightningStatus, Location } from '@/lib/types'

// Weather is worth keeping across reloads. Refetching every location on each
// page load meant ~3 requests per location (weather + marine + tides), a ~30s
// settle with 18 locations, and enough burst traffic that the final batch
// intermittently failed and showed "no weather data" before recovering.
// Anything younger than this is served from cache without a refetch.
export const FRESH_MS = 3 * 60 * 60 * 1000
// Older entries are still KEPT, just refetched: an evening's 7-day forecast is
// far better than nothing at a dawn spot with no signal. Dropping everything
// over 3 h on load turned that into 18 "data missing" cards; the card's
// "updated 8 h ago" label already shows the age honestly.
const KEEP_MS = 48 * 60 * 60 * 1000
const LS_KEY = 'fc2-forecasts'

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

/** Cached forecasts, minus anything too old to be worth showing. */
function loadCache(): Record<string, Forecast> {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, Forecast>
    const now = Date.now()
    const out: Record<string, Forecast> = {}
    // Forecast holds only numeric timestamps, so JSON round-trips losslessly.
    for (const [id, f] of Object.entries(parsed)) {
      if (f && typeof f.fetched === 'number' && now - f.fetched < KEEP_MS) out[id] = f
    }
    return out
  } catch {
    return {} // corrupt cache is not worth recovering — refetch instead
  }
}

export const useForecastStore = defineStore('forecast', () => {
  const forecasts = ref<Record<string, Forecast>>(loadCache())
  const status = ref<Record<string, 'loading' | 'ok' | 'error'>>({})
  const lightning = ref<Record<string, LightningStatus>>({})
  /** When each location's lightning was last read successfully. */
  const lightningCheckedAt = ref<Record<string, number>>({})

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
   * Young enough AND fetched for the location as it is now. The coordinates
   * drive everything and fresh water skips tides, so a key mismatch is the
   * wrong data however young: a spot corrected from fresh to salt sat without
   * tides for up to 3 h, and one switched salt→fresh kept its tide points.
   * "Young" is shorter when the tide request failed (weather.ts isYoung).
   */
  function isFresh(loc: Location): boolean {
    const f = forecasts.value[loc.id]
    return !!f && isYoung(f, FRESH_MS) && f.fetchedFor === forecastKey(loc)
  }

  // After a network failure the service worker may answer from its cache with
  // a copy that keeps its real, older fetch time (weather.ts fetchedAt). Never
  // let that replace a newer forecast for the same spot as it is now.
  function putForecast(loc: Location, f: Forecast) {
    const prev = forecasts.value[loc.id]
    if (prev && prev.fetchedFor === f.fetchedFor && prev.fetched > f.fetched) return
    // A failed tide request must not wipe tides an earlier fetch got: "Update
    // all" during a DMI hiccup stripped every coastal spot of its tide bonus.
    // DMI predicts fixed instants, so the old points still hold for the hours
    // they cover. The forecast stays marked, so the retry still happens.
    if (f.tidesFailed && !f.tides && prev?.tides && prev.fetchedFor === f.fetchedFor) {
      f = { ...f, tides: prev.tides }
    }
    forecasts.value[loc.id] = f
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
  const sameLightning = (a: LightningStatus | undefined, b: LightningStatus) =>
    !!a && a.level === b.level && a.closestKm === b.closestKm

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
    const results = await Promise.allSettled(due.map((l) => fetchLightningStatus(l)))
    const now = Date.now()
    const changed: Record<string, LightningStatus> = {}
    const checked: Record<string, number> = {}
    results.forEach((r, i) => {
      const id = due[i].id
      // A forced refresh started later already landed; this answer is older.
      if ((lightningCheckedAt.value[id] ?? 0) > started) return
      const prev = lightning.value[id]
      let next: LightningStatus | undefined
      if (r.status === 'fulfilled') {
        next = r.value
        checked[id] = now
      } else {
        // Keep the previous status. Overwriting it with 'clear' here lifted the
        // danger cap from a spot with a strike 6 km away on one flaky request.
        if (lightningAt[id] === started) delete lightningAt[id]
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
    if (Object.keys(changed).length) lightning.value = { ...lightning.value, ...changed }
  }

  /** One location, with retries. Reports nothing — the caller decides how. */
  async function fetchOne(loc: Location, retries: number): Promise<boolean> {
    status.value[loc.id] = 'loading'
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt))
        putForecast(loc, await fetchForecast(loc))
        status.value[loc.id] = 'ok'
        saveCache()
        void refreshLightning([loc], true)
        return true
      } catch (e) {
        if (attempt === retries) {
          console.error('Forecast failed:', loc.name, e)
          status.value[loc.id] = 'error'
        }
      }
    }
    return false
  }

  /**
   * One toast for any number of failed locations. Each used to bring its own:
   * offline, 18 identical "you're offline" toasts with 18 Retry buttons.
   */
  function reportFailed(failed: Location[]) {
    const msg = isOffline()
      ? '📡 ' + t('toast_offline')
      : failed.length === 1
        ? '⚠️ ' + t('toast_fetch_failed') + ' ' + failed[0].name
        : '⚠️ ' + t('toast_fetch_failed_n').replace('{n}', String(failed.length))
    showToast(msg, {
      type: 'error',
      action: { label: t('toast_retry'), run: () => { void fetchAll(failed, { force: true }) } },
    })
  }

  async function fetchFor(loc: Location, retries = 2): Promise<boolean> {
    const ok = await fetchOne(loc, retries)
    if (!ok) reportFailed([loc])
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
   */
  async function fetchAll(locations: Location[], opts: { force?: boolean } = {}) {
    if (!locations.length) return
    const idle = locations.filter((l) => status.value[l.id] !== 'loading')
    const todo = opts.force ? idle : idle.filter((l) => !isFresh(l))
    // Lightning is safety information and cheap, so keep it live even where the
    // weather itself came from cache — otherwise a cached load has no strike data.
    const skipped = idle.filter((l) => !todo.includes(l))
    if (skipped.length) void refreshLightning(skipped, opts.force)
    if (!todo.length) return

    // Offline there is nothing to try. Every location used to run its own
    // three attempts first — ~18 s of retries before saying so. Whatever is
    // cached stays on screen, and the 'online' handler retries the failures.
    if (isOffline()) {
      for (const l of todo) status.value[l.id] = 'error'
      reportFailed(todo)
      return
    }

    running++
    progress.value = { done: progress.value.done, total: progress.value.total + todo.length }
    for (const l of todo) status.value[l.id] = 'loading'
    const failed = new Set<string>()
    const attempt = (l: Location) =>
      fetchOne(l, 2).then((ok) => { if (!ok) failed.add(l.id) }).finally(tick)
    try {
      // One request for all weather, one for all marine — see fetchForecasts.
      const results = await fetchForecasts(todo)
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
      // The batch endpoint itself failed (a bad response, a dropped request).
      // Fall back to the old three-at-a-time loop so a batch problem can't take
      // the whole refresh down with it.
      console.error('Batched forecast failed, falling back per location:', e)
      const BATCH = 3
      for (let i = 0; i < todo.length; i += BATCH) {
        await Promise.all(todo.slice(i, i + BATCH).map(attempt))
      }
    } finally {
      if (--running === 0) progress.value = { done: 0, total: 0 }
    }
    if (failed.size) reportFailed(todo.filter((l) => failed.has(l.id)))
  }

  /**
   * Focus and reconnect. Refetches, in one batch, every location whose weather
   * is stale or whose last fetch failed — and, with `all`, any never loaded
   * (reminders need data for views nobody opened). Lightning older than 15 min
   * is re-checked for the rest, however young their weather.
   */
  async function refreshOnResume(locations: Location[], opts: { reasonKey: string; all?: boolean }) {
    const need = locations.filter((l) =>
      status.value[l.id] !== 'loading' && !isFresh(l)
      && (!!forecasts.value[l.id] || status.value[l.id] === 'error' || !!opts.all))
    const rest = locations.filter((l) => forecasts.value[l.id] && !need.includes(l))
    if (rest.length) void refreshLightning(rest)
    if (!need.length) return
    // Offline, fetchAll says so itself; "refreshing…" first would be a fib.
    if (!isOffline()) showToast('⟳ ' + t(opts.reasonKey), { type: 'info', ttl: 3000 })
    await fetchAll(need)
  }

  /**
   * "🗑 Ryd vejrdata", and logout. Includes the map compare's official-spot
   * forecasts: that cache lives in officialCompare's module scope, outlived
   * the wipe, and compare kept serving the old weather for up to 3 h.
   */
  function clearWeather() {
    clearOfficialForecasts()
    forecasts.value = {}
    status.value = {}
    lightning.value = {}
    lightningCheckedAt.value = {}
    for (const k of Object.keys(lightningAt)) delete lightningAt[k]
    clearTimeout(saveTimer)
    try { localStorage.removeItem(LS_KEY) } catch { /* already gone */ }
  }

  return {
    forecasts, status, lightning, lightningCheckedAt, progress,
    isFresh, fetchFor, fetchAll, refreshOnResume, refreshLightning, clearWeather,
  }
})
