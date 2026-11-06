/**
 * Which way a spot's coast faces (onshore spec §1–§2): the types, the one
 * rule that turns a location plus its automatic derivation into what the
 * scorer reads (resolveShore), and the spot card's state (coastLine).
 *
 * Main chunk: types and maths only — no network, no tile decoder, and no
 * import of scoring.ts (which imports this file).
 *
 * Two sources, never mixed in storage:
 * - a manual override, Location.coast, synced with the setup;
 * - an automatic value derived on this device from map data (stores/coast.ts,
 *   lib/coastFetch.ts), kept per device in fc2-coast. Writing it into the
 *   synced setup on load would be an edit, and push.
 */
import type { CoastExposure, CoastOverride, CoastSpread, Location } from './types'

/**
 * Bump when the geometry changes what it derives: entries of an older version
 * are re-derived (and used meanwhile); catalogue entries of an older version
 * are skipped (stores/coast.ts). 2: the shape is capped by the profile's land,
 * and the points 50 m around the pin read only water within 50 m of themselves.
 */
export const COAST_ALGO_VERSION = 2

/**
 * Geometry-only reasons to ask the user (coastGeometry.ts):
 * - far: the pin is more than 150 m from the water;
 * - gap: the water right at the pin faces > 45° away from the open water further out;
 * - enclosed: no direction has ≥ 0.5 km of open water from the pin — a closed
 *   basin, whose profile would say "no wind counts" while the line says
 *   "faces W" (critique R1, a slipway in a closed basin).
 */
export type CoastIssue = 'far' | 'gap' | 'enclosed'

/** One automatic derivation, per device (fc2-coast). Also the shape of the precomputed catalogue entries (without `at`). */
export interface CoastAuto {
  v: number                         // COAST_ALGO_VERSION it was computed with
  at: number                        // ms
  src: 'versatiles' | 'catalogue'
  water: 'sea' | 'inland' | 'none'  // inland = nearest water is lake/river/pond and no sea within macro reach
  facing: number | null             // macro facing "B", integer degrees; null unless water === 'sea'
  nearFacing: number | null         // micro facing "A", for the gap prompt
  spread: CoastSpread               // from the shape
  exposure: CoastExposure | null    // null unless water === 'sea'
  fetchKm: number[]                 // 16 bins, index 0 = N, 1 = NNE …; km, 1 decimal, cap 25; [] unless sea
  pinToWaterM: number | null
  issues: CoastIssue[]
  ok?: true                         // the user tapped "Ser rigtigt ud" on THIS device
  /** A catalogue entry set by hand (coast-overrides.json): scored by its angle, as a manual coast is. */
  fixed?: true
}
/**
 * A derivation that failed. `tries` counts the failures that escalate the
 * backoff: VersaTiles answered with an error, or a tile wouldn't decode.
 * `net`: the last one never reached an answer (no connection, a dropped or
 * timed-out request, the device offline) — it says nothing about the server,
 * so it doesn't escalate, and coming back online re-arms it (stores/coast.ts).
 */
export interface CoastFailure { v: number; failedAt: number; tries: number; net?: true }
export type CoastCacheEntry = CoastAuto | CoastFailure

/**
 * An error for a request that got no answer — the `net` kind of failure
 * above. A flag rather than a class, so the worker can send it across
 * (coast.worker.ts, coastClient.ts): structured cloning keeps no class.
 */
export const transientError = (message: string) => Object.assign(new Error(message), { transient: true as const })
export const isTransient = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { transient?: unknown }).transient === true

export const isCoastAuto = (e: unknown): e is CoastAuto =>
  typeof e === 'object' && e !== null && 'water' in e && Array.isArray((e as CoastAuto).fetchKm) && Array.isArray((e as CoastAuto).issues)

/** What the scorer reads. */
export interface Shore {
  mode: 'manual' | 'auto'
  facing: number
  spread: CoastSpread
  exposure: CoastExposure
  fetchKm: number[] | null          // auto only
}
/** By location id. A missing id = not known yet (pending, failed, offline); null = known to have no coast to score, or none until the user picks (stores/coast.ts shoreById). */
export type ShoreMap = Record<string, Shore | null>

/** The cache key of a pin: 5 decimals is about a metre, so the same pin keeps its entry. */
export const coordKey = (l: { lat: number; lon: number }) => `${l.lat.toFixed(5)},${l.lon.toFixed(5)}`

/** The angle between two bearings, the short way round: [0, 180]. */
export function angDist(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360)
  return d > 180 ? 360 - d : d
}

const SPREADS: readonly number[] = [180, 270, 360]
const EXPOSURES: readonly string[] = ['open', 'semi', 'sheltered']

/**
 * A usable override. Strict on the three values, tolerant of extra keys, so a
 * newer version that adds a field doesn't make this one treat the spot as
 * automatic. Shared by normalize.ts, share.ts and resolveShore.
 */
