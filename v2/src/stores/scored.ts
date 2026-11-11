/**
 * Every saved spot × day × time slot, scored once for the whole app. The
 * dashboard, the setup map and the reminders (App.vue) each scored the same
 * windows for themselves, so with reminders on every forecast, lightning or
 * coast write cost two full passes (~100 ms each on 18 spots) instead of one.
 *
 * Lazy, like any computed: nothing is scored until something reads `windows`,
 * and then only again after an input changes. What each reader does with the
 * list stays its own — the dashboard's hold while a refresh runs, dropping
 * ended windows (useNotEnded), the reminders' horizon (notifications.ts).
 */
import { defineStore } from 'pinia'
import { computed } from 'vue'
import { getScoredWindows } from '@/lib/scoring'
import { localDayUTC, useNow } from '@/lib/clock'
import { useForecastStore } from './forecast'
import { useSettledShores } from './coast'
import { useSetupStore } from './setup'

export const useScoredStore = defineStore('scored', () => {
  const setup = useSetupStore()
  const fc = useForecastStore()
  // The coasts, held while the coast store's queue runs: its results land
  // every few seconds, and each landing re-sorted the dashboard's cards and
  // rebuilt the setup map's pins. They come in at once when the run ends.
  const shores = useSettledShores()
  // getScoredWindows reads the clock itself, where Vue can't see it, so with
  // no other change the list kept yesterday's days past local midnight.
  // Depend on the local day — a number, so the minute ticks rescore nothing.
  // The views take their "today" from this too: with a clock of their own,
  // ticking at another second of the minute, the dashboard's day could turn
  // first, and it showed the new week with its last day empty until this
  // list caught up (up to a minute).
  const now = useNow()
  const today = computed(() => localDayUTC(now.value))

  const windows = computed(() => {
    void today.value
    return getScoredWindows(setup.locations, setup.availability, fc.forecasts, setup.targetSpecies, fc.scoringLightning, shores.value)
  })

  return { windows, today }
})
