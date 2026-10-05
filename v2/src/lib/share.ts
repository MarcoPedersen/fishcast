/** Encode/decode shareable links (window or full setup) as URL query params. */
import { SPECIES_PREFS } from './species'
import type { Availability, FishingMethod, Location, ScoredWindow, WaterType } from './types'

// base64url, not standard base64: the hash router's query parser turns '+'
// into a space before decoding, and standard base64 emits '+' whenever an
// emoji, '>' or '~' falls on the wrong byte offset — so a spot named
// 'Molen 🎣' gave a link that opened to the plain welcome page, no banner.
function enc(obj: unknown): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function dec(s: string): unknown {
  try {
    // Links shared before the switch still work: their '+' arrives as ' '.
    let b = s.replace(/[ \-]/g, '+').replace(/_/g, '/')
    b += '='.repeat((4 - (b.length % 4)) % 4)
    return JSON.parse(decodeURIComponent(escape(atob(b))))
  } catch { return null }
}

function shareUrl(kind: 'win' | 'setup', payload: unknown): string {
  return `${location.origin}${location.pathname}#/?${kind}=${enc(payload)}`
}

// ── Validation ───────────────────────────────────────────────
// A link is input from anyone, and an import writes it straight into the
// synced setup. One window without `d` made getScoredWindows throw, which
// blanked the dashboard — and the editor, so it couldn't be deleted — on
// every synced device; a location without la/lo broke every forecast batch.
// Each element is checked; bad ones are dropped, not repaired.
const WATER: readonly WaterType[] = ['salt', 'brackish', 'fresh', 'both']
const METHODS: readonly FishingMethod[] = ['shore', 'boat', 'waders']
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const MAX_LOCS = 50
const MAX_WINDOWS = 20
const MAX_NAME = 80

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const coord = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max
const time = (v: unknown): v is string => typeof v === 'string' && HHMM.test(v)
const water = (v: unknown): WaterType | undefined => (WATER as readonly unknown[]).includes(v) ? (v as WaterType) : undefined
function name(v: unknown): string | null {
  const n = typeof v === 'string' ? v.trim().slice(0, MAX_NAME) : ''
  return n || null
}

// ── Single window ────────────────────────────────────────────
export interface SharedWindow {
  n: string; la: number; lo: number; wt?: string
  d: string; f: string; t: string; s: number
}
export function shareWindowUrl(w: ScoredWindow): string {
  const p: SharedWindow = {
    n: w.location.name, la: w.location.lat, lo: w.location.lon, wt: w.location.waterType,
    d: w.date.toISOString().slice(0, 10), f: w.from, t: w.to, s: w.score,
  }
  return shareUrl('win', p)
}
export function parseSharedWindow(q: string | undefined): SharedWindow | null {
  const p = q ? dec(q) : null
  if (!isObj(p)) return null
  const n = name(p.n)
  if (n === null || !coord(p.la, 90) || !coord(p.lo, 180)) return null
  if (typeof p.d !== 'string' || !DATE.test(p.d) || !time(p.f) || !time(p.t)) return null
  const s = typeof p.s === 'number' && Number.isFinite(p.s) ? Math.max(0, Math.min(100, Math.round(p.s))) : 0
  return { n, la: p.la, lo: p.lo, wt: water(p.wt), d: p.d, f: p.f, t: p.t, s }
}

// ── Full setup ───────────────────────────────────────────────
export interface SharedSetup {
  locs: { n: string; la: number; lo: number; wt?: string; bt?: string }[]
  sp: string[]
  av: { d: number[]; f: string; t: string; m?: string[] }[]
}
export function shareSetupUrl(locations: Location[], targetSpecies: string[], availability: Availability[]): string {
  const p: SharedSetup = {
    locs: locations.map((l) => ({ n: l.name, la: l.lat, lo: l.lon, wt: l.waterType, bt: l.bottomType })),
    sp: targetSpecies,
    av: availability.map((a) => ({ d: a.days, f: a.from, t: a.to, m: a.methods })),
  }
  return shareUrl('setup', p)
}
export function parseSharedSetup(q: string | undefined): SharedSetup | null {
  const p = q ? dec(q) : null
  if (!isObj(p) || !Array.isArray(p.locs) || !Array.isArray(p.sp) || !Array.isArray(p.av)) return null

  const locs: SharedSetup['locs'] = []
  for (const l of p.locs.slice(0, MAX_LOCS)) {
    if (!isObj(l)) continue
    const n = name(l.n)
    if (n === null || !coord(l.la, 90) || !coord(l.lo, 180)) continue
    locs.push({ n, la: l.la, lo: l.lo, wt: water(l.wt), bt: typeof l.bt === 'string' ? l.bt.slice(0, 40) : undefined })
  }

  // Own keys only: `'toString' in SPECIES_PREFS` is true too.
  const sp = [...new Set(p.sp.filter((id): id is string => typeof id === 'string' && Object.hasOwn(SPECIES_PREFS, id)))]

  const av: SharedSetup['av'] = []
  for (const a of p.av.slice(0, MAX_WINDOWS)) {
    if (!isObj(a) || !Array.isArray(a.d) || !time(a.f) || !time(a.t)) continue
    const d = [...new Set(a.d.filter((x): x is number => Number.isInteger(x) && x >= 0 && x <= 6))].sort((x, y) => x - y)
    if (!d.length) continue
    const m = Array.isArray(a.m) ? a.m.filter((x): x is FishingMethod => (METHODS as readonly unknown[]).includes(x)) : []
    av.push({ d, f: a.f, t: a.t, m: m.length ? m : undefined })
  }

  return locs.length || sp.length || av.length ? { locs, sp, av } : null
}
