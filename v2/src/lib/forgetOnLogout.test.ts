import { afterEach, describe, expect, it, vi } from 'vitest'
import { DRAFT_KEY, SCORES_KEY, forgetAccountData, forgotten, onForget } from './forgetOnLogout'

/**
 * What the catch log keeps outside the stores leaves with the account at
 * logout (session.logout): the next user on this device finds none of it.
 */
afterEach(() => vi.unstubAllGlobals())

describe('forgetAccountData', () => {
  it('wipes the kept bite-scores and the tab’s unsaved form, and tells the modules holding a copy', () => {
    const tab = new Map([[DRAFT_KEY, '{"v":1}']])
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => tab.get(k) ?? null, setItem: (k: string, v: string) => { tab.set(k, v) }, removeItem: (k: string) => { tab.delete(k) } })
    localStorage.setItem(SCORES_KEY, '{"v":1,"results":[]}')
    const dropped = vi.fn()
    onForget(dropped)
    const before = forgotten()
    forgetAccountData()
    expect(localStorage.getItem(SCORES_KEY)).toBeNull()
    expect(tab.has(DRAFT_KEY)).toBe(false)
    expect(dropped).toHaveBeenCalledOnce()
    // Work begun before it sees that it was.
    expect(forgotten()).not.toBe(before)
  })

  it('wipes with storage blocked as well, without throwing', () => {
    const blocked = () => { throw new DOMException('blocked', 'SecurityError') }
    vi.stubGlobal('sessionStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
    expect(() => forgetAccountData()).not.toThrow()
  })
})
