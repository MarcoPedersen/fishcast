/**
 * The Modeltjek view: the conditions and bite-scores at the owner's catches,
 * at the trips that caught nothing, and at their usual time windows on the
 * same spots in the same weeks — three groups side by side.
 *
 * Pure and side-effect free (the samples are scored elsewhere and passed in),
 * so it can be unit-tested without network or Supabase. Every rule here leans
 * towards saying less: the log holds a handful of entries, and a handful of
 * fishing trips shows chance far more often than it shows the weather.
 */
import { Solunar } from './solunar'
import { availDays, availMethods, isOvernight, isValidWindow, tideAt } from './scoring'
import type { Availability, BreakdownItem, FishingMethod, Forecast, Location, MarineHour, ScoredWindow } from './types'

const DAY = 86400000

// ── Conditions, classified from the raw weather ─────────────────────────
// From the weather itself, not from the model's points: the question is what
// the water was like when fish came, and points would only echo the model.

export type FactorId = 'tod' | 'press' | 'wind' | 'windtrend' | 'cloud' | 'wave' | 'tide' | 'sst' | 'solunar' | 'moon' | 'precip'
export type HourConditions = Partial<Record<FactorId, string | null>>

/** One scored hour of an entry or a window. */
export interface HourSample { at: number; score: number; breakdown: BreakdownItem[]; cond: HourConditions }
/** A scored entry or window: the score its card shows, and its hours. */
export interface WindowSample { window: ScoredWindow; hours: HourSample[] }

/**
 * Display order, and the i18n keys of each factor and its categories — written
 * out whole, so strings.test.ts sees every key in the source.
 */
export const FACTOR_LABEL_KEY: Record<FactorId, string> = {
  tod: 'ins_tod', press: 'ins_press', wind: 'ins_wind', windtrend: 'ins_windtrend', cloud: 'ins_cloud',
  wave: 'ins_wave', tide: 'ins_tide', sst: 'ins_sst', solunar: 'ins_solunar', moon: 'ins_moon', precip: 'ins_precip',
}
export const CAT_LABEL_KEY: Record<FactorId, Record<string, string>> = {
  tod: { dawn: 'ins_tod_dawn', day: 'ins_tod_day', dusk: 'ins_tod_dusk', night: 'ins_tod_night' },
  press: { rising: 'ins_press_rising', stable: 'ins_press_stable', falling: 'ins_press_falling' },
  wind: { light: 'ins_wind_light', gentle: 'ins_wind_gentle', fresh: 'ins_wind_fresh', strong: 'ins_wind_strong' },
  windtrend: { rising: 'ins_windtrend_rising', steady: 'ins_windtrend_steady', falling: 'ins_windtrend_falling' },
  cloud: { clear: 'ins_cloud_clear', partly: 'ins_cloud_partly', overcast: 'ins_cloud_overcast' },
  wave: { w0: 'ins_wave_w0', w1: 'ins_wave_w1', w2: 'ins_wave_w2', w3: 'ins_wave_w3' },
  tide: { rising: 'ins_tide_rising', falling: 'ins_tide_falling' },
  sst: { t0: 'ins_sst_t0', t1: 'ins_sst_t1', t2: 'ins_sst_t2', t3: 'ins_sst_t3', t4: 'ins_sst_t4' },
  solunar: { major: 'ins_solunar_major', minor: 'ins_solunar_minor', none: 'ins_solunar_none' },
  moon: { newfull: 'ins_moon_newfull', other: 'ins_moon_other' },
  precip: { p0: 'ins_precip_p0', p1: 'ins_precip_p1', p2: 'ins_precip_p2' },
}
export const FACTORS = Object.keys(FACTOR_LABEL_KEY) as FactorId[]
export const FACTOR_ICON: Record<FactorId, string> = {
  tod: '🌅', press: '🌡️', wind: '💨', windtrend: '📈', cloud: '☁️', wave: '🌊',
  tide: '↕️', sst: '💧', solunar: '🌙', moon: '🌕', precip: '🌧',
}

