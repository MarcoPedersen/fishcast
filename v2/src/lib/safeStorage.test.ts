/**
 * The user's own data on the device (the catch log, the spots) against what
 * the app derives and can compute or fetch again (kept bite-scores, the
 * weather cache): with the storage full, the derived gives way (writeOwn).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DERIVED_KEYS, storageBlocked, writeOwn } from './safeStorage'
import { SCORES_KEY } from './forgetOnLogout'
import { fakeQuota } from '@/test/fakeQuota'
import forecastSource from '@/stores/forecast.ts?raw'

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('writeOwn: the user\'s own data before what the app derives', () => {
  it('names the kept bite-scores first, then the weather cache', () => {
    expect(DERIVED_KEYS).toEqual([SCORES_KEY, 'fc2-forecasts'])
    expect(forecastSource).toMatch(/const LS_KEY = 'fc2-forecasts'/)
  })

  it('writes in place when there is room, and takes nothing away', () => {
    localStorage.setItem(SCORES_KEY, 's'.repeat(300))
    localStorage.setItem('fc2-forecasts', 'f'.repeat(300))
    fakeQuota(1000)
    expect(writeOwn('fc2-catches', 'c'.repeat(300))).toBe(true)
    expect(localStorage.getItem('fc2-catches')).toBe('c'.repeat(300))
    expect(localStorage.getItem(SCORES_KEY)).not.toBeNull()
    expect(localStorage.getItem('fc2-forecasts')).not.toBeNull()
  })

  it('with the storage full, the kept bite-scores give way first', () => {
    localStorage.setItem(SCORES_KEY, 's'.repeat(600))
    localStorage.setItem('fc2-forecasts', 'f'.repeat(300))
    fakeQuota(1000)
    expect(writeOwn('fc2-catches', 'c'.repeat(200))).toBe(true)
    expect(localStorage.getItem('fc2-catches')).toBe('c'.repeat(200))
    expect(localStorage.getItem(SCORES_KEY)).toBeNull()
    expect(localStorage.getItem('fc2-forecasts')).toBe('f'.repeat(300))
  })

  it('then the weather cache, when the scores weren\'t enough', () => {
    localStorage.setItem(SCORES_KEY, 's'.repeat(600))
    localStorage.setItem('fc2-forecasts', 'f'.repeat(300))
    fakeQuota(1000)
    expect(writeOwn('fc2-setup', 'p'.repeat(800))).toBe(true)
    expect(localStorage.getItem('fc2-setup')).toBe('p'.repeat(800))
    expect(localStorage.getItem(SCORES_KEY)).toBeNull()
    expect(localStorage.getItem('fc2-forecasts')).toBeNull()
  })

  it('a value that never fits, or a storage that takes nothing: false, never a throw', () => {
    localStorage.setItem('fc2-catches', 'old')
    fakeQuota(100)
    expect(writeOwn('fc2-catches', 'c'.repeat(200))).toBe(false)
    expect(localStorage.getItem('fc2-catches')).toBe('old')
    vi.restoreAllMocks()
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
    expect(writeOwn('fc2-catches', 'c')).toBe(false)
  })
})

// Which the user is asked to fix: make room, or allow the site to store data.
describe('storageBlocked: no storage at all, as opposed to a full one', () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!
  afterEach(() => { Object.defineProperty(globalThis, 'localStorage', real) })

  it('a full storage is not blocked', () => {
    fakeQuota(0)
    expect(writeOwn('fc2-catches', 'c')).toBe(false)
    expect(storageBlocked()).toBe(false)
  })

  it('site data blocked (reading localStorage throws), or a web view with none (null), is', () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError') } })
    expect(storageBlocked()).toBe(true)
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: null })
    expect(writeOwn('fc2-catches', 'c')).toBe(false)
    expect(storageBlocked()).toBe(true)
  })
})
