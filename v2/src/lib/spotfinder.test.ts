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

describe('findLuckySpots', () => {
  it('finds no spot for a species no official spot lists (so the view must explain)', () => {
    expect(findLuckySpots(['laks'], 10, ctx)).toEqual([])
  })

  it('offers flatfish spots for plaice now that "Flatfish" rows are real species', () => {
    expect(findLuckySpots(['roedspætte'], 6, ctx).length).toBe(6)
  })
})
