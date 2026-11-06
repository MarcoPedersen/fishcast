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
    expect(at('hesnaes').regions.southZealandPike).toBe('maybe')
    expect(at('fornaes-fyr').regions).toEqual({})
  })
})

/**
 * BEK nr 1673 af 10/12/2025 sets different waters for pike and perch. One box
 * (lat 54.55–55.3, lon 11.3–12.6) served both, so Køge Bugt and Ishøj (perch
 * bilag 3 runs north to the Sjællandsbro over Kalvebodløbet and covers Køge
 * Bugt west of Aflandshage – Møns Klint) and Korsør Nor, Skælskør and Nakskov
 * Fjord (west to the line Albuen – Halskov Odde) lost the 24 cm perch minimum,
 * as did the Copenhagen and Køge streams of bilag 4.
 */
describe('rulePlaceAt — BEK 1673 pike and perch waters', () => {
  it('places Køge Bugt, Ishøj, Korsør Nor, Skælskør and Nakskov Fjord in the perch salt waters', () => {
    for (const s of ['koge-bugt-strand', 'ishoj-strand', 'albuen', 'hesnaes', 'hyllekrog-odde']) {
      expect(at(s).regions.perchBek1673Salt, s).toBe('maybe')
    }
    for (const [lat, lon] of [[55.335, 11.16], [55.25, 11.29], [54.835, 11.08]]) {
      expect(rulePlaceAt(lat, lon).regions.perchBek1673Salt, `${lat},${lon}`).toBe('maybe')
    }
  })

  it('keeps the perch salt waters inside the order\'s lines', () => {
    expect(at('dragor-havn').regions.perchBek1673Salt).toBeUndefined()      // east of Aflandshage
    expect(rulePlaceAt(55.2, 10.95).regions.perchBek1673Salt).toBeUndefined() // the Great Belt
    expect(rulePlaceAt(55.52, 11.11).regions.perchBek1673Salt).toBeUndefined() // Reersø, north of Halskov
    expect(rulePlaceAt(54.655, 11.35).regions.perchBek1673Salt).toBeUndefined() // Rødby, Fehmarn Belt
  })

  it('places the Copenhagen and Køge streams of bilag 4 in the perch fresh waters', () => {
    expect(rulePlaceAt(55.455, 12.15).regions.perchBek1673Fresh).toBe('maybe') // Køge Å
    expect(rulePlaceAt(55.67, 12.45).regions.perchBek1673Fresh).toBe('maybe')  // Harrestrup Å
    expect(rulePlaceAt(54.77, 11.5).regions.perchBek1673Fresh).toBe('maybe')   // Lolland
    expect(at('furesø').regions.perchBek1673Fresh).toBeUndefined()
    expect(at('arreso').regions.perchBek1673Fresh).toBeUndefined()
  })

  it('keeps the pike waters to Sydsjælland, Møn, Lolland and Falster', () => {
    expect(at('ishoj-strand').regions.southZealandPike).toBeUndefined()
    expect(at('koge-bugt-strand').regions.southZealandPike).toBeUndefined()
  })
})
