import { describe, it, expect } from 'vitest'
import { summariseCatchScores, verdictKey, MIN_MEANINGFUL } from './catchInsights'

describe('summariseCatchScores', () => {
  it('returns null with no scores', () => {
    expect(summariseCatchScores([])).toBeNull()
  })

  it('counts each score into the right band', () => {
    const s = summariseCatchScores([85, 70, 50, 20])!
    expect(s.bands).toEqual({ great: 1, good: 1, mid: 1, poor: 1 })
  })

  it('uses the same band edges as the score colours (80 / 65 / 45)', () => {
    expect(summariseCatchScores([80])!.bands.great).toBe(1)
    expect(summariseCatchScores([79])!.bands.good).toBe(1)
    expect(summariseCatchScores([65])!.bands.good).toBe(1)
    expect(summariseCatchScores([64])!.bands.mid).toBe(1)
    expect(summariseCatchScores([45])!.bands.mid).toBe(1)
    expect(summariseCatchScores([44])!.bands.poor).toBe(1)
  })

  it('averages and computes the high share', () => {
    const s = summariseCatchScores([80, 60])!
    expect(s.avg).toBe(70)
    expect(s.highShare).toBe(0.5)
  })

  it('flags a thin sample below the meaningful threshold', () => {
    expect(summariseCatchScores([70, 70])!.thin).toBe(true)
    expect(summariseCatchScores(Array(MIN_MEANINGFUL).fill(70))!.thin).toBe(false)
  })

  it('ignores NaN entries', () => {
    expect(summariseCatchScores([70, NaN, 80])!.n).toBe(2)
  })
})

describe('verdictKey', () => {
  const sum = (scores: number[]) => summariseCatchScores(scores)!

  it('reports a thin sample before judging predictiveness', () => {
    expect(verdictKey(sum([90, 90]))).toBe('insight_thin')
  })

  it('calls it strong when most catches land on good-or-better scores', () => {
    expect(verdictKey(sum([90, 85, 80, 70, 30]))).toBe('insight_strong')
  })

  it('calls it mixed in the middle', () => {
    expect(verdictKey(sum([90, 70, 40, 30, 20]))).toBe('insight_mixed')
  })

  it('calls it weak when catches mostly happen on low scores', () => {
    expect(verdictKey(sum([40, 30, 20, 25, 35]))).toBe('insight_weak')
  })
})
