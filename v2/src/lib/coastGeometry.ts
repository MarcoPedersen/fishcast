/**
 * Which way a spot's coast faces, from OpenStreetMap water polygons in vector
 * tiles (onshore spec §1.5, with the critique's R1/R2). Pure: no fetch, no DOM,
 * so it runs in the worker, on the main thread as a fallback, and in Node
 * (the tests and the precompute script).
 *
 * The method, in short: rasterise sea, inland water and piers around the pin
 * on a fine local grid (4 m, ±1.1 km, z13 tiles) and a coarse one (50 m,
 * ±25 km, z8 tiles), cast 72 rays, and read
 * - facing B: where the open water is (macro reach, weighted by fetch);
 * - facing A: where the water right at the pin is (micro reach);
 * - a 16-direction profile of open water upwind (fetch), which the scorer reads.
 *
 * Bearings throughout: degrees clockwise from north.
 */
import { COAST_ALGO_VERSION, angDist, type CoastAuto, type CoastIssue } from './coast'
import type { CoastExposure, CoastSpread } from './types'

// ── Minimal Mapbox Vector Tile decoder ──────────────────────
// Only what the derivation reads: layer names, extent, feature type, tags and
// geometry. Ported from the research script (onshore/scripts/mvt.mjs), which
// decoded both VersaTiles and OpenFreeMap tiles.

export interface MvtFeature { type: number; props: Record<string, unknown>; parts: [number, number][][] }
export interface MvtLayer { extent: number; features: MvtFeature[] }

