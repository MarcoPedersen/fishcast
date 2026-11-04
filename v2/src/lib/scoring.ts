/**
 * Scoring engine — TS port of the v1 scoreWindow core, reworked as model v3
 * from the fishing research (model-spec.md; K§ refers to its knowledge.md).
 * Pure: takes forecast + setup as arguments, no global state.
 */
import { Solunar } from './solunar'
import { SPECIES_PREFS, type SpeciesPref } from './species'
import { suggestLure } from './lures'
import { clamp } from './math'
import { t } from './i18n'
import { tideRangeM } from './weather'
import type { Availability, BreakdownItem, FishingMethod, Forecast, HourData, LightningStatus, Location, ScoredWindow, TidePrediction, WindowRelevance } from './types'

/**
 * All scoring point values in one place — how much each factor can move the
 * score. Tune the model here; the modal's explanation text (bd_*_why strings)
 * quotes these values to the user, and a test holds the two together.
 *
 * Model v3 sized each factor by its evidence, not by catches (the owner has
 * logged too few to tune anything), in two steps (model-spec §9.2):
 * 1. Evidence-relative values. Pressure (no study isolates it, K§1.4) and
 *    solunar (Quigley et al. 2023 found no link with catch rates) are about
 *    halved; calm wind, glassy water and 0.6–1 m waves about halved (coastal
 *    sea trout want some wind and chop, K§2.4); the tide is scaled by the
 *    station's range (a few cm south of the Belts, K§15.1); water
 *    temperature is new, the best-documented seasonal driver (K§0.1).
 * 2. Everything × 1.25 (the moon excepted: too small to scale), and the base
 *    chosen by the §9.3 rule. Removing noise squeezed the scale, and the
 *    10-19 attempt that only recentred the median lost a third of its "good"
 *    windows. The one scale factor is set once, on the old model's own
 *    fixture distribution, never on catches.
 * The rain-probability "thunder" −20 is gone: forecast-hour thunder can't be
 * read from these sources, and the DMI lightning cap (lightningCap) is the
 * real signal.
 */
export const SCORE_WEIGHTS = {
  // §9.3 rule: the integer in 20–28 that brings the owner's pooled median Δ
  // (havørred + makrel, coast) against the old model with tides to 0 ± 1,
  // lower on a tie (scripts/model-check/v3.check.ts). It found 20, not the
  // prototype's 24.
  base: 20,
  pressure: { strongRise: 15, rise: 8, stable: 0, fall: -8, strongFall: -15 },
  solunar: { major: 11, minor: 6, approachMajor: 4, approachMinor: 2 },
  // Dawn ramps dawnBase → dawnPeak towards sunrise, dusk likewise; `day` is
  // the rest of daylight, and what a day feeder's midday counts as.
  timeOfDay: { dawnBase: 6, dawnPeak: 29, duskBase: 6, duskPeak: 22, night: 6, midday: -10, day: 3 },
  cloud: 10,
  wind: { calm: 4, brisk: -5, gale: -22 },
  windTrend: { strongRise: -19, rise: -10, strongFall: 10, fall: 5 },
  precip: { light: 5, heavy: -15 },
  wave: { danger: -25, high: -15, moderate: -4, glassy: 3 },
  method: { boatBig: -19, boatMod: -10, wadersBig: -15, wadersMod: -8, wadersGlassy: 6 },
  moonFactor: 0.3,
  // × the tide weight min(1, range ÷ fullRangeM). The species tide rule and
  // the tag need speciesMinWeight (a 25 cm range): a few cm is not tidal
  // movement (K§1.1, high).
  tide: { rising: 12, falling: 5, fullRangeM: 0.5, speciesMinWeight: 0.5 },
  // The water-temperature row spans −waterTemp…+waterTemp.
  waterTemp: 12,
  // A visitor (makrel, hornfisk, fjæsing) below this preference is "not here
  // yet / gone": no species bonus, and it doesn't count as a day feeder.
  visitorMinPref: 0.2,
  speciesMax: 30,
  relevanceMax: 15,
  lightningCap: 15,
} as const

/** One hour's conditions, as the species bonus rules below see them. */
export interface SpeciesConditions {
  /** 'dawn' | 'dusk' | 'night' | 'midday' | 'day', or null with no sun times. */
  timeOfDay: 'dawn' | 'dusk' | 'night' | 'midday' | 'day' | null
  windMs: number | null
  cloud: number
  tideRising: boolean
  /** 0–1: the local tidal range against SCORE_WEIGHTS.tide.fullRangeM. */
  tideWeight: number
  waveM: number | null
  depth: Location['depth'] | null
  sstC: number | null
}

const isDaylight = (c: SpeciesConditions) => c.timeOfDay === 'midday' || c.timeOfDay === 'day'
const isBreeze = (c: SpeciesConditions) => c.windMs != null && c.windMs >= 4 && c.windMs <= 8

/**
 * When each SPECIES_PREFS bonus key pays out. Every key a species lists needs a
 * rule here (a test enforces it): waveLight, pressureHigh and deep used to be
 * defined but never read, so torsk's species row was always 0 and pighvar's
 * light-surf preference never reached the score. A missing reading never pays.
 * The pressure and solunar rules are gone: no source supports them (K§1.4).
 */
