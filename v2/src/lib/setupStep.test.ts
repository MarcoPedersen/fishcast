import { describe, expect, it } from 'vitest'
import { firstMissingStep } from './setupStep'

/**
 * The first step a setup lacks, where Find pladser's and Målarter's way on
 * leads: its time windows first (Tidsvinduer, step 1), then a spot
 * (Lokationer). None with both, a whole setup.
 */
describe('firstMissingStep', () => {
  const spot = {}
  const window1 = {}

  it('no time windows: Tidsvinduer, whatever spots there are', () => {
    expect(firstMissingStep({ availability: [], locations: [] })).toBe('availability')
    expect(firstMissingStep({ availability: [], locations: [spot] })).toBe('availability')
  })

  it('time windows but no spot: Lokationer', () => {
    expect(firstMissingStep({ availability: [window1], locations: [] })).toBe('locations')
  })

  it('both: none', () => {
    expect(firstMissingStep({ availability: [window1], locations: [spot] })).toBeNull()
  })
})
