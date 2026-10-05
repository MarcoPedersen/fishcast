/**
 * Scoring engine — TS port of the v1 scoreWindow core.
 * Pure: takes forecast + setup as arguments, no global state.
 */
import { Solunar } from './solunar'
import { SPECIES_PREFS } from './species'
import { suggestLure } from './lures'
import { clamp } from './math'
import { t } from './i18n'
import type { Availability, BreakdownItem, Forecast, LightningStatus, Location, ScoredWindow, WindowRelevance } from './types'

/**
 * All scoring point values in one place — how much each factor can move the
 * score. Tune the model here; the modal's explanation text (bd_*_why strings)
 * describes these ranges to the user, so keep the two in rough agreement.
 */
export const SCORE_WEIGHTS = {
  base: 20,
  pressure: { strongRise: 22, rise: 12, stable: 1, fall: -12, strongFall: -25 },
  windDir: { westNW: 5, south: 2, north: 3, eastNE: -5 },
  windTrend: { strongRise: -15, rise: -8, strongFall: 8, fall: 4 },
  cloud: 8,
  wind: { calm: 7, brisk: -8, gale: -18 },
  precip: { light: 4, heavy: -12, thunder: -20 },
  wave: { danger: -20, high: -12, moderate: -6, glassy: 5 },
  method: { boatBig: -15, boatMod: -8, wadersBig: -12, wadersMod: -6, wadersGlassy: 5 },
  moonFactor: 0.3,
  tide: { rising: 12, falling: 5 },
  speciesMax: 25,
  relevanceMax: 12,
  lightningCap: 15,
} as const

function findIdx<T extends { time: number }>(arr: T[], ms: number): number {
  return arr.findIndex((h) => Math.abs(h.time - ms) < 30 * 60000)
}

const sumPoints = (rows: BreakdownItem[]) => rows.reduce((sum, b) => sum + b.points, 0)

type Tag = ScoredWindow['tags'][number]

interface TideState { value: number; rising: boolean }
function tideAt(predictions: { time: number; value: number }[], targetMs: number): TideState | null {
  if (!predictions || predictions.length < 3) return null
  for (let i = 1; i < predictions.length - 1; i++) {
    if (predictions[i].time <= targetMs && predictions[i + 1].time > targetMs) {
      const prev = predictions[i - 1], curr = predictions[i], next = predictions[i + 1]
      const frac = (targetMs - curr.time) / (next.time - curr.time)
      return { value: curr.value + frac * (next.value - curr.value), rising: curr.value > prev.value }
    }
  }
  return null
}

function pressureTrend(hourly: Forecast['hourly'], idx: number) {
  const now = hourly[idx]?.pressure ?? 1013
  const prev = hourly[Math.max(0, idx - 3)]?.pressure ?? 1013
  const delta = now - prev
  const P = SCORE_WEIGHTS.pressure
  if (delta > 3) return { dir: 'rising', score: P.strongRise }
  if (delta > 1) return { dir: 'rising', score: P.rise }
  if (delta > -1) return { dir: 'stable', score: P.stable }
  if (delta > -3) return { dir: 'falling', score: P.fall }
  return { dir: 'falling', score: P.strongFall }
}

// Wind direction bonus (old fishing wisdom): W/NW best, NE/E worst
function windDirBonus(deg: number | null): number {
  if (deg == null) return 0
  const d = ((deg % 360) + 360) % 360
  const W = SCORE_WEIGHTS.windDir
  if (d >= 247 && d < 337) return W.westNW
  if (d >= 157 && d < 247) return W.south
  if (d >= 337 || d < 22) return W.north
  if (d >= 22 && d < 112) return W.eastNE
  return 0
}

// Wind trend over the previous 3h: rising worsens, falling improves
function windTrend(hourly: Forecast['hourly'], idx: number): { dir: string; score: number } {
  if (hourly.length < 4) return { dir: 'stable', score: 0 }
  const delta = (hourly[idx]?.windMs ?? 0) - (hourly[Math.max(0, idx - 3)]?.windMs ?? 0)
  const T = SCORE_WEIGHTS.windTrend
  if (delta > 2.5) return { dir: 'rising', score: T.strongRise }
  if (delta > 1.0) return { dir: 'rising', score: T.rise }
  if (delta < -2.5) return { dir: 'falling', score: T.strongFall }
  if (delta < -1.0) return { dir: 'falling', score: T.fall }
  return { dir: 'stable', score: 0 }
}

