/**
 * Shared by record.check.ts and compare.check.ts: the fixture, the locations
 * and forecasts built from it, and the one deterministic enumeration of
 * windows both files are written and read in.
 */
import fs from 'node:fs'
import zlib from 'node:zlib'
import { hourlyRows, marineRows, tideRangeM } from '@/lib/weather'
import { DK_SPOTS, locationFromSpot } from '@/lib/spots'
import { SPOT_COAST } from '@/lib/spotCoast.gen'
import { resolveShore, type CoastAuto, type Shore } from '@/lib/coast'
import type { Forecast, Location, ScoredWindow } from '@/lib/types'

const here = (f: string) => new URL(`./${f}`, import.meta.url)

export interface FixtureSpot {
  id: string; slug?: string; name?: string; lat: number; lon: number; waterType: Location['waterType']
  station?: { id: string; name: string; distKm: number }
}
interface FixturePeriod {
  start: string; end: string
  wx: { latitude: number; longitude: number; hourly: any }[]
  ma: { latitude: number; longitude: number; hourly: any }[]
  tides: Record<string, { t0: number; minutes: number[]; values: number[] }>
}
export const FIXTURE: { recorded: string; spots: FixtureSpot[]; periods: FixturePeriod[] } =
  JSON.parse(fs.readFileSync(here('fixture.json'), 'utf8'))

export const LOCS: Location[] = FIXTURE.spots.map((s) => {
  if (!s.slug) return { id: s.id, name: s.name ?? s.id, lat: s.lat, lon: s.lon, waterType: s.waterType }
  const spot = DK_SPOTS.find((d) => d.slug === s.slug)
  if (!spot) throw new Error(`no official spot ${s.slug}`)
  return { id: s.id, ...locationFromSpot(spot) }
})

/** 'tides' = DMI predictions as recorded; 'notides' = DMI failing, as it does in production today (critique R1). */
export const VARIANTS = ['tides', 'notides'] as const
export type Variant = typeof VARIANTS[number]

/**
 * The forecast the app would hold for this spot. The fixture's DMI values are
 * centimetres, as recorded; the app converts at fetch, so they are divided by
 * 100 here. With `date`, rangeM is set the way fetchTides sets it on the
 * dashboard: over the fixed [day − 1, day + 7) horizon (critique M7), so the
 * check scores what a card shows, not a 15-day range.
 */
export function forecastFor(pi: number, si: number, variant: Variant, date?: Date): Forecast {
  const p = FIXTURE.periods[pi], spot = FIXTURE.spots[si]
  const t = spot.station && variant === 'tides' ? p.tides[spot.station.id] : null
  const predictions = t ? t.minutes.map((m, i) => ({ time: t.t0 + m * 60000, value: t.values[i] / 100 })) : []
  const day0 = date ? new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()).getTime() : NaN
  const rangeM = date ? tideRangeM(predictions, day0 - 86400000, day0 + 7 * 86400000) : undefined
  return {
    fetched: 0,
    hourly: hourlyRows(p.wx[si].hourly),
    // The app's own mapping, so the SST snap and fresh-water rules apply as in production.
    marine: marineRows(p.ma[si], LOCS[si]),
    tides: t ? {
      stationName: spot.station!.name, distKm: spot.station!.distKm,
      predictions, ...(rangeM !== undefined && { rangeM }),
    } : null,
  }
}

/**
 * The fixture's coasts for onshore.check.ts (onshore spec §5.2). Index = spot.
 * - SHORES_AUTO: what the app would read — the catalogue (spotCoast.gen.ts)
 *   for the official three, and for `kal` the value DERIVED at its pin
 *   (coast-fixture.json, written by the precompute; critique R1.4). undefined
 *   = the app leaves it unknown (an 'enclosed' or 'gap' entry), scored as no coast.
 * - SHORES_HAND: R§7's hand values, manual mode.
 * - SHORES_NONE: no coast anywhere.
 */
export const COAST_FIXTURE: Record<string, Omit<CoastAuto, 'at'>> = JSON.parse(fs.readFileSync(here('coast-fixture.json'), 'utf8'))
export const SHORES_AUTO: (Shore | null | undefined)[] = FIXTURE.spots.map((s, si) => {
  if (LOCS[si].waterType === 'fresh') return null
  const e = s.slug ? SPOT_COAST[s.slug] : COAST_FIXTURE[s.id]
  return e ? resolveShore(LOCS[si], { ...e, at: 0 }) : undefined
})
const HAND: Record<string, Pick<Shore, 'facing' | 'spread' | 'exposure'>> = {
  dragor: { facing: 105, spread: 270, exposure: 'open' },
  ronne: { facing: 270, spread: 180, exposure: 'open' },
  tejn: { facing: 41, spread: 180, exposure: 'open' },
  kal: { facing: 245, spread: 180, exposure: 'semi' },
}
export const SHORES_HAND: (Shore | null)[] = FIXTURE.spots.map((s) => (HAND[s.id] ? { mode: 'manual', ...HAND[s.id], fetchKm: null } : null))
export const SHORES_NONE: (Shore | null)[] = FIXTURE.spots.map(() => null)

