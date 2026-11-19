import { afterEach, describe, expect, it, vi } from 'vitest'
import { DRAFT_KEY, SCORES_KEY, accountEpoch, accountIs, forgetAccountData, forgotten, onForget, onLeave } from './forgetOnLogout'

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

/**
 * Signed out in another tab, by a token refresh the server refused, or into
 * another account: no logout runs here, and nothing above is wiped. Work
 * begun for the account left must still keep nothing.
 */
describe('the account the stores hold (accountIs)', () => {
  it('left without a logout here, moves the account epoch and tells the modules; a guest who signs in leaves nothing', () => {
    const left = vi.fn()
    onLeave(left)
    accountIs(null)
    let at = accountEpoch()
    const step = (who: string | null, leaves: boolean) => {
      left.mockClear()
      const draft = forgotten()
      accountIs(who)
      expect(left, String(who)).toHaveBeenCalledTimes(leaves ? 1 : 0)
      expect(accountEpoch() !== at, String(who)).toBe(leaves)
      // The form open in the catch log keeps its typing: only a logout moves its epoch.
      expect(forgotten()).toBe(draft)
      at = accountEpoch()
    }
    step('user-a', false) // a guest signs in
    step('user-a', false)
    step(null, true) // signed out elsewhere, or a refused refresh
    step(null, false)
    step('user-b', false)
    step('user-a', true) // into another account
    // A logout here moves it too.
    forgetAccountData()
    expect(accountEpoch()).not.toBe(at)
  })
})