/** 'HH:MM' → minutes after midnight (NaN when the hour doesn't parse). */
function clockMinutes(s: string): number {
  const [h, m] = s.split(':')
  return parseInt(h) * 60 + (parseInt(m) || 0)
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
    if (idx >= 0) hours.push({ idx, hour, dayOffset, target })
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

  const hourScores: number[] = []
  const hourBreakdowns: BreakdownItem[][] = []
  const tags = new Map<string, Tag | null>()
  // Pressure, wind and wave tags describe the WINDOW, so its worst hour decides
  // them after the loop. Set hour by hour, the last hour to cross a threshold
  // won: a waders window opening in a 1.8 m swell that died to 0.2 m showed a
  // green "🌊 Blik 0.2m" and no red tag. slot() keeps each one's place in the
  // tag order; settle() fills or drops it.
  let pressureRose = false, pressureFell = false
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
    let s = SCORE_WEIGHTS.base
    const bd: BreakdownItem[] = [{ icon: '⚙️', factor: t('bd_base'), label: '', points: SCORE_WEIGHTS.base, key: 'bd_base' }]
    // `key` is the stable i18n stem for the factor — the display name is t(key)
    // and the modal shows its explanation via t(key + '_why').
    const addBd = (icon: string, key: string, points: number, label = '') => {
      if (points !== 0) bd.push({ icon, key, factor: t(key), label, points })
    }

    const pt = pressureTrend(hourly, idx)
    s += pt.score
    addBd('🌡️', 'bd_pressure', pt.score, t('press_' + pt.dir))
    if (pt.dir === 'rising') pressureRose = true
    if (pt.score <= -12) pressureFell = true
    slot('pressure')

    const sol = Solunar.solunarScore(target, periods)
    s += sol.score
    addBd('🌙', 'bd_solunar', sol.score, sol.label || t('bd_solunar_none'))
    if (sol.label) tags.set('solunar', { label: sol.label, cls: 'tag-blue' })

    const tod = Solunar.timeOfDayScore(target, sunTimes)
    s += tod.score
    addBd('🌅', 'bd_timeofday', tod.score, tod.label || t('bd_timeofday_none'))
    if (tod.label && (tod.score >= 10 || tod.score < 0))
      tags.set('timeofday', { label: tod.label, cls: tod.score >= 10 ? 'tag-gold' : 'tag-gray' })

    if (hd.cloud > 65) { s += SCORE_WEIGHTS.cloud; addBd('☁️', 'bd_cloud', SCORE_WEIGHTS.cloud, `${hd.cloud}% ${t('cloud_word')}`); tags.set('cloud', { label: t('tag_overcast'), cls: 'tag-blue' }) }

    const wind = hd.windMs ?? 0
    let windScore = 0
    if (wind < 3) windScore = SCORE_WEIGHTS.wind.calm
    else if (wind > 8) windScore = SCORE_WEIGHTS.wind.gale
    else if (wind > 5.5) windScore = SCORE_WEIGHTS.wind.brisk
    s += windScore
    addBd('💨', 'bd_wind', windScore, `${wind.toFixed(1)} m/s`)
    if (windScore <= 0) allCalm = false
    if (windScore <= SCORE_WEIGHTS.wind.gale) anyGale = true
    slot('wind')

    // Wind trend (rising worsens, falling improves)
    const wt = windTrend(hourly, idx)
    s += wt.score
    addBd('📈', 'bd_windtrend', wt.score, t('wind_' + wt.dir))

    // Wind direction (old fishing wisdom)
    const wdBonus = windDirBonus(hd.windDir)
    s += wdBonus
    addBd('🧭', 'bd_winddir', wdBonus)

    let precipScore = 0
    if (hd.precipPct > 70) precipScore = SCORE_WEIGHTS.precip.heavy
    else if (hd.precipPct > 40) precipScore = SCORE_WEIGHTS.precip.light
    s += precipScore
    addBd('🌧', 'bd_precip', precipScore, `${hd.precipPct}% ${t('precip_word')}`)
    if (hd.precipPct > 70) tags.set('precip', { label: t('tag_thunder'), cls: 'tag-red' })
    // Aligned with the -12 branch + tag above; at >65 it overlapped the
    // "beneficial light rain" +4, giving contradictory breakdown rows.
    if (hd.precipPct > 70) { s += SCORE_WEIGHTS.precip.thunder; addBd('⚡', 'bd_lightning', SCORE_WEIGHTS.precip.thunder, t('thunder_risk')) }

    // Waves (null for inland coords — skip, same as v1 fix)
    const mi = marine ? findIdx(marine, target.getTime()) : -1
    if (mi >= 0 && marine![mi].waveM != null) {
      const w = marine![mi].waveM!
      waveMin = Math.min(waveMin, w)
      waveMax = Math.max(waveMax, w)
      slot('wave')
      let waveScore = 0
      const WV = SCORE_WEIGHTS.wave
      if (w >= 1.5) waveScore = WV.danger
      else if (w >= 1.0) waveScore = WV.high
      else if (w >= 0.6) waveScore = WV.moderate
      else if (w < 0.3) waveScore = WV.glassy
      s += waveScore
      addBd('🌊', 'bd_wave', waveScore, `${w.toFixed(2)}m`)

      // Fishing-method adjustment for the chosen method
      const M = SCORE_WEIGHTS.method
      let methodScore = 0
      if (method === 'boat') { if (w > 1.5) methodScore = M.boatBig; else if (w > 0.8) methodScore = M.boatMod }
      else if (method === 'waders') { if (w > 0.6) methodScore = M.wadersBig; else if (w > 0.4) methodScore = M.wadersMod; else if (w < 0.2) methodScore = M.wadersGlassy }
      if (methodScore !== 0) { s += methodScore; addBd('🎣', 'bd_method', methodScore) }
    }

    const moonScore = Math.round(moonBonus * SCORE_WEIGHTS.moonFactor)
    s += moonScore
    addBd('🌕', 'bd_moon', moonScore)

    // Tide (saltwater) — DMI predictions
    const tide = tides ? tideAt(tides.predictions, target.getTime()) : null
    if (tide) {
      const tScore = tide.rising ? SCORE_WEIGHTS.tide.rising : SCORE_WEIGHTS.tide.falling
      s += tScore
      addBd('🌊', 'bd_tide', tScore, (tide.rising ? t('tide_rising_word') : t('tide_falling_word')) + ` ${tide.value.toFixed(2)}m`)
      tags.set('tide', {
        label: tide.rising ? t('tide_rising') : t('tide_falling'),
        cls: 'tag-blue',
        hint: `${tide.rising ? t('tide_tag_rising') : t('tide_tag_falling')} ${tide.value.toFixed(2)}m`,
      })
    }

    // Species bonuses
    if (targetSpecies.length) {
      let bonus = 0
      for (const id of targetSpecies) {
        const b = SPECIES_PREFS[id]?.bonuses
        if (!b) continue
        if (b.pressureRising && pt.dir === 'rising') bonus += b.pressureRising
        if (b.pressureStable && pt.dir === 'stable') bonus += b.pressureStable
        if (b.solunarMajor && sol.period === 'major') bonus += b.solunarMajor
        if (b.dawn && tod.period === 'dawn') bonus += b.dawn
        if (b.dusk && tod.period === 'dusk') bonus += b.dusk
        if (b.night && tod.period === 'night') bonus += b.night
        if (b.calm && wind < 3) bonus += b.calm
        if (b.cloud && hd.cloud > 60) bonus += b.cloud
        if (b.tide && tide?.rising) bonus += b.tide
      }
      const spScore = clamp(Math.round(bonus / targetSpecies.length), 0, SCORE_WEIGHTS.speciesMax)
      s += spScore
      addBd('🎯', 'fac_species_name', spScore)
    }

    hourScores.push(clamp(Math.round(s), 0, 100))
    hourBreakdowns.push(bd)
  }

  // No hour had usable data (all entries skipped) — avoid Math.max([]) / bad index
  if (!hourScores.length) return base

  settle('pressure', pressureFell ? { label: '↓ ' + t('press_falling'), cls: 'tag-orange' }
    : pressureRose ? { label: '↑ ' + t('press_rising'), cls: 'tag-green' } : null)
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
      relevanceBonus = Math.round((activeIds.length / targetSpecies.length) * SCORE_WEIGHTS.relevanceMax)
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
  const n = hourBreakdowns.length
  const bestBd = hourBreakdowns[bestIdx] ?? hourBreakdowns[0] ?? []
  const labelFor = new Map(bestBd.map((i) => [i.factor, i.label]))
  const iconFor = new Map<string, string>()
  const keyFor = new Map<string, string | undefined>()
  const totals = new Map<string, number>()
  const order: string[] = []
  for (const bd of hourBreakdowns) {
    for (const it of bd) {
      if (!totals.has(it.factor)) { totals.set(it.factor, 0); order.push(it.factor); iconFor.set(it.factor, it.icon); keyFor.set(it.factor, it.key) }
      totals.set(it.factor, totals.get(it.factor)! + it.points)
    }
  }
  const breakdown: BreakdownItem[] = order
    .map((f) => ({ icon: iconFor.get(f)!, factor: f, label: labelFor.get(f) ?? '', points: Math.round(totals.get(f)! / n), key: keyFor.get(f) }))
    .filter((b) => b.points !== 0 || b.factor === t('bd_base'))
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
    for (const avail of availability) {
      if (!avail.days.includes(dow)) continue
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
      for (const loc of locations) {
        const key = `${loc.id}|${date.getTime()}|${avail.from}-${avail.to}`
        if (seen.has(key)) continue
        seen.add(key)
        // A window may allow several methods — score each and keep the best,
        // since the angler would pick whichever fishes best in the conditions.
        // The method only adjusts the wave penalty, so when there's no marine
        // data every method scores identically — skip the redundant passes.
        const fcast = forecasts[loc.id]
        const methods = avail.methods?.length ? avail.methods : ['shore' as const]
        let w = scoreWindow(loc, date, avail.from, avail.to, fcast, targetSpecies, methods[0])
        if (fcast?.marine?.length) {
          for (let mi = 1; mi < methods.length; mi++) {
            const alt = scoreWindow(loc, date, avail.from, avail.to, fcast, targetSpecies, methods[mi])
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
