import { defineStore } from 'pinia'
import { ref } from 'vue'
import { fetchForecast } from '@/lib/weather'
import type { Forecast, Location } from '@/lib/types'

export const useForecastStore = defineStore('forecast', () => {
  const forecasts = ref<Record<string, Forecast>>({})
  const status = ref<Record<string, 'loading' | 'ok' | 'error'>>({})

  async function fetchFor(loc: Location, retries = 2): Promise<boolean> {
    status.value[loc.id] = 'loading'
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 1000 * attempt))
        forecasts.value[loc.id] = await fetchForecast(loc)
        status.value[loc.id] = 'ok'
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

  return { forecasts, status, fetchFor, fetchAll }
})
