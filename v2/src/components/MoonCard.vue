<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/lib/i18n'
import { Solunar } from '@/lib/solunar'
import { useSetupStore } from '@/stores/setup'

const setup = useSetupStore()
// Use the first location (or Denmark centre) for sun/moon times
const ref0 = computed(() => setup.locations[0] ?? { lat: 56.0, lon: 10.5 })

const info = computed(() => {
  const date = new Date()
  const loc = ref0.value
  const phase = Solunar.getMoonPhase(date)
  const moon = Solunar.moonPhaseLabel(phase)
  const sun = Solunar.getSunTimes(date, loc.lat, loc.lon)
  const fmt = (d: Date | null | undefined) =>
    d ? `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}` : '–'
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
      <span class="utc">UTC</span>
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
