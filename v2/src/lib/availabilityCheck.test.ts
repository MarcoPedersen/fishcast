import { describe, it, expect } from 'vitest'
import { availabilityBlockers, endsAtMidnight, timeIssue } from './availabilityCheck'
import type { Availability } from './types'

const win = (from: string, to: string, days: number[]): Availability =>
  ({ id: from + to + days.join(), days, from, to, methods: ['shore'] })

describe('availabilityBlockers', () => {
  it('blocks a window with no days, even an overnight one', () => {
    // 22:00–02:00 with every day un-ticked showed only "Overnight window —
    // that's fine", Next stayed enabled, and the window never scored.
    expect(availabilityBlockers([win('22:00', '02:00', [])])).toEqual({ sameTime: 0, noTime: 0, noDays: 1 })
    expect(availabilityBlockers([win('06:00', '12:00', [])])).toEqual({ sameTime: 0, noTime: 0, noDays: 1 })
  })

  it('counts zero-length windows separately', () => {
    expect(availabilityBlockers([win('06:00', '06:00', [6]), win('06:00', '12:00', [0])]))
      .toEqual({ sameTime: 1, noTime: 0, noDays: 0 })
  })

  // The round J review: a cleared time field counted as a zero-length
  // window, and the editor said start and end must not be the same, though
  // one of them was not there at all.
  it('counts a window with a time cleared apart from a zero-length one', () => {
    expect(availabilityBlockers([win('', '09:00', [1]), win('06:00', '', [1]), win('', '', [1]), win('06:00', '06:00', [1])]))
      .toEqual({ sameTime: 1, noTime: 3, noDays: 0 })
  })

  it('a legacy row without days counts as having none', () => {
    const legacy = { id: 'x', from: '06:00', to: '09:00', methods: ['shore'] } as unknown as Availability
    expect(availabilityBlockers([legacy]).noDays).toBe(1)
  })

  // `!a.days?.length` read a string's length as ticked days, so a garbled
  // "0123" row passed as complete while getScoredWindows could never match it.
  it('a row whose days is not a list counts as having none', () => {
    const garbled = { id: 'x', days: '0123', from: '06:00', to: '09:00', methods: ['shore'] } as unknown as Availability
    expect(availabilityBlockers([garbled]).noDays).toBe(1)
  })

  it('a row whose times are not strings is blocked as one with a time missing, not a crash', () => {
    const garbled = { id: 'x', days: [1], from: undefined, to: 9, methods: ['shore'] } as unknown as Availability
    expect(availabilityBlockers([garbled])).toEqual({ sameTime: 0, noTime: 1, noDays: 0 })
  })

  it('passes ordinary windows', () => {
    expect(availabilityBlockers([win('22:00', '02:00', [5, 6]), win('06:00', '12:00', [0])]))
      .toEqual({ sameTime: 0, noTime: 0, noDays: 0 })
  })
})

describe('timeIssue', () => {
  it('a time cleared or unreadable is missing; the same time twice is the same', () => {
    expect(['', 'abc', undefined, 9].map((x) => timeIssue(x as string, '09:00'))).toEqual(['missing', 'missing', 'missing', 'missing'])
    expect(timeIssue('06:00', '')).toBe('missing')
    expect(timeIssue('', '')).toBe('missing')
    expect(timeIssue('06:00', '06:00')).toBe('same')
    // Minutes count, as scoring reads them.
    expect(timeIssue('06:00', '6:00')).toBe('same')
  })

  it('has nothing to say of a window scoring can read', () => {
    expect(timeIssue('06:00', '12:00')).toBeNull()
    expect(timeIssue('22:00', '02:00')).toBeNull()
    expect(timeIssue('22:00', '00:00')).toBeNull()
    expect(timeIssue('17:00', '17:45')).toBeNull()
  })
})

// The round J review: 22:00–00:00 got the night note, "ends the next
// morning". It ends at midnight.
describe('endsAtMidnight', () => {
  it('a window that ends at 00:00', () => {
    expect(endsAtMidnight('22:00', '00:00')).toBe(true)
    expect(endsAtMidnight('18:30', '0:00')).toBe(true)
  })

  it('not one that ends later in the night, or by day, or can not be scored', () => {
    expect(endsAtMidnight('22:00', '00:30')).toBe(false)
    expect(endsAtMidnight('22:00', '02:00')).toBe(false)
    expect(endsAtMidnight('06:00', '12:00')).toBe(false)
    expect(endsAtMidnight('00:00', '00:00')).toBe(false)
    expect(endsAtMidnight('', '00:00')).toBe(false)
  })
})
