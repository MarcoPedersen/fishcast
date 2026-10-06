<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/lib/i18n'
import { Solunar } from '@/lib/solunar'
import { localDayUTC, useNow } from '@/lib/clock'
import { useSetupStore } from '@/stores/setup'

const setup = useSetupStore()
// Use the first location (or Denmark centre) for sun/moon times
const ref0 = computed(() => setup.locations[0] ?? { lat: 56.0, lon: 10.5 })

// Today's sun and moon, recomputed when the local day changes — from a bare
// `new Date()` the card kept yesterday's sunrise for as long as the dashboard
// stayed open. Computed for local noon: getSunTimes takes its day from the UTC
// date, which is still yesterday just after local midnight.
const now = useNow()
const today = computed(() => localDayUTC(now.value))
const info = computed(() => {
  const d = new Date(today.value)
  const date = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12)
  const loc = ref0.value
  const phase = Solunar.getMoonPhase(date)
  const moon = Solunar.moonPhaseLabel(phase)
  const sun = Solunar.getSunTimes(date, loc.lat, loc.lon)
  // getSunTimes returns absolute instants, so read them in the viewer's own
  // timezone — formatting with getUTC* showed a Danish user 03:32 for a 05:32
  // sunrise and then labelled it "UTC", which is data nobody wants.
  const fmt = (d: Date | null | undefined) =>
    d ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '–'
  return {
    label: moon.label,
    pct: Math.round((phase < 0.5 ? phase * 2 : (1 - phase) * 2) * 100),
    sunrise: fmt(sun.sunrise), sunset: fmt(sun.sunset),
  }
})
</script>

<template>
  <div class="card moon">
    <div class="title">{{ t('moon_title') }}</div>
    <div class="phase">{{ info.label }}</div>
    <div class="pct">{{ t('moon_phase_today') }} {{ info.pct }}%</div>
    <div class="times">
      <span>🌅 {{ info.sunrise }}</span>
      <span>🌇 {{ info.sunset }}</span>
    </div>
  </div>
</template>

<style scoped>
.moon { margin-top: 16px; }
.title { font-weight: 700; font-size: 0.9rem; margin-bottom: 8px; }
.phase { font-size: 1.05rem; }
.pct { font-size: 0.8rem; color: var(--muted); margin-top: 2px; }
.times { display: flex; gap: 14px; margin-top: 8px; font-size: 0.82rem; align-items: center; }
.utc { color: var(--muted); font-size: 0.7rem; }
</style>
