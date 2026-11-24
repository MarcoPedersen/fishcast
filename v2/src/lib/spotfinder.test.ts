import { describe, it, expect } from 'vitest'
import { findLuckySpots, findNearbyRanked } from './spotfinder'
import { DK_SPOTS, findNearbySpots } from './spots'
import { SPECIES_PREFS } from './species'

const ctx = { locations: [], forecastIds: new Set<string>() }
const HILLEROD = { lat: 55.9267, lon: 12.3109 }
const AARHUS = { lat: 56.15, lon: 10.2 }
const names = (rs: { spot: { name: string } }[]) => rs.map((r) => r.spot.name)

/**
 * Nearby mode scored spots that don't list the target species on a different
 * scale (20 + 5 per active species) and sorted both into one list — so a
 * species-rich sea coast with no pike took the gold medal for "Gedde" above
 * the pike lakes.
 */
describe('findNearbyRanked with target species', () => {
  it('ranks a pike lake above a sea beach with no pike (Hillerød, April)', () => {
    const rs = findNearbyRanked(HILLEROD.lat, HILLEROD.lon, 40, ['gedde'], 4, ctx)
    const order = names(rs)
    expect(order).toContain('Gurre Sø')
    expect(order.indexOf('Gurre Sø')).toBeLessThan(order.indexOf('Ishøj Strand') === -1 ? Infinity : order.indexOf('Ishøj Strand'))
  })

  it('puts every spot that lists the species before every spot that does not', () => {
    for (const [pt, sp, month] of [[HILLEROD, 'gedde', 4], [AARHUS, 'aborre', 10], [AARHUS, 'gedde', 5]] as const) {
      // Checked against the spot data, not the `unlisted` flag under test.
      const en = SPECIES_PREFS[sp].nameEn.toLowerCase()
      const lists = (slug: string) => DK_SPOTS.find((s) => s.slug === slug)!.species.some((x) => x.nameEn?.toLowerCase() === en)
      const flags = findNearbyRanked(pt.lat, pt.lon, 80, [sp], month, ctx).map((r) => lists(r.spot.slug))
      expect(flags[0], `${sp} in month ${month}`).toBe(true)
      expect(flags, `${sp} in month ${month}`).toEqual([...flags].sort((a, b) => Number(b) - Number(a)))
    }
  })

  it('perch in October near Aarhus: Randers Fjord and Mossø above Glatved and Fornæs Fyr', () => {
    const order = names(findNearbyRanked(AARHUS.lat, AARHUS.lon, 80, ['aborre'], 10, ctx))
    const pos = (n: string) => (order.indexOf(n) === -1 ? Infinity : order.indexOf(n))
    for (const listed of ['Randers Fjord', 'Mossø']) {
      for (const other of ['Glatved', 'Fornæs Fyr']) expect(pos(listed), `${listed} vs ${other}`).toBeLessThan(pos(other))
    }
  })

  it('marks the fallback spots and never lets them push listed spots out of the top 8', () => {
    const rs = findNearbyRanked(AARHUS.lat, AARHUS.lon, 120, ['aborre'], 10, ctx)
    const listsPerch = (slug: string) =>
      DK_SPOTS.find((s) => s.slug === slug)!.species.some((x) => x.nameEn === 'Perch')
    const perchInRadius = findNearbySpots(AARHUS.lat, AARHUS.lon, 120).filter((s) => listsPerch(s.slug))
    expect(rs.filter((r) => !r.unlisted)).toHaveLength(Math.min(8, perchInRadius.length))
    for (const r of rs) expect(!!r.unlisted, r.spot.name).toBe(!listsPerch(r.spot.slug))
  })

  it('leaves the no-target ranking alone', () => {
    const rs = findNearbyRanked(AARHUS.lat, AARHUS.lon, 80, [], 10, ctx)
    expect(rs.length).toBeGreaterThan(0)
    expect(rs.some((r) => r.unlisted)).toBe(false)
    expect(rs.map((r) => r.score)).toEqual([...rs.map((r) => r.score)].sort((a, b) => b - a))
  })
})

/**
 * Held og lykke for cod in November gave four picks of six inside the Baltic
 * cod ban, Sletterhage on silver, with nothing to say so; the dashboard only
 * flagged the spot once it was saved. A spot where every target it lists is
 * closed that day (lib/seasonGuard) now comes after every spot where one is
 * open, marked with the targets closed there.
 */
