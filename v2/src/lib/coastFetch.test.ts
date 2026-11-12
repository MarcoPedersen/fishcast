import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { clearTileCache, deriveAt, TILE_URL } from './coastFetch'
import { isTransient } from './coast'
import { encodeTile } from '@/test/mvtEncode'

// An all-sea tile, as VersaTiles serves one far out at sea: one full-extent ocean polygon.
const SEA = encodeTile([{ name: 'ocean', features: [{ type: 3, rings: [[[0, 0], [4096, 0], [4096, 4096], [0, 4096], [0, 0]]] }] }])
const ok = () => new Response(SEA as BlobPart, { status: 200 })
const URL_RE = /^https:\/\/tiles\.versatiles\.org\/tiles\/osm\/(\d+)\/(\d+)\/(\d+)$/

let calls: string[] = []
const zoomOf = (u: string) => Number(URL_RE.exec(u)?.[1])

beforeEach(() => { clearTileCache(); calls = [] })
// Only the clock the code under test waits on: Node reads a Response body
// through setImmediate, and faking that froze every body read.
const fakeClock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
// A real timer, taken before any test fakes the clock: stands in for I/O that ends in real time.
const realSetTimeout = globalThis.setTimeout
afterEach(() => { vi.useRealTimers() })

describe('deriveAt — tiles from VersaTiles', () => {
  it('requests at most 4 z13 and 4 z8 tiles of the right shape', async () => {
    const fetchImpl = vi.fn(async (u: string) => { calls.push(u); return ok() })
    const r = await deriveAt(55.6, 12.6, { fetchImpl })
    expect(calls.every((u) => URL_RE.test(u))).toBe(true)
    expect(TILE_URL).toContain('tiles.versatiles.org')
    expect(calls.filter((u) => zoomOf(u) === 13).length).toBeGreaterThanOrEqual(1)
    expect(calls.filter((u) => zoomOf(u) === 13).length).toBeLessThanOrEqual(4)
    expect(calls.filter((u) => zoomOf(u) === 8).length).toBeLessThanOrEqual(4)
    expect(r.src).toBe('versatiles')
    expect(r.water).toBe('sea') // all sea: the pin is in the water
    expect(typeof r.at).toBe('number')
  })

  it('shares z8 tiles between spots 2 km apart', async () => {
    const fetchImpl = vi.fn(async (u: string) => { calls.push(u); return ok() })
    await deriveAt(55.6, 12.6, { fetchImpl })
    const first = calls.length
    await deriveAt(55.6, 12.632, { fetchImpl }) // ≈ 2 km east
    expect(calls.slice(first).filter((u) => zoomOf(u) === 8)).toEqual([])
  })

  /**
   * Critique R5: VersaTiles rate-limits per IP with 429 + Retry-After. A 429
   * is a "wait", not a failure: it is honoured and doesn't use the one retry.
   */
  it('waits out a 429 with Retry-After and does not count it as a failure', async () => {
    fakeClock()
    let n = 0
    const fetchImpl = vi.fn(async (u: string) => {
      calls.push(u)
      return n++ === 0 ? new Response('', { status: 429, headers: { 'Retry-After': '3' } }) : ok()
    })
    const p = deriveAt(55.6, 12.6, { fetchImpl })
    await vi.advanceTimersByTimeAsync(2900)
    const before = calls.length
    await vi.advanceTimersByTimeAsync(200)
    await expect(p).resolves.toMatchObject({ water: 'sea' })
    expect(calls.length).toBeGreaterThan(before)
  })

  it('retries a failing tile once, after 1 s', async () => {
    fakeClock()
    const failed = new Set<string>()
    const fetchImpl = vi.fn(async (u: string) => {
      calls.push(u)
      if (!failed.has(u)) { failed.add(u); return new Response('', { status: 500 }) }
      return ok()
    })
    const p = deriveAt(55.6, 12.6, { fetchImpl })
    // Tiles past the 4-request pool start (and fail) once the first four are done.
    await vi.advanceTimersByTimeAsync(2500)
    await expect(p).resolves.toMatchObject({ water: 'sea' })
  })

  it('aborts a hanging tile at 8 s, then gives up after the retry', async () => {
    fakeClock()
    const fetchImpl = vi.fn((u: string, init?: RequestInit) => new Promise<Response>((_, reject) => {
      calls.push(u)
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
    }))
    const p = deriveAt(55.6, 12.6, { fetchImpl })
    const settled = vi.fn()
    p.then(settled, settled)
    await vi.advanceTimersByTimeAsync(7900)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(8000 + 1100 + 100)
    await expect(p).rejects.toThrow()
  })

  it('rejects when VersaTiles keeps failing (no other provider: critique R5)', async () => {
    fakeClock()
    const fetchImpl = vi.fn(async (u: string) => { calls.push(u); return new Response('', { status: 503 }) })
    const p = deriveAt(55.6, 12.6, { fetchImpl })
    p.catch(() => {})
    await vi.advanceTimersByTimeAsync(5000)
    await expect(p).rejects.toThrow()
    expect(calls.every((u) => URL_RE.test(u))).toBe(true)
  })

  /**
   * Review: a dropped or dead connection failed the spot like a server error,
   * and the store's 1 h / 6 h / 24 h backoff then kept it unknown long after
   * the network was back. A request that got no answer is flagged transient;
   * an answer from VersaTiles (4xx/5xx) or a tile that won't decode is not.
   */
  /**
   * How a spot's derivation ends. The fake clock drives the code's own timers
   * (the 8 s deadline, the 1 s retry); a body read and the gzip decoder run on
   * real I/O and can finish after any one jump of that clock. So step it until
   * the result is in, giving real I/O a turn between steps.
   */
  const settle = async (fetchImpl: (u: string, init?: RequestInit) => Promise<Response>) => {
    clearTileCache()
    let result: string | undefined
    deriveAt(55.6, 12.6, { fetchImpl })
      .then(() => 'resolved', (e: unknown) => (isTransient(e) ? 'transient' : 'hard'))
      .then((r) => { result = r })
    while (result === undefined) {
      await vi.advanceTimersByTimeAsync(1000)
      await new Promise((r) => realSetTimeout(r, 0))
    }
    return result
  }

  it('flags a failure as transient when the request got no answer, not when VersaTiles answered or the tile was bad', async () => {
    fakeClock()
    // fetch() itself rejects: no connection, DNS, a connection reset.
    expect(await settle(async () => { throw new TypeError('Failed to fetch') })).toBe('transient')
    // No answer within 8 s: our own abort.
    expect(await settle((_u, init) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')))
    }))).toBe('transient')
    // The body breaks off half-way.
    expect(await settle(async () => ({ status: 200, headers: new Headers(), arrayBuffer: () => Promise.reject(new TypeError('network error')) }) as unknown as Response)).toBe('transient')
    // VersaTiles answered: 5xx, 4xx.
    expect(await settle(async () => new Response('', { status: 503 }))).toBe('hard')
    expect(await settle(async () => new Response('', { status: 404 }))).toBe('hard')
    // A tile that won't decode: a gzip header over a broken stream. The
    // decompressor's error can be a TypeError, as a fetch's is.
    expect(await settle(async () => new Response(new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3, 0xff, 0xff, 0xff, 0xff]) as BlobPart, { status: 200 }))).toBe('hard')
  })

  // CI (deploy of 4df1e2b): the test above timed out at 5 s. A tile body is read,
  // and a gzip one decoded, on real I/O; when the decoder's error landed after
  // the clock's one 40 s jump, the 1 s retry it scheduled was never reached.
  it('settles when a tile body arrives late in real time', async () => {
    fakeClock()
    const brokenGzip = new Uint8Array([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 0, 3, 0xff, 0xff, 0xff, 0xff])
    const late = async () => ({
      status: 200, headers: new Headers(),
      arrayBuffer: () => new Promise<ArrayBuffer>((r) => realSetTimeout(() => r(brokenGzip.slice().buffer), 100)),
    }) as unknown as Response
    expect(await settle(late)).toBe('hard')
  }, 3000)

  /**
   * clearTileCache: what was asked for before it takes no slot after it. A
   * derivation that settled with tiles still queued or in flight left them
   * behind; the next test's clear woke the queued ones into counted slots,
   * where they waited on a clock nobody stepped, and an in-flight one ending
   * later freed a slot that was not its own. Under load the full suite then
   * timed out on the test below (5 s; 21 ms alone).
   */
  describe('a clear of the tile cache', () => {
    /** Tile requests that hang until answered by hand (the fake clock holds their 8 s deadlines). */
    function held() {
      const answers: ((r: Response) => void)[] = []
      const fetchImpl = vi.fn(() => new Promise<Response>((r) => { answers.push(r) }))
      return { fetchImpl, answers }
    }

    it('lets no tile still queued from before it take a slot after it', async () => {
      fakeClock()
      const old = held()
      deriveAt(55.6, 12.6, { fetchImpl: old.fetchImpl }).catch(() => {})
      await vi.advanceTimersByTimeAsync(0)
      expect(old.fetchImpl).toHaveBeenCalledTimes(4) // the pool: the rest are queued
      clearTileCache()
      await vi.advanceTimersByTimeAsync(0)
      const fetchImpl = vi.fn(async (u: string) => { calls.push(u); return ok() })
      const p = deriveAt(55.6, 12.6, { fetchImpl })
      await vi.advanceTimersByTimeAsync(0)
      expect(old.fetchImpl).toHaveBeenCalledTimes(4)
      expect(fetchImpl).toHaveBeenCalled()
      await expect(p).resolves.toMatchObject({ water: 'sea' })
    })

    it('lets no tile in flight from before it free a slot after it', async () => {
      fakeClock()
      const old = held()
      deriveAt(55.6, 12.6, { fetchImpl: old.fetchImpl }).catch(() => {})
      await vi.advanceTimersByTimeAsync(0)
      clearTileCache()
      const now = held()
      deriveAt(55.6, 12.6, { fetchImpl: now.fetchImpl }).catch(() => {})
      await vi.advanceTimersByTimeAsync(0)
      expect(now.fetchImpl).toHaveBeenCalledTimes(4)
      for (const answer of old.answers) answer(ok()) // the old tiles end, and leave their slots
      for (let i = 0; i < 5; i++) { await vi.advanceTimersByTimeAsync(0); await new Promise((r) => realSetTimeout(r, 0)) }
      expect(now.fetchImpl).toHaveBeenCalledTimes(4) // still the pool's 4
    })
  })

  it('does not cache a failed tile: the next spot fetches it again', async () => {
    fakeClock()
    let fail = true
    const fetchImpl = vi.fn(async (u: string) => { calls.push(u); return fail ? new Response('', { status: 500 }) : ok() })
    const p = deriveAt(55.6, 12.6, { fetchImpl })
    p.catch(() => {})
    await vi.advanceTimersByTimeAsync(3000)
    await expect(p).rejects.toThrow()
    fail = false
    await expect(deriveAt(55.6, 12.6, { fetchImpl })).resolves.toMatchObject({ water: 'sea' })
  })
})
