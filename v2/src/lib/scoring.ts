/**
 * Scoring engine — TS port of the v1 scoreWindow core.
 * Pure: takes forecast + setup as arguments, no global state.
 */
import { Solunar } from './solunar'
import { SPECIES_PREFS } from './species'
import { suggestLure } from './lures'
import { clamp } from './math'
import { t } from './i18n'
import type { Availability, BreakdownItem, Forecast, LightningStatus, Location, ScoredWindow } from './types'

function findIdx<T extends { time: number }>(arr: T[], ms: number): number {
  return arr.findIndex((h) => Math.abs(h.time - ms) < 30 * 60000)
}

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
  if (delta > 3) return { dir: 'rising', score: 22 }
  if (delta > 1) return { dir: 'rising', score: 12 }
  if (delta > -1) return { dir: 'stable', score: 1 }
  if (delta > -3) return { dir: 'falling', score: -12 }
  return { dir: 'falling', score: -25 }
}

// Wind direction bonus (old fishing wisdom): W/NW best, NE/E worst
function windDirBonus(deg: number | null): number {
  if (deg == null) return 0
  const d = ((deg % 360) + 360) % 360
  if (d >= 247 && d < 337) return 5
  if (d >= 157 && d < 247) return 2
  if (d >= 337 || d < 22) return 3
  if (d >= 22 && d < 112) return -5
  return 0
}