export const SPECIES_CONDITIONS: Record<string, (c: SpeciesConditions) => boolean> = {
  dawn: (c) => c.timeOfDay === 'dawn',
  dusk: (c) => c.timeOfDay === 'dusk',
  night: (c) => c.timeOfDay === 'night',
  // Sight feeders: hornfisk (high), pighvar "hunts during the day" (high),
  // ising (medium), big perch in clear lakes (high).
  daylight: isDaylight,
  // Havørred in warm water: at night "almost permanently at the surface", deep
  // by day above 17 °C (DTU tagging, K§2.1, high).
  nightWarm: (c) => c.timeOfDay === 'night' && c.sstC != null && c.sstC >= 15,
  // Pike catch rates rise with wind (Kuparinen et al. 2010, high).
  breeze: isBreeze,
  // Havørred: "onshore wind with some chop" (K§2.4) — ONE claim, so one rule:
  // wind waves follow the wind, and two rules paid it twice. Low–medium, and
  // direction-blind until a spot knows which way its coast faces: at
  // east-facing Dragør most of the hours it fires blow offshore (critique M5).
  windOrChop: (c) => isBreeze(c) || (c.waveM != null && c.waveM >= 0.3 && c.waveM <= 0.9),
  // Hornfisk "can be caught all day, provided the sun is shining"; herring
  // "gerne bagende sol" (medium). A missing cloud value reads 0 % here (see
  // hourlyRows), which this rule can't tell from a clear sky.
  sunny: (c) => isDaylight(c) && c.cloud < 30,
  // Herring "gerne bagende sol og let vind" (medium). 'Let vind' is Beaufort
  // 3, 3.4–5.4 m/s: the band the wind row leaves neutral, between calm (< 3)
  // and brisk (> 5.5). It replaced a calm rule that paid dead calm instead.
  lightWind: (c) => c.windMs != null && c.windMs >= 3 && c.windMs <= 5.5,
  cloud: (c) => c.cloud > 60,
  // A rising tide only where there is one: a few cm south of the Belts is not
  // tidal movement (K§1.1, high).
  tide: (c) => c.tideRising && c.tideWeight >= SCORE_WEIGHTS.tide.speciesMinWeight,
  // Light surf that stirs prey off the bottom (the tips say 0.1–0.5 m for
  // havørred, 0.2–0.6 m for pighvar); one band covers both.
  waveLight: (c) => c.waveM != null && c.waveM >= 0.1 && c.waveM <= 0.6,
  // Only known for a location saved from an official spot (Location.depth).
  deep: (c) => c.depth === 'deep',
}

/**
 * The words the species row shows for the conditions that paid, e.g.
 * "daggry · vind eller bølgegang". A literal map, so the strings test sees
 * every key; scoring.test.ts checks one exists per condition, in both languages.
 */
export const COND_LABEL_KEY: Record<string, string> = {
  dawn: 'bd_cond_dawn',
  dusk: 'bd_cond_dusk',
  night: 'bd_cond_night',
  daylight: 'bd_cond_daylight',
  nightWarm: 'bd_cond_nightWarm',
  breeze: 'bd_cond_breeze',
  windOrChop: 'bd_cond_windOrChop',
  sunny: 'bd_cond_sunny',
  lightWind: 'bd_cond_lightWind',
  cloud: 'bd_cond_cloud',
  tide: 'bd_cond_tide',
  waveLight: 'bd_cond_waveLight',
  deep: 'bd_cond_deep',
}

/**
 * A species' preference (0–1) at sea temperature `x`: piecewise-linear between
 * the curve's breakpoints, flat beyond its ends.
 */
export function sstPreference(curve: [number, number][], x: number): number {
  if (x <= curve[0][0]) return curve[0][1]
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i]
    if (x <= x1) {
      const [x0, y0] = curve[i - 1]
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    }
  }
  return curve[curve.length - 1][1]
}

/**
 * A visitor the water keeps away: below SCORE_WEIGHTS.visitorMinPref it is
 * "not here yet / gone". Unknown water gates nothing — missing data is never
 * penalised.
 */
const isGated = (sp: SpeciesPref | undefined, sst: number | null) =>
  !!sp?.visitor && !!sp.sst && sst != null && sstPreference(sp.sst, sst) < SCORE_WEIGHTS.visitorMinPref

/**
 * Feeds by day at this sea temperature, so the midday penalty doesn't fit it:
 * `true` always, `{ belowSst }` only in colder water. A gated visitor isn't
 * here, so it lifts nothing (critique M2).
 */
const middayFeeder = (sp: SpeciesPref | undefined, sst: number | null) => {
  const d = sp?.dayFeeder
  if (d == null || isGated(sp, sst)) return false
  return d === true || (sst != null && sst < d.belowSst)
}
/**
 * Hunts in sun and daylight, so the overcast bonus doesn't fit it. Only the
 * `true` form: cold-water havørred keep it — the winter-coast source has the
 * first hour last "gerne længere, hvis det er overskyet" (critique M3).
 */
const sunFeeder = (sp: SpeciesPref | undefined, sst: number | null) => sp?.dayFeeder === true && !isGated(sp, sst)

function findIdx<T extends { time: number }>(arr: T[], ms: number): number {
  return arr.findIndex((h) => Math.abs(h.time - ms) < 30 * 60000)
}

const sumPoints = (rows: BreakdownItem[]) => rows.reduce((sum, b) => sum + b.points, 0)

type Tag = ScoredWindow['tags'][number]

export interface TideState { value: number; rising: boolean }

/**
 * Water level at `targetMs`, interpolated between the two predictions around
 * it, and whether it is rising over THAT interval. The direction used to come
 * from the previous pair, so it lagged one interval at every turn — 12:30
 * after a 12:00 high water read rising — and the first interval was skipped.
 * Shared with the Conditions tab (currentConditions) so both read one level.
 * `value` is in metres.
 */