describe('a target closed at a spot on the day searched', () => {
  const NOV = { ...ctx, day: new Date(2026, 10, 24, 12) }
  const APR = { ...ctx, day: new Date(2026, 3, 12, 12) }
  const openFirst = (rs: { closed?: string[] }[]) => {
    const shut = rs.map((r) => !!r.closed)
    expect(shut).toEqual([...shut].sort((a, b) => Number(a) - Number(b)))
  }

  it('cod in November: the Kattegat spots first, the Baltic ones after them, marked', () => {
    const rs = findLuckySpots(['torsk'], 11, NOV)
    expect(names(rs.filter((r) => !r.closed))).toEqual(['Fornæs Fyr', 'Hundested Havn'])
    expect(names(rs.filter((r) => r.closed))).toContain('Sletterhage')
    openFirst(rs)
    for (const r of rs.filter((r) => r.closed)) expect(r.closed, r.spot.name).toEqual(['torsk'])
  })

  it('pike in April near Hillerød: every lake is closed, still listed and marked, before the spots with no pike', () => {
    const rs = findNearbyRanked(HILLEROD.lat, HILLEROD.lon, 40, ['gedde'], 4, APR)
    const listed = rs.filter((r) => !r.unlisted)
    expect(names(listed)).toContain('Gurre Sø')
    for (const r of listed) expect(r.closed, r.spot.name).toEqual(['gedde'])
    expect(rs.findIndex((r) => r.unlisted)).toBe(listed.length === rs.length ? -1 : listed.length)
  })

  it('a spot open for another target is no closed spot: cod and sea trout at Sletterhage', () => {
    const sl = findNearbyRanked(56.0945, 10.5127, 5, ['torsk', 'havørred'], 11, NOV).find((r) => r.spot.name === 'Sletterhage')!
    expect(sl.closed).toBeUndefined()
  })

  // Its score is the open target's: cod's would rank it on a fish it may not keep.
  it('a spot open for one target and closed for another scores for the open one', () => {
    const at = (targets: string[]) =>
      findNearbyRanked(56.0945, 10.5127, 5, targets, 11, NOV).find((r) => r.spot.name === 'Sletterhage')!.score
    expect(at(['torsk'])).toBeGreaterThan(at(['havørred']))
    expect(at(['torsk', 'havørred'])).toBe(at(['havørred']))
  })

  // Only a spot closed for every target was marked: Sletterhage for cod and
  // sea trout gave no word that cod is closed there.
  it('a spot open for one target and closed for another names the closed one', () => {
    const at = (targets: string[]) =>
      findNearbyRanked(56.0945, 10.5127, 5, targets, 11, NOV).find((r) => r.spot.name === 'Sletterhage')!
    expect(at(['torsk', 'havørred']).alsoClosed).toEqual(['torsk'])
    expect(at(['havørred']).alsoClosed).toBeUndefined()
    // Closed for every target: `closed` names them, as before.
    expect(at(['torsk'])).toMatchObject({ closed: ['torsk'] })
    expect(at(['torsk']).alsoClosed).toBeUndefined()
    // No day, no rule read.
    expect(findLuckySpots(['torsk', 'havørred'], 11, ctx).some((r) => r.alsoClosed)).toBe(false)
    expect(findLuckySpots(['torsk', 'havørred'], 11, NOV).some((r) => r.alsoClosed)).toBe(true)
  })

  it('nearby, cod from Aarhus: the open spots before the closed ones', () => {
    const rs = findNearbyRanked(AARHUS.lat, AARHUS.lon, 120, ['torsk'], 11, NOV).filter((r) => !r.unlisted)
    expect(rs.some((r) => r.closed) && rs.some((r) => !r.closed)).toBe(true)
    openFirst(rs)
  })
})

describe('findLuckySpots', () => {
  it('finds no spot for a species no official spot lists (so the view must explain)', () => {
    expect(findLuckySpots(['laks'], 10, ctx)).toEqual([])
  })

  it('offers flatfish spots for plaice now that "Flatfish" rows are real species', () => {
    expect(findLuckySpots(['roedspætte'], 6, ctx).length).toBe(6)
  })
})