// Wind trend over the previous 3h: rising worsens, falling improves
function windTrend(hourly: Forecast['hourly'], idx: number): { dir: string; score: number } {
  if (hourly.length < 4) return { dir: 'stable', score: 0 }
  const delta = (hourly[idx]?.windMs ?? 0) - (hourly[Math.max(0, idx - 3)]?.windMs ?? 0)
  if (delta > 2.5) return { dir: 'rising', score: -15 }
  if (delta > 1.0) return { dir: 'rising', score: -8 }
  if (delta < -2.5) return { dir: 'falling', score: 8 }
  if (delta < -1.0) return { dir: 'falling', score: 4 }
  return { dir: 'stable', score: 0 }
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
  if (isNaN(fromH) || isNaN(toH) || fromH >= toH) return { ...base, score: 0, noData: false }

  const { hourly, marine, tides } = forecast
  const hours: { idx: number; hour: number; target: Date }[] = []
  for (let h = fromH; h <= Math.min(toH, fromH + 12); h++) {
    const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), h))
    const idx = findIdx(hourly, target.getTime())
    if (idx >= 0) hours.push({ idx, hour: h, target })
  }
  if (!hours.length) return { ...base, score: 50, noData: false }

  const sunTimes = Solunar.getSunTimes(date, loc.lat, loc.lon)
  const periods = Solunar.getSolunarPeriods(date, loc.lat, loc.lon)
  const moonBonus = Solunar.moonPhaseLabel(Solunar.getMoonPhase(date)).score

  const hourScores: number[] = []
  const hourBreakdowns: BreakdownItem[][] = []
  const tags = new Map<string, { label: string; cls: string; hint?: string }>()

  for (const { idx, target } of hours) {
    const hd = hourly[idx]
    if (!hd) continue
    let s = 20
    const bd: BreakdownItem[] = [{ icon: '⚙️', factor: t('bd_base'), label: '', points: 20 }]
    const addBd = (icon: string, factor: string, points: number, label = '') => {
      if (points !== 0) bd.push({ icon, factor, label, points })
    }

    const pt = pressureTrend(hourly, idx)
    s += pt.score
    addBd('🌡️', t('bd_pressure'), pt.score, t('press_' + pt.dir))
    if (pt.dir === 'rising') tags.set('pressure', { label: '↑ ' + t('press_rising'), cls: 'tag-green' })
    if (pt.score <= -12) tags.set('pressure', { label: '↓ ' + t('press_falling'), cls: 'tag-orange' })

    const sol = Solunar.solunarScore(target, periods)
    s += sol.score
    addBd('🌙', t('bd_solunar'), sol.score, sol.label || t('bd_solunar_none'))
    if (sol.label) tags.set('solunar', { label: sol.label, cls: 'tag-blue' })

    const tod = Solunar.timeOfDayScore(target, sunTimes)
    s += tod.score
    addBd('🌅', t('bd_timeofday'), tod.score, tod.label || t('bd_timeofday_none'))
    if (tod.label && (tod.score >= 10 || tod.score < 0))
      tags.set('timeofday', { label: tod.label, cls: tod.score >= 10 ? 'tag-gold' : 'tag-gray' })

    if (hd.cloud > 65) { s += 8; addBd('☁️', t('bd_cloud'), 8, `${hd.cloud}% ${t('cloud_word')}`); tags.set('cloud', { label: t('tag_overcast'), cls: 'tag-blue' }) }

    const wind = hd.windMs ?? 0
    let windScore = 0
    if (wind < 3) windScore = 7
    else if (wind > 8) windScore = -18
    else if (wind > 5.5) windScore = -8
    s += windScore
    addBd('💨', t('bd_wind'), windScore, `${wind.toFixed(1)} m/s`)
    if (windScore > 0) tags.set('wind', { label: t('tag_wind_light'), cls: 'tag-green' })
    else if (windScore <= -18) tags.set('wind', { label: t('tag_wind_strong'), cls: 'tag-red' })

    // Wind trend (rising worsens, falling improves)
    const wt = windTrend(hourly, idx)
    s += wt.score
    addBd('📈', t('bd_windtrend'), wt.score, t('wind_' + wt.dir))

    // Wind direction (old fishing wisdom)
    const wdBonus = windDirBonus(hd.windDir)
    s += wdBonus
    addBd('🧭', t('bd_winddir'), wdBonus)

    let precipScore = 0
    if (hd.precipPct > 70) precipScore = -12
    else if (hd.precipPct > 40) precipScore = 4
    s += precipScore
    addBd('🌧', t('bd_precip'), precipScore, `${hd.precipPct}% ${t('precip_word')}`)
    if (hd.precipPct > 70) tags.set('precip', { label: t('tag_thunder'), cls: 'tag-red' })
    if (hd.precipPct > 65) { s -= 20; addBd('⚡', t('bd_lightning'), -20, t('thunder_risk')) }

    // Waves (null for inland coords — skip, same as v1 fix)
    const mi = marine ? findIdx(marine, target.getTime()) : -1
    if (mi >= 0 && marine![mi].waveM != null) {
      const w = marine![mi].waveM!
      let waveScore = 0, waveLabel = `${w.toFixed(1)}m`
      if (w >= 1.5) { waveScore = -20; waveLabel = `🌊 ${t('wave_danger')} ${w.toFixed(1)}m`; tags.set('wave', { label: waveLabel, cls: 'tag-red' }) }
      else if (w >= 1.0) { waveScore = -12; waveLabel = `🌊 ${t('wave_high')} ${w.toFixed(1)}m`; tags.set('wave', { label: waveLabel, cls: 'tag-red' }) }
      else if (w >= 0.6) waveScore = -6
      else if (w < 0.3) { waveScore = 5; waveLabel = `🌊 ${t('wave_calm_lbl')} ${w.toFixed(1)}m`; tags.set('wave', { label: waveLabel, cls: 'tag-green' }) }
      s += waveScore
      addBd('🌊', t('bd_wave'), waveScore, `${w.toFixed(2)}m`)

      // Fishing-method adjustment for the chosen method
      let methodScore = 0
      if (method === 'boat') { if (w > 1.5) methodScore = -15; else if (w > 0.8) methodScore = -8 }
      else if (method === 'waders') { if (w > 0.6) methodScore = -12; else if (w > 0.4) methodScore = -6; else if (w < 0.2) methodScore = 5 }
      if (methodScore !== 0) { s += methodScore; addBd('🎣', t('bd_method'), methodScore) }
    }

    const moonScore = Math.round(moonBonus * 0.3)
    s += moonScore
    addBd('🌕', t('bd_moon'), moonScore)

    // Tide (saltwater) — DMI predictions
    const tide = tides ? tideAt(tides.predictions, target.getTime()) : null
    if (tide) {
      const tScore = tide.rising ? 12 : 5
      s += tScore
      addBd('🌊', t('bd_tide'), tScore, (tide.rising ? t('tide_rising_word') : t('tide_falling_word')) + ` ${tide.value.toFixed(2)}m`)
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
      const spScore = clamp(Math.round(bonus / targetSpecies.length), 0, 25)
      s += spScore
      addBd('🎯', t('fac_species_name'), spScore)
    }

    hourScores.push(clamp(Math.round(s), 0, 100))
    hourBreakdowns.push(bd)
  }

  // No hour had usable data (all entries skipped) — avoid Math.max([]) / bad index
  if (!hourScores.length) return { ...base, score: 50, noData: false }

  const bestIdx = hourScores.indexOf(Math.max(...hourScores))
  const bestHour = hours[bestIdx] ?? hours[0]

  // Lure suggestion from the best hour's conditions
  const bh = hourly[bestHour.idx]
  const mi = marine ? findIdx(marine, bestHour.target.getTime()) : -1
  const waveM = mi >= 0 && marine![mi].waveM != null ? marine![mi].waveM! : 0
  const srH = sunTimes.sunrise ? sunTimes.sunrise.getUTCHours() : -99
  const ssH = sunTimes.sunset ? sunTimes.sunset.getUTCHours() : -99
  const lure = suggestLure({
    cloud: bh.cloud ?? 50, waveM, windMs: bh.windMs ?? 2, precipPct: bh.precipPct ?? 0,
    isDawn: Math.abs(bestHour.hour - srH) <= 1,
    isDusk: Math.abs(bestHour.hour - ssH) <= 1,
  }, targetSpecies)

  // Spot relevance: bonus if this spot lists target species active this month
  let relevanceBonus = 0
  if (targetSpecies.length && loc.species?.length) {
    const m = date.getMonth() + 1
    const matches = targetSpecies.filter((id) => {
      const en = SPECIES_PREFS[id]?.nameEn?.toLowerCase()
      return loc.species!.some((s) => s.nameEn?.toLowerCase() === en && s.months.includes(m))
    }).length
    if (matches > 0) {
      relevanceBonus = Math.round((matches / targetSpecies.length) * 12)
      tags.set('relevance', { label: `🎯 ${matches}/${targetSpecies.length} ${t('relevance_active')}`, cls: 'tag-green' })
    }
  }
  // Window-level breakdown: average each factor's contribution across the
  // window's hours so the rows shown in the modal sum to the score on the card.
  // (Detail labels are taken from the best hour as a representative sample.)
  const n = hourBreakdowns.length
  const bestBd = hourBreakdowns[bestIdx] ?? hourBreakdowns[0] ?? []
  const labelFor = new Map(bestBd.map((i) => [i.factor, i.label]))
  const iconFor = new Map<string, string>()
  const totals = new Map<string, number>()
  const order: string[] = []
  for (const bd of hourBreakdowns) {
    for (const it of bd) {
      if (!totals.has(it.factor)) { totals.set(it.factor, 0); order.push(it.factor); iconFor.set(it.factor, it.icon) }
      totals.set(it.factor, totals.get(it.factor)! + it.points)
    }
  }
  const breakdown: BreakdownItem[] = order
    .map((f) => ({ icon: iconFor.get(f)!, factor: f, label: labelFor.get(f) ?? '', points: Math.round(totals.get(f)! / n) }))
    .filter((b) => b.points !== 0 || b.factor === t('bd_base'))
  if (relevanceBonus > 0) breakdown.push({ icon: '📍', factor: t('fac_spot_name'), label: '', points: relevanceBonus })
  const finalScore = clamp(breakdown.reduce((sum, b) => sum + b.points, 0), 0, 100)

  return {
    location: loc, date, from, to,
    score: finalScore,
    noData: false,
    bestHourStr: bestHour ? `${String(bestHour.hour).padStart(2, '0')}:00` : null,
    tags: [...tags.values()],
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

  for (let day = 0; day < 7; day++) {
    const date = new Date(now)
    date.setUTCDate(date.getUTCDate() + day)
    date.setUTCHours(0, 0, 0, 0)
    const dow = date.getDay()
    for (const avail of availability) {
      if (!avail.days.includes(dow)) continue
      for (const loc of locations) {
        const key = `${loc.id}|${date.getTime()}|${avail.from}-${avail.to}`
        if (seen.has(key)) continue
        seen.add(key)
        const method = avail.methods?.[0] ?? 'shore'
        const w = scoreWindow(loc, date, avail.from, avail.to, forecasts[loc.id], targetSpecies, method)
        // Lightning override: danger caps the score; any active strike adds a red tag (today only)
        const lgt = lightning[loc.id]
        if (lgt && lgt.level !== 'clear' && day === 0) {
          w.lightning = lgt
          if (lgt.level === 'danger') w.score = Math.min(w.score, 15)
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
