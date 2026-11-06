import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { parseQuery } from 'vue-router'
import { parseSharedSetup, parseSharedWindow, shareSetupUrl, shareWindowUrl } from './share'
import { CATALOGUE_MATCH_KM, locationFromShared } from './shareImport'
import { DK_SPOTS, locationFromSpot } from './spots'
import type { Availability, Location, ScoredWindow } from './types'

beforeAll(() => { vi.stubGlobal('location', { origin: 'https://example.test', pathname: '/fishcast/v2/' }) })
afterAll(() => { vi.unstubAllGlobals() })

const opened = (url: string) => parseQuery(url.split('#/?')[1]) as Record<string, string>
const std64 = (obj: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
const AV: Availability = { id: 'a', days: [3], from: '05:00', to: '09:00', methods: ['shore'] }
/** What the scorer reads of a location: everything but its id and the user's own ★ and note. */
const scored = ({ id, fav, note, ...rest }: Location) => rest

/**
 * Regression — WelcomeView imported a shared spot as name, place, water,
 * bottom and coast. Depth, the official slug and the species were lost, so
 * the recipient scored the same spot lower than the sharer (makrel's 'deep'
 * bonus, 8 points; torsk's, 6). An import is now the sharer's spot.
 */
describe('a shared spot, imported', () => {
  const official = DK_SPOTS.map((s): Location => ({ id: 's-' + s.slug, ...locationFromSpot(s) }))

  it('is the sharer’s spot, for every official spot, on a setup link', () => {
    const p = parseSharedSetup(opened(shareSetupUrl(official, ['makrel'], [AV])).setup)!
    expect(p.locs).toHaveLength(Math.min(official.length, 50))
    const imported = p.locs.map((l, i) => ({ id: official[i].id, ...locationFromShared(l, p.legacy) }))
    expect(imported.map(scored)).toEqual(official.slice(0, 50).map(scored))
  })

  it('is the sharer’s spot on a window link', () => {
    for (const spot of official.filter((l) => l.depth === 'deep')) {
      const w: ScoredWindow = { location: spot, date: new Date(Date.UTC(2026, 6, 15)), from: '05:00', to: '09:00', score: 75, noData: false, bestHourStr: null, tags: [] }
      const p = parseSharedWindow(opened(shareWindowUrl(w)).win)!
      expect(scored({ id: spot.id, ...locationFromShared(p, p.legacy) })).toEqual(scored(spot))
    }
  })

  it('keeps a custom spot custom: no depth or slug it never had', () => {
    const fornaes = DK_SPOTS.find((s) => s.slug === 'fornaes-fyr')!
    const pin: Location = { id: 'x', name: 'Pin by the lighthouse', lat: fornaes.lat + 0.0001, lon: fornaes.lon, waterType: 'salt', species: [{ nameEn: 'Cod', months: [1] }] }
    const p = parseSharedSetup(opened(shareSetupUrl([pin], [], [AV])).setup)!
    const l = locationFromShared(p.locs[0], p.legacy)
    expect(l.depth).toBeUndefined()
    expect(l.spotSlug).toBeUndefined()
  })
})

/**
 * Links already in chats carry none of it. A spot within the coast store's
 * catalogue radius of an official one is taken as saved from it — as
 * locationFromSpot would have saved it — so the recipient earns its depth.
 */
describe('a spot from a link made before depth travelled', () => {
  const fornaes = DK_SPOTS.find((s) => s.slug === 'fornaes-fyr')!

  it('takes the depth and slug of the official spot it sits on', () => {
    const p = parseSharedSetup(std64({ locs: [{ n: 'Fornæs Fyr', la: fornaes.lat, lo: fornaes.lon, wt: 'salt', bt: 'stone' }], sp: [], av: [] }))!
    expect(locationFromShared(p.locs[0], p.legacy)).toMatchObject({ depth: 'deep', spotSlug: 'fornaes-fyr' })
    const w = parseSharedWindow(std64({ n: 'Fornæs Fyr', la: fornaes.lat, lo: fornaes.lon, d: '2026-07-15', f: '05:00', t: '09:00', s: 75 }))!
    expect(locationFromShared(w, w.legacy)).toMatchObject({ depth: 'deep', spotSlug: 'fornaes-fyr' })
  })

  /**
   * Its species too. Left to enrichMissingSpecies, they came from the spots
   * nearby (speciesFromNearby), and the same official spot scored up to 15
   * points apart for 41 spot × species pairs (rødspætte at Fornæs Fyr 54
   * against the sharer's 69).
   */
  it('is the sharer’s spot, for every official spot, on a v1 setup link and an older window link', () => {
    for (const s of DK_SPOTS) {
      const sharer = scored({ id: 'x', ...locationFromSpot(s) })
      const p = parseSharedSetup(std64({ v: 1, locs: [{ n: s.name, la: s.lat, lo: s.lon, wt: s.waterType, bt: s.bottomType }], sp: [], av: [] }))!
      expect(scored({ id: 'x', ...locationFromShared(p.locs[0], p.legacy) })).toEqual(sharer)
      const w = parseSharedWindow(std64({ n: s.name, la: s.lat, lo: s.lon, wt: s.waterType, bt: s.bottomType, d: '2026-07-15', f: '05:00', t: '09:00', s: 75 }))!
      expect(scored({ id: 'x', ...locationFromShared(w, w.legacy) })).toEqual(sharer)
    }
  })

  it('takes its own copy of the official spot’s species', () => {
    const p = parseSharedSetup(std64({ locs: [{ n: 'Fornæs Fyr', la: fornaes.lat, lo: fornaes.lon }], sp: [], av: [] }))!
    const l = locationFromShared(p.locs[0], p.legacy)
    l.species![0].months.push(13)
    expect(fornaes.species[0].months).not.toContain(13)
  })

  it('takes nothing from an official spot further away than the catalogue radius', () => {
    const away = CATALOGUE_MATCH_KM * 2 / 111 // degrees of latitude
    const p = parseSharedSetup(std64({ locs: [{ n: 'Up the coast', la: fornaes.lat + away, lo: fornaes.lon }], sp: [], av: [] }))!
    const l = locationFromShared(p.locs[0], p.legacy)
    expect(l.depth).toBeUndefined()
    expect(l.spotSlug).toBeUndefined()
    expect(l.species).toBeUndefined() // enrichMissingSpecies fills these in, as before
  })
})

/** Both imports on the welcome page go through it — they used to build a location by hand each. */
describe('the welcome page', () => {
  const src = Object.values(import.meta.glob<string>('/src/views/WelcomeView.vue', { query: '?raw', import: 'default', eager: true }))[0] ?? ''

  it('imports a shared setup and a shared window with locationFromShared', () => {
    expect(src).toContain('s.locs.map((l) => ({ id: uid(), ...locationFromShared(l, s.legacy) }))')
    expect(src).toContain('setup.locations.push({ id: uid(), ...locationFromShared(w, w.legacy) })')
  })
})
