<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onBeforeUnmount, ref } from 'vue'
import { lang, spName, t } from '@/lib/i18n'
import { getScoredWindows, scoreColor, scoreLabel } from '@/lib/scoring'
import { SPECIES_PREFS } from '@/lib/species'
import type { ScoredWindow } from '@/lib/types'
import { useForecastStore } from '@/stores/forecast'
import { useSetupStore } from '@/stores/setup'
import SeasonsTab from '@/components/SeasonsTab.vue'
import ConditionsTab from '@/components/ConditionsTab.vue'
// Lazy: pulls in Leaflet (~150 KB), so only load it if the tab is opened.
const MapTab = defineAsyncComponent(() => import('@/components/MapTab.vue'))
import MoonCard from '@/components/MoonCard.vue'
import { shareWindowUrl, shareSetupUrl } from '@/lib/share'
import { downloadWindowIcs } from '@/lib/calendar'
import { confirmDialog } from '@/lib/confirm'
import { useModal } from '@/lib/useModal'
import { enableNotifications, disableNotifications, notifsEnabled, scheduleWindowNotifications } from '@/lib/notifications'

const setup = useSetupStore()
const fc = useForecastStore()

const copied = ref<string | null>(null)
async function copy(url: string, key: string) {
  // Only show "✓ copied" when the write actually succeeded (clipboard access
  // can be denied or unavailable on insecure contexts).
  try {
    await navigator.clipboard.writeText(url)
    copied.value = key
    setTimeout(() => { if (copied.value === key) copied.value = null }, 2000)
  } catch { /* leave the button as-is so the user can retry */ }
}
// Stable identity for a window card — the list re-sorts on refresh, so index
// keys would let open panels / "copied" ticks jump between unrelated windows.
function wkey(w: ScoredWindow): string {
  return `${w.location.id}|${w.date.getTime()}|${w.from}`
}
function shareWindow(w: ScoredWindow) { copy(shareWindowUrl(w), 'w' + wkey(w)) }
function shareSetup() { copy(shareSetupUrl(setup.locations, setup.targetSpecies, setup.availability), 'setup') }

async function clearWeather() { if (await confirmDialog(t('reset_data_confirm'))) fc.clearWeather() }
async function resetChoices() { if (await confirmDialog(t('reset_choices_confirm'))) setup.resetChoices() }

const tab = ref<'windows' | 'map' | 'seasons' | 'conditions'>('windows')

onMounted(() => fc.fetchAll(setup.locations))

const windows = computed(() =>
  getScoredWindows(setup.locations, setup.availability, fc.forecasts, setup.targetSpecies, fc.lightning),
)
// Per (location + time-slot), the score across all upcoming days — drives the
// little forecast trend strip under each card (improving vs declining).
const trends = computed(() => {
  const m = new Map<string, ScoredWindow[]>()
  for (const w of windows.value) {
    const key = `${w.location.id}|${w.from}-${w.to}`
    if (!m.has(key)) m.set(key, [])
    m.get(key)!.push(w)
  }
  for (const arr of m.values()) arr.sort((a, b) => a.date.getTime() - b.date.getTime())
  return m
})
function trendFor(w: ScoredWindow) {
  return trends.value.get(`${w.location.id}|${w.from}-${w.to}`) ?? []
}
function barH(score: number): string { return `${4 + Math.round((score / 100) * 22)}px` }
function dayShort(d: Date): string { return t('day' + d.getDay()) }
function sameDay(a: Date, b: Date): boolean { return a.getTime() === b.getTime() }

const loading = computed(() => Object.values(fc.status).some((s) => s === 'loading'))
// First load = fetching with nothing cached yet → show skeletons instead of the
// empty "no windows" notice or a flash of "?" cards.
const firstLoad = computed(() => loading.value && !Object.keys(fc.forecasts).length)

// "Updated Xm ago" — tracks the most recent successful fetch. `now` ticks each
// minute so the relative label stays current without a refresh.
const now = ref(Date.now())
let nowTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => { nowTimer = setInterval(() => { now.value = Date.now() }, 60_000) })
onBeforeUnmount(() => clearInterval(nowTimer))
const lastFetched = computed(() => {
  const ts = Object.values(fc.forecasts).map((f) => f.fetched)
  return ts.length ? Math.max(...ts) : 0
})
const updatedLabel = computed(() => {
  if (!lastFetched.value) return ''
  const mins = Math.floor((now.value - lastFetched.value) / 60_000)
  const rel = mins < 1 ? t('time_just_now')
    : mins < 60 ? `${mins} ${t('time_min_ago')}`
    : `${Math.floor(mins / 60)} ${t('time_hr_ago')}`
  return `${t('updated_prefix')} ${rel}`
})

