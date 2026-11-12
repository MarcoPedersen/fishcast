import { vi } from 'vitest'

/**
 * The test localStorage (test-setup.ts) as a browser's: at most `limit`
 * characters of values, then a QuotaExceededError. Undo with vi.restoreAllMocks.
 */
export function fakeQuota(limit: number) {
  const set = localStorage.setItem
  return vi.spyOn(localStorage, 'setItem').mockImplementation((key: string, value: string) => {
    let used = 0
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!
      if (k !== key) used += localStorage.getItem(k)!.length
    }
    if (used + String(value).length > limit) throw new DOMException('full', 'QuotaExceededError')
    set(key, value)
  })
}
