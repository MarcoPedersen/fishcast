<script setup lang="ts">
/**
 * Modeltjek: the conditions and bite-scores at the owner's trips with a
 * catch, at the trips without one, and at their usual time windows on the
 * same spots in the same weeks. The old panel compared the catches' scores
 * with nothing — "60 % of catches in good windows" is within the base rate of
 * the owner's own dawn windows — so it said "the model fits" on no evidence.
 *
 * Counts are always shown, nothing is claimed below MIN_N per group, and the
 * wording stays descriptive. Collapsed by default, so the log form stays near
 * the top on a phone.
 */
import { computed, ref, watch } from 'vue'
import { lang, t } from '@/lib/i18n'
import { entryWindow, findCatchLocation, isEmptyTrip, scoreBlocker, spotKey, tripOutings } from '@/lib/catchScore'
import {
  CAT_LABEL_KEY, FACTOR_LABEL_KEY, MIN_N, cellDisplay, conditionTable, distinctDays, highlights, modelPointsTable,
  summariseGroup, verdict, type CatCell, type GroupId, type Highlight, type Sentence,
} from '@/lib/catchInsights'
import { insight, insightGroups, runAnalysis, runFingerprint } from '@/lib/insightRun'
import type { Availability, CatchEntry, Location } from '@/lib/types'

const props = defineProps<{
  entries: CatchEntry[]
  locations: Location[]
  availability: Availability[]
  targetSpecies: string[]
}>()

// Remembered per device; a blocked or private store just starts closed.
const OPEN_KEY = 'fc2-modelcheck-open'
const open = ref((() => { try { return localStorage.getItem(OPEN_KEY) === '1' } catch { return false } })())
watch(open, (v) => { try { localStorage.setItem(OPEN_KEY, v ? '1' : '0') } catch { /* not remembered */ } })

const analysable = computed(() => props.entries.filter((e) => !scoreBlocker(e, props.locations)))
// Catches from one outing are one trip with a catch, here as in the groups.
const catchTripCount = computed(() =>
  new Set(analysable.value.filter((e) => !isEmptyTrip(e)).map((e) => `${e.date}|${spotKey(e, props.locations)}`)).size)
// …and a trip logged twice (two devices offline) is one trip without a catch.
const emptyCount = computed(() => tripOutings(analysable.value.filter((e) => isEmptyTrip(e)), props.locations).length)
// Entries that would be analysable but are past MAX_SCORE_AGE_DAYS. Shown
// even when nothing else is, or the "not included" line never appears.
const tooOld = computed(() => props.entries.filter((e) =>
  scoreBlocker(e, props.locations) === 'old' && entryWindow(e) && findCatchLocation(e, props.locations)).length)
const visible = computed(() => analysable.value.length > 0 || tooOld.value > 0)

const fresh = computed(() => insight.run?.fp === runFingerprint(props.entries, props.locations, props.availability, props.targetSpecies))
const data = computed(() => (fresh.value ? insightGroups(props.entries, props.locations, props.targetSpecies, insight.run!.base) : null))
const sums = computed(() => data.value && {
  catch: summariseGroup(data.value.groups.catch),
  empty: summariseGroup(data.value.groups.empty),
  base: summariseGroup(data.value.groups.base),
})
const baseDays = computed(() => (data.value ? distinctDays(data.value.groups.base) : 0))
const sentences = computed(() => (data.value ? verdict(data.value.groups) : []))
const rows = computed(() => (data.value ? conditionTable(data.value.groups) : []))
const said = computed(() => highlights(rows.value))
const points = computed(() => (data.value ? modelPointsTable(data.value.groups) : []))

function run() {
  runAnalysis(props.entries, props.locations, props.availability, props.targetSpecies)
}

const fill = (s: string, params: Record<string, string | number>) =>
  Object.entries(params).reduce((out, [k, v]) => out.replace(`{${k}}`, String(v)), s)
const say = (s: Sentence) => fill(t(s.key), s.params)
const pct = (x: number) => (lang.value === 'da' ? `${x} %` : `${x}%`)
const count = (n: number, one: string, many: string) => (n === 1 ? t(one) : fill(t(many), { n }))

const countLine = computed(() => fill(t('insight_count'), { a: count(catchTripCount.value, 'insight_trip_one', 'insight_trip_many'), b: emptyCount.value }))
const summaryLine = computed(() => (sentences.value.length ? say(sentences.value[0]) : countLine.value))
const progressText = computed(() => `⏳ ${fill(t('insight_progress'), { i: insight.progress.i, n: insight.progress.n })}`)

const GROUPS: GroupId[] = ['catch', 'empty', 'base']
const GROUP_KEY: Record<GroupId, string> = { catch: 'insight_g_catch', empty: 'insight_g_empty', base: 'insight_g_base' }
const noBase = computed(() => !props.availability.length)

