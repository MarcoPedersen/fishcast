import { describe, it, expect } from 'vitest'
import { smartDetectWaterType } from './geo'
import { findNearbySpots } from './spots'
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

  it('takes a lake a few km off when the name says lake', () => {
    // Esrum Sø's official spot sits at the south end, 4 km from the village.
    const near = findNearbySpots(56.0333, 12.3667, 40).slice(0, 5)
    expect(smartDetectWaterType(56.0333, 12.3667, 'Esrum Sø', near)).toBe('fresh')
  })
})