/** Same match as scoring.ts findIdx: the row within half an hour. */
function findIdx<T extends { time: number }>(arr: T[], ms: number): number {
  return arr.findIndex((h) => Math.abs(h.time - ms) < 30 * 60000)
}

/** The marine hour's sea temperature, once the model branch adds it to MarineHour. */
type SeaHour = MarineHour & { sstC?: number | null }

/**
 * The categories of one local hour. `atMs` is the hour's instant, built like
 * scoring.ts builds its targets (local wall-clock hour). A missing input
 * leaves its factor null, and the hour then doesn't count for that factor.
 *
 * Every rule borrows the scorer's own: the time-of-day bands come from
 * Solunar.timeOfDayScore (in winter dawn's sunrise + 2 h overlaps midday's
 * noon − 2 h, and only the scorer's order says which wins), the pressure and
 * wind-trend thresholds from pressureTrend and windTrend, and the sun, moon
 * and solunar day is the hour's own local date — after midnight, an
 * overnight trip's hours belong to the next day, as in scoreWindow.
 */
export function classifyHour(f: Forecast, loc: Location, atMs: number): HourConditions {
  const at = new Date(atMs)
  const day = new Date(Date.UTC(at.getFullYear(), at.getMonth(), at.getDate()))
  const sun = Solunar.getSunTimes(day, loc.lat, loc.lon)
  const tod = sun.sunrise && sun.sunset ? Solunar.timeOfDayScore(at, sun).period : null
  const phase = Solunar.getMoonPhase(day)
  const sol = Solunar.solunarScore(at, Solunar.getSolunarPeriods(day, loc.lat, loc.lon)).period
  const out: HourConditions = {
    tod: !(sun.sunrise && sun.sunset) ? null : tod === 'dawn' || tod === 'dusk' || tod === 'night' ? tod : 'day',
    solunar: sol === 'major' || sol === 'minor' ? sol : 'none',
    moon: phase < 0.03 || phase > 0.97 || (phase >= 0.47 && phase <= 0.53) ? 'newfull' : 'other',
    press: null, wind: null, windtrend: null, cloud: null, precip: null, wave: null, tide: null, sst: null,
  }

  const i = findIdx(f.hourly, atMs)
  if (i >= 0) {
    const h = f.hourly[i]
    // The scorer looks 3 rows back; with fewer rows before it, there is no trend to read.
    const prev = i >= 3 ? f.hourly[i - 3] : undefined
    if (h.pressure != null && prev?.pressure != null) {
      const d = h.pressure - prev.pressure
      out.press = d > 1 ? 'rising' : d > -1 ? 'stable' : 'falling'
    }
    if (h.windMs != null) {
      out.wind = h.windMs < 3 ? 'light' : h.windMs <= 5.5 ? 'gentle' : h.windMs <= 8 ? 'fresh' : 'strong'
      if (prev?.windMs != null) {
        const d = h.windMs - prev.windMs
        out.windtrend = d > 1 ? 'rising' : d < -1 ? 'falling' : 'steady'
      }
    }
    out.cloud = h.cloud < 30 ? 'clear' : h.cloud <= 65 ? 'partly' : 'overcast'
    // The scorer's bands: light rain above 40 %, heavy above 70 %.
    out.precip = h.precipPct <= 40 ? 'p0' : h.precipPct <= 70 ? 'p1' : 'p2'
  }

  const m = f.marine ? findIdx(f.marine, atMs) : -1
  if (m >= 0) {
    const mh = f.marine![m] as SeaHour
    if (mh.waveM != null) out.wave = mh.waveM < 0.3 ? 'w0' : mh.waveM < 0.6 ? 'w1' : mh.waveM < 1 ? 'w2' : 'w3'
    if (mh.sstC != null) out.sst = mh.sstC < 4 ? 't0' : mh.sstC < 8 ? 't1' : mh.sstC < 12 ? 't2' : mh.sstC < 16 ? 't3' : 't4'
  }
  const tide = f.tides ? tideAt(f.tides.predictions, atMs) : null
  if (tide) out.tide = tide.rising ? 'rising' : 'falling'
  return out
}