export function tideAt(predictions: { time: number; value: number }[], targetMs: number): TideState | null {
  if (!predictions || predictions.length < 2) return null
  for (let i = 0; i < predictions.length - 1; i++) {
    const curr = predictions[i], next = predictions[i + 1]
    if (curr.time <= targetMs && next.time > targetMs) {
      const frac = (targetMs - curr.time) / (next.time - curr.time)
      return { value: curr.value + frac * (next.value - curr.value), rising: next.value > curr.value }
    }
  }
  return null
}

const tideRangeCache = new WeakMap<TidePrediction[], number | null>()

/**
 * The range of a forecast cached before fetchTides set `rangeM`: computed from
 * the predictions once per list, not per hour × window × method on every
 * rescore — scanning them per hour over reactive arrays doubled the cold
 * scoring time.
 */
export function cachedTideRange(predictions: TidePrediction[]): number | null {
  if (!tideRangeCache.has(predictions)) tideRangeCache.set(predictions, tideRangeM(predictions))
  return tideRangeCache.get(predictions)!
}

/**
 * The row 3 hours before hourly[idx], found by time: a past-weather series
 * drops all-null rows, and idx − 3 then reached across the gap and invented a
 * ±15 trend (critique M6b). undefined when there is no such row.
 * Hourly series are gap-free almost always, so idx − 3 is tried first: the
 * scan from index 0, run for pressure and for wind, tripled the reads of the
 * store's reactive array per scored hour (each read is a proxy get).
 */
function threeHoursBefore(hourly: Forecast['hourly'], idx: number): HourData | undefined {
  const now = hourly[idx]
  if (!now) return undefined
  const want = now.time - 3 * 3600000
  const near = hourly[idx - 3]
  if (near && Math.abs(near.time - want) < 30 * 60000) return near
  const j = findIdx(hourly, want)
  return j >= 0 ? hourly[j] : undefined
}

/**
 * null when either reading is missing: an unknown trend is not "stable".
 * `fast` marks the strong rise or fall, so the row can say so: labelled by
 * direction alone, a +15 read "weakly rising" under a bd_pressure_why that
 * gives +15 to fast-rising pressure.
 */
function pressureTrend(hourly: Forecast['hourly'], idx: number): { dir: 'rising' | 'stable' | 'falling'; fast: boolean; score: number } | null {
  const now = hourly[idx]?.pressure
  const prev = threeHoursBefore(hourly, idx)?.pressure
  if (now == null || prev == null) return null
  const delta = now - prev
  const P = SCORE_WEIGHTS.pressure
  if (delta > 3) return { dir: 'rising', fast: true, score: P.strongRise }
  if (delta > 1) return { dir: 'rising', fast: false, score: P.rise }
  if (delta > -1) return { dir: 'stable', fast: false, score: P.stable }
  if (delta > -3) return { dir: 'falling', fast: false, score: P.fall }
  return { dir: 'falling', fast: true, score: P.strongFall }
}

// Wind trend over the previous 3h: rising worsens, falling improves. null when
// either reading is missing (it read as 0 m/s, inventing a trend).
function windTrend(hourly: Forecast['hourly'], idx: number): { dir: string; score: number } | null {
  const now = hourly[idx]?.windMs
  const prev = threeHoursBefore(hourly, idx)?.windMs
  if (now == null || prev == null) return null
  const delta = now - prev
  const T = SCORE_WEIGHTS.windTrend
  if (delta > 2.5) return { dir: 'rising', score: T.strongRise }
  if (delta > 1.0) return { dir: 'rising', score: T.rise }
  if (delta < -2.5) return { dir: 'falling', score: T.strongFall }
  if (delta < -1.0) return { dir: 'falling', score: T.fall }
  return { dir: 'stable', score: 0 }
}

/**
 * An hour with no temperature, wind or pressure has no weather to score. It
 * used to be scored anyway, with the null wind read as calm (+7) and the null
 * pressure as stable (+1).
 */
const emptyHour = (hd: HourData) => hd.temp == null && hd.windMs == null && hd.pressure == null

/**
 * 'HH:MM' → minutes after midnight (NaN when the hour doesn't parse, or when it
 * isn't a string at all — a garbled synced row must make its window invalid,
 * not throw from `split` and blank every view that scores windows).
 */
function clockMinutes(s: string): number {
  if (typeof s !== 'string') return NaN
  const [h, m] = s.split(':')
  return parseInt(h) * 60 + (parseInt(m) || 0)
}

/**
 * An availability row's days and methods, as lists whatever the row holds.
 * normalize.ts repairs rows on load and on pull, but a row that slips past it
 * (another app version writing the same account) used to throw from
 * `days.includes` in getScoredWindows and take the dashboard, the reminders
 * and the map down with it. A string "days" also has a length, so it passed
 * the editor's "no days ticked" check while never matching a day.
 */
export function availDays(a: Availability): number[] {
  return Array.isArray(a.days) ? a.days : []
}
export function availMethods(a: Availability): FishingMethod[] {
  return Array.isArray(a.methods) && a.methods.length ? a.methods : ['shore']
}

/**
 * A window is scoreable unless it's zero-length or unparseable. An end hour
 * BEFORE the start hour means it runs past midnight (22:00 → 02:00) — night
 * fishing is a core use case here, so that's valid, not reversed.
 * Shared with the availability editor so both agree on what's valid.
 * Minutes count: comparing hours only made 17:00–17:45 "zero-length", and the
 * editor told the user start and end must differ when they did.
 */
