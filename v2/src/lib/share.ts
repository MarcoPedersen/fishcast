/** Encode/decode shareable links (window or full setup) as URL query params. */
import type { Availability, Location, ScoredWindow } from './types'

function enc(obj: unknown): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
}
function dec<T>(s: string): T | null {
  try { return JSON.parse(decodeURIComponent(escape(atob(s)))) as T } catch { return null }
}

function shareUrl(kind: 'win' | 'setup', payload: unknown): string {
  return `${location.origin}${location.pathname}#/?${kind}=${enc(payload)}`
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
  return q ? dec<SharedWindow>(q) : null
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
  const p = q ? dec<SharedSetup>(q) : null
  return p && Array.isArray(p.locs) && Array.isArray(p.sp) && Array.isArray(p.av) ? p : null
}
