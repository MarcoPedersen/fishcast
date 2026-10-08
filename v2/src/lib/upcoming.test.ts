import { describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { useNotEnded, windowEndMs, windowKey } from './upcoming'
import type { ScoredWindow } from './types'

// Danish local time (CEST/CET), whatever the machine running the tests uses.
vi.stubEnv('TZ', 'Europe/Copenhagen')

const loc = { id: 'l1', name: 'Tejn mole', lat: 55.25, lon: 14.83 }
/** A window on local calendar day `day` of October 2026, in the app's day encoding. */
function win(day: number, from: string, to: string, score = 60): ScoredWindow {
  return { location: loc, date: new Date(Date.UTC(2026, 9, day)), from, to, score, noData: false, bestHourStr: null, tags: [] }
}
/** Local wall-clock instant in Copenhagen. */
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).getTime()

describe('windowEndMs', () => {
  it('ends on its own day at the local end time', () => {
    expect(windowEndMs(win(2, '05:00', '10:00'))).toBe(at(2, 10))
    expect(new Date(windowEndMs(win(2, '05:00', '10:00'))).toISOString()).toBe('2026-10-02T08:00:00.000Z')
  })

  it('keeps the minutes', () => {
    expect(windowEndMs(win(2, '06:00', '08:45'))).toBe(at(2, 8, 45))
  })

  it('ends an overnight window the next morning', () => {
    expect(windowEndMs(win(2, '22:00', '02:00'))).toBe(at(3, 2))
    expect(windowEndMs(win(31, '23:00', '00:30'))).toBe(new Date(2026, 10, 1, 0, 30).getTime())
  })
})

describe('useNotEnded', () => {
  function setup(nowMs: number, list: ScoredWindow[]) {
    const now = ref(nowMs)
    const windows = ref(list)
    const scope = effectScope()
    const upcoming = scope.run(() => useNotEnded(() => windows.value, () => now.value))!
    return { now, windows, upcoming, scope }
  }

  /**
   * Regression: availability 05:00–10:00 daily, horizon "I dag", 15:00 —
   * the hero still read "🏆 Dagens bedste · 05:00–10:00 · 78", advice to fish
   * a session that ended five hours ago.
   */
  it('drops windows that have already ended', () => {
    const morning = win(2, '05:00', '10:00', 78)
    const evening = win(2, '17:00', '21:00', 55)
    const tomorrow = win(3, '05:00', '10:00', 70)
    const { upcoming, scope } = setup(at(2, 15), [morning, tomorrow, evening])
    expect(upcoming.value).toEqual([tomorrow, evening])
    scope.stop()
  })

  it('keeps a window that is under way', () => {
    const w = win(2, '14:00', '18:00')
    const { upcoming, now, scope } = setup(at(2, 15), [w])
    expect(upcoming.value).toEqual([w])
    now.value = at(2, 18)
    expect(upcoming.value).toEqual([])
    scope.stop()
  })

  it('keeps an overnight window until it ends the next morning', () => {
    const night = win(2, '22:00', '02:00')
    const { upcoming, now, scope } = setup(at(3, 0, 30), [night])
    expect(upcoming.value).toEqual([night])
    now.value = at(3, 2)
    expect(upcoming.value).toEqual([])
    scope.stop()
  })

  /** The map tab re-renders its pins whenever the array it's handed changes. */
  it('hands out the same array while the clock ticks without a window ending', () => {
    const list = [win(2, '05:00', '10:00'), win(2, '17:00', '21:00'), win(3, '05:00', '10:00')]
    const { upcoming, now, scope } = setup(at(2, 15), list)
    const first = upcoming.value
    for (let m = 1; m <= 90; m++) {
      now.value = at(2, 15) + m * 60_000
      expect(upcoming.value).toBe(first)
    }
    now.value = at(2, 21)
    expect(upcoming.value).not.toBe(first)
    expect(upcoming.value).toHaveLength(1)
    scope.stop()
  })

  it('follows a new list', () => {
    const { upcoming, windows, scope } = setup(at(2, 15), [win(2, '05:00', '10:00')])
    expect(upcoming.value).toEqual([])
    const later = win(2, '16:00', '18:00')
    windows.value = [later]
    expect(upcoming.value).toEqual([later])
    scope.stop()
  })
})

describe('windowKey', () => {
  /**
   * Regression: "every day 06:00–09:00" plus "Sat+Sun 06:00–14:00" gave two
   * Saturday cards one key, so 💡 / 🎯 / 🔗 on one toggled both.
   */
  it('tells apart windows that share a start but not an end', () => {
    expect(windowKey(win(3, '06:00', '09:00'))).not.toBe(windowKey(win(3, '06:00', '14:00')))
  })

  it('is the same for the same slot on a fresh recompute', () => {
    expect(windowKey(win(3, '06:00', '09:00'))).toBe(windowKey(win(3, '06:00', '09:00')))
  })
})