export function isCoastOverride(v: unknown): v is CoastOverride {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  return typeof o.facing === 'number' && Number.isFinite(o.facing) && o.facing >= 0 && o.facing < 360
    && SPREADS.includes(o.spread as number) && EXPOSURES.includes(o.exposure as string)
}

/**
 * The coast the scorer reads for this spot: a Shore, null when there is no
 * coast to score, undefined when it isn't known (yet).
 *
 * An automatic entry flagged 'enclosed' or 'gap' is undefined too, until the
 * user picks in the coast picker: from a pin in a closed basin every profile
 * bin is ≤ 0.4 km, so every wind scored 0 to +1 at Kalundborg while the line
 * said "faces W" (critique R1). Unknown, the spot gets the unknown-coast
 * fallback (windOrChop +2), not a profile that contradicts its own line.
 */
export function resolveShore(loc: Location, auto?: CoastAuto): Shore | null | undefined {
  if (loc.waterType === 'fresh') return null
  if (loc.coast === 'none') return null
  if (isCoastOverride(loc.coast)) {
    const { facing, spread, exposure } = loc.coast
    return { mode: 'manual', facing, spread, exposure, fetchKm: null }
  }
  if (!auto) return undefined
  if (auto.water !== 'sea' || auto.facing == null || !auto.exposure) return null
  if (auto.fixed) return { mode: 'manual', facing: auto.facing, spread: auto.spread, exposure: auto.exposure, fetchKm: null }
  if (auto.fetchKm.length !== 16) return null
  if (auto.issues.includes('enclosed') || auto.issues.includes('gap')) return undefined
  return { mode: 'auto', facing: auto.facing, spread: auto.spread, exposure: auto.exposure, fetchKm: auto.fetchKm }
}

/**
 * The manual coast written when the user picks a direction on a spot that is
 * still automatic: the gap prompt's "Mod {dir}" and the picker's first tap.
 * Both copied spread and exposure from the automatic entry, the one the gap
 * flag had just distrusted:
 * - spread 360 made the answer meaningless — at a beach pin "Mod NV" and
 *   "Mod N" both scored every wind +8 "pålandsvind". A direction picked where
 *   the map shows water all round is a pier head or point: 270.
 * - 'sheltered' at a gap or a closed basin is the basin at the pin, not the
 *   water the user fishes (a slipway in a closed basin: every bin ≤ 0.6 km from
 *   the pin, while the user fishes the fjord beyond it). It becomes 'semi',
 *   the middle; the picker's chips set it exactly. 'open' stays: it needs
 *   ≥ 10 km of fetch measured from the pin or 50 m around it.
 */
export function pickedCoast(deg: number, auto?: CoastAuto): CoastOverride {
  const facing = (Math.round((((deg % 360) + 360) % 360) / 22.5) % 16) * 22.5
  const spread: CoastSpread = !auto ? 180 : auto.spread === 360 ? 270 : auto.spread
  const doubt = !!auto && (auto.issues.includes('gap') || auto.issues.includes('enclosed'))
  const exposure: CoastExposure = !auto?.exposure ? 'open' : doubt && auto.exposure === 'sheltered' ? 'semi' : auto.exposure
  return { facing, spread, exposure }
}

export type CoastCheck = CoastIssue | 'inland' | 'nowater'
const CHECK_ORDER: readonly CoastCheck[] = ['gap', 'enclosed', 'far', 'inland', 'nowater']

/**
 * Why the spot card asks the user to check the automatic coast. "Ser rigtigt
 * ud" (`ok`, this device only) answers far, the one question about a
 * direction the line shows. Gap and enclosed ask which way you fish, and
 * inland whether the water is salt or fresh: answers that only a pick, or
 * the water type, give — so they stay. (An inland "Ser rigtigt ud" from an
 * earlier build hid the question and changed nothing.)
 */
export function coastIssues(loc: Location, auto?: CoastAuto): CoastCheck[] {
  if (!auto || loc.waterType === 'fresh') return []
  const found = new Set<CoastCheck>(auto.issues)
  if (auto.water === 'inland') found.add('inland')
  if (auto.water === 'none') found.add('nowater')
  return CHECK_ORDER.filter((k) => found.has(k) && !(auto.ok && k === 'far'))
}

export type CoastLine =
  | { kind: 'coast'; src: 'auto' | 'manual'; dir: number; spread: CoastSpread; exposure: CoastExposure }
  | { kind: 'off'; src: 'manual' }
  | { kind: 'pending' | 'failed' | 'unknown' | 'nowater' | 'inland' | 'enclosed' | 'gap' }

