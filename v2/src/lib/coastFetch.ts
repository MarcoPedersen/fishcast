/**
 * Fetches the vector tiles around a spot and derives its coast (onshore spec
 * §1.6). Used by the worker (coast.worker.ts), by the main-thread fallback in
 * coastClient.ts and by the Node scripts (precompute, owner report).
 *
 * One provider: VersaTiles (tiles.versatiles.org, OpenStreetMap data in the
 * Shortbread schema; no key, CORS *). OpenFreeMap was the spec's fallback, but
 * its terms forbid "collect data from the service in automated ways", which
 * deriving geometry from its tiles is (critique R5). A VersaTiles failure is
 * a CoastFailure with backoff (stores/coast.ts); the score leaves the factor out.
 *
 * What VersaTiles sees: the z13 and z8 tile indices around each spot. The SET
 * of z13 tiles fetched for ±1.1 km places the spot more tightly than one tile:
 * one tile → a ≈ 0.6 km square in its middle, two → a strip, four → within
 * ≈ 1 km of their shared corner (critique R7). Plus the IP address and
 * User-Agent, as for any request. Open-Meteo already gets exact coordinates.
 */
import { COAST_ALGO_VERSION, transientError, type CoastAuto } from './coast'
import { COAST_LAYERS, GEO, decodeMvt, deriveFromFeatures, gunzipIfNeeded, tileFeatures, tileRange, type CoastFeature } from './coastGeometry'

export const TILE_URL = 'https://tiles.versatiles.org/tiles/osm/{z}/{x}/{y}'
// The credit VersaTiles asks for with its `osm` tileset (critique R5.3): lib/osmCredit.ts.

const TILE_TIMEOUT_MS = 8000
const RETRY_AFTER_MS = 1000
/** ≤ 4 tile requests in flight. */
const POOL = 4
/** Decoded tiles kept in memory: the z8 ones are shared by every spot on a coast (all six on Bornholm use one or two). */
const LRU_SIZE = 24
/** A 429 is waited out this many times at most before it counts as a failure; Retry-After is capped. */
const MAX_429 = 5
const MAX_RETRY_AFTER_MS = 60_000

export interface DeriveOpts {
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>
  /** Node only (the precompute): an identifying User-Agent. Browsers don't allow setting it. */
  headers?: Record<string, string>
  /** At least this long between request starts (the precompute's ≤ 2 requests/s). */
  minGapMs?: number
  src?: CoastAuto['src']
  /** The precompute: every layer name a real tile holds, to check the Shortbread names this reads (spec §1.5 step 3). */
  onLayers?: (tile: string, layers: string[]) => void
}

const cache = new Map<string, Promise<CoastFeature[]>>()
let inFlight = 0
const waiting: (() => void)[] = []
let nextStart = 0
/** Bumped by clearTileCache: the pool's slots are counted per epoch. */
let epoch = 0

/**
 * Tests and logout: forget decoded tiles, and the pool. Requests still in
 * flight finish into the void: a hung one would otherwise hold its slot.
 * Nothing asked for before the clear takes or frees a slot after it: a tile
 * still queued is dropped (a transient failure), and one in flight ending
 * later leaves the new count alone. Woken into counted slots, the queued
 * tiles of one test's settled derivation starved the next test's.
 */
export function clearTileCache() {
  epoch++
  cache.clear()
  nextStart = 0
  inFlight = 0
  waiting.splice(0).forEach((go) => go())
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  const mine = epoch
  if (inFlight >= POOL) await new Promise<void>((r) => waiting.push(r))
  if (mine !== epoch) throw transientError('tile cache cleared')
  inFlight++
  try { return await fn() } finally {
    if (mine === epoch) {
      inFlight--
      waiting.shift()?.()
    }
  }
}

/** Retry-After as seconds or an HTTP date; 5 s when absent or unreadable. */
function retryAfterMs(res: Response): number {
  const h = res.headers.get('Retry-After')
  const s = Number(h)
  const ms = h && Number.isFinite(s) ? s * 1000 : h ? Date.parse(h) - Date.now() : NaN
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, Number.isFinite(ms) ? ms : 5000))
}

class RateLimited extends Error { constructor(public waitMs: number) { super('429') } }

/** A request that got no answer: fetch itself, or the body, failed or was aborted. Flagged here, where it can't be a decoder's TypeError. */
const noAnswer = (e: unknown) => transientError(`tile request: ${String(e)}`)

/**
 * One request with an 8 s deadline. AbortController + setTimeout rather than
 * AbortSignal.timeout: the same everywhere, and the tests' fake clock drives it.
 */
async function requestTile(url: string, opts: DeriveOpts): Promise<Uint8Array> {
  if (opts.minGapMs) {
    const now = Date.now()
    const at = Math.max(now, nextStart)
    nextStart = at + opts.minGapMs
    if (at > now) await sleep(at - now)
  }
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TILE_TIMEOUT_MS)
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, { signal: ctl.signal, ...(opts.headers && { headers: opts.headers }) })
      .catch((e: unknown) => { throw noAnswer(e) })
    if (res.status === 429) throw new RateLimited(retryAfterMs(res))
    if (res.status !== 200) throw new Error(`tile ${res.status}`)
    return new Uint8Array(await res.arrayBuffer().catch((e: unknown) => { throw noAnswer(e) }))
  } finally { clearTimeout(timer) }
}

/** A tile's coast features: one retry after 1 s for a network error, a non-200 or a decode error; a 429 is waited out. */
async function loadTile(z: number, x: number, y: number, opts: DeriveOpts): Promise<CoastFeature[]> {
  const url = TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
  return slot(async () => {
    let failures = 0, limited = 0
    for (;;) {
      try {
        const body = await gunzipIfNeeded(await requestTile(url, opts))
        opts.onLayers?.(`${z}/${x}/${y}`, Object.keys(decodeMvt(body)))
        return tileFeatures(z, x, y, decodeMvt(body, COAST_LAYERS))
      } catch (e) {
        if (e instanceof RateLimited && ++limited <= MAX_429) { await sleep(e.waitMs); continue }
        if (++failures > 1) throw e
        await sleep(RETRY_AFTER_MS)
      }
    }
  })
}

function tile(z: number, x: number, y: number, opts: DeriveOpts): Promise<CoastFeature[]> {
  const key = `${z}/${x}/${y}`
  const hit = cache.get(key)
  if (hit) { cache.delete(key); cache.set(key, hit); return hit }
  const p = loadTile(z, x, y, opts)
  cache.set(key, p)
  // A failed tile is not remembered: the next spot, or "Prøv igen", fetches it again.
  p.catch(() => { if (cache.get(key) === p) cache.delete(key) })
  while (cache.size > LRU_SIZE) cache.delete(cache.keys().next().value!)
  return p
}

/** The automatic coast at (lat, lon): ≤ 4 z13 + ≤ 4 z8 tiles, then the pure derivation. Rejects when a tile can't be had. */
export async function deriveAt(lat: number, lon: number, opts: DeriveOpts = {}): Promise<CoastAuto> {
  const local = tileRange(lat, lon, GEO.localR, 13)
  const coarse = tileRange(lat, lon, GEO.coarseR, 8)
  const [l, c] = await Promise.all([
    Promise.all(local.map(([z, x, y]) => tile(z, x, y, opts))),
    Promise.all(coarse.map(([z, x, y]) => tile(z, x, y, opts))),
  ])
  const d = deriveFromFeatures(lat, lon, l.flat(), c.flat())
  return { ...d, v: COAST_ALGO_VERSION, at: Date.now(), src: opts.src ?? 'versatiles' }
}
