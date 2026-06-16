/**
 * Scoring engine — TS port of the v1 scoreWindow core.
 * Pure: takes forecast + setup as arguments, no global state.
 */
import { Solunar } from './solunar'
import { SPECIES_PREFS } from './species'
import { suggestLure } from './lures'
import { t } from './i18n'
import type { Availability, Forecast, Location, ScoredWindow } from './types'

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const avg = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0)

function findIdx<T extends { time: number }>(arr: T[], ms: number): number {
  return arr.findIndex((h) => Math.abs(h.time - ms) < 30 * 60000)
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

export function scoreWindow(
  loc: Location,
  date: Date,
  from: string,
  to: string,
  forecast: Forecast | undefined,
  targetSpecies: string[],
): ScoredWindow {
  const base: ScoredWindow = {
    location: loc, date, from, to,
    score: 20, noData: true, bestHourStr: null, tags: [],
  }
  if (!forecast) return base

  const fromH = parseInt(from)
  const toH = parseInt(to)
  if (isNaN(fromH) || isNaN(toH) || fromH >= toH) return { ...base, score: 0, noData: false }

  const { hourly, marine } = forecast
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
  const tags = new Map<string, { label: string; cls: string; hint?: string }>()

  for (const { idx, target } of hours) {
    const hd = hourly[idx]
    if (!hd) continue
    let s = 20

    const pt = pressureTrend(hourly, idx)
    s += pt.score
    if (pt.dir === 'rising') tags.set('pressure', { label: '↑ ' + t('press_rising'), cls: 'tag-green' })
    if (pt.score <= -12) tags.set('pressure', { label: '↓ ' + t('press_falling'), cls: 'tag-orange' })

    const sol = Solunar.solunarScore(target, periods)
    s += sol.score
    if (sol.label) tags.set('solunar', { label: sol.label, cls: 'tag-blue' })

    const tod = Solunar.timeOfDayScore(target, sunTimes)
    s += tod.score
    if (tod.label && (tod.score >= 10 || tod.score < 0))
      tags.set('timeofday', { label: tod.label, cls: tod.score >= 10 ? 'tag-gold' : 'tag-gray' })

    if (hd.cloud > 65) { s += 8; tags.set('cloud', { label: t('tag_overcast'), cls: 'tag-blue' }) }

    const wind = hd.windMs ?? 0
    if (wind < 3) { s += 7; tags.set('wind', { label: t('tag_wind_light'), cls: 'tag-green' }) }
    else if (wind > 8) { s -= 18; tags.set('wind', { label: t('tag_wind_strong'), cls: 'tag-red' }) }
    else if (wind > 5.5) s -= 8

    if (hd.precipPct > 70) { s -= 12; tags.set('precip', { label: t('tag_thunder'), cls: 'tag-red' }) }
    else if (hd.precipPct > 40) s += 4
    if (hd.precipPct > 65) s -= 20 // lightning risk extra

    // Waves (null for inland coords — skip, same as v1 fix)
    const mi = marine ? findIdx(marine, target.getTime()) : -1
    if (mi >= 0 && marine![mi].waveM != null) {
      const w = marine![mi].waveM!
      if (w >= 1.5) { s -= 20; tags.set('wave', { label: `🌊 ${t('wave_danger')} ${w.toFixed(1)}m`, cls: 'tag-red' }) }
      else if (w >= 1.0) { s -= 12; tags.set('wave', { label: `🌊 ${t('wave_high')} ${w.toFixed(1)}m`, cls: 'tag-red' }) }
      else if (w >= 0.6) s -= 6
      else if (w < 0.3) { s += 5; tags.set('wave', { label: `🌊 ${t('wave_calm_lbl')} ${w.toFixed(1)}m`, cls: 'tag-green' }) }
    }

    s += Math.round(moonBonus * 0.3)

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
      }
      s += clamp(Math.round(bonus / targetSpecies.length), 0, 25)
    }

    hourScores.push(clamp(Math.round(s), 0, 100))
  }

  const finalScore = clamp(Math.round(avg(hourScores)), 0, 100)
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

  return {
    location: loc, date, from, to,
    score: finalScore,
    noData: false,
    bestHourStr: bestHour ? `${String(bestHour.hour).padStart(2, '0')}:00` : null,
    tags: [...tags.values()],
    lure,
  }
}

export function getScoredWindows(
  locations: Location[],
  availability: Availability[],
  forecasts: Record<string, Forecast>,
  targetSpecies: string[],
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
        windows.push(scoreWindow(loc, date, avail.from, avail.to, forecasts[loc.id], targetSpecies))
      }
    }
  }
  return windows.sort((a, b) => b.score - a.score)
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