function reader(buf: Uint8Array) {
  let p = 0
  const varint = () => {
    let r = 0, s = 0, b: number
    do { b = buf[p++]; r += (b & 0x7f) * 2 ** s; s += 7 } while (b & 0x80 && p < buf.length)
    return r
  }
  return {
    get pos() { return p },
    set pos(v: number) { p = v },
    varint,
    key: (): [number, number] => { const k = varint(); return [Math.floor(k / 8), k & 7] },
    bytes: () => { const n = varint(); const s = p; p += n; return buf.subarray(s, p) },
    skip(w: number) {
      if (w === 0) varint()
      else if (w === 1) p += 8
      else if (w === 2) { const n = varint(); p += n }
      else if (w === 5) p += 4
      else throw new Error('mvt: wire type ' + w)
    },
    end: () => p >= buf.length,
  }
}
const td = new TextDecoder()
function packed(b: Uint8Array): number[] { const r = reader(b), out: number[] = []; while (!r.end()) out.push(r.varint()); return out }
const zz = (v: number) => (v % 2 ? -(v + 1) / 2 : v / 2)
function value(b: Uint8Array): unknown {
  const r = reader(b)
  while (!r.end()) {
    const [f, w] = r.key()
    if (f === 1) return td.decode(r.bytes())
    if (f === 2) { const v = new DataView(b.buffer, b.byteOffset + r.pos, 4).getFloat32(0, true); r.pos += 4; return v }
    if (f === 3) { const v = new DataView(b.buffer, b.byteOffset + r.pos, 8).getFloat64(0, true); r.pos += 8; return v }
    if (f === 4 || f === 5) return r.varint()
    if (f === 6) return zz(r.varint())
    if (f === 7) return !!r.varint()
    r.skip(w)
  }
  return null
}
/** MoveTo / LineTo / ClosePath → rings or lines in tile coordinates. */
function geometry(cmds: number[]): [number, number][][] {
  const parts: [number, number][][] = []
  let x = 0, y = 0, cur: [number, number][] | null = null, i = 0
  while (i < cmds.length) {
    const c = cmds[i++], id = c & 7, n = c >> 3
    if (id === 7) { if (cur && cur.length) cur.push([cur[0][0], cur[0][1]]); continue }
    for (let k = 0; k < n && i + 1 < cmds.length + 1; k++) {
      x += zz(cmds[i++]); y += zz(cmds[i++])
      if (id === 1) { cur = [[x, y]]; parts.push(cur) } else cur?.push([x, y])
    }
  }
  return parts
}
export function decodeMvt(buf: Uint8Array, wantLayers?: readonly string[]): Record<string, MvtLayer> {
  const r = reader(buf), layers: Record<string, MvtLayer> = {}
  while (!r.end()) {
    const [f, w] = r.key()
    if (f !== 3) { r.skip(w); continue }
    const lr = reader(r.bytes())
    let name = '', extent = 4096
    const keys: string[] = [], vals: unknown[] = [], feats: Uint8Array[] = []
    while (!lr.end()) {
      const [lf, lw] = lr.key()
      if (lf === 1) name = td.decode(lr.bytes())
      else if (lf === 2) feats.push(lr.bytes())
      else if (lf === 3) keys.push(td.decode(lr.bytes()))
      else if (lf === 4) vals.push(value(lr.bytes()))
      else if (lf === 5) extent = lr.varint()
      else lr.skip(lw)
    }
    if (wantLayers && !wantLayers.includes(name)) continue
    layers[name] = {
      extent,
      features: feats.map((fb) => {
        const fr = reader(fb)
        let tags: number[] = [], type = 0, geom: number[] = []
        while (!fr.end()) {
          const [ff, fw] = fr.key()
          if (ff === 2) tags = packed(fr.bytes())
          else if (ff === 3) type = fr.varint()
          else if (ff === 4) geom = packed(fr.bytes())
          else fr.skip(fw)
        }
        const props: Record<string, unknown> = {}
        for (let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = vals[tags[i + 1]]
        return { type, props, parts: geometry(geom) }
      }),
    }
  }
  return layers
}

/** A gzip body (1f 8b). tiles.versatiles.org answers brotli at the HTTP layer, which the browser undoes; a tile stored gzipped arrives as a raw gzip body. */
export const isGzip = (b: Uint8Array) => b.length > 1 && b[0] === 0x1f && b[1] === 0x8b

/**
 * Unwrap a gzip body; anything else is returned as it is. DecompressionStream
 * is only touched for a gzip body: it needs iOS 16.4+ (critique suggestion
 * 10), and a plain tile must not fail on a phone that lacks it.
 */
export async function gunzipIfNeeded(b: Uint8Array): Promise<Uint8Array> {
  if (!isGzip(b)) return b
  if (typeof DecompressionStream === 'undefined') throw new Error('gzip tile, and no DecompressionStream here')
  const stream = new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// ── Tile maths (Web Mercator, XYZ) ──────────────────────────
const lon2x = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z
const lat2y = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
}
/** The north-west corner of tile (z, x, y) — or any fractional tile position — as [lon, lat]. */
export function tileToLonLat(z: number, x: number, y: number): [number, number] {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z
  return [(x / 2 ** z) * 360 - 180, (180 / Math.PI) * Math.atan(Math.sinh(n))]
}
/** The tiles at zoom z covering a square of ±m metres around the point. */
export function tileRange(lat: number, lon: number, m: number, z: number): [number, number, number][] {
  const dLat = m / M_PER_DEG_LAT, dLon = m / (M_PER_DEG_LON * Math.cos((lat * Math.PI) / 180))
  const x0 = Math.floor(lon2x(lon - dLon, z)), x1 = Math.floor(lon2x(lon + dLon, z))
  const y0 = Math.floor(lat2y(lat + dLat, z)), y1 = Math.floor(lat2y(lat - dLat, z))
  const out: [number, number, number][] = []
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y])
  return out
}

// ── Features ────────────────────────────────────────────────
/**
 * One feature as the rasteriser needs it: rings (or lines) as flat
 * [lon, lat, lon, lat, …] arrays.
 * - sea: open sea, and docks (harbour basins open to it);
 * - inland: lakes, rivers, ponds (kept apart for the water kind);
 * - land: piers and dams — land drawn over the water;
 * - landLine: pier and dam lines, buffered to 3 m of land.
 */
export type FeatureKind = 'sea' | 'inland' | 'land' | 'landLine'
export interface CoastFeature { kind: FeatureKind; rings: Float64Array[] }

/**
 * The kind of a VersaTiles (Shortbread schema) feature, or null to skip it.
 * Breakwaters are `pier_polygons` / `pier_lines` there, so a mole pin sits on
 * land with a short harbour fetch on one side. Dams are land too (critique
 * suggestion 5): a dam across a fjord arm is not water.
 */
export function featureKind(layer: string, props: Record<string, unknown>): FeatureKind | null {
  if (layer === 'ocean') return 'sea'
  if (layer === 'water_polygons') {
    if (props.kind === 'dock') return 'sea'
    if (props.kind === 'swimming_pool') return null
    return 'inland'
  }
  if (layer === 'pier_polygons' || layer === 'dam_polygons') return 'land'
  if (layer === 'pier_lines' || layer === 'dam_lines') return 'landLine'
  return null
}
export const COAST_LAYERS = ['ocean', 'water_polygons', 'pier_polygons', 'dam_polygons', 'pier_lines', 'dam_lines'] as const

