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

  it('passes ordinary windows', () => {
    expect(availabilityBlockers([win('22:00', '02:00', [5, 6]), win('06:00', '12:00', [0])]))
      .toEqual({ badTime: 0, noDays: 0 })
  })
})
