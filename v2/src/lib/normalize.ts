/**
 * Repair a stored or pulled document before the stores hold it. A shared link
 * used to be able to plant rows the app can't render (an availability window
 * with no `days` throws in getScoredWindows and blanks the whole app), and the
 * bad row synced to every device. Share links are now validated strictly
 * (share.ts), but an account that was poisoned before that stays poisoned, so
 * every load and adopt goes through here too.
 *
 * Lenient on purpose — this is the user's own data. Rows the editor can create
 * mid-edit (no days ticked, a cleared time field) are kept as they are; only
 * wrong TYPES are repaired, and only rows that can't mean anything are dropped.
 */
import type { Availability, FishingMethod, Location, WaterType } from './types'

const newId = () => Math.random().toString(36).slice(2, 10)
const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v)
const METHODS: readonly FishingMethod[] = ['shore', 'boat', 'waders']
const WATER: readonly WaterType[] = ['salt', 'brackish', 'fresh', 'both']

/** A finite number, also from a numeric string (`'55.6'` broke the weather bbox maths). */
function coord(v: unknown, max: number): number | null {
  const n = typeof v === 'string' && v.trim() ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= max ? n : null
}

/** Locations without usable coordinates are dropped — one undefined lat broke the whole forecast batch. */
export function normalizeLocations(raw: unknown): Location[] {
  if (!Array.isArray(raw)) return []
  const out: Location[] = []
  for (const l of raw) {
    if (!isObj(l)) continue
    const lat = coord(l.lat, 90)
    const lon = coord(l.lon, 180)
    if (lat === null || lon === null) continue
    const fixed = {
      ...l,
      id: typeof l.id === 'string' && l.id ? l.id : newId(),
      name: typeof l.name === 'string' ? l.name : '',
      lat,
      lon,
    } as Location
    // An imported link could carry any JSON here; unknown values mean "not set".
    if (fixed.waterType !== undefined && !WATER.includes(fixed.waterType)) delete fixed.waterType
    if (fixed.species !== undefined && !Array.isArray(fixed.species)) delete fixed.species
    out.push(fixed)
  }
  return out
}

/** Windows keep their place; a missing/garbled field becomes the editor's "empty" value. */
export function normalizeAvailability(raw: unknown): Availability[] {
  if (!Array.isArray(raw)) return []
  const out: Availability[] = []
  for (const a of raw) {
    if (!isObj(a)) continue
    out.push({
      ...a,
      id: typeof a.id === 'string' && a.id ? a.id : newId(),
      days: Array.isArray(a.days) ? a.days.filter((d: unknown) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6) : [],
      from: typeof a.from === 'string' ? a.from : '',
      to: typeof a.to === 'string' ? a.to : '',
      methods: Array.isArray(a.methods) ? a.methods.filter((m: unknown) => METHODS.includes(m as FishingMethod)) : ['shore'],
    } as Availability)
  }
  return out
}

export function normalizeSpecies(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string') : []
}

/** Catch entries only ever come from the app's own form; just keep the list iterable. */
export function normalizeEntries<T>(raw: unknown): T[] {
  return Array.isArray(raw) ? (raw.filter(isObj) as T[]) : []
}