/** A decoded tile's features in lon/lat. Independent of the pin, so a tile shared by several spots is converted once. */
export function tileFeatures(z: number, x: number, y: number, layers: Record<string, MvtLayer>): CoastFeature[] {
  const out: CoastFeature[] = []
  for (const [name, layer] of Object.entries(layers)) {
    const ext = layer.extent || 4096
    for (const f of layer.features) {
      const kind = featureKind(name, f.props)
      if (!kind) continue
      // Polygons only for the area kinds, lines only for the line kinds (MVT type 3 / 2).
      if (kind === 'landLine' ? f.type !== 2 : f.type !== 3) continue
      const rings = f.parts.filter((p) => p.length > 1).map((p) => {
        const r = new Float64Array(p.length * 2)
        for (let i = 0; i < p.length; i++) {
          const [lon, lat] = tileToLonLat(z, x + p[i][0] / ext, y + p[i][1] / ext)
          r[2 * i] = lon; r[2 * i + 1] = lat
        }
        return r
      })
      if (rings.length) out.push({ kind, rings })
    }
  }
  return out
}

// ── Rasterising ─────────────────────────────────────────────
const M_PER_DEG_LAT = 110540
const M_PER_DEG_LON = 111320
const LAND = 0, SEA = 1, INLAND = 2, OUTSIDE = 255

/** The constants of §1.5. LOCAL_R is 1 100 m, not 1 000: the eight extra origins 50 m out (R2) still cast 1 000 m rays inside it. */
export const GEO = {
  localR: 1100, localCell: 4, localStep: 2, localReach: 1000,
  coarseR: 25000, coarseCell: 50, coarseStep: 25, handoverSkip: 400,
  capM: 25000, rays: 72, lineBufM: 3, jitterM: 50,
} as const

interface Grid { N: number; g: Uint8Array; at(mx: number, my: number): number }

