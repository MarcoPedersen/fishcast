/** Encode/decode shareable links (window or full setup) as URL query params. */
import { SPECIES_PREFS } from './species'
import { isCoastOverride } from './coast'
import type { Availability, CoastOverride, FishingMethod, Location, ScoredWindow, WaterType } from './types'

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
const MAX_SPECIES = 30
const DEPTHS: readonly NonNullable<Location['depth']>[] = ['shallow', 'medium', 'deep']
// Catalogue slugs are lowercase words joined by '-', some with Danish letters ('furesø').
const SLUG = /^[\p{Ll}\p{N}]+(?:-[\p{Ll}\p{N}]+)*$/u
/**
 * The payload version that carries a spot's depth, slug and species. A link
 * without it (every v2 link before, and v1's `v: 1`) is a legacy link: what
 * it lacks is unknown, not absent (shareImport.ts fills it in).
 */
const VERSION = 2

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const coord = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max
const time = (v: unknown): v is string => typeof v === 'string' && HHMM.test(v)
const water = (v: unknown): WaterType | undefined => (WATER as readonly unknown[]).includes(v) ? (v as WaterType) : undefined
const bottom = (v: unknown): string | undefined => typeof v === 'string' ? v.slice(0, 40) : undefined
// A name that's missing or not a string marks a malformed payload. An empty
// one doesn't: the rename field lets a spot's name be cleared, and rejecting
// it dropped that spot from setup links and blanked window links. It gets the
// coordinate name MapView gives an unnamed spot instead.
/**
 * The coast override, rebuilt from its three values: strict, so a link can't
 * plant a value the scorer misreads, and without a newer version's extra keys.
 * Anything else (absent, 'auto', a facing of 400) is dropped and the spot is
 * kept: it then derives its coast automatically.
 */
function coast(v: unknown): CoastOverride | 'none' | undefined {
  if (v === 'none') return 'none'
  return isCoastOverride(v) ? { facing: v.facing, spread: v.spread, exposure: v.exposure } : undefined
}
function name(v: unknown, la: number, lo: number): string | null {
  if (typeof v !== 'string') return null
  return v.trim().slice(0, MAX_NAME) || `${la.toFixed(4)}, ${lo.toFixed(4)}`
}

// ── Depth, slug and species ──────────────────────────────────
// Without them a recipient scored the sharer's deep spot lower: makrel's and
// torsk's 'deep' bonus reads the depth, and the spot-relevance bonus the
// species. Species go as [nameEn, months as a 12-bit mask] — a setup of 18
// spots stays a link a chat app passes on whole.
type SpotSpecies = NonNullable<Location['species']>
const depth = (v: unknown): Location['depth'] => (DEPTHS as readonly unknown[]).includes(v) ? (v as Location['depth']) : undefined
const slug = (v: unknown): string | undefined => typeof v === 'string' && v.length <= 60 && SLUG.test(v) ? v : undefined
// An empty list is one the sharer cleared, and travels as one: sent as none,
// it arrived as never filled, and the recipient's lookup filled it
// (stores/setup.ts enrichMissingSpecies). No list at all travels as none.
function encSpecies(sp: Location['species']): [string, number][] | undefined {
  if (!sp) return undefined
  return sp.map((x) => [x.nameEn, x.months.reduce((m, n) => Number.isInteger(n) && n >= 1 && n <= 12 ? m | (1 << (n - 1)) : m, 0)])
}
function species(v: unknown): SpotSpecies | undefined {
  if (!Array.isArray(v)) return undefined
  if (!v.length) return []
  const out: SpotSpecies = []
  for (const x of v) {
    if (out.length === MAX_SPECIES) break
    if (!Array.isArray(x) || typeof x[0] !== 'string' || !x[0].trim() || !Number.isInteger(x[1]) || x[1] < 0 || x[1] > 0xfff) continue
    out.push({ nameEn: x[0].trim().slice(0, 40), months: Array.from({ length: 12 }, (_, i) => i + 1).filter((n) => x[1] & (1 << (n - 1))) })
  }
  return out.length ? out : undefined
}
/** What a link says about a spot beyond its place: the sharer's own values, nothing else. */
export interface SharedSpotFacts { dp?: Location['depth']; sl?: string; ss?: SpotSpecies }
/** A spot as a link carries it (setup links and window links alike). */
export interface SharedLoc extends SharedSpotFacts {
  n: string; la: number; lo: number; wt?: string; bt?: string; co?: CoastOverride | 'none'
}
const facts = (l: Location): { dp?: Location['depth']; sl?: string; ss?: [string, number][] } =>
  ({ dp: l.depth, sl: l.spotSlug, ss: encSpecies(l.species) })
