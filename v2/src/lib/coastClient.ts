/**
 * Main-thread side of the coast derivation: one module worker, created on the
 * first request, with a 40 s deadline per spot. Where a module worker can't
 * be had (no Worker, or construction throws — Safari before 15), the same
 * code runs on the main thread from a lazy chunk, one spot at a time with a
 * yield before each. The store calls it one spot at a time.
 */
import { transientError, type CoastAuto } from './coast'

const JOB_TIMEOUT_MS = 40_000

interface Job { resolve: (r: CoastAuto) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
/** `transient`: the worker's request got no answer (coast.ts transientError) — a flag, as an Error's class doesn't survive the message. */
type Reply = { id: number; ok: true; result: CoastAuto } | { id: number; ok: false; error: string; transient?: boolean }

/** undefined = not tried yet; null = no worker here (use the inline fallback). */
let worker: Worker | null | undefined
const jobs = new Map<number, Job>()
let seq = 0

function failAll(msg: string) {
  for (const [id, j] of jobs) { clearTimeout(j.timer); j.reject(new Error(msg)); jobs.delete(id) }
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    if (typeof Worker === 'undefined') return (worker = null)
    const w = new Worker(new URL('./coast.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<Reply>) => {
      const j = jobs.get(e.data.id)
      if (!j) return
      jobs.delete(e.data.id)
      clearTimeout(j.timer)
      if (e.data.ok) j.resolve(e.data.result)
      else j.reject(e.data.transient ? transientError(e.data.error) : new Error(e.data.error))
    }
    // A worker that fails to load (a module worker where they aren't
    // supported, a stale chunk): fail what it holds, and use the fallback.
    w.onerror = () => { failAll('coast worker error'); w.terminate(); worker = null }
    worker = w
  } catch {
    worker = null
  }
  return worker
}

/** No answer within the deadline: the connection's doing far more often than the server's, so transient — no escalating backoff. */
const timedOut = () => transientError('coast derivation timed out')

function withDeadline<T>(p: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(timedOut()), JOB_TIMEOUT_MS)
    p.then((v) => { clearTimeout(timer); resolve(v) }, (e) => { clearTimeout(timer); reject(e) })
  })
}

/** The automatic coast at (lat, lon), from the worker or the inline fallback. */
export function deriveCoast(lat: number, lon: number): Promise<CoastAuto> {
  const w = getWorker()
  if (!w) {
    return withDeadline((async () => {
      await new Promise((r) => setTimeout(r, 0)) // let the page breathe between spots
      const { deriveAt } = await import('./coastFetch')
      return deriveAt(lat, lon)
    })())
  }
  return new Promise<CoastAuto>((resolve, reject) => {
    const id = ++seq
    const timer = setTimeout(() => { jobs.delete(id); reject(timedOut()) }, JOB_TIMEOUT_MS)
    jobs.set(id, { resolve, reject, timer })
    w.postMessage({ id, lat, lon })
  })
}

/** Logout: stop the worker and drop what it was doing. */
export function terminate() {
  failAll('terminated')
  worker?.terminate()
  worker = undefined
}
