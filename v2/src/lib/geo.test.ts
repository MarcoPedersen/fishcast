import { describe, it, expect } from 'vitest'
import { smartDetectWaterType, speciesFromNearby } from './geo'
import { fitWaterType } from './locationSpecies'
import { DK_SPOTS, findNearbySpots } from './spots'
import { locationFromSearch } from './placeSearch'

/** A searched place as the location search turns it into a spot (Open-Meteo geocoder coordinates). */
const searched = (name: string, lat: number, lon: number) =>
  locationFromSearch({ name, admin1: '', lat, lon, country: 'DK' }).waterType

/**
 * The water-type guess for a searched place or a tapped pin. A wrong 'fresh'
 * is never questioned: the spot gets no tide, no sea temperature and no coast
 * direction, so the coast check that asks "the map shows fresh water here,
 * which is right?" never runs for it, and the species picker offers only lake
 * fish. Classic sea-trout harbours came out fresh because a lake spot a few
 * km inland was the only official spot within 8 km (Hornbæk: Gurre Sø 4 km),
 * or by the East-Jutland zone rule, which called everything east of 9.8° fresh
 * (Ebeltoft, Horsens, Mariager).
 */
describe('smartDetectWaterType', () => {
  it.each([
    ['Hornbæk', 56.09027, 12.45693],
    ['Gilleleje', 56.12196, 12.31056],
    ['Tisvildeleje', 56.05978, 12.07409],
    ['Ebeltoft', 56.19442, 10.6821],
    ['Dronningmølle', 56.09492, 12.38523],
    ['Horsens', 55.86066, 9.85034],
    ['Mariager', 56.6496, 9.9775],
  ])('does not call the coastal town %s fresh water', (name, lat, lon) => {
    expect(searched(name, lat, lon)).not.toBe('fresh')
  })

  it.each([
    ['Helsingør', 56.03606, 12.6136],
    ['Rørvig', 55.94405, 11.75268],
    ['Hundested', 55.96397, 11.85044],
    ['Aarhus', 56.1567, 10.2108],
  ])('still calls %s brackish', (name, lat, lon) => {
    expect(searched(name, lat, lon)).toBe('brackish')
  })

  it.each([
    ['Silkeborg', 56.17, 9.55],
    ['Skanderborg', 56.0393, 9.93],
    ['Farum', 55.8085, 12.3609],
  ])('calls %s, beside its lake spot, fresh', (name, lat, lon) => {
    expect(searched(name, lat, lon)).toBe('fresh')
  })

  // The trade-off, on purpose: a lake village a few km from its lake's spot
  // (Bryrup 6 km and Them 4 km from Julsø & Brassø) and an inland town
  // (Hinnerup) are guessed brackish, not fresh. A wrong brackish is caught
  // when the coast lookup finds a lake or river and no sea, and the guess
  // then follows the map (waterGuess.ts); a wrong fresh is caught by nothing.
  it.each([
    ['Bryrup, Region Midtjylland', 56.0258, 9.5164],
    ['Them, Region Midtjylland', 56.0917, 9.5519],
    ['Hinnerup, Region Midtjylland', 56.2667, 10.0667],
  ])('guesses %s brackish, for the map to correct', (name, lat, lon) => {
    expect(searched(name, lat, lon)).toBe('brackish')
  })

  // "Arresø", "Julsø", "Mossø": the lake's name is one word, and only
  // "Esrum Sø" or "Arre Sø" counted, so the search called them brackish.
  it.each([
    ['Arresø', 55.97, 12.10],
    ['Julsø', 56.11, 9.66],
    ['Mossø', 56.04, 9.79],
    ['Silkeborg Langsø', 56.17, 9.53],
    ['Furesøen', 55.80, 12.41],
  ])('calls the lake %s fresh by its name', (name, lat, lon) => {
    expect(searched(name, lat, lon)).toBe('fresh')
  })

  // The islands and the seas whose names end the same way are not lakes.
  it.each([
    ['Læsø', 57.27, 11.03],
    ['Samsø', 55.87, 10.61],
    ['Agersø', 55.21, 11.19],
    ['Christiansø', 55.32, 15.19],
    ['Nordsøen', 56.5, 8.1],
    ['Østersøen', 55.0, 14.0],
    ['Havnsø', 55.75, 11.33],
    ['Vigsø', 57.10, 8.73],
  ])('does not call %s a lake', (name, lat, lon) => {
    expect(searched(name, lat, lon)).not.toBe('fresh')
  })

  // A word ending in -sø names a village or a stretch of coast as often as a
  // lake. On its own it made the guess fresh wherever the place lay: Reersø
  // on the Great Belt, Vedersø Klit on the North Sea, Drejø's Søndersø, and
  // a map tap whose road lies in Reersø. Nothing questions a fresh guess, so
  // those kept no tide, no sea temperature and a lake-fish picker.
  it.each([
    ['Reersø, Region Sjælland', 55.52472, 11.11027],
    ['Vedersø Klit, Region Midtjylland', 56.25398, 8.13657],
    ['Søndersø (Drejø)', 54.9624, 10.4212],
    ['Bygaden, Reersø', 55.52472, 11.11027],
  ])('does not call %s fresh water by the -sø in its name', (name, lat, lon) => {
    expect(searched(name, lat, lon)).not.toBe('fresh')
  })

  it('calls no salt or brackish spot of the catalogue fresh by its own name', () => {
    for (const s of DK_SPOTS.filter((x) => x.waterType !== 'fresh')) {
      const others = findNearbySpots(s.lat, s.lon, 40).filter((x) => x.slug !== s.slug).slice(0, 5)
      expect(smartDetectWaterType(s.lat, s.lon, s.name, others), s.name).not.toBe('fresh')
    }
  })

  it('takes a lake a few km off when the name says lake', () => {
    // Esrum Sø's official spot sits at the south end, 4 km from the village.
    const near = findNearbySpots(56.0333, 12.3667, 40).slice(0, 5)
    expect(smartDetectWaterType(56.0333, 12.3667, 'Esrum Sø', near)).toBe('fresh')
  })
})

