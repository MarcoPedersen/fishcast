import { describe, it, expect } from 'vitest'
import { rulePlaceAt } from './ruleArea'
import { DK_SPOTS } from './spots'

const at = (slug: string) => {
  const s = DK_SPOTS.find((x) => x.slug === slug)!
  return rulePlaceAt(s.lat, s.lon)
}

/**
 * The 2026 lists set sizes per column (Nordsøen incl. Limfjorden / Skagerrak-
 * Kattegat / Bælterne og Østersøen) and ban cod in ICES 22–32 only, so a
 * location has to be placed in one of them. Boundaries: Commission Regulation
 * (EC) 2187/2005 Annex I (Hasenøre–Gniben, Gilbjerg Hoved–Kullen).
 */
describe('rulePlaceAt — sea area', () => {
  it('places the Djursland east coast in the Kattegat, north of Hasenøre–Gniben', () => {
    expect(at('fornaes-fyr').areas).toEqual(['skagerrak'])
    expect(at('jernhatten').areas).toEqual(['skagerrak'])
  })

  it('places Aarhus Bay, Samsø and Kalø Vig in the Belt Sea (ICES 22)', () => {
    for (const s of ['aarhus-havn-oestmolen', 'stavns', 'mageoen', 'sletterhage']) expect(at(s).areas, s).toEqual(['belts'])
  })

  it('places the Øresund (ICES 23) and Bornholm (24/25) in the Baltic', () => {
    expect(at('helsingore-kysten').areas).toEqual(['belts'])
    expect(at('dragor-havn').areas).toEqual(['belts'])
    expect(at('ronne-havn').areas).toEqual(['belts'])
  })

  it('places the north coast of Zealand west of Gilbjerg Hoved in the Kattegat', () => {
    expect(at('hundested-havn').areas).toEqual(['skagerrak'])
  })

  it('counts the Limfjord and the west coast as the North Sea', () => {
    expect(at('virksund').areas).toEqual(['northSea'])
    expect(at('hasseris-bugten').areas).toEqual(['northSea'])
    expect(at('graerup-strand').areas).toEqual(['northSea'])
  })

  it('hedges a point on a boundary between both areas', () => {
    // Gilleleje sits on Gilbjerg Hoved, where the Kattegat meets the Sound.
    expect(rulePlaceAt(56.125, 12.31).areas.sort()).toEqual(['belts', 'skagerrak'])
  })
})

describe('rulePlaceAt — named regions', () => {
  it('knows Bornholm for certain', () => {
    expect(at('ronne-havn').regions.bornholm).toBe('in')
    expect(at('dragor-havn').regions.bornholm).toBeUndefined()
  })

  it('can only say "maybe" for the fjords and the Wadden Sea', () => {
    expect(rulePlaceAt(56.0, 8.25).regions.ringkobing).toBe('maybe')   // Ringkøbing Fjord
    expect(rulePlaceAt(55.47, 8.44).regions.wadden).toBe('maybe')      // Esbjerg
    expect(at('graerup-strand').regions.wadden).toBeUndefined()        // north of Blåvandshuk
    expect(at('hesnaes').regions.southZealand).toBe('maybe')
    expect(at('fornaes-fyr').regions).toEqual({})
  })
})