/** Bite-score cell: the scores themselves below MIN_N ("58 · 64 · 71"), else the mean. */
function scoreCell(g: GroupId): string {
  const s = sums.value?.[g]
  if (!s?.n || (g === 'base' && noBase.value)) return '–'
  return s.mean == null ? s.scores.map((v) => Math.round(v)).join(' · ') : fill(t('insight_mean'), { v: Math.round(s.mean) })
}
function goodCell(g: GroupId): string {
  const s = sums.value?.[g]
  return s?.goodShare == null ? '–' : pct(Math.round(s.goodShare * 100))
}
function catCell(c: CatCell, g: GroupId): { main: string; small: string } {
  if (!c.nf) return { main: '–', small: '' }
  const d = cellDisplay(c, g)
  if (d.pct == null) return { main: fill(t(d.hours ? 'insight_of_hours' : 'insight_of'), { k: d.k, n: d.n }), small: '' }
  return { main: pct(d.pct), small: g === 'base' ? '' : d.hours ? fill(t('insight_hours_short'), { k: d.k }) : String(d.k) }
}
/**
 * "Daggry: 3 af 5 ture med fangst (60 %) mod 28 % af dine tidsvinduer" —
 * with its counts, so a share of 5 never reads like a share of 500. An
 * hour-weighted factor is a share of hours, and says so.
 */
function highlightText(h: Highlight): string {
  const x = (c: CatCell) => pct(Math.round(c.share! * 100))
  const H_KEY = { catch: 'insight_h_catch', empty: 'insight_h_empty', base: 'insight_h_base' }
  const part = (c: CatCell, g: 'catch' | 'empty' | 'base') =>
    c.hn != null ? fill(t('insight_diff_base'), { x: x(c), g: t(H_KEY[g]) })
    : g === 'base' ? fill(t('insight_diff_base'), { x: x(c), g: t('insight_n_base') })
    : fill(t('insight_diff_part'), { k: Math.round(c.k), n: c.nf, g: t(g === 'catch' ? 'insight_n_catch' : 'insight_n_empty'), x: x(c) })
  return fill(t('insight_diff'), { factor: t(FACTOR_LABEL_KEY[h.factor]), cat: t(CAT_LABEL_KEY[h.factor][h.cat]), a: part(h.a, 'catch'), b: part(h.b, h.vs) })
}
function fmtPoints(v: number | null): string {
  if (v == null) return '–'
  const abs = Math.abs(v).toFixed(1)
  const s = lang.value === 'da' ? abs.replace('.', ',') : abs
  return (v > 0.05 ? '+' : v < -0.05 ? '−' : '') + s
}
const thin = (g: GroupId) => (sums.value?.[g].n ?? 0) < MIN_N
</script>