const notifOn = ref(notifsEnabled())
async function toggleNotifs() {
  if (notifOn.value) { disableNotifications(); notifOn.value = false; return }
  if (await enableNotifications()) { notifOn.value = true; scheduleWindowNotifications(windows.value) }
}
// NB: ongoing re-scheduling is handled app-wide in App.vue (timers die with the
// tab, so they must re-arm on start/focus regardless of the open view). Here we
// only schedule immediately on enabling, for instant feedback.

const openTips = ref<string | null>(null)
const detail = ref<ScoredWindow | null>(null)
const { dialogRef: detailRef } = useModal(() => detail.value != null, () => { detail.value = null })

function fmtDate(d: Date): string {
  return `${t('day' + d.getDay())} ${d.getDate()}. ${t('month' + d.getMonth())}`
}

// Forecast confidence by lead time — accuracy degrades the further out a window
// is, so flag it. Near-term (≤1 day) is treated as high and shown unmarked.
function conf(d: Date): { days: number; level: 'high' | 'med' | 'low' } {
  const n = new Date()
  const today = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())
  const days = Math.round((d.getTime() - today) / 86400000)
  return { days, level: days <= 1 ? 'high' : days <= 4 ? 'med' : 'low' }
}

// ── Density toggle (Simple ⇄ Full), remembered across visits ──────────
const density = ref<'full' | 'simple'>(
  localStorage.getItem('fc2-dash-density') === 'simple' ? 'simple' : 'full',
)
function setDensity(d: 'full' | 'simple') {
  density.value = d
  localStorage.setItem('fc2-dash-density', d)
}

// ── Horizon: how far ahead to look ────────────────────────────────────
// The list is score-sorted, so without this a great day 5 days out buries
// today. Purely a display filter — reminders (App.vue) still watch all 7 days.
const HORIZONS = [1, 3, 7] as const
type Horizon = (typeof HORIZONS)[number]
const horizon = ref<Horizon>(
  (Number(localStorage.getItem('fc2-dash-horizon')) as Horizon) || 7,
)
if (!HORIZONS.includes(horizon.value)) horizon.value = 7
function setHorizon(h: Horizon) {
  horizon.value = h
  localStorage.setItem('fc2-dash-horizon', String(h))
  // A day filter outside the new horizon would leave an empty list.
  if (dayFilter.value != null && conf(new Date(dayFilter.value)).days >= h) dayFilter.value = null
}
/** Windows inside the chosen horizon — the basis for everything displayed. */
const inHorizon = computed(() => windows.value.filter((w) => conf(w.date).days < horizon.value))

// ── Week-at-a-glance: best achievable score per day across all spots ──
const weekDays = computed(() => {
  const byDay = new Map<number, number>()
  for (const w of inHorizon.value) {
    if (w.noData) continue
    const k = w.date.getTime()
    byDay.set(k, Math.max(byDay.get(k) ?? 0, w.score))
  }
  const n = new Date()
  const base = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())
  return Array.from({ length: horizon.value }, (_, i) => {
    const dt = new Date(base + i * 86400000)
    return { t: base + i * 86400000, date: dt, best: byDay.get(base + i * 86400000) ?? null }
  })
})

// Click a week-strip day to filter the list to it (click again to clear).
const dayFilter = ref<number | null>(null)
function toggleDay(tms: number) { dayFilter.value = dayFilter.value === tms ? null : tms }

// Top recommendation in the horizon (windows are score-sorted; first with data wins).
const topPick = computed(() => inHorizon.value.find((w) => !w.noData && w.breakdown) ?? null)

// Windows actually shown (honours the day filter).
const shownWindows = computed(() =>
  dayFilter.value == null ? inHorizon.value : inHorizon.value.filter((w) => w.date.getTime() === dayFilter.value),
)
</script>