export function isValidWindow(from: string, to: string): boolean {
  const f = clockMinutes(from)
  const u = clockMinutes(to)
  return !isNaN(f) && !isNaN(u) && f !== u
}

/** True when the window crosses midnight and so ends on the following day. */
export function isOvernight(from: string, to: string): boolean {
  const f = clockMinutes(from)
  const u = clockMinutes(to)
  return !isNaN(f) && !isNaN(u) && u < f
}

/**
 * The wall-clock hours a window covers, each with the day offset it falls on
 * (1 = after midnight). Inclusive of the end hour and capped at 12 hours, which
 * is the behaviour the ascending-only loop had before overnight support.
 * Equal hours are a window inside one hour (17:00–17:45: just 17) unless
 * `overnight` says it wraps (05:30–05:15) — pass isOvernight(from, to).
 */
export function windowHours(fromH: number, toH: number, overnight = toH < fromH): { hour: number; dayOffset: number }[] {
  const span = overnight ? 24 - fromH + toH : Math.max(0, toH - fromH)
  const out: { hour: number; dayOffset: number }[] = []
  for (let i = 0; i <= Math.min(span, 12); i++) {
    const abs = fromH + i
    out.push({ hour: abs % 24, dayOffset: abs >= 24 ? 1 : 0 })
  }
  return out
}

