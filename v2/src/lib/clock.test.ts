import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { localDayUTC, useNow } from './clock'

// Danish local time (CEST/CET), whatever the machine running the tests uses.
vi.stubEnv('TZ', 'Europe/Copenhagen')

describe('localDayUTC', () => {
  /**
   * Regression: the dashboard took "today" from the UTC date, which is still
   * yesterday from 00:00 to 01:00/02:00 in Denmark — so at 00:30 on a Friday,
   * "I dag" listed Thursday's windows and the week strip began on Thursday.
   */
  it('is the local calendar day just after local midnight', () => {
    const fri0030 = Date.UTC(2026, 9, 1, 22, 30) // Fri 2 Oct 00:30 CEST
    expect(localDayUTC(fri0030)).toBe(Date.UTC(2026, 9, 2))
    expect(new Date(localDayUTC(fri0030)).getUTCDay()).toBe(5) // Friday
  })

  it('is the local calendar day just before local midnight', () => {
    const thu2330 = Date.UTC(2026, 9, 1, 21, 30) // Thu 1 Oct 23:30 CEST
    expect(localDayUTC(thu2330)).toBe(Date.UTC(2026, 9, 1))
  })

  it('steps whole days, even across the end of summer time', () => {
    const sat2330 = Date.UTC(2026, 9, 24, 21, 30) // Sat 24 Oct 23:30 CEST; DST ends Sun 03:00
    expect(localDayUTC(sat2330, 1) - localDayUTC(sat2330)).toBe(86_400_000)
    expect(localDayUTC(sat2330, 2)).toBe(Date.UTC(2026, 9, 26))
  })
})

describe('useNow', () => {
  let onVis: (() => void) | null
  const doc = {
    hidden: false,
    addEventListener: (_: string, fn: () => void) => { onVis = fn },
    removeEventListener: (_: string, fn: () => void) => { if (onVis === fn) onVis = null },
  }
  beforeEach(() => {
    onVis = null
    doc.hidden = false
    vi.useFakeTimers()
    vi.setSystemTime(Date.UTC(2026, 9, 2, 6, 0))
    vi.stubGlobal('document', doc)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('ticks, so time-dependent computeds don\'t freeze', () => {
    const scope = effectScope()
    const now = scope.run(() => useNow(60_000))!
    const t0 = now.value
    vi.advanceTimersByTime(60_000)
    expect(now.value).toBe(t0 + 60_000)
    scope.stop()
  })

  it('catches up as soon as the page is visible again', () => {
    const scope = effectScope()
    const now = scope.run(() => useNow(60_000))!
    // A throttled background tab: the clock moved on, the interval didn't fire
    vi.setSystemTime(Date.UTC(2026, 9, 2, 9, 0))
    doc.hidden = false
    onVis!()
    expect(now.value).toBe(Date.UTC(2026, 9, 2, 9, 0))
    scope.stop()
  })

  it('stops ticking and listening with its component', () => {
    const scope = effectScope()
    const now = scope.run(() => useNow(60_000))!
    scope.stop()
    const t0 = now.value
    vi.advanceTimersByTime(5 * 60_000)
    expect(now.value).toBe(t0)
    expect(onVis).toBeNull()
  })
})
