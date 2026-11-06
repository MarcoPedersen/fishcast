<script setup lang="ts">
/**
 * "Which way does the coast face?" for one spot (onshore spec §3.2). Emits
 * the user's choice; the spot card applies it to the location (a user edit,
 * so it syncs). Never mutates its props.
 */
import { computed, nextTick, ref } from 'vue'
import { lang, t } from '@/lib/i18n'
import { windDir } from '@/lib/conditions'
import {
  DIR_NAME_KEY, EXPOSURE_OPT_KEY, SPREAD_OPT_KEY, dirIndex, isCoastOverride, pickedCoast, type CoastAuto,
} from '@/lib/coast'
import type { CoastExposure, CoastOverride, CoastSpread, Location } from '@/lib/types'
import OsmCredit from '@/components/OsmCredit.vue'

const props = defineProps<{ loc: Location; auto?: CoastAuto; status?: 'pending' | 'failed' }>()
const emit = defineEmits<{
  (e: 'set', value: CoastOverride | 'none' | undefined): void
  (e: 'retry'): void
  (e: 'close'): void
}>()

const DIRS = Array.from({ length: 16 }, (_, k) => k)
const SPREADS: CoastSpread[] = [180, 270, 360]
const EXPOSURES: CoastExposure[] = ['open', 'semi', 'sheltered']
const SIZE = 220, C = SIZE / 2, RING = 92, BTN = 34, ROSE = 62

const override = computed(() => (isCoastOverride(props.loc.coast) ? props.loc.coast : null))
const selected = computed(() => (override.value ? dirIndex(override.value.facing) : null))
const suggested = computed(() => (props.auto?.facing != null && props.auto.water === 'sea' ? dirIndex(props.auto.facing) : null))
const spread = computed<CoastSpread | null>(() => override.value?.spread ?? props.auto?.spread ?? null)
const exposure = computed<CoastExposure | null>(() => override.value?.exposure ?? props.auto?.exposure ?? null)

const abbr = (k: number) => windDir(k * 22.5, lang.value === 'en')
/** The direction's long name; the automatic suggestion says so — its visible "auto" caption is hidden from screen readers. */
const dirLabel = (k: number) => (suggested.value === k && selected.value !== k ? `${t(DIR_NAME_KEY[k])}, ${t('coast_suggested')}` : t(DIR_NAME_KEY[k]))
const pos = (k: number) => {
  const a = (k * 22.5 * Math.PI) / 180
  return { left: `${C + RING * Math.sin(a) - BTN / 2}px`, top: `${C - RING * Math.cos(a) - BTN / 2}px` }
}

/** The first tap turns an automatic spot manual — with pickedCoast's shape, not a copy of the automatic one. */
function pickDir(k: number) {
  emit('set', override.value ? { ...override.value, facing: k * 22.5 } : pickedCoast(k * 22.5, props.auto))
}
function pickSpread(s: CoastSpread) { if (override.value) emit('set', { ...override.value, spread: s }) }
function pickExposure(x: CoastExposure) { if (override.value) emit('set', { ...override.value, exposure: x }) }

// Roving tabindex: the selected direction (else the suggestion, else N) takes
// focus; arrows move by one point, Home goes to N.
const focusK = computed(() => selected.value ?? suggested.value ?? 0)
const dirBtns = ref<HTMLButtonElement[]>([])
function onKey(e: KeyboardEvent, k: number) {
  const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (k + 1) % 16
    : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (k + 15) % 16
    : e.key === 'Home' ? 0 : null
  if (next == null) return
  e.preventDefault()
  pickDir(next)
  void nextTick(() => dirBtns.value[next]?.focus())
}

/** A wedge from the centre, bearing a → b, radius r (SVG y points down). */
function wedge(a: number, b: number, r: number): string {
  if (b - a >= 360) return `M ${C - r} ${C} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`
  const p = (d: number) => `${(C + r * Math.sin((d * Math.PI) / 180)).toFixed(1)} ${(C - r * Math.cos((d * Math.PI) / 180)).toFixed(1)}`
  return `M ${C} ${C} L ${p(a)} A ${r} ${r} 0 ${b - a > 180 ? 1 : 0} 1 ${p(b)} Z`
}
/** Where the water is, for an automatic spot: one wedge per direction, radius by log fetch (0–25 km). */
const rose = computed(() => (override.value || !props.auto?.fetchKm.length ? [] : props.auto.fetchKm.map((f, k) => {
  const r = (Math.log10(1 + f) / Math.log10(26)) * ROSE
  return r > 0.5 ? wedge(k * 22.5 - 11.25, k * 22.5 + 11.25, r) : ''
}).filter(Boolean)))
/** The chosen sector, for a manual spot: facing ± spread / 2. */
const sector = computed(() => (override.value ? wedge(override.value.facing - override.value.spread / 2, override.value.facing + override.value.spread / 2, ROSE) : ''))
</script>