/**
 * The category covering most of a sample's hours that have data for the
 * factor; a tie goes to the category met first. A catch has one hour, so its
 * category is simply that hour's, and "2 af 3" stays a count of entries.
 */
export function dominant(hours: HourSample[], f: FactorId): string | null {
  const count = new Map<string, number>()
  for (const h of [...hours].sort((a, b) => a.at - b.at)) {
    const c = h.cond[f]
    if (c != null) count.set(c, (count.get(c) ?? 0) + 1)
  }
  let best: string | null = null
  for (const [c, n] of count) if (best == null || n > count.get(best)!) best = c
  return best
}

// ── Groups and their summaries ──────────────────────────────────────────

/** Below this: counts only — no means, no highlights, no claims. */
export const MIN_N = 5
/** At or above this in both groups: the softer caveat. */
export const SOLID_N = 20
/** Members each logged group needs before a condition difference is highlighted. */
export const HIGHLIGHT_N = 10
/** Distinct days the baseline needs before it stops being called "few". */
export const BASE_FEW_DAYS = 10
/** "Good" as the score colours have it. */
const GOOD = 65

export type GroupId = 'catch' | 'empty' | 'base'
export interface Groups { catch: WindowSample[]; empty: WindowSample[]; base: WindowSample[] }

/**
 * Catches from one outing — same date, same spot — as one sample. Five fish on
 * one morning are one trip with a catch: counted as five, they reached MIN_N
 * on their own, unlocked the means and highlights, and "5 ture med fangst"
 * was false. Its hours are the distinct catch hours; its score is the mean of
 * their 1-hour scores. (The cards keep each catch's own score.)
 */
export function catchTrips(items: { key: string; sample: WindowSample }[]): WindowSample[] {
  const byKey = new Map<string, WindowSample[]>()
  for (const { key, sample } of items) byKey.set(key, [...(byKey.get(key) ?? []), sample])
  return [...byKey.values()].map((samples) => {
    const seen = new Map<number, { score: number; hour: HourSample }>()
    for (const s of samples) {
      const h = s.hours[0]
      if (h && !seen.has(h.at)) seen.set(h.at, { score: s.window.score, hour: h })
    }
    const parts = [...seen.values()].sort((a, b) => a.hour.at - b.hour.at)
    const score = parts.length ? parts.reduce((a, p) => a + p.score, 0) / parts.length : samples[0].window.score
    return { window: { ...samples[0].window, score }, hours: parts.map((p) => p.hour) }
  })
}

export interface GroupSummary {
  n: number
  /** Every member's score, sorted — what the panel lists below MIN_N. */
  scores: number[]
  /** Mean of the members' scores; null below MIN_N. */
  mean: number | null
  /** Mean share of each member's hours scoring ≥ 65; null below MIN_N. */
  goodShare: number | null
  /** Sample standard deviation of the scores (0 below two members). */
  sd: number
}

/**
 * A member's score is the number its card shows (window.score) — averaging
 * the clamped hour scores instead put 53 in the panel beside a card that
 * said 52. The hours give the share of good hours: hour-level, because a
 * 4-hour window's average is diluted against a catch's single hour.
 */
export function summariseGroup(samples: WindowSample[]): GroupSummary {
  const n = samples.length
  const scores = samples.map((s) => s.window.score).sort((a, b) => a - b)
  const mean = n ? scores.reduce((a, b) => a + b, 0) / n : 0
  const sd = n > 1 ? Math.sqrt(scores.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1)) : 0
  const good = samples.map((s) => (s.hours.length ? s.hours.filter((h) => h.score >= GOOD).length / s.hours.length : 0))
  return {
    n, scores, sd,
    mean: n >= MIN_N ? mean : null,
    goodShare: n >= MIN_N ? good.reduce((a, b) => a + b, 0) / n : null,
  }
}

