import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetchForecast, fetchLightningStatus } from '@/lib/weather'
import { showToast } from '@/lib/toast'
import { t } from '@/lib/i18n'
import type { Forecast, LightningStatus, Location } from '@/lib/types'

// Weather is worth keeping across reloads. Refetching every location on each
// page load meant ~3 requests per location (weather + marine + tides), a ~30s
// settle with 18 locations, and enough burst traffic that the final batch
// intermittently failed and showed "no weather data" before recovering.
// Anything younger than this is served from cache; matches the staleness rule
// App.vue already applies on focus/reconnect.
const FRESH_MS = 3 * 60 * 60 * 1000
const LS_KEY = 'fc2-forecasts'

/** Cached forecasts, minus anything already stale. */
function loadCache(): Record<string, Forecast> {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, Forecast>
    const now = Date.now()
    const out: Record<string, Forecast> = {}
    // Forecast holds only numeric timestamps, so JSON round-trips losslessly.
    for (const [id, f] of Object.entries(parsed)) {
      if (f && typeof f.fetched === 'number' && now - f.fetched < FRESH_MS) out[id] = f
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

  function isFresh(id: string): boolean {
    const f = forecasts.value[id]
    return !!f && Date.now() - f.fetched < FRESH_MS
  }

  // Lightning needs to stay fresher than the weather (it's safety data), but not
  // per visit: the dashboard calls fetchAll on every mount, so navigating away
  // and back re-fired one request per location — 18 on this setup — even when
  // everything was cached and nothing could have changed.
  const LIGHTNING_FRESH_MS = 15 * 60 * 1000
  const lightningAt: Record<string, number> = {}

  /** Best-effort and never allowed to fail a forecast fetch. */
  function refreshLightning(locations: Location[], force = false) {
    const now = Date.now()
    const due = force
      ? locations
      : locations.filter((l) => now - (lightningAt[l.id] ?? 0) > LIGHTNING_FRESH_MS)
    for (const l of due) {
      // Stamp before awaiting, so a remount mid-flight doesn't duplicate the
      // request; clear it again on failure so the next attempt can retry.
      lightningAt[l.id] = now
      fetchLightningStatus(l)
        .then((s) => { lightning.value[l.id] = s })
        .catch(() => { delete lightningAt[l.id] })
    }
  }

  async function fetchFor(loc: Location, retries = 2): Promise<boolean> {
    status.value[loc.id] = 'loading'
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt))
        forecasts.value[loc.id] = await fetchForecast(loc)
        status.value[loc.id] = 'ok'
        saveCache()
        refreshLightning([loc], true)
        return true
      } catch (e) {
        if (attempt === retries) {
          console.error('Forecast failed:', loc.name, e)
          status.value[loc.id] = 'error'
          const offline = typeof navigator !== 'undefined' && navigator.onLine === false
          showToast(
            offline ? '📡 ' + t('toast_offline') : '⚠️ ' + t('toast_fetch_failed') + ' ' + loc.name,
            { type: 'error', action: { label: t('toast_retry'), run: () => fetchFor(loc) } },
          )
        }
      }
    }
    return false
  }

  /** Bulk-refresh progress for the UI. total = 0 means "not refreshing". */
  const progress = ref({ done: 0, total: 0 })

  /**
   * Fetch every location that needs it. Cached-and-fresh locations are skipped
   * unless `force` is set (the explicit "update all" button).
   */
  async function fetchAll(locations: Location[], opts: { force?: boolean } = {}) {
    if (!locations.length) return
    const todo = opts.force ? locations : locations.filter((l) => !isFresh(l.id))
    // Lightning is safety information and cheap, so keep it live even where the
    // weather itself came from cache — otherwise a cached load has no strike data.
    const skipped = locations.filter((l) => !todo.includes(l))
    if (skipped.length) refreshLightning(skipped, opts.force)
    if (!todo.length) return

    progress.value = { done: 0, total: todo.length }
    const BATCH = 3
    try {
      for (let i = 0; i < todo.length; i += BATCH) {
        await Promise.all(todo.slice(i, i + BATCH).map((l) =>
          fetchFor(l).finally(() => { progress.value = { ...progress.value, done: progress.value.done + 1 } }),
        ))
      }
    } finally {
      progress.value = { done: 0, total: 0 }
    }
  }

  function clearWeather() {
    forecasts.value = {}
    status.value = {}
    lightning.value = {}
    for (const k of Object.keys(lightningAt)) delete lightningAt[k]
    clearTimeout(saveTimer)
    try { localStorage.removeItem(LS_KEY) } catch { /* already gone */ }
  }

  return { forecasts, status, lightning, progress, fetchFor, fetchAll, clearWeather }
})