<template>
  <div class="coast-pick">
    <div class="cp-head">
      <strong>{{ t('coast_pick_title') }}</strong>
      <button class="cp-x" :aria-label="t('close')" :title="t('close')" @click="emit('close')">✕</button>
    </div>
    <p class="cp-hint">{{ t('coast_pick_hint') }}</p>

    <div class="compass" :style="{ width: SIZE + 'px', height: SIZE + 'px' }">
      <svg class="cp-svg" :viewBox="`0 0 ${SIZE} ${SIZE}`" aria-hidden="true">
        <circle :cx="C" :cy="C" :r="ROSE" class="cp-ring" />
        <path v-for="(d, i) in rose" :key="'r' + i" :d="d" class="cp-rose" />
        <path v-if="sector" :d="sector" class="cp-sector" />
        <circle :cx="C" :cy="C" r="4" class="cp-dot" />
      </svg>
      <div role="radiogroup" :aria-label="t('coast_pick_title')">
        <button v-for="k in DIRS" :key="k" ref="dirBtns" type="button" role="radio" class="cp-dir"
          :class="{ on: selected === k, sug: suggested === k && selected !== k }"
          :style="pos(k)" :aria-checked="selected === k" :aria-label="dirLabel(k)"
          :tabindex="focusK === k ? 0 : -1" @click="pickDir(k)" @keydown="onKey($event, k)">
          {{ abbr(k) }}
          <span v-if="suggested === k && selected !== k" class="cp-auto" aria-hidden="true">{{ t('coast_src_auto') }}</span>
        </button>
      </div>
    </div>

    <p class="cp-label">{{ t('coast_spread_label') }}</p>
    <div class="cp-chips">
      <button v-for="s in SPREADS" :key="s" type="button" class="cp-chip" :class="{ on: spread === s }"
        :disabled="!override" :aria-pressed="spread === s" @click="pickSpread(s)">{{ t(SPREAD_OPT_KEY[s]) }}</button>
    </div>
    <p class="cp-label">{{ t('coast_exp_label') }}</p>
    <div class="cp-chips">
      <button v-for="x in EXPOSURES" :key="x" type="button" class="cp-chip" :class="{ on: exposure === x }"
        :disabled="!override" :aria-pressed="exposure === x" @click="pickExposure(x)">{{ t(EXPOSURE_OPT_KEY[x]) }}</button>
    </div>

    <div class="cp-acts">
      <button type="button" class="btn ghost sm" :class="{ on: loc.coast === undefined }" @click="emit('set', undefined)">{{ t('coast_use_auto') }}</button>
      <button type="button" class="btn ghost sm" :class="{ on: loc.coast === 'none' }" @click="emit('set', 'none')">{{ t('coast_set_none') }}</button>
      <button v-if="status === 'failed'" type="button" class="btn ghost sm" @click="emit('retry')">{{ t('coast_retry') }}</button>
    </div>
    <p class="cp-osm"><OsmCredit :text="t('coast_osm')" /></p>
  </div>
</template>

<style scoped>
.coast-pick { margin-top: 8px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: rgba(56,189,248,.06); }
.cp-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 0.86rem; }
.cp-x { background: none; border: none; color: var(--muted); cursor: pointer; font-size: 0.9rem; padding: 2px 6px; }
.cp-hint { font-size: 0.74rem; color: var(--muted); margin: 6px 0 8px; }
.compass { position: relative; max-width: 100%; margin: 4px auto 6px; }
.cp-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.cp-ring { fill: none; stroke: var(--border); stroke-dasharray: 3 3; }
.cp-rose { fill: rgba(56,189,248,.35); stroke: none; }
.cp-sector { fill: rgba(56,189,248,.25); stroke: var(--primary); stroke-width: 1; }
.cp-dot { fill: var(--muted); }
.cp-dir {
  position: absolute; width: 34px; height: 34px; border-radius: 50%; padding: 0;
  border: 1px solid var(--border); background: var(--bg-card); color: var(--text);
  font-size: 0.62rem; font-weight: 600; cursor: pointer; line-height: 1;
}
.cp-dir:hover { border-color: var(--primary); }
.cp-dir:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.cp-dir.on { background: var(--primary); border-color: var(--primary); color: var(--bg); }
.cp-dir.sug { border: 1px dashed var(--primary); }
.cp-auto { position: absolute; left: 50%; bottom: -11px; transform: translateX(-50%); font-size: 0.5rem; color: var(--primary); font-weight: 400; }
.cp-label { font-size: 0.74rem; color: var(--muted); margin: 8px 0 4px; }
.cp-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.cp-chip { font-size: 0.74rem; padding: 4px 9px; border-radius: 10px; border: 1px solid var(--border); background: none; color: var(--muted); cursor: pointer; }
.cp-chip:hover:not(:disabled) { border-color: var(--primary); }
.cp-chip.on { border-color: var(--green); color: var(--green); background: rgba(34,197,94,.1); font-weight: 600; }
.cp-chip:disabled { cursor: default; opacity: 0.55; }
.cp-acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.cp-acts .btn.on { border-color: var(--primary); color: var(--primary); }
.cp-osm { font-size: 0.66rem; color: var(--muted); margin: 8px 0 0; }
</style>