export const HM = ['havørred', 'makrel']
/** Target sets per spot: the owner's (global, so lakes get them too), havørred alone, none; the lake's own pair. */
export function targetSets(si: number): string[][] {
  return LOCS[si].waterType === 'fresh' ? [HM, ['gedde', 'aborre']] : [HM, ['havørred'], []]
}
export const tsName = (ts: string[]) => ts.join('+') || 'none'
/** The owner's three targets (onshore spec §5.2): the row divides by the present ones. */
export const OWNER3 = ['havørred', 'fjaesing', 'makrel']
/**
 * The onshore check's sets (record OUT=v3, onshore.check.ts): the coast spots
 * × [HM, OWNER3, havørred, none], the lake × [HM, gedde + aborre]. A separate
 * list, so before/after.json.gz keep the order they were written in.
 */
export function onshoreTargetSets(si: number): string[][] {
  return LOCS[si].waterType === 'fresh' ? [HM, ['gedde', 'aborre']] : [HM, OWNER3, ['havørred'], []]
}

/** 24 single hours (HH:00–HH:30 is exactly hour HH) and three multi-hour windows. */
export const WINDOWS: { name: string; type: string; from: string; to: string }[] = [
  ...Array.from({ length: 24 }, (_, h) => ({ name: `${String(h).padStart(2, '0')}h`, type: '1h', from: `${h}:00`, to: `${h}:30` })),
  { name: '06-09', type: '06-09', from: '06:00', to: '09:00' },
  { name: '17-21', type: '17-21', from: '17:00', to: '21:00' },
  { name: '08-18', type: '08-18', from: '08:00', to: '18:00' },
]
/** Days 2–15 of each period: day 1 only feeds the 3-hour look-backs. */
export const DAYS = Array.from({ length: 14 }, (_, i) => i + 1)

export interface Cell { si: number; pi: number; day: number; wi: number; targets: string[]; date: Date }

/** Every window, in the one order a file is written and read in: `sets` picks the target sets per spot. */
export function* cells(sets: (si: number) => string[][] = targetSets): Generator<Cell> {
  for (let si = 0; si < FIXTURE.spots.length; si++) {
    for (const targets of sets(si)) {
      for (let pi = 0; pi < FIXTURE.periods.length; pi++) {
        const start = new Date(FIXTURE.periods[pi].start + 'T00:00:00Z')
        for (const day of DAYS) {
          // UTC midnight of the local date parts: the app's window convention.
          const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + day))
          for (let wi = 0; wi < WINDOWS.length; wi++) yield { si, pi, day, wi, targets, date }
        }
      }
    }
  }
}

/** A window as [score, keyIndex, points, keyIndex, points, …]; [null] for no data. */
export type Rec = (number | null)[]
export interface RecordFile { model: string; keys: string[]; variants: Record<Variant, Rec[]> }

export function encoder(keys: string[]) {
  return (w: ScoredWindow): Rec => {
    if (w.noData) return [null]
    const out: Rec = [w.score]
    for (const b of w.breakdown ?? []) {
      const k = b.key ?? `?${b.factor}`
      let i = keys.indexOf(k)
      if (i < 0) { keys.push(k); i = keys.length - 1 }
      out.push(i, b.points)
    }
    return out
  }
}

export function rowsOf(file: RecordFile, rec: Rec): Record<string, number> {
  const rows: Record<string, number> = {}
  for (let i = 1; i < rec.length; i += 2) rows[file.keys[rec[i] as number]] = (rows[file.keys[rec[i] as number]] ?? 0) + (rec[i + 1] as number)
  return rows
}

// Gzipped: ~50 000 windows with their rows are a few MB of JSON each.
export const writeRecords = (name: string, f: RecordFile) => fs.writeFileSync(here(`${name}.json.gz`), zlib.gzipSync(JSON.stringify(f)))
export const readRecords = (name: string): RecordFile => JSON.parse(zlib.gunzipSync(fs.readFileSync(here(`${name}.json.gz`))).toString('utf8'))
export const hasRecords = (name: string) => fs.existsSync(here(`${name}.json.gz`))