export function scoreWindow(
  loc: Location,
  date: Date,
  from: string,
  to: string,
  forecast: Forecast | undefined,
  targetSpecies: string[],
  method: 'shore' | 'boat' | 'waders' = 'shore',
): ScoredWindow {
  const base: ScoredWindow = {
    location: loc, date, from, to,
    score: 20, noData: true, bestHourStr: null, tags: [],
  }
  if (!forecast) return base

  const fromH = parseInt(from)
  const toH = parseInt(to)
  if (!isValidWindow(from, to)) return { ...base, score: 0, noData: false }

  const W = SCORE_WEIGHTS
  const { hourly, marine, tides } = forecast
  const hours: { idx: number; hour: number; dayOffset: number; target: Date }[] = []
  for (const { hour, dayOffset } of windowHours(fromH, toH, isOvernight(from, to))) {
    // Availability hours are the user's LOCAL wall-clock times — anchor the
    // target in local time (forecast timestamps are absolute, so the lookup
    // then hits the right hour). Using Date.UTC here shifted every window's
    // conditions by 1–2h in Denmark. dayOffset carries an overnight window's
    // post-midnight hours onto the next calendar day.
    const target = new Date(
      date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + dayOffset, hour,
    )
    const idx = findIdx(hourly, target.getTime())
    // An hour with no weather at all counts as missing, like one with no row.
    if (idx >= 0 && !emptyHour(hourly[idx])) hours.push({ idx, hour, dayOffset, target })
  }
  // Forecast exists but covers none of the window's hours (e.g. stale data) —
  // report honestly as no-data ("?") instead of fabricating a neutral 50.
  if (!hours.length) return base

  // Sun and moon per calendar day the window touches: an overnight window's
  // post-midnight hours belong to the NEXT day's dawn and solunar periods.
  // Scoring them against the start day's sun times put a 04:00 June dawn after
  // that day's sunset — 'night' — so fishing through to dawn never got it.
  const astro: { sun: ReturnType<typeof Solunar.getSunTimes>; periods: ReturnType<typeof Solunar.getSolunarPeriods>; moonBonus: number }[] = []
  const astroFor = (dayOffset: number) => {
    if (!astro[dayOffset]) {
      const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + dayOffset))
      astro[dayOffset] = {
        sun: Solunar.getSunTimes(d, loc.lat, loc.lon),
        periods: Solunar.getSolunarPeriods(d, loc.lat, loc.lon),
        moonBonus: Solunar.moonPhaseLabel(Solunar.getMoonPhase(d)).score,
      }
    }
    return astro[dayOffset]
  }

  // Per target species, not per hour: its temperature curve and prefs.
  const prefs = targetSpecies.map((id) => SPECIES_PREFS[id])
  const curves = prefs.map((sp) => sp?.sst).filter((c): c is [number, number][] => !!c)
  const share = (f: (sp: SpeciesPref | undefined) => boolean) => (prefs.length ? prefs.filter(f).length / prefs.length : 0)
  // The station's tidal range decides how much the tide counts, everywhere.
  const rangeM = tides?.predictions?.length ? (tides.rangeM ?? cachedTideRange(tides.predictions)) : null
  const tideWeight = rangeM == null ? 0 : clamp(rangeM / W.tide.fullRangeM, 0, 1)

  const hourScores: number[] = []
  const hourBreakdowns: BreakdownItem[][] = []
  const tags = new Map<string, Tag | null>()
  // Pressure, wind and wave tags describe the WINDOW, so its worst hour decides
  // them after the loop. Set hour by hour, the last hour to cross a threshold
  // won: a waders window opening in a 1.8 m swell that died to 0.2 m showed a
  // green "🌊 Blik 0.2m" and no red tag. slot() keeps each one's place in the
  // tag order; settle() fills or drops it.
  // The fast flags name a strong rise or fall in the tag, as on the row.
  let pressureRose = false, pressureFell = false, roseFast = false, fellFast = false
  let allCalm = true, anyGale = false
  let waveMin = Infinity, waveMax = -Infinity
  const slot = (k: string) => { if (!tags.has(k)) tags.set(k, null) }
  const settle = (k: string, tag: Tag | null) => {
    if (!tags.has(k)) return
    if (tag) tags.set(k, tag)
    else tags.delete(k)
  }

  for (const { idx, dayOffset, target } of hours) {
    const hd = hourly[idx]
    if (!hd) continue
    const { sun: sunTimes, periods, moonBonus } = astroFor(dayOffset)
    let s = W.base
    const bd: BreakdownItem[] = [{ icon: '⚙️', factor: t('bd_base'), label: '', points: W.base, key: 'bd_base' }]
    // `key` is the stable i18n stem for the factor — the display name is t(key)
    // and the modal shows its explanation via t(key + '_why').
    const addBd = (icon: string, key: string, points: number, label = '') => {
      s += points
      if (points !== 0) bd.push({ icon, key, factor: t(key), label, points })
    }

    // The marine hour (null inland and past the marine model's reach).
    const mi = marine ? findIdx(marine, target.getTime()) : -1
    const mh = mi >= 0 ? marine![mi] : null
    const sst = mh?.sstC ?? null

    const pt = pressureTrend(hourly, idx)
    if (pt) {
      // Built outside t(): the strings test reads a quoted ternary branch in a
      // t() call as a whole key, and '_fast' is only a suffix.
      const pressKey = 'press_' + pt.dir + (pt.fast ? '_fast' : '')
      addBd('🌡️', 'bd_pressure', pt.score, t(pressKey))
      if (pt.dir === 'rising') { pressureRose = true; roseFast ||= pt.fast }
      // Any fall, not just a strong one: at the smaller weights a −12 is a
      // > 3 hPa drop in 3 h, and the orange tag all but vanished.
      if (pt.dir === 'falling') { pressureFell = true; fellFast ||= pt.fast }
    }
    slot('pressure')

    // Solunar at moon-phase scale (no evidence it matters, K§1.4); the approach
    // ramp pays in proportion to how close the period is.
    const sol = Solunar.solunarScore(target, periods)
    const SOL = W.solunar
    const solPts = sol.period === 'major' ? SOL.major
      : sol.period === 'minor' ? SOL.minor
      : sol.period === 'approach-major' ? Math.round(SOL.approachMajor * sol.frac)
      : sol.period === 'approach-minor' ? Math.round(SOL.approachMinor * sol.frac) : 0
    addBd('🌙', 'bd_solunar', solPts, sol.label || t('bd_solunar_none'))
    if (sol.label && solPts > 0) tags.set('solunar', { label: sol.label, cls: 'tag-blue' })

    // Time of day, sized by SCORE_WEIGHTS on solunar's ramp position. Dawn and
    // dusk stay for everyone: winter mornings and spring evenings still fish
    // best, also for sea trout (K§2.2–2.3). Midday is the one that doesn't fit
    // a day feeder (hornfisk, pighvar, ising, sild, aborre; havørred in water
    // under 10 °C), so for their share of the targets it counts as ordinary
    // daytime.
    const tod = Solunar.timeOfDayScore(target, sunTimes)
    const TOD = W.timeOfDay
    const qMidday = tod.period === 'midday' ? share((sp) => middayFeeder(sp, sst)) : 0
    const todPts = tod.period === 'dawn' ? Math.round(TOD.dawnBase + (TOD.dawnPeak - TOD.dawnBase) * tod.frac)
      : tod.period === 'dusk' ? Math.round(TOD.duskBase + (TOD.duskPeak - TOD.duskBase) * tod.frac)
      : tod.period === 'night' ? TOD.night
      : tod.period === 'midday' ? Math.round(TOD.midday * (1 - qMidday) + TOD.day * qMidday)
      : tod.period === 'day' ? TOD.day : 0
    const todLabel = tod.label || t('bd_timeofday_none')
    addBd('🌅', 'bd_timeofday', todPts, qMidday > 0 ? `${todLabel} · ${t('bd_tod_dayfeeders')}` : todLabel)
    if (tod.label && (todPts >= 10 || todPts < 0))
      tags.set('timeofday', { label: tod.label, cls: todPts >= 10 ? 'tag-gold' : 'tag-gray' })

    // Overcast helps predators that hunt in subdued light, not the ones that
    // hunt in sun and daylight. The tag describes the sky, so it stays.
    if (hd.cloud > 65) {
      const qCloud = share((sp) => sunFeeder(sp, sst))
      addBd('☁️', 'bd_cloud', Math.round(W.cloud * (1 - qCloud)), `${hd.cloud}% ${t('cloud_word')}`)
      tags.set('cloud', { label: t('tag_overcast'), cls: 'tag-blue' })
    }

    // A missing wind is left out: it read as 0 m/s, i.e. calm and a bonus.
    const wind = hd.windMs
    if (wind != null) {
      let windScore = 0
      if (wind < 3) windScore = W.wind.calm
      else if (wind > 8) windScore = W.wind.gale
      else if (wind > 5.5) windScore = W.wind.brisk
      addBd('💨', 'bd_wind', windScore, `${wind.toFixed(1)} m/s`)
      if (windScore <= 0) allCalm = false
      if (windScore <= W.wind.gale) anyGale = true
    } else {
      allCalm = false // no "light wind" tag without a reading
    }
    slot('wind')

    // Wind trend (rising worsens, falling improves)
    const wt = windTrend(hourly, idx)
    if (wt) addBd('📈', 'bd_windtrend', wt.score, t('wind_' + wt.dir))

    let precipScore = 0
    if (hd.precipPct > 70) precipScore = W.precip.heavy
    else if (hd.precipPct > 40) precipScore = W.precip.light
    addBd('🌧', 'bd_precip', precipScore, `${hd.precipPct}% ${t('precip_word')}`)
    // The chance of rain, not of heavy rain or thunder: precipitation_probability
    // is the chance of ≥ 0.1 mm. It used to carry a −20 "thunder" row too.
    if (hd.precipPct > 70) tags.set('precip', { label: t('bd_tag_rain'), cls: 'tag-orange' })

    // Waves (null for inland coords — skip, same as v1 fix)
    let waveH: number | null = null
    if (mh?.waveM != null) {
      const w = mh.waveM
      waveH = w
      waveMin = Math.min(waveMin, w)
      waveMax = Math.max(waveMax, w)
      slot('wave')
      let waveScore = 0
      const WV = W.wave
      if (w >= 1.5) waveScore = WV.danger
      else if (w >= 1.0) waveScore = WV.high
      else if (w >= 0.6) waveScore = WV.moderate
      else if (w < 0.3) waveScore = WV.glassy
      addBd('🌊', 'bd_wave', waveScore, `${w.toFixed(2)}m`)

      // Fishing-method adjustment for the chosen method
      const M = W.method
      let methodScore = 0
      if (method === 'boat') { if (w > 1.5) methodScore = M.boatBig; else if (w > 0.8) methodScore = M.boatMod }
      else if (method === 'waders') { if (w > 0.6) methodScore = M.wadersBig; else if (w > 0.4) methodScore = M.wadersMod; else if (w < 0.2) methodScore = M.wadersGlassy }
      addBd('🎣', 'bd_method', methodScore)
    }

    addBd('🌕', 'bd_moon', Math.round(moonBonus * W.moonFactor))

    // Tide (saltwater) — DMI predictions, worth as much as the tide is big:
    // a few cm at Dragør and on Bornholm is not tidal movement (K§1.1).
    const tide = tides ? tideAt(tides.predictions, target.getTime()) : null
    if (tide) {
      const rangeCm = Math.round((rangeM ?? 0) * 100)
      const levelCm = `${Math.round(tide.value * 100)} cm`
      addBd('🌊', 'bd_tide', Math.round((tide.rising ? W.tide.rising : W.tide.falling) * tideWeight),
        (tide.rising ? t('tide_rising_word') : t('tide_falling_word')) + ' · ' + t('bd_tide_range').replace('{n}', String(rangeCm)))
      // Only a tide the score counts gets a tag; a 3–11 cm one kept a blue tag
      // on every card for a signal the model now all but ignores.
      if (tideWeight >= W.tide.speciesMinWeight) {
        tags.set('tide', {
          label: tide.rising ? t('tide_rising') : t('tide_falling'),
          cls: 'tag-blue',
          hint: `${tide.rising ? t('tide_tag_rising') : t('tide_tag_falling')} ${levelCm}`,
        })
      }
    }

    // Water temperature against the targets' curves — the main way season
    // enters the model, because it is the mechanism the sources name (K§0,
    // K§12.1). Only targets with a curve count, so one without (gedde)
    // neither raises nor dilutes the row; no sea temperature (a lake, the
    // Limfjord, an old cache) means no row. The mean is weighted by presence
    // (Σp² / Σp): a plain mean let an absent makrel drag down the sea trout
    // that are there, on top of losing its bonuses (critique M1). One target
    // is unchanged, all absent is still −waterTemp, and it is continuous
    // where the visitor gate opens.
    if (sst != null && curves.length) {
      const ps = curves.map((c) => sstPreference(c, sst))
      const sp = ps.reduce((a, p) => a + p, 0)
      const m = sp > 0 ? ps.reduce((a, p) => a + p * p, 0) / sp : 0
      const pts = Math.round(W.waterTemp * (2 * m - 1))
      addBd('💧', 'bd_watertemp', pts, `${sst.toFixed(1)} °C`)
      if (pts >= 6) tags.set('watertemp', { label: `💧 ${sst.toFixed(1)} °C`, cls: 'tag-green' })
      else if (pts <= -6) tags.set('watertemp', { label: `💧 ${sst.toFixed(1)} °C`, cls: 'tag-gray' })
    }

    // Species bonuses
    if (targetSpecies.length) {
      const cond: SpeciesConditions = {
        timeOfDay: tod.period as SpeciesConditions['timeOfDay'], windMs: wind, cloud: hd.cloud, tideRising: !!tide?.rising, tideWeight,
        waveM: waveH, depth: loc.depth ?? null, sstC: sst,
      }
      let bonus = 0
      const fired: string[] = []
      for (const sp of prefs) {
        // A visitor the water keeps away earns nothing: a January dawn paid
        // makrel its dawn bonus for a fish that isn't there (K§3.5, K§4). It
        // still counts in the denominator, like any other target (§10).
        if (!sp || isGated(sp, sst)) continue
        for (const [key, pts] of Object.entries(sp.bonuses)) {
          if (!SPECIES_CONDITIONS[key]?.(cond)) continue
          bonus += pts
          if (!fired.includes(key)) fired.push(key)
        }
      }
      const spScore = clamp(Math.round(bonus / targetSpecies.length), 0, W.speciesMax)
      addBd('🎯', 'fac_species_name', spScore, fired.slice(0, 3).map((k) => t(COND_LABEL_KEY[k] ?? k)).join(' · '))
    }

    hourScores.push(clamp(Math.round(s), 0, 100))
    hourBreakdowns.push(bd)
  }

  // No hour had usable data (all entries skipped) — avoid Math.max([]) / bad index
  if (!hourScores.length) return base

  settle('pressure', pressureFell ? { label: '↓ ' + t(fellFast ? 'press_falling_fast' : 'press_falling'), cls: 'tag-orange' }
    : pressureRose ? { label: '↑ ' + t(roseFast ? 'press_rising_fast' : 'press_rising'), cls: 'tag-green' } : null)
  settle('wind', anyGale ? { label: t('tag_wind_strong'), cls: 'tag-red' }
    : allCalm ? { label: t('tag_wind_light'), cls: 'tag-green' } : null)
  const peak = `${waveMax.toFixed(1)}m`
  settle('wave', waveMax >= 1.5 ? { label: `🌊 ${t('wave_danger')} ${peak}`, cls: 'tag-red' }
    : waveMax >= 1.0 ? { label: `🌊 ${t('wave_high')} ${peak}`, cls: 'tag-red' }
    : waveMax < 0.3 ? { label: `🌊 ${t('wave_calm_lbl')} ${peak}`, cls: 'tag-green' } : null)

  const bestIdx = hourScores.indexOf(Math.max(...hourScores))
  const bestHour = hours[bestIdx] ?? hours[0]

  // Lure suggestion from the best hour's conditions
  const bh = hourly[bestHour.idx]
  const mi = marine ? findIdx(marine, bestHour.target.getTime()) : -1
  const waveM = mi >= 0 && marine![mi].waveM != null ? marine![mi].waveM! : 0
  // bestHour.hour is a local wall-clock hour — compare against local sun hours
  // of the day that hour falls on.
  const sunTimes = astroFor(bestHour.dayOffset).sun
  const srH = sunTimes.sunrise ? sunTimes.sunrise.getHours() : -99
  const ssH = sunTimes.sunset ? sunTimes.sunset.getHours() : -99
  const lure = suggestLure({
    cloud: bh.cloud ?? 50, waveM, windMs: bh.windMs ?? 2, precipPct: bh.precipPct ?? 0,
    isDawn: Math.abs(bestHour.hour - srH) <= 1,
    isDusk: Math.abs(bestHour.hour - ssH) <= 1,
  }, targetSpecies)

  // Spot relevance: bonus if this spot lists target species active this month.
  // Keep the actual split, not just the count — the card lets you open it up to
  // see which species are behind the "1/3 active here" tag.
  let relevanceBonus = 0
  let relevance: WindowRelevance | undefined
  if (targetSpecies.length && loc.species?.length) {
    const m = date.getMonth() + 1
    const activeIds: string[] = []
    const inactiveIds: string[] = []
    for (const id of targetSpecies) {
      const en = SPECIES_PREFS[id]?.nameEn?.toLowerCase()
      const isActive = loc.species!.some((s) => s.nameEn?.toLowerCase() === en && s.months.includes(m))
      ;(isActive ? activeIds : inactiveIds).push(id)
    }
    if (activeIds.length > 0) {
      relevanceBonus = Math.round((activeIds.length / targetSpecies.length) * W.relevanceMax)
      relevance = { activeIds, inactiveIds }
      tags.set('relevance', {
        label: `🎯 ${activeIds.length}/${targetSpecies.length} ${t('relevance_active')}`,
        cls: 'tag-green',
        key: 'relevance',
      })
    }
  }
  // Window-level breakdown: average each factor's contribution across the
  // window's hours so the rows shown in the modal sum to the score on the card.
  // (Detail labels are taken from the best hour as a representative sample.)
  // Grouped by key, not by translated name: two keys that share a name in one
  // language were merged into one row.
  const n = hourBreakdowns.length
  const bestBd = hourBreakdowns[bestIdx] ?? hourBreakdowns[0] ?? []
  const idOf = (it: BreakdownItem) => it.key ?? it.factor
  const labelFor = new Map(bestBd.map((i) => [idOf(i), i.label]))
  const first = new Map<string, BreakdownItem>()
  const totals = new Map<string, number>()
  for (const bd of hourBreakdowns) {
    for (const it of bd) {
      const id = idOf(it)
      if (!first.has(id)) { first.set(id, it); totals.set(id, 0) }
      totals.set(id, totals.get(id)! + it.points)
    }
  }
  const breakdown: BreakdownItem[] = [...first.entries()]
    .map(([id, it]) => ({ icon: it.icon, factor: it.factor, label: labelFor.get(id) ?? '', points: Math.round(totals.get(id)! / n), key: it.key }))
    .filter((b) => b.points !== 0 || b.key === 'bd_base')
  // The wave row spans the window when the sea changes across it — the best
  // hour alone read "0.20m" for a window that opened in a 1.8 m swell.
  const waveRow = breakdown.find((b) => b.key === 'bd_wave')
  if (waveRow && waveMin.toFixed(2) !== waveMax.toFixed(2)) waveRow.label = `${waveMin.toFixed(2)}–${waveMax.toFixed(2)}m`
  if (relevanceBonus > 0) breakdown.push({ icon: '📍', factor: t('fac_spot_name'), label: '', points: relevanceBonus, key: 'fac_spot_name' })
  // The factors can add up to ~150 on a perfect dawn and far below 0 in a
  // storm. Account for the clamp with a row of its own, or the modal lists rows
  // summing to −85 above "Samlet score 0".
  const rawSum = sumPoints(breakdown)
  const finalScore = clamp(rawSum, 0, 100)
  if (finalScore !== rawSum) {
    const key = rawSum > 100 ? 'bd_ceiling' : 'bd_floor'
    breakdown.push({ icon: '📏', factor: t(key), label: '', points: finalScore - rawSum, key })
  }

  return {
    location: loc, date, from, to,
    score: finalScore,
    noData: false,
    bestHourStr: bestHour ? `${String(bestHour.hour).padStart(2, '0')}:00` : null,
    tags: [...tags.values()].filter((tg): tg is Tag => tg != null),
    relevance,
    lure,
    breakdown,
  }
}

