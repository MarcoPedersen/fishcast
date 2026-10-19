import { describe, it, expect } from 'vitest'
import { STRINGS } from './strings'
import type { SafetyRec } from './conditions'
import type { FishingMethod } from './types'

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

  // The values a runtime-built key can end in, for the `builds` lists below.
  // Every member of a union type, checked by the compiler both ways: a value
  // added to the type, or dropped from it, fails typecheck here.
  const allOf = <K extends string>(members: Record<K, true>) => Object.keys(members) as K[]
  // The quoted items of `const NAME = [ … ]` or `new Set([ … ])` in a source,
  // for a list the test cannot import (DashboardView's TABS lives in <script
  // setup>, spotfinder's SPOT_TYPES is module-private). A parse that finds
  // nothing leaves an empty list, which the builds test fails on.
  const listIn = (path: string, name: string) => {
    const m = sources[path]?.match(new RegExp(String.raw`\bconst ${name}\b[^=]*=\s*(?:new Set\()?\[([^\]]*)\]`))
    return m ? [...m[1].matchAll(/'([^']*)'/g)].map((q) => q[1]) : []
  }
  const range = (n: number) => Array.from({ length: n }, (_, i) => i)
  const built = (prefix: string, values: readonly (string | number)[]) => values.map((v) => prefix + v)
  const TRENDS = ['rising', 'stable', 'falling'] // pressureTrend() / windTrend() in scoring.ts

  // Keys the app builds at runtime, so they never appear whole in the source.
  // `literal` is the construction as written at the call site; a prefix
  // covers whatever the expression can append — the conservative reading, so
  // 'wind_' + wt.dir keeps every wind_* key alive, not just the trend labels.
  // `builds` is every key the expression can produce, each of which must
  // exist; null where another check owns that, as noted on the entry.
  const DYNAMIC: { literal: string; matches: (key: string) => boolean; site: string; builds: string[] | null }[] = [
    // getDay() / getUTCDay(); getMonth() or a 1-based month - 1.
    { literal: "'day' +", matches: (k) => k.startsWith('day'), site: 'weekday names — Dashboard, CatchLog, Availability, mapPopups', builds: built('day', range(7)) },
    { literal: "'month' +", matches: (k) => k.startsWith('month'), site: 'month names — Dashboard, CatchLog, SeasonsTab', builds: built('month', range(12)) },
    { literal: "'bft_' +", matches: (k) => k.startsWith('bft_'), site: 'Beaufort labels — conditions.ts beaufort()', builds: built('bft_', range(13)) },
    {
      literal: "'uc_' +", matches: (k) => k.startsWith('uc_'), site: 'undercurrent level — ConditionsTab',
      builds: built('uc_', allOf<SafetyRec['undercurrent']>({ negligible: true, low: true, moderate: true, strong: true })),
    },
    { literal: "'press_' +", matches: (k) => k.startsWith('press_'), site: 'pressure-trend label — scoring.ts', builds: built('press_', TRENDS) },
    { literal: "'wind_' +", matches: (k) => k.startsWith('wind_'), site: 'wind-trend label — scoring.ts', builds: built('wind_', TRENDS) },
    { literal: "'spottype_' +", matches: (k) => k.startsWith('spottype_'), site: 'official spot type — spotfinder.ts', builds: built('spottype_', listIn('/src/lib/spotfinder.ts', 'SPOT_TYPES')) },
    {
      literal: "'method_' +", matches: (k) => k.startsWith('method_'), site: 'fishing method — Availability, CatchLog',
      builds: built('method_', allOf<FishingMethod>({ shore: true, boat: true, waders: true })),
    },
    { literal: "'tab_' +", matches: (k) => k.startsWith('tab_'), site: 'dashboard tab names — DashboardView', builds: built('tab_', listIn('/src/views/DashboardView.vue', 'TABS')) },
    // lures.ts looks the key up in STRINGS.da first and skips a species
    // without a tip, so a missing one is a choice, not a raw key on screen.
    { literal: "'tip_' +", matches: (k) => k.startsWith('tip_'), site: 'species tackle tip — lures.ts', builds: null },
    // t(b.key + '_why') in the score modal: b.key is a breakdown row's own
    // i18n key, so X_why stays while X itself is used. The rows come from
    // scoring.ts, and scoring.test.ts checks X and X_why for the rows a storm
    // and a perfect day produce.
    { literal: "+ '_why'", matches: (k) => k.endsWith('_why') && words.has(k.slice(0, -4)), site: 'score-modal explanations — DashboardView', builds: null },
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

  // The sources with comments removed and strings kept: a comment that
  // mentions a construction is not a call site. Quote-aware, so the '//' in
  // 'https://…' survives. It is no tokenizer, and it can misread both ways.
  // A '//' inside a regex literal drops the rest of its line, so a real call
  // site can look missing. For the dynamic call-site check that is a loud
  // failure; for the missing-key check further down it would hide a t('key')
  // and pass silently, so that check reads the raw text too. A quote or
  // backtick it takes for the start of a string (one in a regex, an
  // apostrophe in template text) keeps the comment after it as code, so a
  // commented-out construction can pass for a call site: a silent failure of
  // the dynamic check (the missing-key check only gets stricter). A ' or "
  // misread ends at the newline and keeps at most the rest of its line; a `
  // misread runs on to the next backtick, and the test below fails if it
  // keeps a whole comment line or an HTML comment. A false pass is still
  // possible, but only through a trailing comment (one after code on its
  // line) that follows a stray quote.
  function stripComments(src: string): string {
    let out = ''
    let quote = ''
    for (let i = 0; i < src.length; i++) {
      const c = src[i]
      if (quote) {
        out += c
        if (c === '\\') out += src[++i] ?? ''
        else if (c === quote || (c === '\n' && quote !== '`')) quote = ''
      } else if (src.startsWith('//', i)) {
        const end = src.indexOf('\n', i)
        if (end < 0) break
        i = end - 1 // the newline itself is kept on the next pass
      } else if (src.startsWith('/*', i) || src.startsWith('<!--', i)) {
        const close = c === '/' ? '*/' : '-->'
        const end = src.indexOf(close, i + 2)
        if (end < 0) break
        out += ' '
        i = end + close.length - 1
      } else {
        if (c === "'" || c === '"' || c === '`') quote = c
        out += c
      }
    }
    return out
  }
  // Per file, so a comment left open at the end of one cannot swallow the next.
  const code = Object.values(sources).map(stripComments).join('\n')

  // Lines of stripped text that are still comments: the trace of a misread.
  const commentLines = (stripped: string) =>
    stripped.split('\n').map((l) => l.trim()).filter((l) => /^(?:\/\/|\/\*)|<!--/.test(l))

  it('the stripper leaves no comment line behind', () => {
    // A backtick in a regex (/`/) opens a "template string" that keeps every
    // comment up to the next backtick, across lines: with a commented-out
    // "// t('tab_' + id)" below one, the call-site check stayed green after
    // DashboardView's real call was removed, and the tab_* keys stayed
    // shielded. An apostrophe in template prose does the same to an HTML
    // comment later on its line.
    const found = Object.entries(sources).flatMap(([path, src]) => commentLines(stripComments(src)).map((l) => `${path}: ${l}`))
    expect(found).toEqual([])
    expect(commentLines(stripComments("const tick = /`/\n// t('tab_' + id)\n"))).toEqual(["// t('tab_' + id)"])
    expect(commentLines(stripComments("<p>Don't panic</p> <!-- t('day' + n) -->"))).toHaveLength(1)
  })

  const missingCallSites = (src: string) =>
    DYNAMIC.filter((d) => !src.includes(d.literal)).map((d) => `${d.literal} (${d.site})`)

  it('every dynamic pattern still has its call site', () => {
    // Drop the entry when the construction goes, or it shields dead keys.
    expect(missingCallSites(code)).toEqual([])
  })

  it('a comment is not a call site', () => {
    // Regression: scoring.ts explains the score modal in a comment ("…via
    // t(key + '_why')"), and that comment alone satisfied the '_why' entry.
    // Had the real t(b.key + '_why') in DashboardView gone, the 16 bd_*_why /
    // fac_*_why keys would have shipped dead with this check still green.
    const commentsOnly = [
      "    // and the modal shows its explanation via t(key + '_why').",
      ...DYNAMIC.map((d, i) => [`// ${d.literal}`, `/* ${d.literal} */`, `<!-- ${d.literal} -->`][i % 3]),
    ].join('\n')
    expect(missingCallSites(stripComments(commentsOnly))).toEqual(DYNAMIC.map((d) => `${d.literal} (${d.site})`))
    // …while '//' inside a string is not a comment: a URL earlier on the line
    // must not hide the call after it.
    const stringsThenCall = "const u = 'https://x.dk', s = \"a//b\", w = html`${t('day' + n)} //`; t('tab_' + id)"
    expect(stripComments(stringsThenCall)).toBe(stringsThenCall)
  })

  it('every key a dynamic pattern builds exists in both languages', () => {
    // The missing-key check further down sees only whole literal keys, so it
    // cannot see these. Dropping tab_map, day3, month7, uc_low, method_boat,
    // spottype_pier, bft_5 and wind_falling from both tables left the whole
    // suite green, while the app would have shown "tab_map" as a dashboard
    // tab, "day3" for every Wednesday and "month7" for August.
    expect(DYNAMIC.filter((d) => d.builds?.length === 0).map((d) => `${d.literal} (${d.site})`)).toEqual([])
    const missing = DYNAMIC.flatMap((d) => d.builds ?? []).flatMap((k) =>
      ['da', 'en'].filter((l) => !Object.hasOwn(STRINGS[l], k)).map((l) => `${l}.${k}`))
    expect(missing.sort()).toEqual([])
  })

  it('every key appears in the app sources or is built by a dynamic pattern', () => {
    const unused = Object.keys(STRINGS.da).filter((k) => !words.has(k) && !DYNAMIC.some((d) => d.matches(k)))
    expect(unused).toEqual([])
  })

  // The other direction. t() renders a missing key as its own name, so
  // deleting a key that is still called — a cleanup that misjudges one as
  // dead, or a merge with a branch that still calls a key this one dropped —
  // puts "rename" on a button with every test green: the checks above only
  // ask whether a key is used, never whether a used key exists.
  //
  // The literals in an expression that are whole keys: the whole argument, or
  // a branch of a ternary. Not the 'day' of 'day' + n (a prefix), nor the
  // 'low' of level === 'low' ? … (a value the key is chosen by).
  const wholeKeys = (expr: string) =>
    [...expr.matchAll(/(?<=(?:^|[(:?])\s*)(['"])(\w+)\1(?=\s*(?:$|[):]))/g)].map((m) => m[2])
  // The argument text of every fn(…) call, parens balanced.
  function callArgs(src: string, fn: string): string[] {
    const args: string[] = []
    for (const m of src.matchAll(new RegExp(String.raw`\b${fn}\(`, 'g'))) {
      const start = m.index + m[0].length
      let i = start
      let quote = ''
      for (let depth = 1; i < src.length && depth > 0; i++) {
        const c = src[i]
        if (quote) {
          if (c === '\\') i++
          else if (c === quote) quote = ''
        } else if (c === "'" || c === '"' || c === '`') quote = c
        else if (c === '(') depth++
        else if (c === ')') depth--
      }
      args.push(src.slice(start, i - 1))
    }
    return args
  }
  // Calls that take a key: t(), solunar's tr() wrapper, App's
  // refreshOnResume(reasonKey) for the resume toast, and the wader notes that
  // ConditionsTab hands to t(n). Fields that hold one for a later t():
  // labelKey (the safety verdicts) and nameKey/reasonKey (lure colours).
  // Keys a function returns are not seen here; the breakdown rows, the auth
  // errors and the catch-insight verdicts have their own checks in
  // scoring.test.ts, auth.test.ts and catchInsights.test.ts.
  //
  // Read in the raw sources as well as the stripped ones. The stripper can drop
  // a real call (a '//' in a regex literal takes the rest of its line), and
  // here that is a silent pass; the raw text cannot hide one. What the raw text
  // adds is a commented-out t('old_key'), which then has to exist too: a loud
  // failure, the safe way round. The stripped copy still finds a key that a
  // comment inside the call would hide from the raw reading.
  const namedIn = (srcs: string[]) => new Set([...srcs, ...srcs.map(stripComments)].flatMap((src) => [
    ...['t', 'tr', 'refreshOnResume', String.raw`notes\.push`].flatMap((fn) => callArgs(src, fn)).flatMap(wholeKeys),
    ...[...src.matchAll(/\b(?:labelKey|nameKey|reasonKey)\s*:\s*([^,}\n]+)/g)].flatMap((m) => wholeKeys(m[1].trim())),
  ]))
  const named = namedIn(Object.values(sources))

  it('finds the keys the app names', () => {
    // Had the collector stopped matching, the check below would pass on an
    // empty list. One key from each kind of site above.
    expect(named.size).toBeGreaterThan(300)
    const samples = ['rename', 'fav_add', 'fav_remove', 'conf_low', 'sol_culm', 'toast_back_online', 'rec_note_mud', 'rec_wader_mud', 'rec_shore_caution', 'lure_reason_pink']
    expect(samples.filter((k) => !named.has(k))).toEqual([])
    // …and nothing that is only part of a key, or a value compared on the way.
    expect(['day', 'month', 'tab_', '_why', 'low', 'lower', 'strong'].filter((k) => named.has(k))).toEqual([])
  })

  it('a regex literal does not hide a key named after it', () => {
    // The stripper takes the '//' of /\//g for a comment and drops the rest
    // of the line. share.ts has that regex; a t('zz_missing_key') appended to
    // its line left every test here green, while the app would have shown
    // "zz_missing_key". The same call placed before the regex was caught.
    const line = "    .replace(/\\+/g, '-').replace(/\\//g, '_') + t('zz_missing_key')"
    expect(stripComments(line)).not.toContain('zz_missing_key')
    expect(namedIn([line]).has('zz_missing_key')).toBe(true)
  })

  it('every key the app names exists in both languages', () => {
    const missing = [...named].flatMap((k) =>
      ['da', 'en'].filter((l) => !Object.hasOwn(STRINGS[l], k)).map((l) => `${l}.${k}`))
    expect(missing.sort()).toEqual([])
  })
})
