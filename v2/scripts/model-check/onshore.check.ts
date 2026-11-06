/**
 * Onshore wind per spot (onshore spec §5.2): gates O1–O9 against model v3 as
 * it was at 71d2038 (v3.json.gz, recorded with onshoreTargetSets), scoring
 * the model in src/ live with the fixture's coasts (lib.ts SHORES_*). Run from v2/:
 *   REPORT=<file> npx vitest run --config scripts/model-check/vitest.config.mjs onshore
 * "Δ" is always new − v3, tides variant, same window.
 */
import { it, vi } from 'vitest'
import fs from 'node:fs'
import { SCORE_WEIGHTS, getScoredWindows, scoreWindow, shoreRelation } from '@/lib/scoring'
import { SPECIES_PREFS } from '@/lib/species'
import { STRINGS } from '@/lib/strings'
import { SPOT_COAST } from '@/lib/spotCoast.gen'
import type { Shore } from '@/lib/coast'
import type { Availability, Forecast, Location, ScoredWindow } from '@/lib/types'
import {
  COAST_FIXTURE, FIXTURE, HM, LOCS, OWNER3, SHORES_AUTO, SHORES_HAND, SHORES_NONE, WINDOWS,
  cells, forecastFor, onshoreTargetSets, readRecords, rowsOf, tsName, type Cell,
} from './lib'

declare const process: { env: Record<string, string | undefined> }

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const month = (pi: number) => MONTH[Number(FIXTURE.periods[pi].start.slice(5, 7)) - 1]
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN }
const share = (a: number[], f: (v: number) => boolean) => (a.length ? (100 * a.filter(f).length) / a.length : NaN)
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)
const sgn = (n: number, d = 0) => (Number.isNaN(n) ? 'n/a' : n > 0 ? `+${n.toFixed(d)}` : n.toFixed(d))
const pass = (b: boolean) => (b ? 'PASS' : 'FAIL')
const CLAMP = new Set(['bd_floor', 'bd_ceiling'])
const SETS = { AUTO: SHORES_AUTO.map((s) => s ?? null), HAND: SHORES_HAND, NONE: SHORES_NONE } as const
type SetName = keyof typeof SETS
const ID = FIXTURE.spots.map((s) => s.id)
const si = (id: string) => ID.indexOf(id)

interface Res { score: number | null; rows: Record<string, number> }

