import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetchForecast, fetchLightningStatus } from '@/lib/weather'
import { showToast } from '@/lib/toast'
import { t } from '@/lib/i18n'
import type { Forecast, LightningStatus, Location } from '@/lib/types'

export const useForecastStore = defineStore('forecast', () => {
  const forecasts = ref<Record<string, Forecast>>({})
  const status = ref<Record<string, 'loading' | 'ok' | 'error'>>({})
  const lightning = ref<Record<string, LightningStatus>>({})

  async function fetchFor(loc: Location, retries = 2): Promise<boolean> {
    status.value[loc.id] = 'loading'
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt))
        forecasts.value[loc.id] = await fetchForecast(loc)
        status.value[loc.id] = 'ok'
        // Lightning is best-effort and must never fail the forecast fetch
        fetchLightningStatus(loc).then((s) => { lightning.value[loc.id] = s }).catch(() => {})
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

  async function fetchAll(locations: Location[]) {
    if (!locations.length) return
    progress.value = { done: 0, total: locations.length }
    const BATCH = 3
    try {
      for (let i = 0; i < locations.length; i += BATCH) {
        await Promise.all(locations.slice(i, i + BATCH).map((l) =>
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
  }

  return { forecasts, status, lightning, progress, fetchFor, fetchAll, clearWeather }
})
