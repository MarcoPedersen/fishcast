<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { lang, spName, t } from '@/lib/i18n'
import { getScoredWindows, scoreColor, scoreLabel } from '@/lib/scoring'
import { SPECIES_PREFS } from '@/lib/species'
import { useForecastStore } from '@/stores/forecast'
import { useSetupStore } from '@/stores/setup'

const setup = useSetupStore()
const fc = useForecastStore()

onMounted(() => fc.fetchAll(setup.locations))

const windows = computed(() =>
  getScoredWindows(setup.locations, setup.availability, fc.forecasts, setup.targetSpecies),
)
const loading = computed(() => Object.values(fc.status).some((s) => s === 'loading'))
const openTips = ref<number | null>(null)

function fmtDate(d: Date): string {
  return `${t('day' + d.getDay())} ${d.getDate()}. ${t('month' + d.getMonth())}`
}
</script>

<template>
  <div class="dash">
    <div class="row between head">
      <h1>{{ t('tab_windows') }}</h1>
      <button class="btn ghost sm" :disabled="loading" @click="fc.fetchAll(setup.locations)">
        {{ loading ? '⏳ ' + t('loading') : t('update_all') }}
      </button>
    </div>

    <div v-if="setup.targetSpecies.length" class="targets">
      {{ t('dash_targets') }}
      <span v-for="id in setup.targetSpecies" :key="id" class="pill">
        {{ SPECIES_PREFS[id]?.emoji }} {{ spName(SPECIES_PREFS[id]) }}
      </span>
    </div>

    <p v-if="!windows.length" class="notice">{{ t('dash_no_windows') }}</p>

    <div v-for="(w, i) in windows.slice(0, 20)" :key="i" class="card win" :class="{ top: i === 0 }">
      <div class="score" :class="scoreColor(w.score)">
        <span v-if="w.noData">?</span><span v-else>{{ w.score }}</span>
      </div>
      <div class="body">
        <div class="title">
          <strong>{{ fmtDate(w.date) }}</strong> · {{ w.from }}–{{ w.to }}
          <span v-if="i === 0" class="badge">🏆</span>
        </div>
        <div class="meta">
          📍 {{ w.location.name }}
          <template v-if="w.bestHourStr"> · {{ t('best_hour') }} {{ w.bestHourStr }}</template>
          <template v-if="!w.noData"> · {{ scoreLabel(w.score) }}</template>
        </div>
        <div v-if="w.tags.length" class="tags">
          <span v-for="(tag, j) in w.tags" :key="j" class="tag" :class="tag.cls">{{ tag.label }}</span>
        </div>
        <div v-if="!w.noData && w.lure?.colors.length" class="lure">
          <span class="lure-label">{{ t('lure_label') }}</span>
          <template v-for="(c, k) in w.lure.colors" :key="k">
            <span class="swatch" :style="{ background: c.hex }" :title="c.name + ' — ' + c.reason"></span>
            <span class="lure-name" :title="c.reason">{{ c.name }}</span>
            <span v-if="k < w.lure.colors.length - 1" class="sep">·</span>
          </template>
          <button v-if="w.lure.tips.length" class="tips-btn" :title="w.lure.tips.join('\n')"
            @click="openTips = openTips === i ? null : i">💡</button>
        </div>
        <div v-if="openTips === i && w.lure?.tips.length" class="tips-panel">
          <div v-for="(tip, k) in w.lure.tips" :key="k" class="tip">{{ tip }}</div>
        </div>
        <div v-if="w.noData" class="nodata">
          ⚠️ {{ t('data_missing') }}
          <button class="btn primary sm" @click="fc.fetchFor(w.location)">⟳ {{ t('load_data_btn') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.head h1 { font-size: 1.3rem; }
.row { display: flex; align-items: center; gap: 10px; } .row.between { justify-content: space-between; }
.targets { font-size: 0.82rem; color: var(--cyan); margin: 10px 0; display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.pill { background: rgba(56, 189, 248, 0.12); border: 1px solid var(--border); border-radius: 12px; padding: 2px 8px; font-size: 0.76rem; }
.win { display: flex; gap: 14px; margin-top: 10px; }
.win.top { border-color: var(--primary); }
.score { width: 52px; height: 52px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; font-size: 1.1rem; flex-shrink: 0; }
.score-great { background: rgba(34, 197, 94, 0.2); color: var(--green); }
.score-good  { background: rgba(56, 189, 248, 0.2); color: var(--primary); }
.score-avg   { background: rgba(245, 158, 11, 0.2); color: var(--gold); }
.score-poor  { background: rgba(239, 68, 68, 0.2);  color: var(--red); }
.meta { font-size: 0.8rem; color: var(--muted); margin-top: 3px; }
.tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.tag { font-size: 0.7rem; padding: 2px 8px; border-radius: 10px; border: 1px solid var(--border); }
.tag-green { color: var(--green); } .tag-red { color: var(--red); } .tag-gold { color: var(--gold); }
.tag-blue { color: var(--primary); } .tag-gray, .tag-orange { color: var(--muted); }
.badge { margin-left: 6px; }
.nodata { margin-top: 8px; font-size: 0.78rem; color: var(--gold); display: flex; gap: 10px; align-items: center; }
.notice { color: var(--muted); margin-top: 20px; }
.lure { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; margin-top: 8px; }
.lure-label { font-size: 0.72rem; color: var(--muted); white-space: nowrap; }
.swatch { width: 14px; height: 14px; border-radius: 50%; display: inline-block; border: 1.5px solid rgba(255,255,255,.55); flex-shrink: 0; }
.lure-name { font-size: 0.74rem; cursor: help; }
.sep { color: var(--muted); font-size: 0.7rem; }
.tips-btn { width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--border); background: none; cursor: pointer; font-size: 0.8rem; line-height: 1; }
.tips-btn:hover { border-color: var(--primary); }
.tips-panel { margin-top: 6px; padding: 8px 10px; border-left: 2px solid var(--primary); background: rgba(56,189,248,.05); border-radius: 0 6px 6px 0; }
.tip { font-size: 0.75rem; line-height: 1.5; color: var(--text); }
.tip + .tip { margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--border); }
</style>
