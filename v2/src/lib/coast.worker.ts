/**
 * The coast derivation off the main thread (onshore spec §1.6). Rasterising
 * ~1.3 M cells and casting 9 × 72 rays per spot, times 18 spots, on a phone
 * would freeze the app — the dashboard already had a 5 s freeze fixed in 71d2038.
 * coastClient.ts owns the lifecycle; this is only the message shell.
 */
import { isTransient } from './coast'
import { deriveAt } from './coastFetch'

self.onmessage = async (e: MessageEvent<{ id: number; lat: number; lon: number }>) => {
  const { id, lat, lon } = e.data
  try {
    const result = await deriveAt(lat, lon)
    self.postMessage({ id, ok: true, result })
  } catch (err) {
    // The flag, not the error: a posted Error arrives without its own properties.
    self.postMessage({ id, ok: false, error: String(err), transient: isTransient(err) })
  }
}
