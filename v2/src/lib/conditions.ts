/** Beaufort scale + current-condition helpers (ported from v1). */
import { t } from './i18n'
// The scorer's own reading, so the tab and the dashboard tag agree. (Imported
// this way round: scoring.ts is in the main chunk, this module is lazy.)
import { threeHoursBefore, tideAt } from './scoring'
import { takesSeaData } from './weather'
import type { Forecast, Location } from './types'

const BEAUFORT = [
  { bf: 0, maxMs: 0.3 }, { bf: 1, maxMs: 1.6 }, { bf: 2, maxMs: 3.4 }, { bf: 3, maxMs: 5.5 },
  { bf: 4, maxMs: 8.0 }, { bf: 5, maxMs: 10.8 }, { bf: 6, maxMs: 13.9 }, { bf: 7, maxMs: 17.2 },
  { bf: 8, maxMs: 20.8 }, { bf: 9, maxMs: 24.5 }, { bf: 10, maxMs: 28.5 }, { bf: 11, maxMs: 32.7 },
  { bf: 12, maxMs: 999 },
]

/** A wind reading on the Beaufort scale. A missing one has no grade: it is not 0 'Stille'. */
export function beaufort(ms: number): { bf: number; label: string } {
  const b = BEAUFORT.find((x) => ms < x.maxMs) ?? BEAUFORT[BEAUFORT.length - 1]
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
  /** Against the reading 3 h back; null when either is missing (not 'stable'). */
  pressureTrend: 'rising' | 'falling' | 'stable' | null
  waveM: number | null; wavePeriod: number | null
  /** Sea temperature °C, the value the water-temperature row scores; null inland or too far from the sea cell. */
  sstC: number | null
  /** Water level, metres (DMI's centimetres converted at fetch). */
  tide: { value: number; rising: boolean } | null
  tideStation: string | null; tideDistKm: number | null
}

/** Hourly series for charts: pressure (next 48h) + wave height (next 24h). */
export function chartSeries(f: Forecast | undefined): { pressure: number[]; waves: number[] } {
  if (!f) return { pressure: [], waves: [] }
  const now = Date.now()
  const pressure = f.hourly
    .filter((h) => h.time >= now && h.time <= now + 48 * 3600000 && h.pressure != null)
    .map((h) => h.pressure!) as number[]
  const waves = (f.marine ?? [])
    .filter((m) => m.time >= now && m.time <= now + 24 * 3600000 && m.waveM != null)
    .map((m) => m.waveM!) as number[]
  return { pressure, waves }
}

// ── Shore / boat / wader safety recommendation (ported from v1) ──
export type RecLevel = 'yes' | 'caution' | 'no'
export interface SafetyRec {
  boat: { ok: RecLevel; labelKey: string }
  shore: { ok: RecLevel; labelKey: string }
  wader: { ok: RecLevel; labelKey: string; notes: string[] }
  /** 'unknown' at a sea spot with no wave height. */
  undercurrent: 'negligible' | 'low' | 'moderate' | 'strong' | 'unknown'
  level: 'safe' | 'caution' | 'danger'
}

/** Gusts of Beaufort 7 strength (the BEAUFORT table's 13.9 m/s) and up. */
const GUST_CAUTION_MS = 13.9

/**
 * A missing reading is never read as calm, as the scorer already refuses to
 * (scoring.ts emptyHour, threeHoursBefore): a null wind was graded Bft 0
 * 'Stille', and an all-null hour between Bft 7 hours gave a green 'ideal'.
 * Each verdict is worked out with the mildest value the missing reading
 * could take (no wind, flat water), and where that still says 'yes' it
 * says 'caution' instead, naming what is missing. Worse values only make a
 * verdict worse, so a 'caution' or 'no' found that way stands. A fresh-water
 * spot has no sea waves to miss (weather.takesSeaData); at a sea spot a null
 * wave height is unknown (a marine outage, or a sea cell too far off), not
 * the inland case, which gave a spot in a 1.8 m swell boat 'good' and
 * waders 'ideal'.
 */
