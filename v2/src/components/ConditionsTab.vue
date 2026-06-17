<script setup lang="ts">
import { computed } from 'vue'
import { lang, t } from '@/lib/i18n'
import { beaufort, currentConditions, safetyRec, windDir } from '@/lib/conditions'
import { useForecastStore } from '@/stores/forecast'
import { useSetupStore } from '@/stores/setup'

const setup = useSetupStore()
const fc = useForecastStore()
const trendArrow = { rising: '↑', falling: '↓', stable: '→' } as const

const rows = computed(() =>
  setup.locations.map((loc) => {
    const c = currentConditions(fc.forecasts[loc.id])
    return { loc, c, rec: c ? safetyRec(c, loc.bottomType) : null }
  }),
)
const recCls = { yes: 'rec-good', caution: 'rec-caution', no: 'rec-bad' } as const
const recIcon = { yes: '✅', caution: '⚠️', no: '🚫' } as const

</script>

<template>
  <div class="conditions">
    <p v-if="!setup.locations.length" class="muted">{{ t('no_locations') }}</p>

    <div v-for="{ loc, c, rec } in rows" :key="loc.id" class="card loc">
      <div class="loc-name">📍 {{ loc.name }}</div>

      <template v-if="c">
        <div class="grid">
          <div class="cell"><span class="k">🌡️ {{ t('cond_temp') }}</span><span class="v">{{ c.temp?.toFixed(0) }}°C</span></div>
          <div class="cell"><span class="k">💨 {{ t('cond_wind') }}</span><span class="v">{{ c.windMs?.toFixed(1) }} m/s {{ windDir(c.windDir, lang === 'en') }}</span></div>
          <div class="cell"><span class="k">🌬️ {{ t('cond_gust') }}</span><span class="v">{{ c.gustMs?.toFixed(1) }} m/s</span></div>
          <div class="cell"><span class="k">🧭 {{ t('cond_pressure') }}</span><span class="v">{{ c.pressure?.toFixed(0) }} hPa {{ trendArrow[c.pressureTrend] }}</span></div>
          <div class="cell"><span class="k">☁️ {{ t('cond_cloud') }}</span><span class="v">{{ c.cloud }}%</span></div>
          <div class="cell"><span class="k">🌧 {{ t('cond_precip') }}</span><span class="v">{{ c.precipPct }}%</span></div>
          <div class="cell" v-if="c.waveM != null"><span class="k">🌊 {{ t('cond_wave') }}</span><span class="v">{{ c.waveM.toFixed(2) }} m</span></div>
          <div class="cell" v-if="c.wavePeriod != null"><span class="k">〰️ {{ t('cond_period') }}</span><span class="v">{{ c.wavePeriod.toFixed(1) }} s</span></div>
          <div class="cell" v-if="c.tide"><span class="k">🌊 {{ t('cond_tide') }}</span><span class="v">{{ c.tide.rising ? t('tide_rising_word') : t('tide_falling_word') }} {{ c.tide.value.toFixed(2) }} m</span></div>
          <div class="cell wide" v-if="c.tideStation"><span class="k">📡 {{ t('cond_tide_from') }}</span><span class="v">{{ c.tideStation }} ({{ c.tideDistKm }} km)</span></div>
        </div>
        <div class="beaufort">{{ beaufort(c.windMs).bf }} Bft — {{ beaufort(c.windMs).label }}</div>

        <div v-if="rec" class="safety">
          <div class="safety-head">{{ t('safety_title') }}</div>
          <div class="recs">
            <div class="rec" :class="recCls[rec.boat.ok]">{{ recIcon[rec.boat.ok] }} {{ t('sm_boat') }}: {{ t(rec.boat.labelKey) }}</div>
            <div class="rec" :class="recCls[rec.shore.ok]">{{ recIcon[rec.shore.ok] }} {{ t('sm_shore') }}: {{ t(rec.shore.labelKey) }}</div>
            <div class="rec" :class="recCls[rec.wader.ok]">{{ recIcon[rec.wader.ok] }} {{ t('sm_wader') }}: {{ t(rec.wader.labelKey) }}</div>
          </div>
          <ul v-if="rec.wader.notes.length" class="rec-notes">
            <li v-for="(n, i) in rec.wader.notes" :key="i">{{ t(n) }}</li>
          </ul>
          <div class="uc">{{ t('safety_undercurrent') }}: {{ t('uc_' + rec.undercurrent) }}</div>
        </div>
      </template>

      <div v-else-if="fc.status[loc.id] === 'loading'" class="muted">⏳ {{ t('loading') }}</div>
      <div v-else class="nodata">
        ⚠️ {{ t('data_missing') }}
        <button class="btn primary sm" @click="fc.fetchFor(loc)">⟳ {{ t('load_data_btn') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.loc { margin-bottom: 10px; }
.loc-name { font-weight: 700; margin-bottom: 10px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 14px; }
.cell { display: flex; justify-content: space-between; gap: 8px; font-size: 0.84rem; padding: 3px 0; border-bottom: 1px solid var(--border); }
.cell.wide { grid-column: 1 / 3; }
.k { color: var(--muted); } .v { font-weight: 600; text-align: right; }
.beaufort { margin-top: 10px; font-size: 0.78rem; color: var(--muted); }
.safety { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border); }
.safety-head { font-weight: 700; font-size: 0.82rem; margin-bottom: 8px; }
.recs { display: flex; flex-direction: column; gap: 4px; }
.rec { font-size: 0.82rem; padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border); }
.rec-good { color: var(--green); border-color: rgba(34,197,94,.4); }
.rec-caution { color: var(--gold); border-color: rgba(245,158,11,.4); }
.rec-bad { color: var(--red); border-color: rgba(239,68,68,.4); }
.rec-notes { margin: 8px 0 0; padding-left: 18px; }
.rec-notes li { font-size: 0.74rem; color: var(--muted); line-height: 1.5; }
.uc { margin-top: 8px; font-size: 0.74rem; color: var(--muted); }
.nodata { font-size: 0.82rem; color: var(--gold); display: flex; gap: 10px; align-items: center; }
.muted { color: var(--muted); font-size: 0.85rem; }
</style>