<template>
  <div class="dash">
    <div class="tabbar">
      <button class="tab" :class="{ active: tab === 'windows' }" @click="tab = 'windows'">{{ t('tab_windows') }}</button>
      <button class="tab" :class="{ active: tab === 'map' }" @click="tab = 'map'">{{ t('tab_map') }}</button>
      <button class="tab" :class="{ active: tab === 'seasons' }" @click="tab = 'seasons'">{{ t('tab_seasons') }}</button>
      <button class="tab" :class="{ active: tab === 'conditions' }" @click="tab = 'conditions'">{{ t('tab_conditions') }}</button>
    </div>

    <MapTab v-if="tab === 'map'" :windows="inHorizon" />
    <SeasonsTab v-else-if="tab === 'seasons'" />
    <ConditionsTab v-else-if="tab === 'conditions'" />

    <template v-else>
    <div class="row between head">
      <span class="muted-h">{{ t('tab_windows') }}
        <span v-if="updatedLabel && !firstLoad" class="updated">· {{ updatedLabel }}</span>
      </span>
      <div class="head-actions">
        <div class="density" role="group" :aria-label="t('dash_horizon')">
          <button v-for="h in HORIZONS" :key="h" class="dbtn" :class="{ on: horizon === h }"
            :title="t('dash_horizon')" @click="setHorizon(h)">
            {{ h === 1 ? t('dash_h_today') : h + ' ' + t('dash_h_days') }}
          </button>
        </div>
        <div class="density" role="group" :aria-label="t('dash_view')">
          <button class="dbtn" :class="{ on: density === 'simple' }" @click="setDensity('simple')">{{ t('dash_simple') }}</button>
          <button class="dbtn" :class="{ on: density === 'full' }" @click="setDensity('full')">{{ t('dash_full') }}</button>
        </div>
        <button class="btn ghost sm" :class="{ on: notifOn }" @click="toggleNotifs">
          {{ notifOn ? t('notif_enabled') : t('notif_enable') }}
        </button>
        <button class="btn ghost sm" @click="shareSetup">{{ copied === 'setup' ? t('share_copied') : t('share_setup_btn') }}</button>
        <button class="btn ghost sm" :disabled="loading" @click="fc.fetchAll(setup.locations)">
          {{ loading ? '⏳ ' + t('loading') : t('update_all') }}
        </button>
      </div>
    </div>

    <div v-if="setup.targetSpecies.length" class="targets">
      {{ t('dash_targets') }}
      <span v-for="id in setup.targetSpecies" :key="id" class="pill">
        {{ SPECIES_PREFS[id]?.emoji }} {{ spName(SPECIES_PREFS[id]) }}
      </span>
    </div>

    <!-- Week at a glance: best score per day; tap a day to filter the list -->
    <div v-if="!firstLoad && inHorizon.length" class="weekstrip">
      <button v-for="d in weekDays" :key="d.t" class="wday"
        :class="{ active: dayFilter === d.t, empty: d.best == null }"
        :disabled="d.best == null" @click="toggleDay(d.t)">
        <span class="wday-lbl">{{ dayShort(d.date).charAt(0) }}</span>
        <span class="wday-bar-wrap"><span class="wday-bar" :class="d.best != null ? scoreColor(d.best) : ''"
          :style="{ height: d.best != null ? barH(d.best) : '3px' }"></span></span>
        <span class="wday-score">{{ d.best != null ? d.best : '–' }}</span>
      </button>
    </div>

    <!-- Top pick this week -->
    <button v-if="!firstLoad && topPick" class="toppick" @click="detail = topPick">
      <span class="tp-medal">🏆</span>
      <span class="tp-body">
        <span class="tp-title">{{ t('dash_top_pick') }}</span>
        <span class="tp-detail">{{ topPick.location.name }} · {{ fmtDate(topPick.date) }} · {{ topPick.from }}–{{ topPick.to }}</span>
      </span>
      <span class="tp-score" :class="scoreColor(topPick.score)">{{ topPick.score }}</span>
    </button>

    <!-- Day filter active → show a clear affordance -->
    <div v-if="dayFilter != null && !firstLoad" class="dayfilter">
      {{ t('dash_showing_day') }} <strong>{{ fmtDate(new Date(dayFilter)) }}</strong>
      <button class="btn ghost sm" @click="dayFilter = null">✕ {{ t('dash_show_all_days') }}</button>
    </div>

    <template v-if="firstLoad">
      <div v-for="n in 4" :key="'sk' + n" class="card win skel">
        <div class="score sk-circle"></div>
        <div class="body">
          <div class="sk-line w60"></div>
          <div class="sk-line w40"></div>
          <div class="sk-line w50"></div>
        </div>
      </div>
    </template>

    <p v-else-if="!windows.length" class="notice">{{ t('dash_no_windows') }}</p>
    <!-- Windows exist, just none inside the chosen horizon -->
    <p v-else-if="!inHorizon.length" class="notice">
      {{ t('dash_none_in_horizon') }}
      <button class="btn ghost sm" @click="setHorizon(7)">{{ t('dash_show_week') }}</button>
    </p>

    <!-- Simple view: one glanceable row per window -->
    <template v-if="!firstLoad && density === 'simple'">
      <button v-for="(w, i) in shownWindows.slice(0, 30)" :key="wkey(w)" class="srow"
        :disabled="w.noData || !w.breakdown" @click="detail = w">
        <span class="score sm" :class="scoreColor(w.score)"><span v-if="w.noData">?</span><span v-else>{{ w.score }}</span></span>
        <span class="srow-main">
          <span class="srow-when"><strong>{{ dayShort(w.date) }} {{ w.date.getDate() }}.</strong> · {{ w.from }}–{{ w.to }}
            <span v-if="i === 0 && dayFilter == null">🏆</span></span>
          <span class="srow-loc">📍 {{ w.location.name }}</span>
        </span>
        <span v-if="!w.noData" class="srow-label">{{ scoreLabel(w.score) }}</span>
        <span class="srow-chev">›</span>
      </button>
    </template>

    <!-- Full view -->
    <template v-else-if="!firstLoad">
    <div v-for="(w, i) in shownWindows.slice(0, 20)" :key="wkey(w)" class="card win" :class="{ top: i === 0 }">
      <button class="score" :class="scoreColor(w.score)" :title="t('score_breakdown_for')"
        :disabled="w.noData || !w.breakdown" @click="detail = w">
        <span v-if="w.noData">?</span><span v-else>{{ w.score }}</span>
      </button>
      <div class="body">
        <div class="title">
          <strong>{{ fmtDate(w.date) }}</strong> · {{ w.from }}–{{ w.to }}
          <span v-if="i === 0" class="badge">🏆</span>
          <span class="title-right">
            <span v-if="!w.noData && w.lure?.colors.length" class="lure-mini" :title="t('lure_label')">
              <span v-for="(c, k) in w.lure.colors" :key="k" class="swatch"
                :style="{ background: c.hex }" :title="c.name + ' — ' + c.reason"></span>
              <button class="tips-btn" :title="t('lure_label')" :aria-label="t('lure_label')"
                @click="openTips = openTips === wkey(w) ? null : wkey(w)">💡</button>
            </span>
            <button class="share-win" :title="t('share_btn')" :aria-label="t('share_btn')" @click="shareWindow(w)">
              {{ copied === 'w' + wkey(w) ? '✓' : '🔗' }}
            </button>
            <button v-if="!w.noData" class="share-win" :title="t('cal_add')" :aria-label="t('cal_add')" @click="downloadWindowIcs(w)">📅</button>
          </span>
        </div>
        <div class="meta">
          📍 {{ w.location.name }}
          <template v-if="w.bestHourStr"> · {{ t('best_hour') }} {{ w.bestHourStr }}</template>
          <template v-if="!w.noData"> · {{ scoreLabel(w.score) }}</template>
          <template v-if="!w.noData && conf(w.date).level !== 'high'">
            · <span class="conf" :class="'conf-' + conf(w.date).level" :title="t('conf_hint')">📡 {{ conf(w.date).days }} {{ t('conf_days') }}</span>
          </template>
        </div>
        <div v-if="w.tags.length" class="tags">
          <span v-for="(tag, j) in w.tags" :key="j" class="tag" :class="tag.cls">{{ tag.label }}</span>
        </div>
        <div v-if="!w.noData && trendFor(w).length > 1" class="trend" :title="t('dash_trend')">
          <button v-for="(d, k) in trendFor(w)" :key="k" class="tcol"
            :class="{ clickable: !d.noData && d.breakdown }"
            :disabled="d.noData || !d.breakdown"
            :title="`${dayShort(d.date)} · ${d.noData ? '—' : d.score} — ${t('score_breakdown_for')}`"
            @click="detail = d">
            <div class="tbar" :class="d.noData ? 'tbar-nodata' : scoreColor(d.score)" :style="{ height: d.noData ? '4px' : barH(d.score) }"></div>
            <span class="tlabel" :class="{ now: sameDay(d.date, w.date) }">{{ dayShort(d.date).charAt(0) }}</span>
          </button>
        </div>
        <!-- 💡 reveals the lure colour names (now compact swatches above) + any tips -->
        <div v-if="openTips === wkey(w) && !w.noData && w.lure?.colors.length" class="tips-panel">
          <div class="tip tip-colors">
            <span class="tip-lbl">{{ t('lure_label') }}</span>
            <span v-for="(c, k) in w.lure.colors" :key="k" class="tip-color" :title="c.reason">
              <span class="swatch" :style="{ background: c.hex }"></span> {{ c.name }}
            </span>
          </div>
          <div v-for="(tip, k) in w.lure.tips" :key="k" class="tip">{{ tip }}</div>
        </div>
        <div v-if="w.noData" class="nodata">
          ⚠️ {{ t('data_missing') }}
          <button class="btn primary sm" @click="fc.fetchFor(w.location)">⟳ {{ t('load_data_btn') }}</button>
        </div>
      </div>
    </div>
    </template>

    <MoonCard />

    <div class="data-footer">
      <button class="btn ghost sm" @click="clearWeather">{{ t('reset_data_btn') }}</button>
      <button class="btn ghost sm" @click="resetChoices">{{ t('reset_choices_btn') }}</button>
    </div>
    </template>

    <!-- Score breakdown modal -->
    <div v-if="detail" class="overlay" @click.self="detail = null">
      <div class="card modal" ref="detailRef" role="dialog" aria-modal="true" tabindex="-1"
        :aria-label="t('score_breakdown_for')">
        <div class="row between">
          <h3>{{ detail.score }} · {{ scoreLabel(detail.score) }}</h3>
          <button class="btn ghost sm" @click="detail = null">✕</button>
        </div>
        <div class="bd-for">
          {{ t('score_breakdown_for') }}
          <strong>{{ detail.location.name }} · {{ fmtDate(detail.date) }}</strong>
          · {{ detail.from }}–{{ detail.to }}
          <span v-if="conf(detail.date).level !== 'high'" class="conf" :class="'conf-' + conf(detail.date).level"
            :title="t('conf_hint')"> · 📡 {{ conf(detail.date).days }} {{ t('conf_days') }} · {{ t(conf(detail.date).level === 'low' ? 'conf_low' : 'conf_med') }}</span>
        </div>
        <div class="bd-table">
          <div v-for="(b, k) in detail.breakdown" :key="k" class="bd-row">
            <span class="bd-icon">{{ b.icon }}</span>
            <span class="bd-factor">{{ b.factor }}</span>
            <span class="bd-label">{{ b.label }}</span>
            <span class="bd-pts" :class="b.points > 0 ? 'pos' : b.points < 0 ? 'neg' : ''">
              {{ b.points > 0 ? '+' : '' }}{{ b.points }}
            </span>
          </div>
          <div class="bd-row total">
            <span class="bd-icon">🏁</span>
            <span class="bd-factor">{{ t('score_total') }}</span>
            <span class="bd-label"></span>
            <span class="bd-pts">{{ detail.score }}</span>
          </div>
        </div>
        <p class="bd-note">{{ t('bd_window_note') }}</p>

        <!-- Plain-language explanation of each factor that contributed -->
        <div class="bd-why">
          <strong class="bd-why-title">{{ t('bd_why_title') }}</strong>
          <ul>
            <li v-for="(b, k) in (detail.breakdown ?? []).filter((x) => x.key)" :key="k">
              <span class="bd-why-ico">{{ b.icon }}</span>
              <span><strong>{{ b.factor }}</strong> — {{ t(b.key + '_why') }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tabbar { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--border); }