<template>
  <div v-if="visible" class="card modelcheck">
    <div class="mc-head">
      <button type="button" class="mc-toggle" :aria-expanded="open" @click="open = !open">
        <span class="chev" aria-hidden="true">{{ open ? '▾' : '▸' }}</span>
        <strong>🔬 {{ t('insight_title') }}</strong>
      </button>
      <button v-if="analysable.length" class="btn ghost sm" :disabled="insight.running" @click="run">
        {{ insight.running ? progressText : t('insight_run') }}
      </button>
    </div>
    <p v-if="!open" class="mc-sub">{{ summaryLine }}</p>

    <template v-if="open">
      <p class="mc-sub">{{ t('insight_sub') }}</p>
      <p class="mc-sub">{{ countLine }}</p>
      <p v-if="tooOld" class="mc-sub">{{ count(tooOld, 'insight_too_old_one', 'insight_too_old_many') }}</p>
      <p class="mc-sub">{{ t('insight_targets_note') }}</p>

      <template v-if="data && sums">
        <p v-if="data.failed" class="mc-sub warn">{{ fill(t('insight_failed'), { n: data.failed }) }}</p>
        <p v-if="data.overlapping" class="mc-sub">{{ count(data.overlapping, 'insight_overlap_one', 'insight_overlap_many') }}</p>

        <table class="mc-table">
          <colgroup><col class="c-lbl" /><col class="c-num" /><col class="c-num" /><col class="c-num" /></colgroup>
          <thead>
            <tr>
              <th></th>
              <th v-for="g in GROUPS" :key="g" scope="col">
                {{ t(GROUP_KEY[g]) }}
                <small v-if="g !== 'base'">({{ sums[g].n }})</small>
                <small v-else-if="!noBase">{{ fill(t('insight_base_n'), { w: sums.base.n, d: baseDays }) }}</small>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">{{ t('insight_row_score') }}</th>
              <td v-for="g in GROUPS" :key="g" :class="{ dim: thin(g) }">{{ scoreCell(g) }}</td>
            </tr>
            <tr>
              <th scope="row">{{ t('insight_row_good') }}</th>
              <td v-for="g in GROUPS" :key="g">{{ goodCell(g) }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="noBase" class="mc-sub">{{ t('insight_no_baseline') }}</p>

        <div class="mc-verdict">
          <p v-for="(s, i) in sentences" :key="i">{{ say(s) }}</p>
          <p v-for="h in said" :key="h.factor" class="hl">{{ highlightText(h) }}</p>
        </div>

        <details v-if="rows.length" class="mc-more">
          <summary>{{ t('insight_cond_title') }}</summary>
          <table class="mc-table">
            <colgroup><col class="c-lbl" /><col class="c-num" /><col class="c-num" /><col class="c-num" /></colgroup>
            <tbody v-for="r in rows" :key="r.factor">
              <tr class="f-head">
                <th colspan="4" scope="rowgroup">
                  {{ t(FACTOR_LABEL_KEY[r.factor]) }}
                  <small v-if="r.dataNote">{{ fill(t('insight_has_data'), { k: r.dataNote.k, n: r.dataNote.n }) }}</small>
                </th>
              </tr>
              <tr v-for="c in r.cats" :key="c.cat" :class="{ hl: c.highlight }">
                <th scope="row">{{ t(CAT_LABEL_KEY[r.factor][c.cat]) }}</th>
                <td v-for="g in GROUPS" :key="g">
                  {{ catCell(c.cells[g], g).main }}<small v-if="catCell(c.cells[g], g).small">{{ catCell(c.cells[g], g).small }}</small>
                </td>
              </tr>
            </tbody>
          </table>
        </details>

        <details v-if="points.length" class="mc-more">
          <summary>{{ t('insight_points_title') }}</summary>
          <p class="mc-sub">{{ t('insight_points_sub') }}</p>
          <table class="mc-table">
            <colgroup><col class="c-lbl" /><col class="c-num" /><col class="c-num" /><col class="c-num" /></colgroup>
            <thead>
              <tr><th></th><th v-for="g in GROUPS" :key="g" scope="col">{{ t(GROUP_KEY[g]) }}</th></tr>
            </thead>
            <tbody>
              <tr v-for="p in points" :key="p.key">
                <th scope="row">{{ p.icon }} {{ t(p.key) }}</th>
                <td v-for="g in GROUPS" :key="g" :class="{ dim: thin(g) }">{{ fmtPoints(p.values[g]) }}</td>
              </tr>
            </tbody>
          </table>
        </details>
      </template>

      <details class="mc-more">
        <summary>ⓘ {{ t('insight_how_title') }}</summary>
        <p class="mc-sub">{{ t('insight_footnote') }}</p>
        <p class="mc-sub">{{ t('insight_hours_note') }}</p>
        <p class="mc-sub">{{ t('insight_tide_note') }}</p>
        <p class="mc-sub">{{ t('insight_base_note') }}</p>
        <p class="mc-sub">{{ t('insight_archive_note') }}</p>
      </details>
    </template>
  </div>
</template>

<style scoped>
.modelcheck { margin-top: 12px; }
.mc-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.mc-toggle {
  display: flex; align-items: center; gap: 6px; background: none; border: none; padding: 4px 0;
  color: var(--text); cursor: pointer; font: inherit; text-align: left;
}
.chev { color: var(--muted); width: 1em; }
.mc-sub { font-size: 0.74rem; color: var(--muted); margin-top: 4px; line-height: 1.45; }
.mc-sub.warn { color: var(--gold); }
.mc-table { width: 100%; table-layout: fixed; border-collapse: collapse; margin-top: 10px; font-size: 0.74rem; }
.c-lbl { width: 40%; }
.c-num { width: 20%; }
.mc-table th, .mc-table td { padding: 4px 4px; vertical-align: top; overflow-wrap: anywhere; }
.mc-table thead th { font-weight: 600; color: var(--text); text-align: right; line-height: 1.3; }
.mc-table thead th small { display: block; font-weight: 400; color: var(--muted); }
.mc-table tbody th { text-align: left; font-weight: 400; color: var(--muted); }
.mc-table td { text-align: right; color: var(--text); font-variant-numeric: tabular-nums; }
.mc-table td small { color: var(--muted); font-size: 0.66rem; margin-left: 3px; white-space: nowrap; }
.mc-table tr + tr { border-top: 1px solid var(--border); }
.mc-table .f-head th { padding-top: 10px; color: var(--text); font-weight: 600; }
.mc-table .f-head th small { font-weight: 400; color: var(--muted); }
.mc-table tr.hl th, .mc-table tr.hl td { color: var(--text); font-weight: 700; }
.mc-table td.dim { color: var(--muted); }
.mc-verdict { margin-top: 10px; font-size: 0.78rem; line-height: 1.5; }
.mc-verdict p + p { margin-top: 4px; }
.mc-verdict .hl { font-weight: 600; }
.mc-more { margin-top: 10px; }
.mc-more summary { cursor: pointer; font-size: 0.78rem; color: var(--primary); }
</style>