function makeGrid(lat0: number, lon0: number, R: number, cell: number) {
  const N = Math.round((2 * R) / cell)
  const g = new Uint8Array(N * N)
  const kx = Math.cos((lat0 * Math.PI) / 180) * M_PER_DEG_LON, ky = M_PER_DEG_LAT
  // Equirectangular around the pin: grid column/row from lon/lat.
  const gx = (lon: number) => ((lon - lon0) * kx + R) / cell
  const gy = (lat: number) => (R - (lat - lat0) * ky) / cell

  /**
   * Even-odd scanline fill of one feature's rings with an active-edge table:
   * a naive rows × edges fill was too slow on z8 coastlines (thousands of
   * vertices × 1 000 rows).
   */
  function fill(rings: Float64Array[], val: number) {
    const ex0: number[] = [], ey0: number[] = [], ex1: number[] = [], ey1: number[] = []
    let ymin = Infinity, ymax = -Infinity
    for (const r of rings) {
      for (let i = 2; i < r.length; i += 2) {
        const ax = gx(r[i - 2]), ay = gy(r[i - 1]), bx = gx(r[i]), by = gy(r[i + 1])
        if (ay === by) continue
        const up = ay < by
        ex0.push(up ? ax : bx); ey0.push(up ? ay : by); ex1.push(up ? bx : ax); ey1.push(up ? by : ay)
        if (Math.min(ay, by) < ymin) ymin = Math.min(ay, by)
        if (Math.max(ay, by) > ymax) ymax = Math.max(ay, by)
      }
    }
    if (!ex0.length) return
    const r0 = Math.max(0, Math.floor(ymin)), r1 = Math.min(N - 1, Math.ceil(ymax))
    if (r0 > r1) return
    // Bucket each edge by the first row whose centre it reaches.
    const buckets = new Map<number, number[]>()
    for (let i = 0; i < ex0.length; i++) {
      const rs = Math.max(r0, Math.ceil(ey0[i] - 0.5))
      let b = buckets.get(rs)
      if (!b) buckets.set(rs, (b = []))
      b.push(i)
    }
    let active: number[] = []
    const xs: number[] = []
    for (let row = r0; row <= r1; row++) {
      const yc = row + 0.5
      const add = buckets.get(row)
      if (add) for (const i of add) active.push(i)
      active = active.filter((i) => ey1[i] > yc)
      xs.length = 0
      for (const i of active) if (yc >= ey0[i]) xs.push(ex0[i] + ((yc - ey0[i]) * (ex1[i] - ex0[i])) / (ey1[i] - ey0[i]))
      xs.sort((a, b) => a - b)
      const base = row * N
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil(xs[k] - 0.5)), c1 = Math.min(N - 1, Math.floor(xs[k + 1] - 0.5))
        for (let c = c0; c <= c1; c++) g[base + c] = val
      }
    }
  }

  /** A line buffered to `bufM` metres of `val` (a pier drawn as a line has no width). */
  function line(r: Float64Array, bufM: number, val: number) {
    const rc = Math.ceil(bufM / cell), lim = bufM + cell / 2
    for (let i = 2; i < r.length; i += 2) {
      const ax = gx(r[i - 2]), ay = gy(r[i - 1]), bx = gx(r[i]), by = gy(r[i + 1])
      // Skip segments wholly outside the grid.
      if (Math.max(ax, bx) < -rc || Math.min(ax, bx) > N + rc || Math.max(ay, by) < -rc || Math.min(ay, by) > N + rc) continue
      const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 2) + 1
      for (let k = 0; k <= n; k++) {
        const cx = ax + ((bx - ax) * k) / n, cy = ay + ((by - ay) * k) / n
        for (let dx = -rc; dx <= rc; dx++) for (let dy = -rc; dy <= rc; dy++) {
          if (Math.hypot(dx, dy) * cell > lim) continue
          const c = Math.floor(cx + dx), rr = Math.floor(cy + dy)
          if (c >= 0 && rr >= 0 && c < N && rr < N) g[rr * N + c] = val
        }
      }
    }
  }

  const grid: Grid = {
    N, g,
    at(mx, my) {
      const c = Math.floor((mx + R) / cell), r = Math.floor((R - my) / cell)
      return c < 0 || r < 0 || c >= N || r >= N ? OUTSIDE : g[r * N + c]
    },
  }
  return { grid, fill, line }
}

function rasterise(lat: number, lon: number, R: number, cell: number, feats: CoastFeature[], withLand: boolean): Grid {
  const { grid, fill, line } = makeGrid(lat, lon, R, cell)
  // Sea first, inland water over it (a harbour mapped as natural=water keeps
  // its own kind), then land over both: a breakwater wins over the water it stands in.
  for (const f of feats) if (f.kind === 'sea') fill(f.rings, SEA)
  for (const f of feats) if (f.kind === 'inland') fill(f.rings, INLAND)
  if (withLand) {
    for (const f of feats) if (f.kind === 'land') fill(f.rings, LAND)
    for (const f of feats) if (f.kind === 'landLine') for (const r of f.rings) line(r, GEO.lineBufM, LAND)
  }
  return grid
}

// ── Rays ────────────────────────────────────────────────────
const isWater = (v: number) => v === SEA || v === INLAND

interface Ray { th: number; ux: number; uy: number; d0: number | null; kind: number; local: number; total: number }

/** 72 rays from (ox, oy) metres off the pin: first water, local fetch, and the total fetch across the hand-over. */
function castRays(L: Grid, C: Grid, ox: number, oy: number): Ray[] {
  const G = GEO
  const rays: Ray[] = []
  for (let i = 0; i < G.rays; i++) {
    const th = (i * 360) / G.rays
    const ux = Math.sin((th * Math.PI) / 180), uy = Math.cos((th * Math.PI) / 180)
    const lat = (d: number) => L.at(ox + ux * d, oy + uy * d)
    const coarse = (d: number) => C.at(ox + ux * d, oy + uy * d)
    let d0: number | null = null, kind = LAND
    for (let d = 0; d <= G.localReach; d += G.localStep) {
      const v = lat(d)
      if (isWater(v)) { d0 = d; kind = v; break }
    }
    let local = 0, total = 0
    if (d0 != null) {
      let d = d0
      while (d <= G.localReach && isWater(lat(d))) d += G.localStep
      local = Math.min(d, G.localReach) - d0
      let end: number
      if (d > G.localReach) {
        // Still water at the edge of the fine grid: continue on the coarse one.
        // Its coastline is generalised, so up to 400 m of "land" right after
        // the hand-over is skipped before the ray counts as ended there.
        let dd = G.localReach, skipped = 0
        while (dd < G.capM && !isWater(coarse(dd)) && skipped < G.handoverSkip) { dd += G.coarseStep; skipped += G.coarseStep }
        if (isWater(coarse(dd))) {
          while (dd < G.capM && isWater(coarse(dd))) dd += G.coarseStep
          end = Math.min(dd, G.capM)
        } else end = G.localReach
      } else end = d
      total = end - d0
    }
    rays.push({ th, ux, uy, d0, kind, local, total })
  }
  return rays
}

