/**
 * The model-spec v3 gates (§12.2 G1–G6, with the critique's M11: both
 * references). before.json.gz is the model at ed34b06; after.json.gz the
 * model in src/. "Old" is the old model WITH tides, the spec's reference;
 * the old model WITHOUT tides — what the owner actually read while every DMI
 * request failed, until main's 739ea2f — is reported beside it so the owner
 * can choose. Run from v2/:
 *   REPORT=<file> npx vitest run --config scripts/model-check/vitest.config.mjs v3
 */
import { it } from 'vitest'
import fs from 'node:fs'
import { SCORE_WEIGHTS } from '@/lib/scoring'
import { STRINGS } from '@/lib/strings'
import { FIXTURE, HM, LOCS, WINDOWS, cells, readRecords, rowsOf, tsName, type Rec, type RecordFile } from './lib'

declare const process: { env: Record<string, string | undefined> }

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const season = (pi: number) => MONTH[Number(FIXTURE.periods[pi].start.slice(5, 7)) - 1]
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN }
const share = (a: number[], f: (v: number) => boolean) => (a.length ? Math.round((100 * a.filter(f).length) / a.length) : NaN)
const sgn = (n: number) => (n > 0 ? `+${n}` : `${n}`)
const CLAMP = new Set(['bd_floor', 'bd_ceiling'])
const dist = (a: number[]) => `${[0.1, 0.25, 0.5, 0.75, 0.9].map((p) => pct(a, p)).join(' / ')} | ${share(a, (v) => v >= 55)} / ${share(a, (v) => v >= 65)} / ${share(a, (v) => v >= 80)} %`

