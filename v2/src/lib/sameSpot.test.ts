import { describe, it, expect } from 'vitest'
import { SAME_PLACE_KM, pairSpots, sameSpot } from './sameSpot'
import { CATALOGUE_MATCH_KM } from './spots'

/** One metre north, in degrees of latitude. */
const M = 1 / 110540
const at = (lat: number, lon: number, spotSlug?: string) => ({ lat, lon, ...(spotSlug && { spotSlug }) })
const HORNBAEK = at(56.09027, 12.45693)
const NORDHUSE = at(55.97, 12.1)
const ARRESO = at(55.98, 12.13)

/**
 * A shared setup taken in over the user's own, and a guest's spots met by an
 * account's setup at sign-in, both ask which spots are one: the same place,
 * or copies of the same official spot.
 */
describe('one spot, or two', () => {
  it('reads one place with the catalogue\'s radius', () => {
    expect(SAME_PLACE_KM).toBe(CATALOGUE_MATCH_KM)
  })

  it('is one place within 30 m, two beyond', () => {
    expect(sameSpot(HORNBAEK, HORNBAEK)).toBe(true)
    expect(sameSpot(HORNBAEK, at(HORNBAEK.lat + 25 * M, HORNBAEK.lon))).toBe(true)
    expect(sameSpot(HORNBAEK, at(HORNBAEK.lat + 40 * M, HORNBAEK.lon))).toBe(false)
    expect(sameSpot(NORDHUSE, ARRESO)).toBe(false)
  })

  it('is one official spot wherever its copies sit, and no slug names none', () => {
    expect(sameSpot(at(56.09, 12.45, 'molen'), at(56.2, 12.45, 'molen'))).toBe(true)
    expect(sameSpot(at(56.09, 12.45, 'molen'), at(56.2, 12.45, 'pynten'))).toBe(false)
    expect(sameSpot(at(56.09, 12.45), at(56.2, 12.45))).toBe(false)
  })
})

describe('pairing a list with the spots already held', () => {
  it('pairs each with the one at its place, and leaves a new one unpaired', () => {
    const have = [NORDHUSE, HORNBAEK]
    expect(pairSpots([HORNBAEK, ARRESO, NORDHUSE], have)).toEqual([HORNBAEK, undefined, NORDHUSE])
  })

  it('pairs each held spot once: a second copy at one place is a new one', () => {
    const near = at(HORNBAEK.lat + 10 * M, HORNBAEK.lon)
    expect(pairSpots([HORNBAEK, HORNBAEK], [HORNBAEK])).toEqual([HORNBAEK, undefined])
    // The nearer of two held copies goes with it, the other with the next.
    expect(pairSpots([near, HORNBAEK], [HORNBAEK, near])).toEqual([near, HORNBAEK])
  })

  // Round P review: the first of the list near a held spot took it, though a
  // later one sat right on it. That one then came in as a second spot at the
  // held one's place.
  it('pairs a held spot with the nearest of the list, wherever that is in it', () => {
    const off = at(HORNBAEK.lat + 25 * M, HORNBAEK.lon)
    expect(pairSpots([off, HORNBAEK], [HORNBAEK])).toEqual([undefined, HORNBAEK])
    expect(pairSpots([HORNBAEK, off], [HORNBAEK])).toEqual([HORNBAEK, undefined])
  })

  // A sharer with one copy of a spot at its old pin and one at its pin now
  // meets the user's copy at the pin now: that one is the copy at the same place.
  it('pairs by place before it pairs by official spot', () => {
    const old = at(56.1, 12.5, 'molen')
    const now = at(56.2, 12.5, 'molen')
    expect(pairSpots([old, now], [now])).toEqual([undefined, now])
    expect(pairSpots([old, now], [now, old])).toEqual([old, now])
    expect(pairSpots([old], [now])).toEqual([now])
  })

  it('asks a test of its own last, for what neither place nor slug pairs', () => {
    const a = at(56.1, 12.5)
    const b = at(56.2, 12.5)
    expect(pairSpots([a], [b])).toEqual([undefined])
    expect(pairSpots([a], [b], (x, y) => x.lat < y.lat)).toEqual([b])
  })
})