it('onshore', () => {
  const v3 = readRecords('v3')
  const all: Cell[] = [...cells(onshoreTargetSets)]
  if (all.length !== v3.variants.tides.length) throw new Error(`v3.json.gz holds ${v3.variants.tides.length} windows, the enumeration ${all.length}`)
  const out: string[] = []
  const say = (s = '') => out.push(s)

  const fcs = new Map<string, Forecast>()
  const fcOf = (c: Pick<Cell, 'pi' | 'si' | 'date'>) => {
    const k = `${c.pi}|${c.si}|${c.date.getTime()}`
    if (!fcs.has(k)) fcs.set(k, forecastFor(c.pi, c.si, 'tides', c.date))
    return fcs.get(k)!
  }
  const rowsW = (w: ScoredWindow) => {
    const r: Record<string, number> = {}
    for (const b of w.breakdown ?? []) r[b.key!] = (r[b.key!] ?? 0) + b.points
    return r
  }
  const scoreCell = (c: Cell, shore: Shore | null, f = fcOf(c)): ScoredWindow => {
    const w = WINDOWS[c.wi]
    return scoreWindow(LOCS[c.si], c.date, w.from, w.to, f, c.targets, 'shore', shore)
  }

  // ── score everything, once per coast set ──
  const res: Record<SetName, Res[]> = { AUTO: [], HAND: [], NONE: [] }
  for (const name of Object.keys(SETS) as SetName[]) {
    for (const c of all) {
      const w = scoreCell(c, SETS[name][c.si])
      res[name].push(w.noData ? { score: null, rows: {} } : { score: w.score, rows: rowsW(w) })
    }
  }
  const v3Score = (i: number) => v3.variants.tides[i][0] as number | null
  const v3Rows = (i: number) => rowsOf(v3, v3.variants.tides[i])
  const ok = (i: number) => v3Score(i) != null && res.AUTO[i].score != null
  const coast = (i: number) => LOCS[all[i].si].waterType !== 'fresh'
  const idx = (ts: string[], f: (i: number) => boolean = coast) => all.map((_, i) => i).filter((i) => ok(i) && tsName(all[i].targets) === tsName(ts) && f(i))
  const is1h = (i: number) => WINDOWS[all[i].wi].type === '1h'
  const d = (name: SetName, i: number) => (res[name][i].score as number) - (v3Score(i) as number)
  const curBase = SCORE_WEIGHTS.base
  const raw = (r: Record<string, number>) => Object.entries(r).filter(([k]) => !CLAMP.has(k)).reduce((a, [, v]) => a + v, 0)
  const atBase = (b: number, i: number, name: SetName = 'AUTO') => Math.max(0, Math.min(100, raw(res[name][i].rows) + b - curBase))

  // The hour a 1h window covers, from the forecast.
  const hourOf = (i: number) => {
    const c = all[i], f = fcOf(c), h = parseInt(WINDOWS[c.wi].from)
    const t = new Date(c.date.getUTCFullYear(), c.date.getUTCMonth(), c.date.getUTCDate(), h).getTime()
    const hd = f.hourly.find((x) => Math.abs(x.time - t) < 1800000)
    const mh = f.marine?.find((x) => Math.abs(x.time - t) < 1800000)
    return { hd, waveM: mh?.waveM ?? null }
  }
  // The old windOrChop condition (v3: 4–8 m/s or 0.3–0.9 m of waves, any direction).
  const oldWoc = (i: number) => {
    const { hd, waveM } = hourOf(i)
    const w = hd?.windMs
    return (w != null && w >= 4 && w <= 8) || (waveM != null && waveM >= 0.3 && waveM <= 0.9)
  }

  const owner = idx(OWNER3), hv = idx(['havørred']), hm = idx(HM), none = idx([])
  const lake = idx(['gedde', 'aborre'], (i) => !coast(i)), lakeHM = idx(HM, (i) => !coast(i))

  // ── fixture coasts ──
  say('## Fixture coasts (SHORES_AUTO vs SHORES_HAND)')
  say('| spot | source | facing | spread | exposure | fetchKm N…NNW | issues | hand |')
  say('|---|---|---|---|---|---|---|---|')
  for (const s of FIXTURE.spots) {
    if (LOCS[si(s.id)].waterType === 'fresh') continue
    const e = s.slug ? SPOT_COAST[s.slug] : COAST_FIXTURE[s.id]
    const a = SHORES_AUTO[si(s.id)]
    const h = SHORES_HAND[si(s.id)]!
    const src = s.slug ? (e?.fixed ? 'catalogue, hand-set (coast-overrides.json)' : 'catalogue') : 'derived at the fixture pin'
    say(`| ${s.id} | ${src} | ${e?.facing ?? '—'} | ${e?.spread} | ${e?.exposure ?? '—'} | ${e?.fetchKm.join(' ') || '—'} | ${e?.issues.join(',') || ''}${a === undefined ? ' → UNKNOWN to the scorer' : a ? ` → ${a.mode}` : ' → none'} | ${h.facing} / ${h.spread} / ${h.exposure} |`)
  }
  say()
  say('Mean bd_shorewind per hour, havørred alone (1h windows), AUTO / HAND / auto − hand:')
  say(`| spot | ${[...new Set(FIXTURE.periods.map((_, pi) => month(pi)))].join(' | ')} |`)
  say(`|---|${FIXTURE.periods.map(() => '---').join('|')}|`)
  const autoHandWarn: string[] = []
  for (const id of ['dragor', 'ronne', 'tejn', 'kal']) {
    const cellsTxt = FIXTURE.periods.map((_, pi) => {
      const ix = hv.filter((i) => is1h(i) && all[i].si === si(id) && all[i].pi === pi)
      const a = mean(ix.map((i) => res.AUTO[i].rows.bd_shorewind ?? 0)), h = mean(ix.map((i) => res.HAND[i].rows.bd_shorewind ?? 0))
      const diffs = ix.map((i) => Math.abs((res.AUTO[i].rows.bd_shorewind ?? 0) - (res.HAND[i].rows.bd_shorewind ?? 0)))
      if (mean(diffs) > 2) autoHandWarn.push(`${id} ${month(pi)} mean |auto − hand| ${mean(diffs).toFixed(1)}`)
      return `${sgn(a, 1)} / ${sgn(h, 1)} / ${sgn(a - h, 1)}`
    })
    say(`| ${id} | ${cellsTxt.join(' | ')} |`)
  }
  say(autoHandWarn.length ? `Mean |auto − hand| over 2: ${autoHandWarn.join('; ')} — see the facing table: the hand value and the derived/catalogue one disagree there.` : 'Mean |auto − hand| ≤ 2 for every spot and month.')
  say()

  // ── O1 bounds ──
  let o1Bad = 0, o1Min = Infinity, o1Max = -Infinity
  for (const name of Object.keys(SETS) as SetName[]) for (let i = 0; i < all.length; i++) {
    const v = res[name][i].rows.bd_shorewind
    if (v == null) continue
    o1Min = Math.min(o1Min, v); o1Max = Math.max(o1Max, v)
    if (v < -4 || v > 8) o1Bad++
  }

  // ── O2 calibration ──
  const medAt = (ix: number[], b: number) => pct(ix.map((i) => atBase(b, i) - (v3Score(i) as number)), 0.5)
  const baseRows = Array.from({ length: 7 }, (_, k) => 18 + k).map((b) => ({ b, owner: medAt(owner, b), hm: medAt(hm, b), hv: medAt(hv, b) }))
  const pick = baseRows.filter((x) => Math.abs(x.owner) <= 1).sort((x, y) => Math.abs(x.owner) - Math.abs(y.owner) || x.b - y.b)[0]
  const o2Med = medAt(owner, curBase)

  // ── O3 band shares ──
  const nOwner = owner.map((i) => res.AUTO[i].score as number), oOwner = owner.map((i) => v3Score(i) as number)
  const bands = [55, 65, 80].map((th) => ({ th, d: share(nOwner, (v) => v >= th) - share(oOwner, (v) => v >= th) }))

  // ── O4 tails ──
  const limits: [string, number[], number][] = [['OWNER3', owner, 20], ['havørred', hv, 25], ['HM', hm, 20]]
  const over: string[] = []
  const tail = limits.map(([name, ix, lim]) => {
    const ds = ix.map((i) => d('AUTO', i))
    for (const i of ix) {
      if (Math.abs(d('AUTO', i)) <= lim) continue
      const a = res.AUTO[i].rows, b = v3Rows(i)
      const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])]
      const diff = keys.map((k) => [k, (a[k] ?? 0) - (b[k] ?? 0)] as const).filter(([, x]) => x !== 0).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))
      const c = all[i]
      over.push(`${name} ${ID[c.si]} ${month(c.pi)} d${c.day} ${WINDOWS[c.wi].name}: Δ ${sgn(d('AUTO', i))} — ${diff.map(([k, x]) => `${k} ${sgn(x)}`).join(', ')}; cause: ${diff[0]?.[0] ?? '?'}`)
    }
    return { name, lim, max: Math.max(...ds.map(Math.abs)) }
  })

  // ── O5 direction signal ──
  const westE = (lo: number, hi: number) => {
    const sel = (ids: string[]) => hv.filter((i) => is1h(i) && ids.includes(ID[all[i].si])).filter((i) => {
      const { hd } = hourOf(i)
      return hd?.windMs != null && hd.windMs >= 4 && hd.windDir != null && hd.windDir >= lo && hd.windDir <= hi
    })
    const w = sel(['ronne', 'kal']), e = sel(['tejn', 'dragor'])
    return { diff: mean(w.map((i) => d('AUTO', i))) - mean(e.map((i) => d('AUTO', i))), nW: w.length, nE: e.length }
  }
  const o5w = westE(225, 315), o5e = westE(45, 135)
  // Top-spot agreement among the coastal spots, per (period, day, window), havørred alone.
  const top = new Map<string, { id: string; nv: number; ov: number; nId: string; oId: string }>()
  for (const i of hv) {
    const c = all[i], k = `${c.pi}|${c.day}|${c.wi}`
    const n = res.AUTO[i].score as number, o = v3Score(i) as number
    const t = top.get(k) ?? { id: '', nv: -1, ov: -1, nId: '', oId: '' }
    if (n > t.nv) { t.nv = n; t.nId = ID[c.si] }
    if (o > t.ov) { t.ov = o; t.oId = ID[c.si] }
    top.set(k, t)
  }
  const agree = share([...top.values()].map((t) => (t.nId === t.oId ? 1 : 0)), (v) => v === 1)
  const moved: Record<string, number> = {}
  for (const t of top.values()) if (t.nId !== t.oId) moved[`${t.oId}→${t.nId}`] = (moved[`${t.oId}→${t.nId}`] ?? 0) + 1

  // ── O6 invariants ──
  let sumBad = 0, rangeBad = 0, windDirRows = 0, lakeShore = 0, zeroBad = 0
  const keys = new Set<string>()
  for (const name of Object.keys(SETS) as SetName[]) for (let i = 0; i < all.length; i++) {
    const r = res[name][i]
    if (r.score == null) continue
    if (Object.values(r.rows).reduce((a, v) => a + v, 0) !== r.score) sumBad++
    if (r.score < 0 || r.score > 100) rangeBad++
    for (const k of Object.keys(r.rows)) keys.add(k)
    if ('bd_winddir' in r.rows) windDirRows++
    if (!coast(i) && 'bd_shorewind' in r.rows) lakeShore++
    if (!all[i].targets.length && v3Score(i) != null) {
      // Exact zero, against v3 shifted by any base change (critique R6).
      const a = r.rows, b = v3Rows(i)
      const ks = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => !CLAMP.has(k) && k !== 'bd_base'))
      const same = [...ks].every((k) => (a[k] ?? 0) === (b[k] ?? 0)) && (a.bd_base ?? 0) - (b.bd_base ?? 0) === curBase - 20
      const expect = Math.max(0, Math.min(100, raw(b) + curBase - 20))
      if (!same || r.score !== expect) zeroBad++
    }
  }
  const keyBad = [...keys].flatMap((k) => ['da', 'en'].filter((l) => !STRINGS[l][k] || !STRINGS[l][k + '_why']).map((l) => `${l}.${k}`))

  // ── O7 missing data ──
  const mapHours = (f: Forecast, g: (h: Forecast['hourly'][number]) => Forecast['hourly'][number]): Forecast => ({ ...f, hourly: f.hourly.map(g) })
  const SST_REL = ['bd_watertemp', 'fac_species_name', 'bd_timeofday', 'bd_cloud', 'bd_shorewind', 'bd_wind', 'bd_wave']
  const variants: [string, (f: Forecast) => Forecast, boolean, string[], string[]][] = [
    ['wind null', (f) => mapHours(f, (h) => ({ ...h, windMs: null })), false, ['bd_wind', 'bd_windtrend', 'bd_shorewind'], ['fac_species_name']],
    ['windDir null', (f) => mapHours(f, (h) => ({ ...h, windDir: null })), false, ['bd_shorewind'], ['fac_species_name']],
    ['coast unknown (SHORES_NONE)', (f) => f, true, ['bd_shorewind'], ['fac_species_name']],
    ['sstC null', (f) => ({ ...f, marine: f.marine?.map((m) => ({ ...m, sstC: null })) ?? null }), false, ['bd_watertemp'], SST_REL],
    ['marine null', (f) => ({ ...f, marine: null }), false, ['bd_wave', 'bd_method', 'bd_watertemp'], SST_REL],
    ['pressure null', (f) => mapHours(f, (h) => ({ ...h, pressure: null })), false, ['bd_pressure'], []],
    ['tides null', (f) => ({ ...f, tides: null }), false, ['bd_tide'], ['fac_species_name']],
  ]
  const sample = owner.filter((_, k) => k % 5 === 0)
  const o7: string[] = []
  let o7ok = true
  for (const [name, strip, noShore, gone, related] of variants) {
    let leaks = 0, unrelated = 0
    for (const i of sample) {
      const c = all[i], f = fcOf(c)
      const a = rowsW(scoreCell(c, SETS.AUTO[c.si], f))
      const b = rowsW(scoreCell(c, noShore ? null : SETS.AUTO[c.si], strip(f)))
      if (gone.some((k) => k in b)) leaks++
      const ks = new Set([...Object.keys(a), ...Object.keys(b)].filter((k) => !gone.includes(k) && !related.includes(k) && !CLAMP.has(k)))
      if ([...ks].some((k) => (a[k] ?? 0) !== (b[k] ?? 0))) unrelated++
    }
    if (leaks || unrelated) o7ok = false
    o7.push(`- ${name}: leaks ${leaks}, unrelated rows changed ${unrelated}`)
  }

  // ── O8 M5 redo ──
  const o8: string[] = []
  let o8max = 0
  for (const id of ['dragor', 'ronne', 'tejn', 'kal']) {
    const shore = SHORES_AUTO[si(id)] ?? SHORES_HAND[si(id)]!
    const src = SHORES_AUTO[si(id)] ? 'AUTO' : 'HAND (AUTO unknown)'
    const ix = hv.filter((i) => is1h(i) && all[i].si === si(id))
    const rel = (i: number) => { const { hd } = hourOf(i); return shoreRelation(hd?.windDir ?? null, hd?.windMs ?? null, shore) ?? 'none' }
    const split = (sel: number[]) => {
      const n = sel.length, cnt: Record<string, number> = { on: 0, side: 0, off: 0, none: 0 }
      for (const i of sel) cnt[rel(i)]++
      return { n, txt: `${n} h: on ${(100 * cnt.on / n).toFixed(0)} %, side ${(100 * cnt.side / n).toFixed(0)} %, off ${(100 * cnt.off / n).toFixed(0)} %, calm/none ${(100 * cnt.none / n).toFixed(0)} %`, off: n ? (100 * cnt.off) / n : 0 }
    }
    const set = SHORES_AUTO[si(id)] ? 'AUTO' : 'HAND'
    const before = split(ix.filter(oldWoc))
    const paid = ix.filter((i) => (res[set][i].rows.bd_shorewind ?? 0) > 0)
    const after = split(paid)
    const offPaid = paid.filter((i) => rel(i) === 'off').map((i) => res[set][i].rows.bd_shorewind)
    o8max = Math.max(o8max, after.off)
    o8.push(`- ${id} (${src}): before (windOrChop fired) ${before.txt}; after (bd_shorewind > 0) ${after.txt}${offPaid.length ? `; the offshore hours that pay: mean ${mean(offPaid).toFixed(2)}, max ${Math.max(...offPaid)}` : ''}`)
  }

  // ── O9 performance ──
  // 18 spots (the four coastal fixture spots, repeated), the owner's kind of
  // slots, with and without shores; median of interleaved runs, after warm-up.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(FIXTURE.periods[2].start + 'T10:00:00Z').getTime() + 2 * 86400000)
  const locs18: Location[] = [], fc18: Record<string, Forecast> = {}, sh18: Record<string, Shore | null> = {}
  for (let k = 0; k < 18; k++) {
    const s = [0, 1, 2, 3][k % 4]
    const id = `p${k}`
    locs18.push({ ...LOCS[s], id })
    fc18[id] = forecastFor(2, s, 'tides', new Date(Date.now()))
    sh18[id] = SETS.AUTO[s]
  }
  const av: Availability[] = [
    { id: 'a', days: [0, 1, 2, 3, 4, 5, 6], from: '05:00', to: '09:00', methods: ['shore'] },
    { id: 'b', days: [1, 2, 3, 4, 5], from: '17:00', to: '21:00', methods: ['shore', 'waders'] },
    { id: 'c', days: [0, 6], from: '08:00', to: '18:00', methods: ['shore', 'boat', 'waders'] },
  ]
  const time = (shores?: Record<string, Shore | null>) => { const t0 = performance.now(); getScoredWindows(locs18, av, fc18, OWNER3, {}, shores); return performance.now() - t0 }
  // Cold: the first call of the process pays the JIT for all of scoring, so
  // the run without shores goes first; the one with them then pays only for
  // the new code and the fetch-profile cache.
  const coldWithout = time()
  const cold = { with: time(sh18), without: coldWithout }
  for (let k = 0; k < 5; k++) { time(sh18); time() }
  const tW: number[] = [], tO: number[] = [], pairs: number[] = []
  for (let k = 0; k < 41; k++) {
    // Alternate which goes first, so a GC pause or a clock step lands on both sides alike.
    const a = k % 2 ? time() : NaN, b = time(sh18), c = k % 2 ? a : time()
    tO.push(c); tW.push(b); pairs.push(b / c)
  }
  vi.useRealTimers()
  // On this machine two identical runs gave ×1.07 and ×1.13 by the ratio of
  // medians, and ×0.99 to ×1.15 by the minima. The gate reads the median of
  // 41 back-to-back pairs, which a pause hits on one pair, not on a side.
  const ratio = pct(tW, 0.5) / pct(tO, 0.5)
  const ratioPair = pct(pairs, 0.5)

  // ── fallback value and the lake ──
  const fallbackHours = hv.filter((i) => is1h(i) && oldWoc(i) && SETS.AUTO[all[i].si])
  const fallbackMean = mean(fallbackHours.map((i) => res.AUTO[i].rows.bd_shorewind ?? 0))
  const lakeMed = pct(lake.map((i) => d('AUTO', i)), 0.5)

  // ── report ──
  say('## Gates')
  say(`- O1 bounds: bd_shorewind per window (and per hour: the 1h windows) in [${o1Min}, ${o1Max}], outside [−4, +8]: ${o1Bad} — ${pass(!o1Bad && o1Min >= -4 && o1Max <= 8)}`)
  say(`- O2 calibration (OWNER3, coast, pooled, SHORES_AUTO): median Δ at base ${curBase} = ${sgn(o2Med)}; §5.2 pick in [18, 24]: ${pick?.b ?? 'none'} — ${pass(Math.abs(o2Med) <= 1 && pick?.b === curBase)}`)
  say(`  | base | OWNER3 | havørred | HM |`)
  for (const x of baseRows) say(`  | ${x.b}${x.b === pick?.b ? ' ←' : ''} | ${sgn(x.owner)} | ${sgn(x.hv)} | ${sgn(x.hm)} |`)
  say(`- O3 band shares (OWNER3 coast): ${bands.map((b) => `≥${b.th} ${sgn(b.d, 1)} pp`).join(', ')} — ${pass(bands.every((b) => Math.abs(b.d) <= 5))}`)
  say(`- O4 tails: ${tail.map((t) => `${t.name} max |Δ| ${t.max} (≤ ${t.lim})`).join(', ')}; ${over.length} windows over — ${pass(tail.every((t) => t.max <= t.lim))}`)
  for (const o of over.slice(0, 40)) say(`  - ${o}`)
  if (over.length > 40) say(`  - … ${over.length - 40} more`)
  say(`- O5 direction (havørred, ≥ 4 m/s, 1h windows): westerlies 225–315° mean Δ(Rønne, Kalundborg) − mean Δ(Tejn, Dragør) = ${sgn(o5w.diff, 2)} (${o5w.nW} / ${o5w.nE} h, want > 0); easterlies 45–135° ${sgn(o5e.diff, 2)} (${o5e.nW} / ${o5e.nE} h, want < 0) — ${pass(o5w.diff > 0 && o5e.diff < 0)}`)
  say(`  Top coastal spot unchanged in ${agree.toFixed(0)} % of (period, day, window); moves: ${Object.entries(moved).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k} ${n}`).join(', ')}`)
  say(`- O6 invariants (all three coast sets): Σ rows ≠ score ${sumBad}, out of 0–100 ${rangeBad}, keys without t(key)/t(key_why) ${keyBad.length}${keyBad.length ? ` (${keyBad.join(', ')})` : ''}, bd_winddir rows ${windDirRows}, Arresø with bd_shorewind ${lakeShore}, targets [] ≠ v3${curBase !== 20 ? ` + ${curBase - 20}` : ''} ${zeroBad} — ${pass(!sumBad && !rangeBad && !keyBad.length && !windDirRows && !lakeShore && !zeroBad)}`)
  say(`- O7 missing data (${sample.length} owner windows at the coast) — ${pass(o7ok)}`)
  for (const l of o7) say(`  ${l}`)
  say(`- O8 M5 redo (havørred, 1h windows): after, the largest offshore share is ${o8max.toFixed(0)} % — ${pass(o8max <= 5)}`)
  for (const l of o8) say(`  ${l}`)
  say(`- O9 performance (18 spots, 3 slots, OWNER3): cold ${cold.with.toFixed(0)} ms with shores / ${cold.without.toFixed(0)} ms without; median warm ${pct(tW, 0.5).toFixed(1)} / ${pct(tO, 0.5).toFixed(1)} ms = ×${ratio.toFixed(2)}; median of 41 paired runs ×${ratioPair.toFixed(2)} — ${pass(ratioPair <= 1.1)}`)
  say()
  say(`## Fallback value: mean bd_shorewind (havørred, SHORES_AUTO) over the ${fallbackHours.length} hours the old windOrChop condition holds = ${fallbackMean.toFixed(2)} → ${Math.round(fallbackMean)} (windOrChop is ${SPECIES_PREFS.havørred.bonuses.windOrChop}${Math.round(fallbackMean) !== SPECIES_PREFS.havørred.bonuses.windOrChop ? ' — SET IT (1–3)' : ''})`)
  say(`## Lake (gedde + aborre): median Δ ${sgn(lakeMed)} (|·| ≤ 3: ${pass(Math.abs(lakeMed) <= 3)}); HM at the lake median Δ ${sgn(pct(lakeHM.map((i) => d('AUTO', i)), 0.5))}`)
  say()

  // Distributions per target set, and per spot × month × window type.
  say('## Δ distributions (SHORES_AUTO): p5 / p50 / p95 / max |Δ| | new ≥55/≥65/≥80 vs v3')
  for (const [name, ix] of [['OWNER3, coast', owner], ['havørred, coast', hv], ['HM, coast', hm], ['none, coast', none], ['lake gedde+aborre', lake]] as [string, number[]][]) {
    const ds = ix.map((i) => d('AUTO', i)), n = ix.map((i) => res.AUTO[i].score as number), o = ix.map((i) => v3Score(i) as number)
    say(`- ${name} (${ix.length}): ${[0.05, 0.5, 0.95].map((p) => sgn(pct(ds, p))).join(' / ')} / ${Math.max(...ds.map(Math.abs))} | ${[55, 65, 80].map((th) => `${share(n, (v) => v >= th).toFixed(0)}`).join('/')} vs ${[55, 65, 80].map((th) => `${share(o, (v) => v >= th).toFixed(0)}`).join('/')} %`)
  }
  say()
  say('## Δ p5 / p50 / p95 per spot × month × window type (OWNER3, SHORES_AUTO)')
  const types = [...new Set(WINDOWS.map((w) => w.type))]
  say(`| spot | type | ${[...new Set(FIXTURE.periods.map((_, pi) => month(pi)))].join(' | ')} |`)
  say(`|---|---|${FIXTURE.periods.map(() => '---').join('|')}|`)
  for (const id of ['dragor', 'ronne', 'tejn', 'kal']) for (const ty of types) {
    say(`| ${id} | ${ty} | ${FIXTURE.periods.map((_, pi) => {
      const ds = owner.filter((i) => all[i].si === si(id) && all[i].pi === pi && WINDOWS[all[i].wi].type === ty).map((i) => d('AUTO', i))
      return [0.05, 0.5, 0.95].map((p) => sgn(pct(ds, p))).join(' / ')
    }).join(' | ')} |`)
  }
  say()
  say('## Mean bd_shorewind and fac_species_name per spot × month (OWNER3 / havørred, SHORES_AUTO, all windows)')
  for (const id of ['dragor', 'ronne', 'tejn', 'kal']) {
    say(`- ${id}: ${FIXTURE.periods.map((_, pi) => {
      const o = owner.filter((i) => all[i].si === si(id) && all[i].pi === pi), h = hv.filter((i) => all[i].si === si(id) && all[i].pi === pi)
      const m = (ix: number[], k: string) => mean(ix.map((i) => res.AUTO[i].rows[k] ?? 0)).toFixed(1)
      return `${month(pi)} shore ${m(o, 'bd_shorewind')}/${m(h, 'bd_shorewind')} species ${m(o, 'fac_species_name')}/${m(h, 'fac_species_name')}`
    }).join('; ')}`)
  }
  say()
  say(`## Catalogue (spotCoast.gen.ts): ${Object.keys(SPOT_COAST).length} coastal official spots`)
  say('| slug | facing | spread | exposure | issues | scored as |')
  say('|---|---|---|---|---|---|')
  for (const [slug, e] of Object.entries(SPOT_COAST)) {
    const scored = e.water !== 'sea' ? 'none' : e.fixed ? 'hand-set (manual)' : e.issues.some((x) => x === 'gap' || x === 'enclosed') ? 'unknown (fallback)' : 'auto profile'
    say(`| ${slug} | ${e.facing ?? '—'} | ${e.spread} | ${e.exposure ?? '—'} | ${e.issues.join(',')} | ${scored} |`)
  }

  const text = out.join('\n')
  console.log(text)
  if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, text)
})