/** Weighted circular mean of ray bearings, as integer degrees, with its resultant length R. */
function circMean(rays: Ray[], weight: (r: Ray) => number): { deg: number; R: number } | null {
  let sx = 0, sy = 0, sw = 0
  for (const r of rays) {
    const w = weight(r)
    if (!(w > 0)) continue
    sx += w * r.ux; sy += w * r.uy; sw += w
  }
  if (!sw) return null
  return { deg: Math.round(((Math.atan2(sx, sy) * 180) / Math.PI + 360) % 360) % 360, R: Math.hypot(sx, sy) / sw }
}

const median = (a: number[]) => {
  if (!a.length) return 0
  const s = [...a].sort((x, y) => x - y)
  return s[Math.floor(s.length / 2)]
}

/**
 * One origin's 16-bin profile and its exposure median against the central
 * facing. The pin reaches water up to its micro / macro reach; a point 50 m
 * around it only within `reach` of itself (deriveFromFeatures, R2).
 */
function originProfile(rays: Ray[], facingB: number | null, reach?: number) {
  const wet = rays.filter((r) => r.d0 != null)
  if (!wet.length) return { bins: new Array<number>(16).fill(0), expMed: 0 }
  const nearest = Math.min(...wet.map((r) => r.d0!))
  const micro = reach ?? Math.max(300, nearest + 150), macro = reach ?? Math.max(800, nearest + 300)
  // Bin k (centre k × 22.5°) takes the longest fetch among the rays within
  // ±7.5° of its centre that start within micro reach: 3 rays on the
  // cardinal and intercardinal bins, 4 on the others, so no bin leans to one
  // side by sort order.
  const bins = Array.from({ length: 16 }, (_, k) => {
    let m = 0
    for (const r of wet) if (r.d0! <= micro && angDist(r.th, k * 22.5) <= 7.5 && r.total > m) m = r.total
    return m
  })
  const sec = facingB == null ? [] : wet.filter((r) => r.d0! <= macro && r.total > 0 && angDist(r.th, facingB) <= 45).map((r) => r.total)
  return { bins, expMed: median(sec) }
}

/**
 * Up to this many km a profile bin is land: the scorer's own "no water" edge
 * (scoring.ts fetchGateKm[0], where the water weight is still 0). Not "under":
 * the points 50 m out at sea give a straight coast's landward bins at ±67°
 * 0.2 km, and "< 0.2" read its 157° of land as 112°, a mole.
 */
const LAND_KM = 0.2

/**
 * The widest shape the profile allows, from its longest run of land bins: a
 * straight coast has ~180° of land behind it, a mole or point ~90°, water all
 * round none — so ≥ 6 bins (≥ 135°) is 180, 2–5 is 270, 0–1 is 360. The
 * shape came from how the water right at the pin is spread (RA) alone: at
 * a beach pin a breakwater 16 m off the pin cut its NW rays short, RA fell
 * to 0.27, and a straight coast with 135° of land (E–SSW) read "water all
 * round" — which a gap answer then copied into a manual coast.
 */
export function spreadCap(fetchKm: readonly number[]): CoastSpread {
  const land = fetchKm.map((f) => f <= LAND_KM)
  if (land.every(Boolean)) return 180
  let run = 0, best = 0
  for (let i = 0; i < 32; i++) {
    run = land[i % 16] ? run + 1 : 0
    best = Math.max(best, Math.min(run, 16))
  }
  return best >= 6 ? 180 : best >= 2 ? 270 : 360
}

export type DerivedCoast = Omit<CoastAuto, 'at' | 'src'>

