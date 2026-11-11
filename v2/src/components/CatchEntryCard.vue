<script setup lang="ts">
/**
 * One entry of the catch log: the catch (or the trip without one), when and
 * where, its regulation warnings and its bite-score. A component of its own
 * so the log's form can re-render without it: in the view's template, every
 * keystroke in the form re-ran every card's warnings, place and score
 * lookups, each lookup a JSON fingerprint, about 100 ms a keystroke at 150
 * entries. Here they are computeds: they run again only when the entry, the
 * spots, the targets, the coasts, the day, the language (the warnings, the
 * hint and the chips are worded) or this entry's own result or loading change.
 */
import { computed, ref } from 'vue'
import { t } from '@/lib/i18n'
import { catchPlaceName, findCatchLocation, isEmptyTrip, scoreBlocker } from '@/lib/catchScore'
import { catchWarnings } from '@/lib/catchGuard'
import { CAT_LABEL_KEY, FACTORS, FACTOR_ICON, FACTOR_LABEL_KEY, dominant, type WindowSample } from '@/lib/catchInsights'
import { coastOutdated, insight, resultFor, scoreOne } from '@/lib/insightRun'
import { scoreColor, scoreLabel } from '@/lib/scoring'
import { methodLabel, speciesLabel } from '@/lib/catchLabels'
import type { ShoreMap } from '@/lib/coast'
import type { CatchEntry, Location } from '@/lib/types'

const props = defineProps<{
  entry: CatchEntry
  locations: Location[]
  targets: string[]
  shores: ShoreMap
  /** Today, as localDayUTC: when an entry gets too old to score moves with it. */
  today: number
  /** The entry is open in the form. */
  active: boolean
}>()
const emit = defineEmits<{ edit: [entry: CatchEntry]; remove: [entry: CatchEntry] }>()

const empty = computed(() => isEmptyTrip(props.entry))
const place = computed(() => catchPlaceName(props.entry, props.locations))

// Regulation warnings (undersize / closed season), as the form shows them:
// a saved spot's water type and position pick the rules.
const warnings = computed(() => {
  if (empty.value) return []
  const c = props.entry
  const loc = findCatchLocation(c, props.locations)
  return catchWarnings(c.speciesId, c.lengthCm, c.date, c.released, loc?.waterType, loc)
})

// ── Bite-score ──────────────────────────────────────────────────────
// Lazily computed, in the store insightRun shares with the Modeltjek panel —
// so a card and the panel never show two numbers for one entry. A result is
// only read back while the entry (and the setup it was scored with) is
// unchanged; 'failed' = the weather fetch errored (offline, a 5xx), which is
// worth another try, unlike null = no data for that hour.
//
// What keeps it from being scored. scoreBlocker reads the clock ('old'), and
// a computed with a bare new Date() freezes at its first run (lib/clock), so
// it reads the day too and runs again when the day turns.
const blocker = computed(() => {
  void props.today
  return scoreBlocker(props.entry, props.locations)
})
// Without this the whole score line vanished when an entry couldn't be scored —
// no number, no button, no reason. Say which piece is missing instead.
const hint = computed(() => {
  const b = blocker.value
  return b === 'time' ? t(empty.value ? 'log_score_need_span' : 'log_score_need_time')
    : b === 'location' ? t('log_score_need_loc')
    : b === 'old' ? t('log_score_too_old')
    : null
})
const result = computed(() => resultFor(props.entry, props.locations, props.targets))
const scored = computed(() => { const r = result.value; return r && r !== 'failed' ? r : null })
const loading = computed(() => insight.loading.has(props.entry.id))
// The spot's coast landed (or was picked) after the score: it stays, and says
// so with a "Beregn igen" — it used to vanish back to the button (review C9).
const coastMoved = computed(() => coastOutdated(props.entry, props.locations, props.targets, props.shores))
function score() { scoreOne(props.entry, props.locations, props.targets, props.shores) }

// "▸ Forhold": the entry's dominant conditions, one chip per factor with data.
// The factor is named in the chip: in a title only (never shown on touch),
// "🌡️ Stabilt" read as a stable temperature and "🌙 Ingen" as no moon.
const condOpen = ref(false)
function conditionChips(s: WindowSample) {
  return FACTORS.flatMap((f) => {
    const c = dominant(s.hours, f)
    return c ? [{ f, text: `${FACTOR_ICON[f]} ${t(FACTOR_LABEL_KEY[f])}: ${t(CAT_LABEL_KEY[f][c])}` }] : []
  })
}
const chips = computed(() => (scored.value ? conditionChips(scored.value) : []))

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y) return iso
  const dt = new Date(y, (m || 1) - 1, d || 1)
  return `${t('day' + dt.getDay())} ${d}. ${t('month' + (m - 1))} ${y}`
}
</script>

