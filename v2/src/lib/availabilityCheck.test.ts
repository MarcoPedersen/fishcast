import { describe, it, expect } from 'vitest'
import { availabilityBlockers } from './availabilityCheck'
import type { Availability } from './types'

const win = (from: string, to: string, days: number[]): Availability =>
  ({ id: from + to + days.join(), days, from, to, methods: ['shore'] })

describe('availabilityBlockers', () => {
  it('blocks a window with no days, even an overnight one', () => {
    // 22:00–02:00 with every day un-ticked showed only "Overnight window —
    // that's fine", Next stayed enabled, and the window never scored.
    expect(availabilityBlockers([win('22:00', '02:00', [])])).toEqual({ badTime: 0, noDays: 1 })
    expect(availabilityBlockers([win('06:00', '12:00', [])])).toEqual({ badTime: 0, noDays: 1 })
  })

  it('counts zero-length windows separately', () => {
    expect(availabilityBlockers([win('06:00', '06:00', [6]), win('06:00', '12:00', [0])]))
      .toEqual({ badTime: 1, noDays: 0 })
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

  it('a row whose times are not strings is blocked, not a crash', () => {
    const garbled = { id: 'x', days: [1], from: undefined, to: 9, methods: ['shore'] } as unknown as Availability
    expect(availabilityBlockers([garbled])).toEqual({ badTime: 1, noDays: 0 })
  })

  it('passes ordinary windows', () => {
    expect(availabilityBlockers([win('22:00', '02:00', [5, 6]), win('06:00', '12:00', [0])]))
      .toEqual({ badTime: 0, noDays: 0 })
  })
})