/** Distinct (spot, day) pairs — the baseline's independent samples: windows on one day share its weather. */
export function distinctDays(samples: WindowSample[]): number {
  return new Set(samples.map((s) => `${s.window.location.id}|${s.window.date.getTime()}`)).size
}

// ── The condition table ─────────────────────────────────────────────────

/**
 * Factors that change hour by hour. A catch is one hour while a trip or a
 * window spans many, and the dominant category of an 08–18 window is "Dag"
 * whatever happened at dawn — the majority class wins every span. For these
 * a member's weight of 1 is split across its hours instead, so the table
 * compares shares of fishing hours.
 */
export const HOUR_WEIGHTED: readonly FactorId[] = ['tod', 'solunar', 'tide', 'windtrend', 'precip']

/** One member's weight per category of a factor, summing to 1; null without data. */
function weights(s: WindowSample, f: FactorId): Map<string, number> | null {
  if (!HOUR_WEIGHTED.includes(f)) {
    const c = dominant(s.hours, f)
    return c == null ? null : new Map([[c, 1]])
  }
  const cats = s.hours.map((h) => h.cond[f]).filter((c): c is string => c != null)
  if (!cats.length) return null
  const w = new Map<string, number>()
  for (const c of cats) w.set(c, (w.get(c) ?? 0) + 1 / cats.length)
  return w
}

/** k members (or member-weights) out of the nf members with data for the factor. */
export interface CatCell { k: number; nf: number; share: number | null }
export interface Highlight {
  factor: FactorId
  cat: string
  vs: 'empty' | 'base'
  a: CatCell
  b: CatCell
  /** |share a − share b|, 0–1 */
  gap: number
}
export interface FactorRow {
  factor: FactorId
  cats: { cat: string; cells: Record<GroupId, CatCell>; highlight: boolean }[]
  /** Members of the two logged groups with data for the factor, when that is fewer than all of them. */
  dataNote: { k: number; n: number } | null
  highlight: Highlight | null
}

/**
 * Whether a difference is worth a sentence. With 5 members and a baseline
 * share of 0.3, chance alone gives a gap of 25 points in a third of the ~35
 * category rows, so the three highlight slots filled up almost every time.
 * Now both logged groups need HIGHLIGHT_N members with data, and the gap must
 * clear 2.5 standard errors as well as 25 points — the baseline counted by
 * its distinct days, since 184 windows from 15 days share 15 days' weather.
 */
function qualifies(a: CatCell, b: CatCell, nA: number, nB: number): boolean {
  if (a.share == null || b.share == null || nA < 1 || nB < 1) return false
  const p = (a.share * nA + b.share * nB) / (nA + nB)
  const se = Math.sqrt(p * (1 - p) * (1 / nA + 1 / nB))
  return Math.abs(a.share - b.share) >= Math.max(0.25, 2.5 * se)
}