it('v3', () => {
  const before = readRecords('before'), after = readRecords('after')
  const all = [...cells()]
  const out: string[] = []
  const say = (s = '') => out.push(s)
  const score = (r: Rec) => r[0] as number
  const ok = (i: number) => after.variants.tides[i][0] != null && before.variants.tides[i][0] != null

  const rawOf = (f: RecordFile, r: Rec) => Object.entries(rowsOf(f, r)).filter(([k]) => !CLAMP.has(k)).reduce((a, [, v]) => a + v, 0)
  const curBase = SCORE_WEIGHTS.base
  const coast = (i: number) => LOCS[all[i].si].waterType !== 'fresh'
  const idx = (ts: string[], f: (i: number) => boolean) => all.map((_, i) => i).filter((i) => ok(i) && tsName(all[i].targets) === tsName(ts) && f(i))
  const hm = idx(HM, coast)
  const atBase = (b: number, i: number) => Math.max(0, Math.min(100, rawOf(after, after.variants.tides[i]) + b - curBase))

  // ── §9.3 base search, against both references (M11) ──
  const oldT = hm.map((i) => score(before.variants.tides[i]))
  const oldN = hm.map((i) => score(before.variants.notides[i]))
  say('## Base search (havørred + makrel, coast, pooled)')
  say(`| base | median Δ vs old with tides | vs old without tides | ≥55 / ≥65 / ≥80 % |`)
  const rows = Array.from({ length: 17 }, (_, k) => 16 + k).map((b) => {
    const nw = hm.map((i) => atBase(b, i))
    return { b, medT: pct(nw.map((v, k) => v - oldT[k]), 0.5), medN: pct(nw.map((v, k) => v - oldN[k]), 0.5), nw }
  })
  const pick = (key: 'medT' | 'medN') => rows.filter((x) => x.b >= 20 && x.b <= 28 && Math.abs(x[key]) <= 1).sort((x, y) => Math.abs(x[key]) - Math.abs(y[key]) || x.b - y.b)[0]
  const chosenT = pick('medT'), chosenN = rows.filter((x) => Math.abs(x.medN) <= 1).sort((x, y) => Math.abs(x.medN) - Math.abs(y.medN) || x.b - y.b)[0]
  for (const x of rows) say(`| ${x.b}${x.b === chosenT?.b ? ' (§9.3)' : ''}${x.b === chosenN?.b ? ' (no-tide ref)' : ''} | ${sgn(x.medT)} | ${sgn(x.medN)} | ${share(x.nw, (v) => v >= 55)} / ${share(x.nw, (v) => v >= 65)} / ${share(x.nw, (v) => v >= 80)} |`)
  say(`§9.3 (with tides, 20–28): ${chosenT?.b ?? 'none'}; against the no-tide reference: ${chosenN?.b ?? 'none'}. SCORE_WEIGHTS.base = ${curBase}${chosenT && chosenT.b !== curBase ? ' — UPDATE IT' : ''}`)
  say()

  // ── distributions ──
  const newS = (i: number) => score(after.variants.tides[i])
  say('## Distributions (p10 / p25 / p50 / p75 / p90 | ≥55 / ≥65 / ≥80)')
  const sets: [string, number[]][] = [
    ['havørred+makrel, coast', hm],
    ['havørred, coast', idx(['havørred'], coast)],
    ['none, coast', idx([], coast)],
    ['lake (gedde+aborre)', idx(['gedde', 'aborre'], (i) => !coast(i))],
  ]
  const g3: string[] = []
  for (const [name, ix] of sets) {
    const o = ix.map((i) => score(before.variants.tides[i])), on = ix.map((i) => score(before.variants.notides[i])), n = ix.map(newS)
    const d = ix.map((i, k) => n[k] - o[k])
    say(`- ${name} (${ix.length}): old+tides ${dist(o)}; old no tides ${dist(on)}; new ${dist(n)}; Δ p5/p50/p95/min/max ${[0.05, 0.5, 0.95].map((p) => sgn(pct(d, p))).join(' / ')} / ${Math.min(...d)} / ${sgn(Math.max(...d))}`)
    if (name !== 'havørred+makrel, coast') { const lim = name.startsWith('lake') ? 8 : 6; if (Math.abs(pct(d, 0.5)) > lim) g3.push(`${name} ${sgn(pct(d, 0.5))}`) }
  }
  say()
  say('## Median Δ per season × window type (havørred + makrel, coast; old with tides → new)')
  const types = [...new Set(WINDOWS.map((w) => w.type))]
  const seasons = [...new Set(FIXTURE.periods.map((_, pi) => season(pi)))]
  say(`| | ${seasons.join(' | ')} |`)
  let worst = 0
  for (const ty of types) {
    const cellsTxt = seasons.map((se) => {
      const ix = hm.filter((i) => season(all[i].pi) === se && WINDOWS[all[i].wi].type === ty)
      const o = ix.map((i) => score(before.variants.tides[i])), n = ix.map(newS)
      const md = pct(ix.map((i, k) => n[k] - o[k]), 0.5)
      if (Math.abs(md) > Math.abs(worst)) worst = md
      return `${pct(o, 0.5)}→${pct(n, 0.5)} (${sgn(md)})`
    })
    say(`| ${ty} | ${cellsTxt.join(' | ')} |`)
  }
  say()
  // Season sanity for havørred alone (S9): spring and autumn at or above summer.
  const hv = idx(['havørred'], coast).filter((i) => WINDOWS[all[i].wi].type !== '1h')
  say(`## Havørred alone, multi-hour windows, median by season: ${seasons.map((se) => `${se} ${pct(hv.filter((i) => season(all[i].pi) === se).map(newS), 0.5)}`).join(', ')}`)
  say()

  // ── gates ──
  const o = hm.map((i) => score(before.variants.tides[i])), n = hm.map(newS)
  const d = hm.map((_, k) => n[k] - o[k])
  const allD = all.map((_, i) => i).filter(ok).map((i) => newS(i) - score(before.variants.tides[i]))
  const pass = (b: boolean) => (b ? 'PASS' : 'FAIL')
  const g2 = [[0.25, 4], [0.75, 4], [0.9, 4]].map(([p, lim]) => [pct(n, p) - pct(o, p), lim])
  const g2s = [[55, 4], [65, 6], [80, 5]].map(([th, lim]) => [share(n, (v) => v >= th) - share(o, (v) => v >= th), lim])
  let invBad = 0, rangeBad = 0, keyBad = 0, lakeBad = 0
  const keys = new Set<string>()
  for (let i = 0; i < all.length; i++) {
    const r = after.variants.tides[i]
    if (r[0] == null) continue
    const rows2 = rowsOf(after, r)
    const s = Object.values(rows2).reduce((a, v) => a + v, 0)
    if (s !== r[0]) invBad++
    if ((r[0] as number) < 0 || (r[0] as number) > 100) rangeBad++
    for (const k of Object.keys(rows2)) keys.add(k)
    if (!coast(i) && (rows2.bd_watertemp != null || rows2.bd_tide != null)) lakeBad++
  }
  for (const k of keys) for (const l of ['da', 'en']) if (!STRINGS[l][k] || !STRINGS[l][k + '_why']) keyBad++
  const big35 = allD.filter((x) => Math.abs(x) > 35).length
  say('## Gates (old = old model with tides)')
  say(`- G1 pooled median Δ 0 ± 1: ${sgn(pct(d, 0.5))} — ${pass(Math.abs(pct(d, 0.5)) <= 1)}`)
  say(`- G2 shape: p25/p75/p90 Δ ${g2.map(([x]) => sgn(x)).join(' / ')}; ≥55/≥65/≥80 Δ ${g2s.map(([x]) => sgn(x)).join(' / ')} pp — ${pass(g2.every(([x, l]) => Math.abs(x) <= l) && g2s.every(([x, l]) => Math.abs(x) <= l))}`)
  say(`- G3 cells: worst season × window median Δ ${sgn(worst)} (≤ 14)${g3.length ? `; other sets outside: ${g3.join(', ')}` : ''} — ${pass(Math.abs(worst) <= 14 && !g3.length)}`)
  say(`- G4 tails: max |Δ| ${Math.max(...allD.map(Math.abs))} (≤ 50); ${big35} windows over 35 (causes not assigned by this script) — ${pass(Math.max(...allD.map(Math.abs)) <= 50)}`)
  say(`- G5 invariant: Σ rows ≠ score ${invBad}, out of range ${rangeBad}, keys without t(key)/t(key_why) ${keyBad} — ${pass(!invBad && !rangeBad && !keyBad)}`)
  say(`- G6 lake: windows with bd_watertemp or bd_tide ${lakeBad} — ${pass(!lakeBad)}`)

  const text = out.join('\n')
  console.log(text)
  if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, text)
})
