import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetchForecast, fetchLightningStatus } from '@/lib/weather'
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
        }
      }
    }
    return false
  }

  async function fetchAll(locations: Location[]) {
    const BATCH = 3
    for (let i = 0; i < locations.length; i += BATCH) {
      await Promise.all(locations.slice(i, i + BATCH).map((l) => fetchFor(l)))
    }
  }

  function clearWeather() {
    forecasts.value = {}
    status.value = {}
    lightning.value = {}
  }

  return { forecasts, status, lightning, fetchFor, fetchAll, clearWeather }
})