export function conditionTable(groups: Groups): FactorRow[] {
  const rows: FactorRow[] = []
  for (const f of FACTORS) {
    const tally = (samples: WindowSample[]) => {
      const k = new Map<string, number>()
      let nf = 0
      const withData: WindowSample[] = []
      for (const s of samples) {
        const w = weights(s, f)
        if (!w) continue
        nf++
        withData.push(s)
        for (const [c, v] of w) k.set(c, (k.get(c) ?? 0) + v)
      }
      return { k, nf, withData }
    }
    const t = { catch: tally(groups.catch), empty: tally(groups.empty), base: tally(groups.base) }
    if (!t.catch.nf && !t.empty.nf && !t.base.nf) continue
    const baseDays = distinctDays(t.base.withData)
    const cell = (g: GroupId, c: string): CatCell => {
      const k = t[g].k.get(c) ?? 0
      return { k, nf: t[g].nf, share: t[g].nf ? k / t[g].nf : null }
    }
    const cats = Object.keys(CAT_LABEL_KEY[f])
      .filter((c) => t.catch.k.has(c) || t.empty.k.has(c) || t.base.k.has(c))
      .map((c) => ({ cat: c, cells: { catch: cell('catch', c), empty: cell('empty', c), base: cell('base', c) }, highlight: false }))

    // At most one highlight per factor: catch vs empty first, then catch vs
    // your windows; within a comparison the largest gap.
    let highlight: Highlight | null = null
    if (t.catch.nf >= HIGHLIGHT_N) {
      for (const vs of ['empty', 'base'] as const) {
        const nB = vs === 'base' ? baseDays : t.empty.nf
        if (vs === 'empty' ? t.empty.nf < HIGHLIGHT_N : baseDays < MIN_N) continue
        for (const row of cats) {
          const a = row.cells.catch, b = row.cells[vs]
          if (!qualifies(a, b, t.catch.nf, nB)) continue
          const gap = Math.abs(a.share! - b.share!)
          if (!highlight || gap > highlight.gap) highlight = { factor: f, cat: row.cat, vs, a, b, gap }
        }
        if (highlight) break
      }
    }
    for (const row of cats) row.highlight = row.cat === highlight?.cat
    const k = t.catch.nf + t.empty.nf
    const n = groups.catch.length + groups.empty.length
    rows.push({ factor: f, cats, dataNote: k < n ? { k, n } : null, highlight })
  }
  return rows
}

/** The factor highlights worth a sentence: at most three, largest difference first. */
export function highlights(rows: FactorRow[]): Highlight[] {
  return rows.map((r) => r.highlight).filter((h): h is Highlight => h != null).sort((a, b) => b.gap - a.gap).slice(0, 3)
}

/**
 * How a cell reads. Below MIN_N members with data: "k af n" — a percentage
 * of 3 would claim a precision it hasn't got. The baseline always as a
 * percentage: its size is in the column header.
 */
export function cellDisplay(c: CatCell, group: GroupId): { pct: number | null; k: number; n: number } {
  const pct = c.share == null || (group !== 'base' && c.nf < MIN_N) ? null : Math.round(c.share * 100)
  return { pct, k: Math.round(c.k), n: c.nf }
}

// ── The model's points ──────────────────────────────────────────────────

/** Rows that are bookkeeping, not a factor. */
const NOT_FACTORS = new Set(['bd_base', 'bd_ceiling', 'bd_floor'])
/**
 * Rows that exist only where their data does. DMI keeps tide predictions for
 * the current year, so last year's entries have no tide row at all; counted
 * as 0 they would pull this year's tide points down. Averaged only over the
 * hours, and members, that had the data.
 */
const DATA_GATED: Record<string, FactorId> = { bd_tide: 'tide' }

export interface PointsRow { key: string; icon: string; values: Record<GroupId, number | null> }

/**
 * Mean points per hour for every factor the model scored, per group. Keys are
 * read from the breakdowns, not listed here: a factor the model gains later
 * appears on its own, labelled t(key) with the model's own strings.
 */
export function modelPointsTable(groups: Groups): PointsRow[] {
  const keys = new Map<string, string>()
  for (const g of [groups.catch, groups.empty, groups.base])
    for (const s of g) for (const h of s.hours) for (const b of h.breakdown)
      if (b.key && !NOT_FACTORS.has(b.key) && !keys.has(b.key)) keys.set(b.key, b.icon)

  const groupMean = (samples: WindowSample[], key: string): number | null => {
    const gate = DATA_GATED[key]
    const perMember: number[] = []
    for (const s of samples) {
      const hours = gate ? s.hours.filter((h) => h.cond[gate] != null) : s.hours
      if (!hours.length) continue
      const pts = hours.map((h) => h.breakdown.find((b) => b.key === key)?.points ?? 0)
      perMember.push(pts.reduce((a, b) => a + b, 0) / hours.length)
    }
    return perMember.length ? perMember.reduce((a, b) => a + b, 0) / perMember.length : null
  }
  const rows: PointsRow[] = []
  for (const [key, icon] of keys) {
    const values = { catch: groupMean(groups.catch, key), empty: groupMean(groups.empty, key), base: groupMean(groups.base, key) }
    if (Object.values(values).some((v) => v != null && Math.round(v * 10) !== 0)) rows.push({ key, icon, values })
  }
  return rows
}