/**
 * The species a custom spot takes from the official spots within 12 km.
 * Brackish water takes salt and fresh species alike (waterCompatible), so by
 * species alone a coastal town took a lake's: Hornbæk, guessed brackish, got
 * the carp, pike, perch and zander of Gurre Sø and Esrum Sø, 4 and 11 km
 * inland. A sea spot (salt or brackish) takes the sea's spots only. A fresh
 * one takes them all, keeping what lives in fresh water: a sea fish never
 * does, and the sea trout that run up the rivers come from the coast's spots
 * (Randers has only Randers Fjord within 12 km).
 */
describe('speciesFromNearby', () => {
  const names = (l: { nameEn: string }[]) => l.map((s) => s.nameEn).sort()
  const HORNBAEK = [56.09027, 12.45693] as const

  it('gives a sea spot the species of the official spots at sea only', () => {
    expect(names(speciesFromNearby(...HORNBAEK, 'brackish'))).toEqual(['Garfish', 'Mackerel', 'Sea Trout'])
    expect(names(speciesFromNearby(...HORNBAEK, 'salt'))).toEqual(['Garfish', 'Mackerel', 'Sea Trout'])
    // Gilleleje: only Gurre Sø within 12 km.
    expect(speciesFromNearby(56.1218, 12.3108, 'brackish')).toEqual([])
  })

  it('gives a fresh spot what lives in fresh water, sea trout from the coast too', () => {
    expect(names(speciesFromNearby(...HORNBAEK, 'fresh')))
      .toEqual(['Brown Trout (river/lake)', 'Carp', 'Perch', 'Pike', 'Sea Trout', 'Zander'])
    expect(names(speciesFromNearby(56.4607, 10.0364, 'fresh'))).toContain('Sea Trout')
  })

  it('takes every spot without a water type, and always fits the one it is given', () => {
    expect(names(speciesFromNearby(...HORNBAEK))).toHaveLength(8)
    for (const w of ['salt', 'brackish', 'fresh'] as const) {
      for (const s of DK_SPOTS) {
        const got = speciesFromNearby(s.lat, s.lon, w)
        expect(fitWaterType(got, w), `${s.slug} ${w}`).toEqual(got)
      }
    }
  })
})