export function getScoredWindows(
  locations: Location[],
  availability: Availability[],
  forecasts: Record<string, Forecast>,
  targetSpecies: string[],
  lightning: Record<string, LightningStatus> = {},
): ScoredWindow[] {
  const windows: ScoredWindow[] = []
  const now = new Date()
  const seen = new Set<string>()

  // Days are LOCAL calendar days, encoded as UTC midnight of the local date
  // parts (the window convention). The UTC date of now lags Copenhagen until
  // 01:00/02:00, so at 00:30 on a Tuesday "today" was Monday: Monday's finished
  // dawn window took the lightning cap and the 7th day was dropped.
  // Day -1 only contributes an overnight window that is still running — at
  // 00:30, yesterday's 22:00–02:00 is the one being fished right now.
  for (let day = -1; day < 7; day++) {
    const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + day))
    const dow = date.getUTCDay()
    // Entries with the same hours on the same day are one window: merge their
    // methods first. Deduping per location on the hours alone skipped the later
    // entry's methods, so a Saturday boat slot beside an every-day shore slot
    // at the same hours never had boat scored.
    const slots = new Map<string, { from: string; to: string; methods: FishingMethod[] }>()
    for (const avail of availability) {
      if (!availDays(avail).includes(dow)) continue
      // A zero-length window scores 0, which renders as an ordinary "poor
      // conditions" card — blaming the weather for a setup mistake. Drop it
      // instead; the editor blocks creating one in the first place. (An end
      // hour before the start is an overnight window, and is scored normally.)
      if (!isValidWindow(avail.from, avail.to)) continue
      if (day < 0) {
        if (!isOvernight(avail.from, avail.to)) continue
        const end = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, clockMinutes(avail.to))
        if (end.getTime() <= now.getTime()) continue
      }
      const methods = availMethods(avail)
      const hoursKey = `${avail.from}-${avail.to}`
      const slot = slots.get(hoursKey)
      if (!slot) slots.set(hoursKey, { from: avail.from, to: avail.to, methods: [...methods] })
      else for (const m of methods) if (!slot.methods.includes(m)) slot.methods.push(m)
    }
    for (const { from, to, methods } of slots.values()) {
      for (const loc of locations) {
        const key = `${loc.id}|${date.getTime()}|${from}-${to}`
        if (seen.has(key)) continue
        seen.add(key)
        // A window may allow several methods — score each and keep the best,
        // since the angler would pick whichever fishes best in the conditions.
        // The method only adjusts the wave penalty, so when there's no marine
        // data every method scores identically — skip the redundant passes.
        const fcast = forecasts[loc.id]
        let w = scoreWindow(loc, date, from, to, fcast, targetSpecies, methods[0])
        if (fcast?.marine?.length) {
          for (let mi = 1; mi < methods.length; mi++) {
            const alt = scoreWindow(loc, date, from, to, fcast, targetSpecies, methods[mi])
            if (alt.score > w.score) w = alt
          }
        }
        // Lightning override: danger caps the score; any active strike adds a
        // red tag — today only, plus yesterday's overnight window still running.
        const lgt = lightning[loc.id]
        if (lgt && lgt.level !== 'clear' && day <= 0) {
          w.lightning = lgt
          if (lgt.level === 'danger' && w.score > SCORE_WEIGHTS.lightningCap) {
            // Keep the breakdown summing to the capped score shown on the card —
            // measured from the rows themselves, not from w.score, so the cap
            // can never inherit a mismatch from earlier rows.
            w.breakdown?.push({ icon: '⚡', factor: t('bd_lightning'), label: t('lgt_danger'), points: SCORE_WEIGHTS.lightningCap - sumPoints(w.breakdown), key: 'bd_lightning' })
            w.score = SCORE_WEIGHTS.lightningCap
          }
          w.tags = [{ label: lightningLabel(lgt), cls: 'tag-red' }, ...w.tags]
        }
        windows.push(w)
      }
    }
  }
  return windows.sort((a, b) => b.score - a.score)
}

export function lightningLabel(s: LightningStatus): string {
  const km = s.closestKm != null ? ` ${s.closestKm} km` : ''
  if (s.level === 'danger') return `⚡${km} — ${t('lgt_danger')}`
  if (s.level === 'warning') return `⚡${km} — ${t('lgt_warning')}`
  return `⚡${km} — ${t('lgt_caution')}`
}

export function scoreColor(s: number): string {
  if (s >= 80) return 'score-great'
  if (s >= 65) return 'score-good'
  if (s >= 45) return 'score-avg'
  return 'score-poor'
}

export function scoreLabel(s: number): string {
  if (s >= 80) return t('score_excellent')
  if (s >= 65) return t('score_good')
  if (s >= 45) return t('score_avg')
  if (s >= 30) return t('score_below')
  return t('score_poor')
}