// ── The verdict ─────────────────────────────────────────────────────────

export interface Sentence { key: string; params: Record<string, string | number> }

/**
 * Plain-language sentences for the three groups, descriptive only — never
 * "because", "better", "works" or "the model is right".
 *
 * Catch vs empty is said to separate only when the gap clears both 8 points
 * (about half a colour band) and twice its standard error: with 5 + 5 members
 * and scores spread by 15–20, the error of the difference is 9–13 points,
 * and a fixed 8 said "separates" in about 40 % of logs where nothing did.
 */
export function verdict(groups: Groups): Sentence[] {
  const c = summariseGroup(groups.catch)
  const e = summariseGroup(groups.empty)
  const b = summariseGroup(groups.base)
  const r = (v: number | null) => (v == null ? '–' : Math.round(v))
  // Your windows count only from MIN_N on too: below it the baseline is
  // listed score by score, like the other groups, and left out of the sentences.
  const baseMean = b.mean
  const out: Sentence[] = []
  const baseFew = () => { if (b.n && distinctDays(groups.base) < BASE_FEW_DAYS) out.push({ key: 'insight_base_few', params: {} }) }

  if (c.n < MIN_N && e.n < MIN_N) return [{ key: 'insight_thin', params: {} }]
  if (c.n < MIN_N) return [{ key: 'insight_thin_catch', params: {} }]
  if (e.n < MIN_N) {
    if (baseMean == null) out.push({ key: 'insight_catch_mean', params: { f: r(c.mean) } })
    else {
      out.push({ key: 'insight_vs_base', params: { f: r(c.mean), b: r(baseMean) } })
      out.push(c.n < SOLID_N ? { key: 'insight_caveat_one', params: { a: c.n } } : { key: 'insight_caveat_mid', params: {} })
    }
    out.push({ key: 'insight_need_empty', params: {} })
    baseFew()
    return out
  }
  out.push(baseMean == null
    ? { key: 'insight_both_nobase', params: { f: r(c.mean), t: r(e.mean) } }
    : { key: 'insight_both', params: { f: r(c.mean), t: r(e.mean), b: r(baseMean) } })
  const diff = c.mean! - e.mean!
  const se = Math.sqrt(c.sd ** 2 / c.n + e.sd ** 2 / e.n)
  const bar = Math.max(8, 2 * se)
  const sep = diff >= bar ? 'insight_sep_yes' : -diff >= bar ? 'insight_sep_rev' : 'insight_sep_no'
  out.push({ key: sep, params: {} })
  // "A pattern, not proof" only follows a pattern: after "doesn't clearly
  // separate" it contradicted the sentence before it.
  if (c.n < SOLID_N || e.n < SOLID_N) out.push({ key: 'insight_caveat_small', params: { a: c.n, b: e.n } })
  else if (sep !== 'insight_sep_no') out.push({ key: 'insight_caveat_mid', params: {} })
  baseFew()
  return out
}

/** Every key verdict() can return — for the panel's strings check. */
export const VERDICT_KEYS = [
  'insight_thin', 'insight_thin_catch', 'insight_catch_mean', 'insight_vs_base', 'insight_caveat_one', 'insight_need_empty',
  'insight_both', 'insight_both_nobase', 'insight_sep_yes', 'insight_sep_no', 'insight_sep_rev', 'insight_caveat_small', 'insight_caveat_mid', 'insight_base_few',
] as const

// ── The baseline: your windows, same spots, same weeks ──────────────────

