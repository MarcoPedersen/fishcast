import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { parseQuery } from 'vue-router'
import { parseSharedSetup, parseSharedWindow, shareSetupUrl, shareWindowUrl } from './share'
import type { Availability, Location, ScoredWindow } from './types'

beforeAll(() => { vi.stubGlobal('location', { origin: 'https://example.test', pathname: '/fishcast/v2/' }) })
afterAll(() => { vi.unstubAllGlobals() })

/** What WelcomeView receives: the hash URL's query, run through the router's own parser. */
function opened(url: string): Record<string, string> {
  return parseQuery(url.split('#/?')[1]) as Record<string, string>
}
const std64 = (obj: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))))

const loc = (name: string): Location => ({ id: 'x', name, lat: 55.6, lon: 12.6, waterType: 'salt', bottomType: 'stone' })
const AV: Availability = { id: 'a', days: [1, 6], from: '05:00', to: '09:30', methods: ['shore', 'waders'] }
const win = (name: string): ScoredWindow => ({
  location: loc(name), date: new Date(Date.UTC(2026, 9, 3)), from: '06:00', to: '09:00', score: 74,
  noData: false, bestHourStr: null, tags: [],
})

/**
 * Regression — vue-router's parseQuery turns '+' into a space, and standard
 * base64 emits '+' for emoji, '>' and '~' at certain byte offsets, so those
 * links opened to the plain welcome page with no banner and no error.
 */
describe('share links survive the router', () => {
  const NAMES = ['Molen 🎣', 'Søen 🐟', 'Havn >5m', 'Mole > Nord', 'Spot ~2', 'Bådebro 🚤', '🏠 Hjemme', 'Æbelø >', 'Øresund Ålegræs']

  it.each(NAMES)('round-trips a setup with a spot named %s', (n) => {
    const url = shareSetupUrl([loc(n), loc('Stevns Klint')], ['torsk'], [AV])
    const p = parseSharedSetup(opened(url).setup)
    expect(p?.locs.map((l) => l.n)).toEqual([n, 'Stevns Klint'])
    expect(p?.av).toEqual([{ d: [1, 6], f: '05:00', t: '09:30', m: ['shore', 'waders'] }])
  })

  it.each(NAMES)('round-trips a window for a spot named %s', (n) => {
    const p = parseSharedWindow(opened(shareWindowUrl(win(n))).win)
    expect(p).toMatchObject({ n, la: 55.6, lo: 12.6, d: '2026-10-03', f: '06:00', t: '09:00', s: 74 })
  })

  it('still opens a link shared before the fix, whose + arrived as a space', () => {
    const payload = { locs: [{ n: 'Molen 🎣', la: 55.6, lo: 12.6 }], sp: [], av: [] }
    const old = std64(payload)
    expect(old).toContain('+') // the case that used to break
    const p = parseSharedSetup(opened(`https://example.test/#/?setup=${old}`).setup)
    expect(p?.locs[0].n).toBe('Molen 🎣')
  })
})

/**
 * Regression — payload fields were never checked. One window without `d` made
 * getScoredWindows throw and blanked the app on every synced device; a
 * location without la/lo broke every forecast batch request.
 */
describe('share payload validation', () => {
  const link = (payload: unknown) => std64(payload)

  it('drops a window without days, and one with bad times', () => {
    const p = parseSharedSetup(link({
      locs: [{ n: 'A', la: 55, lo: 12 }], sp: [],
      av: [{ f: '06:00', t: '09:00' }, { d: [1], f: '6', t: '09:00' }, { d: 'x', f: '06:00', t: '09:00' }, { d: [9, 2, 2], f: '06:00', t: '09:00' }],
    }))
    expect(p?.av).toEqual([{ d: [2], f: '06:00', t: '09:00', m: undefined }])
  })

  it('drops locations without finite, in-range coordinates', () => {
    const p = parseSharedSetup(link({
      locs: [{ n: 'none' }, { n: 'str', la: '55.6', lo: '12' }, { n: 'far', la: 95, lo: 12 }, { n: '  ', la: 55, lo: 12 }, { n: 'ok', la: 55, lo: 12, wt: { x: 1 } }],
      sp: [], av: [],
    }))
    expect(p?.locs).toEqual([{ n: 'ok', la: 55, lo: 12, wt: undefined, bt: undefined }])
  })

  it('keeps only known species and methods', () => {
    const p = parseSharedSetup(link({
      locs: [], sp: ['torsk', 'nonsense', 3, 'toString', 'torsk'],
      av: [{ d: [1], f: '06:00', t: '09:00', m: ['boat', 'jetpack'] }],
    }))
    expect(p?.sp).toEqual(['torsk'])
    expect(p?.av[0].m).toEqual(['boat'])
  })

  it('caps names and list lengths', () => {
    const p = parseSharedSetup(link({
      locs: Array.from({ length: 80 }, (_, i) => ({ n: 'x'.repeat(200), la: 55, lo: 12 + i / 100 })), sp: [], av: [],
    }))
    expect(p?.locs).toHaveLength(50)
    expect(p?.locs[0].n).toHaveLength(80)
  })

  it('rejects a setup with nothing valid left, and non-setup payloads', () => {
    expect(parseSharedSetup(link({ locs: [{ n: 'x' }], sp: ['?'], av: [{}] }))).toBeNull()
    expect(parseSharedSetup(link([1, 2]))).toBeNull()
    expect(parseSharedSetup('%%%')).toBeNull()
    expect(parseSharedSetup(undefined)).toBeNull()
  })

  it('rejects a window without coordinates, date or valid times', () => {
    expect(parseSharedWindow(link({ n: 'x' }))).toBeNull()
    expect(parseSharedWindow(link({ n: 'x', la: '55', lo: 12, d: '2026-10-03', f: '06:00', t: '09:00', s: 50 }))).toBeNull()
    expect(parseSharedWindow(link({ n: 'x', la: 55, lo: 12, d: 'soon', f: '06:00', t: '09:00', s: 50 }))).toBeNull()
    expect(parseSharedWindow(link({ n: 'x', la: 55, lo: 12, d: '2026-10-03', f: '06:00', t: '25:00', s: 50 }))).toBeNull()
  })

  it('clamps a garbage score instead of displaying it', () => {
    expect(parseSharedWindow(link({ n: 'x', la: 55, lo: 12, d: '2026-10-03', f: '06:00', t: '09:00', s: 'lots' }))?.s).toBe(0)
    expect(parseSharedWindow(link({ n: 'x', la: 55, lo: 12, d: '2026-10-03', f: '06:00', t: '09:00', s: 1e9 }))?.s).toBe(100)
  })
})
