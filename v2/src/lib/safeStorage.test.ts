/**
 * The user's own data on the device (the catch log, the spots) against what
 * the app derives and can compute or fetch again (kept bite-scores, the
 * weather cache): with the storage full, the derived gives way (writeOwn).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DERIVED_KEYS, readStored, removeStored, storageBlocked, writeOwn, writeStored } from './safeStorage'
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

/**
 * A preference the storage refused (writeStored false) is kept in memory for
 * the visit. With site data blocked, reading throws, and gave that copy. With
 * the storage full, reading works, and gave what was stored before, or
 * nothing: the reminders' switch, turned on, read as off at the next look.
 */
describe('a preference the storage refused', () => {
  afterEach(() => { for (const k of ['fc2-notifs', 'fc2-lang']) removeStored(k) })

  it('is read back for the visit while the storage is full', () => {
    fakeQuota(0)
    expect(writeStored('fc2-notifs', '1')).toBe(false)
    expect(localStorage.getItem('fc2-notifs')).toBeNull()
    expect(readStored('fc2-notifs')).toBe('1')
  })

  it('in place of the value stored before it', () => {
    localStorage.setItem('fc2-lang', 'da')
    fakeQuota(0)
    expect(writeStored('fc2-lang', 'en')).toBe(false)
    expect(readStored('fc2-lang')).toBe('en')
  })

  // Another tab stored a value since: that one is newer.
  it('gives way to a value stored since', () => {
    localStorage.setItem('fc2-lang', 'da')
    const full = fakeQuota(0)
    writeStored('fc2-lang', 'en')
    full.mockRestore()
    localStorage.setItem('fc2-lang', 'en-GB')
    expect(readStored('fc2-lang')).toBe('en-GB')
    localStorage.setItem('fc2-lang', 'da')
    expect(readStored('fc2-lang')).toBe('da')
  })

  // Room again, and the value written back is the one the refused copy was
  // laid over: the storage then looks unchanged under it, so only the write
  // itself can end that copy.
  it('gives way to a stored write of the value it was laid over', () => {
    localStorage.setItem('fc2-lang', 'da')
    const full = fakeQuota(0)
    writeStored('fc2-lang', 'en')
    full.mockRestore()
    expect(writeStored('fc2-lang', 'da')).toBe(true)
    expect(readStored('fc2-lang')).toBe('da')
  })

  it('gives way to a write that is stored, and is gone with a removal', () => {
    const full = fakeQuota(0)
    writeStored('fc2-lang', 'en')
    full.mockRestore()
    expect(writeStored('fc2-lang', 'da')).toBe(true)
    expect(readStored('fc2-lang')).toBe('da')
    fakeQuota(0)
    writeStored('fc2-notifs', '1')
    removeStored('fc2-notifs')
    expect(readStored('fc2-notifs')).toBeNull()
  })
})