export interface BaselineWindow { locId: string; day: number; from: string; to: string; methods: FishingMethod[] }

const clockMinutes = (s: string) => { const [h, m] = s.split(':'); return parseInt(h) * 60 + (parseInt(m) || 0) }

/**
 * The owner's current time windows on the days around each analysed entry —
 * `padDays` either side, at the entry's spot, up to today and no further back
 * than `oldestDay`. Built like getScoredWindows: the weekday of the day's
 * encoding, same-hours rows merged with their methods united, invalid rows
 * dropped, an overnight window on the day it starts. A window still running
 * (or ahead) is left out: its weather is partly forecast.
 *
 * Why ±7 days at the same spots: water temperature and day length move with
 * the season and the place, and an all-year baseline would make catches look
 * special just for when they happened. These days lie inside the history
 * spans the entries need anyway, so the baseline costs no extra requests.
 */
export function baselineWindows(
  anchors: { locId: string; day: number }[],
  availability: Availability[],
  nowMs: number,
  opts: { padDays?: number; oldestDay?: number } = {},
): BaselineWindow[] {
  const pad = opts.padDays ?? 7
  const n = new Date(nowMs)
  const today = Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())
  const days = new Map<string, Set<number>>()
  for (const { locId, day } of anchors) {
    const set = days.get(locId) ?? new Set<number>()
    for (let d = day - pad * DAY; d <= day + pad * DAY; d += DAY) {
      if (d <= today && (opts.oldestDay == null || d >= opts.oldestDay)) set.add(d)
    }
    days.set(locId, set)
  }
  const out: BaselineWindow[] = []
  for (const [locId, set] of days) {
    for (const day of [...set].sort((a, b) => a - b)) {
      const date = new Date(day)
      const slots = new Map<string, BaselineWindow>()
      for (const a of availability) {
        if (!availDays(a).includes(date.getUTCDay()) || !isValidWindow(a.from, a.to)) continue
        const end = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + (isOvernight(a.from, a.to) ? 1 : 0), 0, clockMinutes(a.to))
        if (end.getTime() > nowMs) continue
        const key = `${a.from}-${a.to}`
        const slot = slots.get(key)
        if (!slot) slots.set(key, { locId, day, from: a.from, to: a.to, methods: [...availMethods(a)] })
        else for (const m of availMethods(a)) if (!slot.methods.includes(m)) slot.methods.push(m)
      }
      out.push(...slots.values())
    }
  }
  return out
}

// ── Before empty trips (removed once the panel moves) ───────────────────

export interface ScoreSummary {
  n: number
  avg: number
  /** Count of catches per score band (same thresholds as scoreColor). */
  bands: { great: number; good: number; mid: number; poor: number }
  /** Share (0–1) of catches that happened at a "good or better" score (>=65). */
  highShare: number
  /** Below this many samples the picture is not meaningful yet. */
  thin: boolean
}

export const MIN_MEANINGFUL = 5

export function summariseCatchScores(scores: number[]): ScoreSummary | null {
  const s = scores.filter((v) => typeof v === 'number' && !Number.isNaN(v))
  if (!s.length) return null

  const bands = { great: 0, good: 0, mid: 0, poor: 0 }
  for (const v of s) {
    if (v >= 80) bands.great++
    else if (v >= 65) bands.good++
    else if (v >= 45) bands.mid++
    else bands.poor++
  }
  const total = s.reduce((a, b) => a + b, 0)
  return {
    n: s.length,
    avg: Math.round(total / s.length),
    bands,
    highShare: (bands.great + bands.good) / s.length,
    thin: s.length < MIN_MEANINGFUL,
  }
}

export function verdictKey(sum: ScoreSummary): string {
  if (sum.thin) return 'insight_thin'
  if (sum.highShare >= 0.6) return 'insight_strong'
  if (sum.highShare >= 0.35) return 'insight_mixed'
  return 'insight_weak'
}
