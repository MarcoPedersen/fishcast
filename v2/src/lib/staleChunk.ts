/**
 * After a deploy, the auto-updating service worker (skipWaiting + clientsClaim)
 * activates mid-session and deletes the previous build's precached chunks while
 * the open page still points at them. The first lazy route — or the map tab —
 * the page hadn't loaded yet then 404s, and the tap silently does nothing until
 * a manual reload. One reload picks up the new build.
 */
const KEY = 'fc2-chunk-reload'
// Not strictly once per tab: an installed PWA can stay open across several
// deploys. A minute is still long enough that a deploy which is genuinely
// broken can't put the page in a reload loop.
const RETRY_MS = 60_000

const CHUNK_ERROR = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i

export function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  return CHUNK_ERROR.test(msg)
}

type Store = Pick<Storage, 'getItem' | 'setItem'>

/**
 * Claim the reload; false when one just happened. Also false when storage is
 * unavailable: without a record of the last reload it could loop forever.
 */
export function claimChunkReload(store: () => Store = () => sessionStorage, now = Date.now()): boolean {
  try {
    const s = store()
    const last = Number(s.getItem(KEY))
    if (last && now - last < RETRY_MS) return false
    s.setItem(KEY, String(now))
    return true
  } catch { return false }
}