/**
 * The spot card's coast line (LocationsView), or null for fresh water. An
 * entry from an older algorithm keeps showing while it is re-derived.
 *
 * It shows an automatic coast only where resolveShore scores one. A 'gap'
 * entry read "Kysten vender mod V · … · auto" at a closed-basin slipway while
 * the score paid the unknown-coast fallback and the breakdown said so.
 */
export function coastLine(loc: Location, auto?: CoastAuto, status?: 'pending' | 'failed'): CoastLine | null {
  if (loc.waterType === 'fresh') return null
  if (loc.coast === 'none') return { kind: 'off', src: 'manual' }
  if (isCoastOverride(loc.coast)) return { kind: 'coast', src: 'manual', dir: loc.coast.facing, spread: loc.coast.spread, exposure: loc.coast.exposure }
  if (auto) {
    if (auto.water === 'none') return { kind: 'nowater' }
    if (auto.water === 'inland') return { kind: 'inland' }
    if (auto.issues.includes('enclosed')) return { kind: 'enclosed' }
    if (auto.issues.includes('gap')) return { kind: 'gap' }
    if (auto.facing != null && auto.exposure) return { kind: 'coast', src: 'auto', dir: auto.facing, spread: auto.spread, exposure: auto.exposure }
  }
  if (status) return { kind: status }
  return { kind: 'unknown' }
}

/**
 * Whether the line shows a value derived from OpenStreetMap data (an
 * automatic coast, or what the derivation found instead), so the page must
 * credit OSM and its licence (review C1). The user's own choice is not.
 */
export const lineFromMap = (c: CoastLine | null): boolean =>
  !!c && (c.kind === 'coast' ? c.src === 'auto' : c.kind === 'nowater' || c.kind === 'inland' || c.kind === 'enclosed' || c.kind === 'gap')

/**
 * The one question the spot card asks, if any, while the coast is automatic
 * (LocationsView). Each is answered by what it offers:
 * - gap: which way do you fish? — "Mod {a}" / "Mod {b}", a pick;
 * - far: the pin is back from the water, is the direction right? — "Ser
 *   rigtigt ud". Only beside a line that shows a direction: beside "Lukket
 *   havn eller bassin" or "sø eller å" it asked about one never shown, and
 *   the tap hid the prompt with the spot still unscored (review);
 * - inland: the map shows fresh water at a salt or brackish spot — "salt or
 *   brackish, choose the direction" opens the picker, "fresh" sets the
 *   water type. The user's tap is the only setup write.
 * 'enclosed' and 'nowater' are said by the line itself.
 */
export function coastCheck(loc: Location, auto?: CoastAuto): { kind: 'gap' | 'far' | 'inland'; auto: CoastAuto } | null {
  if (!auto || loc.coast === 'none' || isCoastOverride(loc.coast)) return null
  const shown = coastLine(loc, auto)?.kind === 'coast'
  const kind = coastIssues(loc, auto).find((k): k is 'gap' | 'far' | 'inland' => k === 'gap' || k === 'inland' || (k === 'far' && shown))
  return kind ? { kind, auto } : null
}

// ── Keys the views look up in these maps at runtime: t(SPREAD_KEY[c.spread]) ──
// Written out whole, so the strings test's "every key is used" finds each.
// That each exists in both languages is a separate check there (KEY_MAPS):
// such a lookup names no literal, so "every key the app names exists" can't.
export const SHORE_REL_KEY = { on: 'shore_on', side: 'shore_side', off: 'shore_off' } as const
/** The line's words for the water off the spot — the same words as the picker's chips (critique suggestion 12). */
export const EXPOSURE_KEY = { open: 'coast_exp_open', semi: 'coast_exp_semi', sheltered: 'coast_exp_sheltered' } as const
export const EXPOSURE_OPT_KEY = { open: 'coast_exp_open_opt', semi: 'coast_exp_semi_opt', sheltered: 'coast_exp_sheltered_opt' } as const
/** The line's sentence by shape: "Kysten vender mod {dir}", "Mole eller pynt · mest åbent mod {dir}", … */
export const SPREAD_KEY = { 180: 'coast_faces', 270: 'coast_mole', 360: 'coast_round' } as const
export const SPREAD_OPT_KEY = { 180: 'coast_spread_180', 270: 'coast_spread_270', 360: 'coast_spread_360' } as const
/** Long direction names for screen readers, N first, clockwise in 22.5° steps. */
export const DIR_NAME_KEY = [
  'dir_n', 'dir_nne', 'dir_ne', 'dir_ene', 'dir_e', 'dir_ese', 'dir_se', 'dir_sse',
  'dir_s', 'dir_ssw', 'dir_sw', 'dir_wsw', 'dir_w', 'dir_wnw', 'dir_nw', 'dir_nnw',
] as const
/** The 16-point index of a bearing (0 = N). */
export const dirIndex = (deg: number) => Math.round((((deg % 360) + 360) % 360) / 22.5) % 16