.tab { background: none; border: none; color: var(--muted); cursor: pointer; padding: 10px 12px; font-size: 0.86rem; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.tab:hover { color: var(--text); }
.tab.active { color: var(--primary); border-bottom-color: var(--primary); font-weight: 700; }
.muted-h { font-size: 0.82rem; color: var(--muted); font-weight: 700; }
.updated { font-weight: 400; font-size: 0.74rem; opacity: 0.8; }
.head-actions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.btn.on { border-color: var(--green); color: var(--green); }

/* Density toggle */
.density { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.dbtn { background: none; border: none; color: var(--muted); cursor: pointer; font-size: 0.76rem; padding: 5px 10px; }
.dbtn.on { background: var(--primary); color: #07111f; font-weight: 700; }

/* Week-at-a-glance strip */
.weekstrip { display: flex; gap: 6px; margin: 12px 0; }
.wday {
  flex: 1; display: flex; flex-direction: column; align-items: center; gap: 4px;
  padding: 8px 2px 6px; border: 1px solid var(--border); border-radius: 10px;
  background: var(--bg-card); color: var(--muted); cursor: pointer; min-height: 66px; justify-content: flex-end;
}
.wday:hover:not(:disabled) { border-color: var(--primary); }
.wday.active { border-color: var(--primary); background: rgba(56,189,248,.12); }
.wday.empty { opacity: 0.45; cursor: default; }
.wday-lbl { font-size: 0.7rem; font-weight: 700; color: var(--text); }
.wday-bar-wrap { display: flex; align-items: flex-end; height: 26px; }
.wday-bar { width: 12px; border-radius: 3px 3px 0 0; min-height: 3px; }
.wday-bar.score-great { background: var(--green); }
.wday-bar.score-good  { background: var(--primary); }
.wday-bar.score-avg   { background: var(--gold); }
.wday-bar.score-poor  { background: var(--red); }
.wday-score { font-size: 0.72rem; font-weight: 700; color: var(--text); }

/* Top-pick hero */
.toppick {
  display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
  margin: 6px 0 4px; padding: 12px 14px; border-radius: 12px; cursor: pointer;
  background: rgba(34,197,94,.10); border: 1px solid rgba(34,197,94,.4); color: var(--text);
}
.toppick:hover { border-color: var(--green); }
.tp-medal { font-size: 1.4rem; }
.tp-body { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.tp-title { font-size: 0.72rem; color: var(--muted); font-weight: 700; text-transform: uppercase; letter-spacing: .03em; }
.tp-detail { font-size: 0.9rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tp-score { width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; flex-shrink: 0; }

/* Day filter banner */
.dayfilter { display: flex; align-items: center; gap: 10px; margin: 8px 0; font-size: 0.82rem; color: var(--muted); }

/* Simple-view rows */
.srow {
  display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
  margin-top: 6px; padding: 8px 12px; border-radius: 10px; cursor: pointer;
  background: var(--bg-card); border: 1px solid var(--border); color: var(--text);
}
.srow:hover:not(:disabled) { border-color: var(--primary); }
.srow[disabled] { cursor: default; }
.score.sm { width: 38px; height: 38px; font-size: 0.9rem; }
.srow-main { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.srow-when { font-size: 0.86rem; }
.srow-loc { font-size: 0.76rem; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.srow-label { font-size: 0.78rem; color: var(--muted); white-space: nowrap; }
.srow-chev { color: var(--muted); font-size: 1.1rem; }
.data-footer { display: flex; gap: 8px; justify-content: center; margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border); flex-wrap: wrap; }
.share-win { background: none; border: none; cursor: pointer; font-size: 0.85rem; opacity: 0.65; padding: 0; }
.share-win:hover { opacity: 1; }
.title { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.title-right { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; }
.lure-mini { display: inline-flex; align-items: center; gap: 4px; }
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
.conf { cursor: help; white-space: nowrap; }
.conf-med { color: var(--gold); }
.conf-low { color: var(--red); }
.tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.trend { display: flex; gap: 5px; align-items: flex-end; margin-top: 10px; height: 40px; }
.tcol { display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 3px; background: none; border: none; padding: 2px 1px 0; cursor: default; }
.tcol.clickable { cursor: pointer; }
.tcol.clickable:hover .tbar { outline: 2px solid var(--primary); outline-offset: 1px; }
.tcol.clickable:hover .tlabel { color: var(--text); }
.tbar { width: 13px; border-radius: 3px 3px 0 0; min-height: 4px; }
.tbar.score-great { background: var(--green); }
.tbar.score-good  { background: var(--primary); }
.tbar.score-avg   { background: var(--gold); }
.tbar.score-poor  { background: var(--red); }
.tbar-nodata { background: var(--border); }
.tlabel { font-size: 0.6rem; color: var(--muted); line-height: 1; }
.tlabel.now { color: var(--text); font-weight: 800; }
.tag { font-size: 0.7rem; padding: 2px 8px; border-radius: 10px; border: 1px solid var(--border); }
.tag-green { color: var(--green); } .tag-red { color: var(--red); } .tag-gold { color: var(--gold); }
.tag-blue { color: var(--primary); } .tag-gray, .tag-orange { color: var(--muted); }
.badge { margin-left: 6px; }
.nodata { margin-top: 8px; font-size: 0.78rem; color: var(--gold); display: flex; gap: 10px; align-items: center; }
.notice { color: var(--muted); margin-top: 20px; }
.swatch { width: 13px; height: 13px; border-radius: 50%; display: inline-block; border: 1.5px solid rgba(255,255,255,.55); flex-shrink: 0; vertical-align: middle; }
.tips-btn { width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--border); background: none; cursor: pointer; font-size: 0.72rem; line-height: 1; padding: 0; flex-shrink: 0; }
.tips-btn:hover { border-color: var(--primary); }
.tips-panel { margin-top: 8px; padding: 8px 10px; border-left: 2px solid var(--primary); background: rgba(56,189,248,.05); border-radius: 0 6px 6px 0; }
.tip { font-size: 0.75rem; line-height: 1.5; color: var(--text); }
.tip + .tip { margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--border); }
.tip-colors { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; }
.tip-lbl { font-size: 0.72rem; color: var(--muted); }
.tip-color { display: inline-flex; align-items: center; gap: 4px; font-size: 0.74rem; }
.score[disabled] { cursor: default; }
.score:not([disabled]) { cursor: pointer; border: none; }
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: grid; place-items: center; z-index: 1000; padding: 16px; }
.modal { max-width: 460px; width: 100%; max-height: 85vh; overflow-y: auto; }
.modal h3 { font-size: 1.1rem; }
.bd-for { font-size: 0.78rem; color: var(--muted); margin: 8px 0 12px; }
.bd-table { display: flex; flex-direction: column; gap: 2px; }
.bd-row { display: grid; grid-template-columns: 22px 1fr auto 44px; gap: 8px; align-items: center; padding: 5px 0; font-size: 0.82rem; }
.bd-row + .bd-row { border-top: 1px solid var(--border); }
.bd-label { font-size: 0.74rem; color: var(--muted); text-align: right; }
.bd-pts { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
.bd-pts.pos { color: var(--green); } .bd-pts.neg { color: var(--red); }
.bd-row.total { margin-top: 4px; border-top: 2px solid var(--border); font-weight: 700; }
.bd-row.total .bd-pts { color: var(--primary); }
.bd-note { margin-top: 10px; font-size: 0.72rem; color: var(--muted); text-align: center; }
.bd-why { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border); }
.bd-why-title { display: block; font-size: 0.82rem; margin-bottom: 8px; }
.bd-why ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 7px; }
.bd-why li { display: flex; gap: 8px; font-size: 0.76rem; line-height: 1.45; color: var(--muted); }
.bd-why li strong { color: var(--text); font-weight: 600; }
.bd-why-ico { flex-shrink: 0; }

/* First-load skeletons */
.skel { pointer-events: none; }
.win .body { flex: 1; min-width: 0; }
.sk-circle, .sk-line {
  background: linear-gradient(90deg, var(--bg-card) 25%, var(--border) 37%, var(--bg-card) 63%);
  background-size: 400% 100%; animation: shimmer 1.4s ease infinite; border-radius: 6px;
}
.sk-circle { width: 52px; height: 52px; border-radius: 50%; flex-shrink: 0; }
.sk-line { height: 11px; margin-top: 8px; }
.sk-line.w60 { width: 60%; } .sk-line.w50 { width: 50%; } .sk-line.w40 { width: 40%; }
@keyframes shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }
@media (prefers-reduced-motion: reduce) { .sk-circle, .sk-line { animation: none; } }

@media (max-width: 640px) {
  .head-actions { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
  .head-actions::-webkit-scrollbar { display: none; }
  .head-actions .btn { flex: 0 0 auto; }
}
</style>
