import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_SAVED, MAX_SAVED_CHARS, SAVED_KEY, readSaved, writeSaved } from './insightSaved'
import type { WindowSample } from './catchInsights'
import type { Location } from './types'

/**
 * The bite-scores kept on this device (insightSaved): what is kept, how much,
 * and what a reload makes of whatever it finds there.
 */
const LOC: Location = { id: 'drg', name: 'Sydmolen', lat: 55.59, lon: 12.68, waterType: 'salt' }
const DAY = 86400000
const D0 = Date.UTC(2026, 9, 1)

/** A scored window as scoreEntry gives it, on day `d` after D0; `pad` makes its stored form longer. */
function sample(d: number, score = 50, pad = 0): WindowSample {
  const day = D0 + d * DAY
  return {
    window: { location: LOC, date: new Date(day), from: '06:00', to: '06:30', score, noData: false, bestHourStr: '06:00', tags: [{ label: '🌅 Daggry', cls: 'tag-gold' }],
      breakdown: [{ icon: '⚙️', factor: 'Basis', label: '', points: 21, key: 'bd_base' }] },
    hours: [{ at: day + 4 * 3600000, score, breakdown: [{ icon: '⚙️', factor: 'Basis', label: 'x'.repeat(pad), points: 21, key: 'bd_base' }], cond: { tod: 'dawn', wind: 'light' } }],
  }
}
const held = (rs: [string, WindowSample | null | 'failed'][]) => new Map(rs.map(([id, result]) => [id, { fp: 'fp-' + id, coast: '', result }]))
const storedIds = () => (JSON.parse(localStorage.getItem(SAVED_KEY)!).results as [string][]).map((r) => r[0])

beforeEach(() => localStorage.removeItem(SAVED_KEY))
afterEach(() => vi.unstubAllGlobals())

describe('kept bite-scores', () => {
  it('come back as they were computed, the window’s date a Date again', () => {
    const s = sample(3, 72)
    writeSaved(held([['c1', s]]))
    const back = readSaved()
    expect([...back.keys()]).toEqual(['c1'])
    expect(back.get('c1')).toEqual({ fp: 'fp-c1', coast: '', result: s })
    expect(back.get('c1')!.result.window.date).toBeInstanceOf(Date)
  })

  /** A failed fetch is worth a retry, and "no data" may be data once the archive catches up. */
  it('are the scored results only — no failure and no "no data"', () => {
    writeSaved(held([['ok', sample(1)], ['failed', 'failed'], ['none', null]]))
    expect([...readSaved().keys()]).toEqual(['ok'])
    // Nothing scored is nothing kept: no older set left behind.
    writeSaved(held([['failed', 'failed']]))
    expect(localStorage.getItem(SAVED_KEY)).toBeNull()
  })

  it(`are at most ${MAX_SAVED}, the newest entries’ first`, () => {
    const many = held(Array.from({ length: MAX_SAVED + 100 }, (_, i): [string, WindowSample] => ['e' + i, sample(i)]))
    writeSaved(many)
    const kept = readSaved()
    expect(kept.size).toBe(MAX_SAVED)
    // e100…e399 are the newest days.
    expect([...kept.keys()].sort()).toEqual(Array.from({ length: MAX_SAVED }, (_, i) => 'e' + (i + 100)).sort())
  })

  it(`are at most ${MAX_SAVED_CHARS} characters, the newest entries’ first`, () => {
    const big = held(Array.from({ length: 80 }, (_, i): [string, WindowSample] => ['e' + i, sample(i, 50, 20_000)]))
    writeSaved(big)
    const raw = localStorage.getItem(SAVED_KEY)!
    expect(raw.length).toBeLessThanOrEqual(MAX_SAVED_CHARS)
    const ids = storedIds()
    expect(ids.length).toBeGreaterThan(10)
    expect(ids.length).toBeLessThan(80)
    expect(ids[0]).toBe('e79')
    expect(ids).toEqual(Array.from({ length: ids.length }, (_, i) => 'e' + (79 - i)))
  })

  /** The weather cache shares the quota: fewer scores rather than a write that fails, and an old set never stays behind. */
  it('shed scores when the browser refuses the size, and keep none rather than an older set', () => {
    writeSaved(held([['old', sample(0)]]))
    const real = localStorage
    const limited = (max: number) => ({ ...real, getItem: real.getItem, removeItem: real.removeItem,
      setItem: (k: string, v: string) => { if (v.length > max) throw new DOMException('full', 'QuotaExceededError'); real.setItem(k, v) } })
    const ten = held(Array.from({ length: 10 }, (_, i): [string, WindowSample] => ['e' + i, sample(i + 1)]))
    const one = JSON.stringify(['e9', 'fp-e9', '', sample(10)]).length
    vi.stubGlobal('localStorage', limited(one * 4))
    writeSaved(ten)
    expect(storedIds().length).toBeGreaterThan(0)
    expect(storedIds().length).toBeLessThan(10)
    expect(storedIds()[0]).toBe('e9')
    vi.stubGlobal('localStorage', limited(10))
    writeSaved(ten)
    expect(real.getItem(SAVED_KEY)).toBeNull()
  })

  it('read past corrupt, older-format and broken data', () => {
    for (const bad of ['{not json', 'null', '[]', '{"results":[]}', '{"v":2,"results":[]}', JSON.stringify([['c1', 'fp', '', sample(1)]])]) {
      localStorage.setItem(SAVED_KEY, bad)
      expect(readSaved().size, bad).toBe(0)
    }
    const good = JSON.parse(JSON.stringify(['ok', 'fp', '', sample(2)]))
    const broken = [
      ['no-date', 'fp', '', { ...sample(2), window: { ...sample(2).window, date: 'never' } }],
      ['no-score', 'fp', '', { ...sample(2), window: { ...sample(2).window, score: null } }],
      ['bad-hour', 'fp', '', { ...sample(2), hours: [{ at: 1 }] }],
      ['no-fp', 7, '', sample(2)],
      'not a record',
    ]
    localStorage.setItem(SAVED_KEY, JSON.stringify({ v: 1, results: [...broken, good] }))
    expect([...readSaved().keys()]).toEqual(['ok'])
  })

  it('work, for the visit, where the browser blocks storage', () => {
    const blocked = () => { throw new DOMException('blocked', 'SecurityError') }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked, removeItem: blocked })
    expect(readSaved().size).toBe(0)
    expect(() => writeSaved(held([['c1', sample(1)]]))).not.toThrow()
  })
})
