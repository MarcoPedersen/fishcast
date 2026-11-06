import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { deriveCoast, terminate } from './coastClient'
import { isTransient } from './coast'

/** A module worker that answers when the test says so. */
class FakeWorker {
  static last: FakeWorker | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  posted: { id: number; lat: number; lon: number }[] = []
  constructor() { FakeWorker.last = this }
  postMessage(m: { id: number; lat: number; lon: number }) { this.posted.push(m) }
  terminate() {}
  reply(data: object) { this.onmessage?.({ data: { id: this.posted.at(-1)!.id, ...data } } as MessageEvent) }
}

const outcome = (p: Promise<unknown>) => p.then(() => 'resolved', (e: unknown) => (isTransient(e) ? 'transient' : 'hard'))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.stubGlobal('Worker', FakeWorker)
})
afterEach(() => {
  terminate()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/**
 * Review: the worker sent every failure as a string, so a dead connection
 * reached the store as a plain Error, and was backed off like a server
 * error. The worker's flag survives the message, and the 40 s deadline is
 * one too: no answer in time is the connection's doing, not the server's.
 */
describe('deriveCoast — what a failure says', () => {
  it("keeps the worker's transient flag across the message", async () => {
    const p = outcome(deriveCoast(55.6, 12.6))
    FakeWorker.last!.reply({ ok: false, error: 'Error: tile request: TypeError: Failed to fetch', transient: true })
    expect(await p).toBe('transient')
  })

  it('a failure the worker does not flag (a 5xx, a bad tile) stays hard', async () => {
    const p = outcome(deriveCoast(55.6, 12.6))
    FakeWorker.last!.reply({ ok: false, error: 'Error: tile 503' })
    expect(await p).toBe('hard')
  })

  it('the 40 s deadline is transient', async () => {
    const p = outcome(deriveCoast(55.6, 12.6))
    await vi.advanceTimersByTimeAsync(40_000)
    expect(await p).toBe('transient')
  })
})