export function safetyRec(c: CurrentConditions, loc: Pick<Location, 'bottomType' | 'waterType'>): SafetyRec {
  const bottomType = loc.bottomType ?? 'mixed'
  const wavesUnknown = takesSeaData(loc) && c.waveM == null
  const bf = c.windMs == null ? 0 : beaufort(c.windMs).bf
  const wave = wavesUnknown ? 0 : c.waveM // null = no sea here (fresh water)
  const missing = c.windMs == null ? 'rec_wind_unknown' : wavesUnknown ? 'rec_waves_unknown' : null

  // Undercurrent (Stokes drift proxy H²/T)
  let undercurrent: SafetyRec['undercurrent'] = wavesUnknown ? 'unknown' : 'negligible'
  if (wave && c.wavePeriod && c.wavePeriod > 0) {
    const proxy = (wave * wave) / c.wavePeriod
    if (proxy >= 0.10) undercurrent = 'strong'
    else if (proxy >= 0.04) undercurrent = 'moderate'
    else if (proxy >= 0.015) undercurrent = 'low'
  }

  // Boat
  let boat: SafetyRec['boat']
  if (wave !== null) {
    if (wave < 0.3 && bf <= 3) boat = { ok: 'yes', labelKey: 'rec_boat_ideal' }
    else if (wave < 0.6 && bf <= 4) boat = { ok: 'yes', labelKey: 'rec_boat_good' }
    else if (wave < 1.0 && bf <= 5) boat = { ok: 'caution', labelKey: 'rec_boat_caution' }
    else boat = { ok: 'no', labelKey: 'rec_boat_no' }
  } else {
    if (bf <= 4) boat = { ok: 'yes', labelKey: 'rec_boat_good' }
    else if (bf <= 5) boat = { ok: 'caution', labelKey: 'rec_boat_caution' }
    else boat = { ok: 'no', labelKey: 'rec_boat_no' }
  }

  // Shore
  let shore: SafetyRec['shore']
  if (wave !== null) {
    if (wave < 1.0 && bf <= 5) shore = { ok: 'yes', labelKey: 'rec_shore_good' }
    else if (wave < 1.5 && bf <= 6) shore = { ok: 'yes', labelKey: 'rec_shore_instead' }
    else if (wave < 2.5) shore = { ok: 'caution', labelKey: 'rec_shore_caution' }
    else shore = { ok: 'no', labelKey: 'rec_shore_no' }
  } else {
    shore = { ok: bf <= 5 ? 'yes' : 'caution', labelKey: bf <= 5 ? 'rec_shore_good' : 'rec_shore_caution' }
  }

  // Waders
  const w = wave ?? 0
  const slip = bottomType === 'stone' || bottomType === 'seaweed'
  const mud = bottomType === 'mud'
  const notes: string[] = []
  if (mud) notes.push('rec_note_mud')
  else if (slip) notes.push('rec_note_slip')
  if (undercurrent === 'strong') notes.push('rec_note_undercurrent_strong')
  else if (undercurrent === 'moderate') notes.push('rec_note_undercurrent_mod')
  if (slip && w > 0.2) notes.push('rec_note_slip_waves')
  if (bottomType === 'sand') notes.push('rec_note_sand_weever')

  let wader: SafetyRec['wader']
  if (mud || undercurrent === 'strong' || w > 0.8) {
    wader = { ok: 'no', labelKey: mud ? 'rec_wader_mud' : undercurrent === 'strong' ? 'rec_wader_undercurrent' : 'rec_wader_waves', notes }
  } else if (slip || undercurrent === 'moderate' || w > 0.4 || bf >= 5) {
    wader = { ok: 'caution', labelKey: 'rec_wader_caution', notes }
  } else {
    wader = { ok: 'yes', labelKey: w < 0.2 ? 'rec_wader_ideal' : 'rec_wader_good', notes }
  }

  if (missing) {
    if (boat.ok === 'yes') boat = { ok: 'caution', labelKey: missing }
    if (shore.ok === 'yes') shore = { ok: 'caution', labelKey: missing }
    if (wader.ok === 'yes') wader = { ...wader, ok: 'caution', labelKey: missing }
  }
  // The table reads the mean wind only, and gusts of Bft 7 strength knock a
  // small boat or a wader about whatever the mean says. (A missing gust
  // changes nothing here: the verdict is built on the mean wind.)
  if (c.gustMs != null && c.gustMs >= GUST_CAUTION_MS) {
    if (boat.ok === 'yes') boat = { ok: 'caution', labelKey: 'rec_boat_caution' }
    if (wader.ok === 'yes') wader = { ...wader, ok: 'caution', labelKey: 'rec_wader_caution' }
  }

  const level = boat.ok === 'no' || wader.ok === 'no' ? 'danger'
    : boat.ok === 'caution' || wader.ok === 'caution' ? 'caution' : 'safe'
  return { boat, shore, wader, undercurrent, level }
}

export function currentConditions(f: Forecast | undefined): CurrentConditions | null {
  if (!f) return null
  const now = Date.now()
  const idx = nearestHourIdx(f, now)
  if (idx < 0) return null
  const h = f.hourly[idx]
  // The row 3 h back, found by time as the score finds it: idx − 3 compared
  // against row 0 in a series' first hours, and a null pressure read as 1013
  // turned a steady 1003 'falling'.
  const p0 = threeHoursBefore(f.hourly, idx)?.pressure
  const dP = h.pressure != null && p0 != null ? h.pressure - p0 : null
  const pressureTrend = dP == null ? null : dP > 1 ? 'rising' : dP < -1 ? 'falling' : 'stable'

  let waveM: number | null = null, wavePeriod: number | null = null, sstC: number | null = null
  if (f.marine) {
    let mb = -1, md = Infinity
    f.marine.forEach((m, i) => { const d = Math.abs(m.time - now); if (d < md) { md = d; mb = i } })
    if (mb >= 0 && md < 2 * 3600000) {
      waveM = f.marine[mb].waveM; wavePeriod = f.marine[mb].wavePeriod
      // Absent on a forecast cached before sea temperature was fetched.
      sstC = f.marine[mb].sstC ?? null
    }
  }

  const tide = f.tides?.predictions?.length ? tideAt(f.tides.predictions, now) : null

  return {
    temp: h.temp, windMs: h.windMs, windDir: h.windDir, gustMs: h.gustMs,
    cloud: h.cloud, precipPct: h.precipPct, pressure: h.pressure, pressureTrend,
    waveM, wavePeriod, sstC, tide,
    tideStation: f.tides?.stationName ?? null, tideDistKm: f.tides?.distKm ?? null,
  }
}
