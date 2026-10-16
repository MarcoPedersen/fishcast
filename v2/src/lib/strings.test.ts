import { describe, it, expect } from 'vitest'
import { STRINGS } from './strings'

// Guards the real maintenance risk in the i18n table: a key added to one
// language but not the other (silent Danish fallback), or an empty value.
describe('STRINGS i18n table', () => {
  const langs = Object.keys(STRINGS)

  it('provides both da and en', () => {
    expect(langs).toContain('da')
    expect(langs).toContain('en')
  })

  it('da and en cover exactly the same keys', () => {
    const da = new Set(Object.keys(STRINGS.da))
    const en = new Set(Object.keys(STRINGS.en))
    const missingInEn = [...da].filter((k) => !en.has(k)).sort()
    const missingInDa = [...en].filter((k) => !da.has(k)).sort()
    expect({ missingInEn, missingInDa }).toEqual({ missingInEn: [], missingInDa: [] })
  })

  it('has no empty values', () => {
    const empties: string[] = []
    for (const l of langs) {
      for (const [k, v] of Object.entries(STRINGS[l])) {
        if (typeof v !== 'string' || v.trim() === '') empties.push(`${l}.${k}`)
      }
    }
    expect(empties).toEqual([])
  })
})

/**
 * Regression: 241 of 786 keys were v1 leftovers that nothing in v2 read — the
 * v1 welcome, water-type, spot-finder and score-modal screens were never
 * ported, but their strings were, and they shipped in the main bundle on every
 * load. Some quoted a scoring model that no longer exists (fac_solunar_desc
 * promised "+30" for a major period; the model gives up to +18). Nothing
 * failed, so nobody noticed. This fails as soon as a key stops being used.
 */
describe('every key is used by the app', () => {
  // Production sources only: a key that only a test mentions still ships
  // unused. strings.ts is the table itself; this file names the patterns.
  const sources = import.meta.glob<string>(
    ['/src/**/*.{ts,vue}', '!/src/**/*.test.ts', '!/src/test/**', '!/src/test-setup.ts', '!/src/lib/strings.ts'],
    { query: '?raw', import: 'default', eager: true },
  )
  const corpus = Object.values(sources).join('\n')
  // Whole words, so 'log_total' is not "used" by 'log_total_one'. Deliberately
  // loose otherwise: a key that also appears as an identifier or in a comment
  // counts as used (cancel, sunrise, points…), so this can miss a dead key,
  // but every key it flags is one that no source file names at all.
  const words = new Set(corpus.match(/[\p{L}\p{N}_]+/gu) ?? [])

  // Keys the app builds at runtime, so they never appear whole in the source.
  // `literal` is the construction as written at the call site; a prefix
  // covers whatever the expression can append — the conservative reading, so
  // 'wind_' + wt.dir keeps every wind_* key alive, not just the trend labels.
  const DYNAMIC: { literal: string; matches: (key: string) => boolean; site: string }[] = [
    { literal: "'day' +", matches: (k) => k.startsWith('day'), site: 'weekday names — Dashboard, CatchLog, Availability, mapPopups' },
    { literal: "'month' +", matches: (k) => k.startsWith('month'), site: 'month names — Dashboard, CatchLog, SeasonsTab' },
    { literal: "'bft_' +", matches: (k) => k.startsWith('bft_'), site: 'Beaufort labels — conditions.ts beaufort()' },
    { literal: "'uc_' +", matches: (k) => k.startsWith('uc_'), site: 'undercurrent level — ConditionsTab' },
    { literal: "'press_' +", matches: (k) => k.startsWith('press_'), site: 'pressure-trend label — scoring.ts' },
    { literal: "'wind_' +", matches: (k) => k.startsWith('wind_'), site: 'wind-trend label — scoring.ts' },
    { literal: "'spottype_' +", matches: (k) => k.startsWith('spottype_'), site: 'official spot type — spotfinder.ts' },
    { literal: "'method_' +", matches: (k) => k.startsWith('method_'), site: 'fishing method — Availability, CatchLog' },
    { literal: "'tab_' +", matches: (k) => k.startsWith('tab_'), site: 'dashboard tab names — DashboardView' },
    { literal: "'tip_' +", matches: (k) => k.startsWith('tip_'), site: 'species tackle tip — lures.ts' },
    // t(b.key + '_why') in the score modal: b.key is a breakdown row's own
    // i18n key, so X_why stays while X itself is used.
    { literal: "+ '_why'", matches: (k) => k.endsWith('_why') && words.has(k.slice(0, -4)), site: 'score-modal explanations — DashboardView' },
  ]

  it('reads the app sources, without the table itself', () => {
    // Had the exclusion stopped working, every key would find itself in
    // strings.ts and pass; had the glob matched nothing, every key would fail
    // with a list that points at the wrong problem.
    const paths = Object.keys(sources)
    expect(paths.length).toBeGreaterThan(50)
    expect(paths.some((p) => p.endsWith('.vue'))).toBe(true)
    expect(paths.filter((p) => p.endsWith('/strings.ts') || p.endsWith('.test.ts'))).toEqual([])
  })

  it('every dynamic pattern still has its call site', () => {
    // Drop the entry when the construction goes, or it shields dead keys.
    expect(DYNAMIC.filter((d) => !corpus.includes(d.literal)).map((d) => `${d.literal} (${d.site})`)).toEqual([])
  })

  it('every key appears in the app sources or is built by a dynamic pattern', () => {
    const unused = Object.keys(STRINGS.da).filter((k) => !words.has(k) && !DYNAMIC.some((d) => d.matches(k)))
    expect(unused).toEqual([])
  })
})