<template>
  <div class="card entry" :class="{ active }">
    <div class="entry-main">
      <div class="entry-top">
        <span v-if="empty" class="sp nofish">{{ t('log_trip_label') }}</span>
        <span v-else class="sp">
          {{ speciesLabel(entry.speciesId) }}
          <span v-if="entry.count && entry.count > 1" class="qty">×{{ entry.count }}</span>
          <span v-if="entry.released === true" class="rel released">🌊 {{ t('log_released') }}</span>
          <span v-else-if="entry.released === false" class="rel kept">🧺 {{ t('log_kept') }}</span>
        </span>
        <span v-if="!empty" class="sizes">
          <span v-if="entry.lengthCm != null" class="size">📏 {{ entry.lengthCm }} cm</span>
          <span v-if="entry.weightKg != null" class="size">⚖️ {{ entry.weightKg }} kg</span>
        </span>
      </div>
      <div class="entry-meta">
        🗓 {{ fmtDate(entry.date) }}
        <template v-if="empty && entry.from && entry.to"> 🕐 {{ entry.from }}–{{ entry.to }}</template>
        <template v-else-if="entry.time"> 🕐 {{ entry.time }}</template>
        <template v-if="place"> · 📍 {{ place }}</template>
        <template v-if="entry.method"> · {{ methodLabel(entry.method) }}</template>
      </div>
      <p v-if="entry.notes" class="entry-notes">{{ entry.notes }}</p>
      <div v-if="warnings.length" class="guard entry-guard">
        <div v-for="(g, k) in warnings" :key="k">⚠️ {{ g }}</div>
      </div>
      <p v-if="hint" class="score-hint">📊 {{ hint }}</p>
      <div v-if="!blocker" class="score-line">
        <span v-if="loading" class="muted sm">{{ t('log_scoring') }}</span>
        <button v-else-if="result === undefined || result === 'failed'" class="btn ghost sm" @click="score">
          {{ result === 'failed' ? t('log_score_retry') : t('log_score_btn') }}
        </button>
        <template v-else-if="scored">
          <span class="cscore" :class="scoreColor(scored.window.score)">{{ scored.window.score }}</span>
          <span class="cscore-lbl">
            {{ t(empty ? 'log_score_trip_label' : 'log_score_label') }} · {{ scoreLabel(scored.window.score) }}
          </span>
          <button type="button" class="cond-toggle" :aria-expanded="condOpen" @click="condOpen = !condOpen">
            <span aria-hidden="true">{{ condOpen ? '▾' : '▸' }}</span> {{ t('log_conditions') }}
          </button>
        </template>
        <span v-else class="muted sm">{{ t('log_score_na') }}</span>
        <span v-if="result === 'failed' && !loading" class="muted sm">{{ t('log_score_failed') }}</span>
        <template v-if="scored && !loading && coastMoved">
          <span class="muted sm">🧭 {{ t('log_score_coast_stale') }}</span>
          <button class="btn ghost sm" @click="score">{{ t('log_score_rerun') }}</button>
        </template>
      </div>
      <p v-if="scored && condOpen" class="cond-line">
        <span v-for="ch in chips" :key="ch.f" class="chip">{{ ch.text }}</span>
      </p>
    </div>
    <div class="entry-actions">
      <button class="btn ghost sm" :title="t('log_edit')" :aria-label="t('log_edit')" @click="emit('edit', entry)">✎</button>
      <button class="btn ghost sm del" :title="t(empty ? 'log_trip_remove' : 'log_remove')"
        :aria-label="t(empty ? 'log_trip_remove' : 'log_remove')" @click="emit('remove', entry)">🗑</button>
    </div>
  </div>
</template>

<style scoped>
.entry { margin-top: 8px; display: flex; gap: 10px; align-items: flex-start; }
.entry.active { border-color: var(--primary); }
.entry-main { flex: 1; min-width: 0; }
.entry-top { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.entry-actions { display: flex; gap: 4px; flex-shrink: 0; }
.sp { font-weight: 700; font-size: 0.95rem; }
.sp.nofish { color: var(--muted); } /* not .empty: that is the empty-log box */
.qty { font-size: 0.78rem; font-weight: 700; color: var(--cyan); margin-left: 4px; }
.rel { font-size: 0.7rem; font-weight: 600; padding: 1px 7px; border-radius: 10px; border: 1px solid var(--border); margin-left: 6px; white-space: nowrap; }
.rel.released { color: var(--primary); border-color: rgba(56,189,248,.4); }
.rel.kept { color: var(--gold); border-color: rgba(245,158,11,.4); }
.sizes { display: flex; gap: 8px; }
.size { font-size: 0.78rem; color: var(--cyan); white-space: nowrap; }
.score-hint { font-size: 0.72rem; color: var(--muted); margin: 6px 0 0; }
.entry-meta { font-size: 0.78rem; color: var(--muted); margin-top: 4px; }
.entry-notes { font-size: 0.82rem; margin-top: 6px; white-space: pre-wrap; }
.guard { margin-top: 8px; font-size: 0.76rem; line-height: 1.5; color: var(--gold); }
.entry-guard { color: var(--gold); }
.score-line { display: flex; align-items: center; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.cscore { width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; font-size: 0.84rem; flex-shrink: 0; }
.cscore-lbl { font-size: 0.78rem; color: var(--muted); }
/* At least 24 px tall: at 2px padding it was an 18 px target beside the score. */
.cond-toggle { background: none; border: none; padding: 4px 6px; min-height: 24px; color: var(--primary); cursor: pointer; font-size: 0.78rem; }
.cond-line { display: flex; flex-wrap: wrap; gap: 4px 6px; margin-top: 6px; }
.chip { font-size: 0.72rem; color: var(--muted); padding: 1px 7px; border: 1px solid var(--border); border-radius: 10px; white-space: nowrap; }
.score-great { background: rgba(34, 197, 94, 0.2); color: var(--green); }
.score-good  { background: rgba(56, 189, 248, 0.2); color: var(--primary); }
.score-avg   { background: rgba(245, 158, 11, 0.2); color: var(--gold); }
.score-poor  { background: rgba(239, 68, 68, 0.2);  color: var(--red); }
.muted { color: var(--muted); } .sm { font-size: 0.78rem; }
.del { flex-shrink: 0; }
</style>