/**
 * The automatic coast at (lat, lon) from the features of the z13 tiles around
 * it (`local`) and the z8 tiles (`coarse`). Steps as in onshore spec §1.5:
 * nearest water, facings A and B, the 16-bin fetch profile, spread, water
 * kind, exposure and the issues that ask the user to check.
 *
 * Critique R2: the profile and the exposure are the per-bin MAX over the pin
 * and 8 points 50 m around it. From a single pin they swung with the pin:
 * a mole pin moved 50 m into the harbour basin read "sheltered",
 * and every wind scored 0 with no prompt. The facings stay the pin's own.
 */
export function deriveFromFeatures(lat: number, lon: number, local: CoastFeature[], coarse: CoastFeature[]): DerivedCoast {
  const G = GEO
  const L = rasterise(lat, lon, G.localR, G.localCell, local, true)
  const C = rasterise(lat, lon, G.coarseR, G.coarseCell, coarse, false)
  const rays = castRays(L, C, 0, 0)

  const wet = rays.filter((r) => r.d0 != null)
  const none: DerivedCoast = {
    v: COAST_ALGO_VERSION, water: 'none', facing: null, nearFacing: null, spread: 360, exposure: null,
    fetchKm: [], pinToWaterM: null, issues: [],
  }
  if (!wet.length) return none
  const nearest = Math.min(...wet.map((r) => r.d0!))
  const micro = Math.max(300, nearest + 150), macro = Math.max(800, nearest + 300)

  // Water kind: inland only when the nearest water is inland AND no sea starts within macro reach.
  const nearestRay = wet.find((r) => r.d0 === nearest)!
  const seaInMacro = wet.some((r) => r.d0! <= macro && r.kind === SEA)
  if (nearestRay.kind === INLAND && !seaInMacro) return { ...none, water: 'inland', pinToWaterM: nearest }

  const B = circMean(wet.filter((r) => r.d0! <= macro && r.total > 0), (r) => Math.min(r.total, 10000))
  const A = circMean(wet.filter((r) => r.d0! <= micro), (r) => Math.min(r.local, 1000))
  const facing = B?.deg ?? null

  // Profile and exposure over the pin and 8 points 50 m around it (R2). A
  // point counts only the water within 50 m of itself: it stands for a pin
  // set 50 m off, not for a walk across a spit. With the pin's 300 m reach,
  // the point 50 m E of a test pin — on a 240 m-wide spit — read the
  // fjord mouth beyond it as the pin's own water: NE 0.1 → 24.8 km, and a NE
  // wind scored +8 "pålandsvind" for a shore it blows off.
  const own = originProfile(rays, facing)
  let bins = own.bins, expMed = own.expMed
  for (let k = 0; k < 8; k++) {
    const a = (k * 45 * Math.PI) / 180
    const p = originProfile(castRays(L, C, G.jitterM * Math.sin(a), G.jitterM * Math.cos(a)), facing, G.jitterM)
    bins = bins.map((b, i) => Math.max(b, p.bins[i]))
    expMed = Math.max(expMed, p.expMed)
  }
  const fetchKm = bins.map((m) => Math.round(Math.min(m, G.capM) / 100) / 10)

  // Lobes: circular runs of bins with ≥ 0.5 km of open water.
  const open = fetchKm.map((f) => f >= 0.5)
  let lobes = 0
  if (open.every(Boolean)) lobes = 1
  else for (let k = 0; k < 16; k++) if (open[k] && !open[(k + 15) % 16]) lobes++
  const RA = A?.R ?? 0
  const byNear: CoastSpread = RA >= 0.55 && lobes === 1 ? 180 : RA < 0.3 ? 360 : 270
  const spread = Math.min(byNear, spreadCap(fetchKm)) as CoastSpread

  const expKm = expMed / 1000
  const exposure: CoastExposure = expKm >= 10 ? 'open' : expKm >= 3 ? 'semi' : 'sheltered'

  const issues: CoastIssue[] = []
  if (nearest > 150) issues.push('far')
  if (A && B && angDist(A.deg, B.deg) > 45) issues.push('gap')
  // R1: no direction with ≥ 0.5 km of open water — a closed basin. Its
  // profile would score every wind ~0 while the line says "faces W".
  if (lobes === 0) issues.push('enclosed')

  return {
    v: COAST_ALGO_VERSION, water: 'sea', facing, nearFacing: A?.deg ?? null, spread, exposure,
    fetchKm, pinToWaterM: nearest, issues,
  }
}
