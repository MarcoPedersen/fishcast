import { describe, it, expect } from 'vitest'
import { claimChunkReload, isChunkLoadError } from './staleChunk'

describe('stale-chunk reload after a deploy', () => {
  it('recognises a lazy chunk that failed to load, in every engine', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/CatchLogView-abc.js'))).toBe(true) // Chromium
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: https://x/a.js'))).toBe(true) // Firefox
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true) // Safari
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/MapTab-1.css'))).toBe(true) // Vite
  })

  it('leaves every other navigation error alone', () => {
    expect(isChunkLoadError(new Error('Navigation cancelled'))).toBe(false)
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'includes')"))).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
  })

  function memory() {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) } }
  }

  it('allows one reload, then none while a broken deploy would loop', () => {
    const s = memory()
    expect(claimChunkReload(() => s, 1_000_000)).toBe(true)
    expect(claimChunkReload(() => s, 1_000_500)).toBe(false) // the reloaded page fails again at once
    expect(claimChunkReload(() => s, 1_030_000)).toBe(false)
  })

  it('allows another reload for a later deploy in the same long-lived tab', () => {
    const s = memory()
    expect(claimChunkReload(() => s, 1_000_000)).toBe(true)
    expect(claimChunkReload(() => s, 1_000_000 + 2 * 3_600_000)).toBe(true)
  })

  it('never reloads when it cannot remember having done so', () => {
    expect(claimChunkReload(() => { throw new DOMException('blocked', 'SecurityError') })).toBe(false)
    const full = { getItem: () => null, setItem: () => { throw new DOMException('full', 'QuotaExceededError') } }
    expect(claimChunkReload(() => full)).toBe(false)
  })
})
