/**
 * Aggregate the retrospective bite-scores of logged catches, to see whether the
 * model's score actually lines up with when fish were caught.
 *
 * Pure + side-effect free (the scores are computed elsewhere and passed in) so
 * it can be unit-tested without network or Supabase.
 */
export interface ScoreSummary {
  n: number
  avg: number
  /** Count of catches per score band (same thresholds as scoreColor). */
  bands: { great: number; good: number; mid: number; poor: number }
  /** Share (0–1) of catches that happened at a "good or better" score (>=65). */
  highShare: number
  /** Below this many samples the picture is not meaningful yet. */
  thin: boolean
}

export const MIN_MEANINGFUL = 5

export function summariseCatchScores(scores: number[]): ScoreSummary | null {
  const s = scores.filter((v) => typeof v === 'number' && !Number.isNaN(v))
  if (!s.length) return null

  const bands = { great: 0, good: 0, mid: 0, poor: 0 }
  for (const v of s) {
    if (v >= 80) bands.great++
    else if (v >= 65) bands.good++
    else if (v >= 45) bands.mid++
    else bands.poor++
  }
  const total = s.reduce((a, b) => a + b, 0)
  return {
    n: s.length,
    avg: Math.round(total / s.length),
    bands,
    highShare: (bands.great + bands.good) / s.length,
    thin: s.length < MIN_MEANINGFUL,
  }
}

/**
 * A plain-language verdict key for the summary — deliberately cautious: with a
 * thin sample we say so rather than claiming predictive power.
 */
export function verdictKey(sum: ScoreSummary): string {
  if (sum.thin) return 'insight_thin'
  if (sum.highShare >= 0.6) return 'insight_strong'
  if (sum.highShare >= 0.35) return 'insight_mixed'
  return 'insight_weak'
}
