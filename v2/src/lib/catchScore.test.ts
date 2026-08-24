import { describe, it, expect } from 'vitest'
import { canScoreCatch, findCatchLocation, scoreBlocker } from './catchScore'
import type { CatchEntry, Location } from './types'

const LOCS: Location[] = [
  { id: 'l1', name: 'Dragør mole', lat: 55.59, lon: 12.68 },
  { id: 'l2', name: 'Tejn mole', lat: 55.25, lon: 14.83 },
]
const entry = (over: Partial<CatchEntry> = {}): CatchEntry => ({
  id: 'c1', date: '2026-08-22', time: '19:00', speciesId: 'havørred',
  locationName: 'Dragør mole', ...over,
})

describe('catch bite-score preconditions', () => {
  it('scores a catch at a saved location with a time', () => {
    expect(canScoreCatch(entry(), LOCS)).toBe(true)
    expect(scoreBlocker(entry(), LOCS)).toBeNull()
  })

  /**
   * The location field is free text with a datalist, so an exact string compare
   * silently dropped the score for anything typed slightly differently.
   */
  it('matches a saved location despite case and stray whitespace', () => {
    expect(findCatchLocation(entry({ locationName: '  dragør MOLE ' }), LOCS)?.id).toBe('l1')
    expect(canScoreCatch(entry({ locationName: 'DRAGØR MOLE' }), LOCS)).toBe(true)
  })

  it('does not match a different place', () => {
    expect(findCatchLocation(entry({ locationName: 'Dragør' }), LOCS)).toBeUndefined()
    expect(scoreBlocker(entry({ locationName: 'Dragør' }), LOCS)).toBe('location')
  })

  it('reports which piece is missing, so the UI can explain', () => {
    expect(scoreBlocker(entry({ time: undefined }), LOCS)).toBe('time')
    expect(scoreBlocker(entry({ time: '' }), LOCS)).toBe('time')
    expect(scoreBlocker(entry({ locationName: '' }), LOCS)).toBe('location')
    expect(scoreBlocker(entry({ locationName: 'Nowhere' }), LOCS)).toBe('location')
  })

  it('treats an empty location name as unmatched rather than matching anything', () => {
    expect(findCatchLocation(entry({ locationName: '   ' }), LOCS)).toBeUndefined()
  })
})
