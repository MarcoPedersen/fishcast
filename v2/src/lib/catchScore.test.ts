import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { canScoreCatch, catchPlaceName, findCatchLocation, linkCatchLocation, scoreBlocker } from './catchScore'

// The fixture date must stay inside the 92-day weather window, whenever the
// suite runs — otherwise every case below turns into 'old'.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-01T12:00:00')) })
afterEach(() => { vi.useRealTimers() })
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

/**
 * Catches used to link to their spot by NAME only, so a spot renamed on one
 * device detached every catch the other device logged there until the
 * rename's rewrite reached that log — and a merge could bring back an entry
 * still carrying the old name. A catch now also carries the spot's id.
 */
describe('findCatchLocation — by id', () => {
  it('follows the id when the stored name is out of date (renamed on another device)', () => {
    expect(findCatchLocation(entry({ locationId: 'l1', locationName: 'Strandvejen' }), LOCS)?.id).toBe('l1')
    expect(scoreBlocker(entry({ locationId: 'l1', locationName: 'Strandvejen' }), LOCS)).toBeNull()
  })

  it('prefers the id over a name that now belongs to another spot', () => {
    expect(findCatchLocation(entry({ locationId: 'l2', locationName: 'Dragør mole' }), LOCS)?.id).toBe('l2')
  })

  it('falls back to the name when the linked spot is gone', () => {
    expect(findCatchLocation(entry({ locationId: 'deleted', locationName: 'Tejn mole' }), LOCS)?.id).toBe('l2')
    expect(findCatchLocation(entry({ locationId: 'deleted', locationName: 'Nowhere' }), LOCS)).toBeUndefined()
  })
})

describe('linkCatchLocation (saving the form)', () => {
  it('links the saved spot the typed name matches, by the same rule', () => {
    expect(linkCatchLocation(' dragør MOLE', LOCS)).toBe('l1')
    expect(linkCatchLocation('Somewhere else', LOCS)).toBeUndefined()
    expect(linkCatchLocation('', LOCS)).toBeUndefined()
  })

  it('follows a name changed while editing', () => {
    expect(linkCatchLocation('Tejn mole', LOCS, entry({ locationId: 'l1', locationName: 'Dragør mole' }))).toBe('l2')
    expect(linkCatchLocation('Free text', LOCS, entry({ locationId: 'l1', locationName: 'Dragør mole' }))).toBeUndefined()
  })

  it('keeps the link of an edited entry whose name was left alone, however out of date', () => {
    // The spot was renamed on the phone; this device's copy of the catch still says the old name.
    expect(linkCatchLocation('Strandvejen', LOCS, entry({ locationId: 'l1', locationName: 'Strandvejen' }))).toBe('l1')
    // …and keeps it even when that old name now matches a different spot.
    expect(linkCatchLocation('Tejn mole', LOCS, entry({ locationId: 'l1', locationName: 'Tejn mole' }))).toBe('l1')
  })

  it('does not keep a link to a spot that is gone', () => {
    expect(linkCatchLocation('Strandvejen', LOCS, entry({ locationId: 'deleted', locationName: 'Strandvejen' }))).toBeUndefined()
  })

  // The edit form opens on the linked spot's CURRENT name (catchPlaceName).
  // Re-resolved by that name, the link went to the first spot of that name —
  // not necessarily this catch's — just for opening and saving the entry.
  it("keeps the link when the field shows the linked spot's current name, even one another spot shares", () => {
    const twins = [...LOCS, { id: 'l3', name: 'Dragør mole', lat: 55.6, lon: 12.69 }]
    expect(linkCatchLocation('Dragør mole', twins, entry({ locationId: 'l3', locationName: 'Strandvejen' }))).toBe('l3')
  })
})

/**
 * A catch logged offline under a spot's old name, after another device
 * renamed it, is linked to the spot by id but kept its old name: the rename's
 * rewrite of the log ran before that catch existed. The list said "📍
 * Strandvejen" for a catch that scores at "Dragør mole".
 */
describe('catchPlaceName (what a catch shows as its place)', () => {
  it("shows the linked spot's current name when the stored one is out of date", () => {
    expect(catchPlaceName(entry({ locationId: 'l1', locationName: 'Strandvejen' }), LOCS)).toBe('Dragør mole')
  })

  it('shows the stored text for free text, a name-only link, and a link to a spot that is gone', () => {
    expect(catchPlaceName(entry({ locationName: 'Ved broen' }), LOCS)).toBe('Ved broen')
    expect(catchPlaceName(entry({ locationName: 'dragør MOLE' }), LOCS)).toBe('dragør MOLE')
    expect(catchPlaceName(entry({ locationId: 'deleted', locationName: 'Strandvejen' }), LOCS)).toBe('Strandvejen')
    expect(catchPlaceName(entry({ locationName: '' }), LOCS)).toBe('')
  })
})