const readFacts = (p: Record<string, unknown>): SharedSpotFacts => ({ dp: depth(p.dp), sl: slug(p.sl), ss: species(p.ss) })
const isLegacy = (p: Record<string, unknown>) => !(typeof p.v === 'number' && p.v >= VERSION)

// ── Single window ────────────────────────────────────────────
export interface SharedWindow extends SharedLoc {
  d: string; f: string; t: string; s: number
  /** Made before links carried depth, slug and species. */
  legacy: boolean
}
export function shareWindowUrl(w: ScoredWindow): string {
  const p = {
    v: VERSION,
    n: w.location.name, la: w.location.lat, lo: w.location.lon, wt: w.location.waterType, bt: w.location.bottomType, co: coast(w.location.coast), ...facts(w.location),
    d: w.date.toISOString().slice(0, 10), f: w.from, t: w.to, s: w.score,
  }
  return shareUrl('win', p)
}
export function parseSharedWindow(q: string | undefined): SharedWindow | null {
  const p = q ? dec(q) : null
  if (!isObj(p)) return null
  // v1's window links said lat/lon (see v1ShareQuery).
  const la = 'la' in p ? p.la : p.lat
  const lo = 'lo' in p ? p.lo : p.lon
  if (!coord(la, 90) || !coord(lo, 180)) return null
  const n = name(p.n, la, lo)
  if (n === null) return null
  if (typeof p.d !== 'string' || !DATE.test(p.d) || !time(p.f) || !time(p.t)) return null
  const s = typeof p.s === 'number' && Number.isFinite(p.s) ? Math.max(0, Math.min(100, Math.round(p.s))) : 0
  return { n, la, lo, wt: water(p.wt), bt: bottom(p.bt), co: coast(p.co), ...readFacts(p), d: p.d, f: p.f, t: p.t, s, legacy: isLegacy(p) }
}

// ── Full setup ───────────────────────────────────────────────
export interface SharedSetup {
  locs: SharedLoc[]
  sp: string[]
  av: { d: number[]; f: string; t: string; m?: string[] }[]
  /** Made before links carried depth, slug and species. */
  legacy: boolean
}
export function shareSetupUrl(locations: Location[], targetSpecies: string[], availability: Availability[]): string {
  const p = {
    v: VERSION,
    locs: locations.map((l) => ({ n: l.name, la: l.lat, lo: l.lon, wt: l.waterType, bt: l.bottomType, co: coast(l.coast), ...facts(l) })),
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
    if (!isObj(l) || !coord(l.la, 90) || !coord(l.lo, 180)) continue
    const n = name(l.n, l.la, l.lo)
    if (n === null) continue
    locs.push({ n, la: l.la, lo: l.lo, wt: water(l.wt), bt: bottom(l.bt), co: coast(l.co), ...readFacts(l) })
  }

  // Own keys only: `'toString' in SPECIES_PREFS` is true too. Not Object.hasOwn:
  // it's missing before Safari/iOS 15.4 (inside the build target, and an API
  // esbuild doesn't polyfill), where it threw inside WelcomeView's render.
  const own = (id: string) => Object.prototype.hasOwnProperty.call(SPECIES_PREFS, id)
  const sp = [...new Set(p.sp.filter((id): id is string => typeof id === 'string' && own(id)))]

  const av: SharedSetup['av'] = []
  for (const a of p.av.slice(0, MAX_WINDOWS)) {
    if (!isObj(a) || !Array.isArray(a.d) || !time(a.f) || !time(a.t)) continue
    const d = [...new Set(a.d.filter((x): x is number => Number.isInteger(x) && x >= 0 && x <= 6))].sort((x, y) => x - y)
    if (!d.length) continue
    const m = Array.isArray(a.m) ? a.m.filter((x): x is FishingMethod => (METHODS as readonly unknown[]).includes(x)) : []
    av.push({ d, f: a.f, t: a.t, m: m.length ? m : undefined })
  }

  return locs.length || sp.length || av.length ? { locs, sp, av, legacy: isLegacy(p) } : null
}

// ── v1 links ─────────────────────────────────────────────────
/**
 * v1 (live June to August 2026) shared `…/fishcast/#setup=…` and
 * `…/fishcast/#share=…`: the payload straight in the hash, in standard
 * base64. The root page forwards that hash to v2, whose hash router reads it
 * as the path '/setup=…', which only the catch-all matches — and it used to
 * send it on to the plain welcome page. This is the welcome page's query for
 * such a path, null for any other: v1's setup payload parses as it is, and
 * its window payload's lat/lon are read too (parseSharedWindow).
 */
export function v1ShareQuery(path: string): { setup: string } | { win: string } | null {
  const m = /^\/(setup|share)=(.+)$/.exec(path)
  if (!m) return null
  return m[1] === 'setup' ? { setup: m[2] } : { win: m[2] }
}
