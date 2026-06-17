/** Beaufort scale + current-condition helpers (ported from v1). */
import { t } from './i18n'
import type { Forecast } from './types'

const BEAUFORT = [
  { bf: 0, maxMs: 0.3 }, { bf: 1, maxMs: 1.6 }, { bf: 2, maxMs: 3.4 }, { bf: 3, maxMs: 5.5 },
  { bf: 4, maxMs: 8.0 }, { bf: 5, maxMs: 10.8 }, { bf: 6, maxMs: 13.9 }, { bf: 7, maxMs: 17.2 },
  { bf: 8, maxMs: 20.8 }, { bf: 9, maxMs: 24.5 }, { bf: 10, maxMs: 28.5 }, { bf: 11, maxMs: 32.7 },
  { bf: 12, maxMs: 999 },
]

export function beaufort(ms: number | null): { bf: number; label: string } {
  const v = ms ?? 0
  const b = BEAUFORT.find((x) => v < x.maxMs) ?? BEAUFORT[BEAUFORT.length - 1]
  return { bf: b.bf, label: t('bft_' + b.bf) }
}

const WIND_DIRS = ['N', 'NNØ', 'NØ', 'ØNØ', 'Ø', 'ØSØ', 'SØ', 'SSØ', 'S', 'SSV', 'SV', 'VSV', 'V', 'VNV', 'NV', 'NNV']
const WIND_DIRS_EN = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
export function windDir(deg: number | null, en: boolean): string {
  if (deg == null) return '–'
  return (en ? WIND_DIRS_EN : WIND_DIRS)[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]
}

function nearestHourIdx(f: Forecast, ms: number): number {
  let best = -1, bestDiff = Infinity
  f.hourly.forEach((h, i) => { const d = Math.abs(h.time - ms); if (d < bestDiff) { bestDiff = d; best = i } })
  return bestDiff < 2 * 3600000 ? best : -1
}

export interface CurrentConditions {
  temp: number | null; windMs: number | null; windDir: number | null; gustMs: number | null
  cloud: number; precipPct: number; pressure: number | null
  pressureTrend: 'rising' | 'falling' | 'stable'
  waveM: number | null; wavePeriod: number | null
  tide: { value: number; rising: boolean } | null
  tideStation: string | null; tideDistKm: number | null
}

export function currentConditions(f: Forecast | undefined): CurrentConditions | null {
  if (!f) return null
  const now = Date.now()
  const idx = nearestHourIdx(f, now)
  if (idx < 0) return null
  const h = f.hourly[idx]
  const prev = f.hourly[Math.max(0, idx - 3)]
  const dP = (h.pressure ?? 1013) - (prev.pressure ?? 1013)
  const pressureTrend = dP > 1 ? 'rising' : dP < -1 ? 'falling' : 'stable'

  let waveM: number | null = null, wavePeriod: number | null = null
  if (f.marine) {
    let mb = -1, md = Infinity
    f.marine.forEach((m, i) => { const d = Math.abs(m.time - now); if (d < md) { md = d; mb = i } })
    if (mb >= 0 && md < 2 * 3600000) { waveM = f.marine[mb].waveM; wavePeriod = f.marine[mb].wavePeriod }
  }

  let tide: { value: number; rising: boolean } | null = null
  if (f.tides?.predictions?.length) {
    const p = f.tides.predictions
    for (let i = 1; i < p.length - 1; i++) {
      if (p[i].time <= now && p[i + 1].time > now) { tide = { value: p[i].value, rising: p[i].value > p[i - 1].value }; break }
    }
  }

  return {
    temp: h.temp, windMs: h.windMs, windDir: h.windDir, gustMs: h.gustMs,
    cloud: h.cloud, precipPct: h.precipPct, pressure: h.pressure, pressureTrend,
    waveM, wavePeriod, tide,
    tideStation: f.tides?.stationName ?? null, tideDistKm: f.tides?.distKm ?? null,
  }
}
