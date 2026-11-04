/**
 * The model-check report (model-spec §11.2 and its critique): before.json.gz
 * (the model at ed34b06) against after.json.gz (the model in src/), on the
 * same fixture windows. Prints the report; REPORT=<path> also writes it there.
 *
 * Baseline: the old model WITHOUT tides. Every DMI request has failed in
 * production since dmigw.govcloud.dk stopped resolving (critique R1), so the
 * scores the owner has learned to read carry no tide row; the old model with
 * tides is reported alongside. "New" is the new model WITH tides, i.e. once
 * DMI is reachable again; the new model without tides is reported too.
 */
import { it } from 'vitest'
import fs from 'node:fs'
import { SCORE_WEIGHTS, scoreWindow } from '@/lib/scoring'
import { FIXTURE, HM, LOCS, WINDOWS, cells, forecastFor, readRecords, rowsOf, tsName, type Cell, type Rec, type RecordFile } from './lib'

declare const process: { env: Record<string, string | undefined> }

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const season = (pi: number) => MONTH[Number(FIXTURE.periods[pi].start.slice(5, 7)) - 1]
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN }
const share = (a: number[], f: (v: number) => boolean) => (a.length ? Math.round((100 * a.filter(f).length) / a.length) : NaN)
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)
const sgn = (n: number) => (n > 0 ? `+${n}` : `${n}`)
const pad = (v: unknown, n: number) => String(v).padStart(n)
const CLAMP = new Set(['bd_floor', 'bd_ceiling'])

interface Row { c: Cell; spot: string; target: string; type: string; season: string; oldS: number; oldT: number; newS: number; newNT: number; oldRows: Record<string, number>; newRows: Record<string, number>; d: number }

it('compare', () => {
  const before = readRecords('before'), after = readRecords('after')
  const all = [...cells()]
  for (const f of [before, after]) for (const v of ['tides', 'notides'] as const)
    if (f.variants[v].length !== all.length) throw new Error(`${f.model} ${v}: ${f.variants[v].length} windows, the enumeration has ${all.length}`)

  const out: string[] = []
  const say = (s = '') => out.push(s)
  const score = (r: Rec) => r[0] as number

  // ── recentring (§7.3): base shifts every window's raw sum by the same amount ──
  // The spec searched 28–40, sized on the old model WITH tides; recentring on
  // the old model without them (R5) needs about 9 points less, so the search
  // runs from 20.
  const rawOf = (f: RecordFile, r: Rec) => Object.entries(rowsOf(f, r)).filter(([k]) => !CLAMP.has(k)).reduce((a, [, v]) => a + v, 0)
  const curBase = SCORE_WEIGHTS.base
  const hmCoastIdx = all.map((c, i) => [c, i] as const).filter(([c]) => tsName(c.targets) === tsName(HM) && LOCS[c.si].waterType !== 'fresh').map(([, i]) => i)
  const atBase = (b: number, i: number) => Math.max(0, Math.min(100, rawOf(after, after.variants.tides[i]) + b - curBase))
  const oldHm = hmCoastIdx.map((i) => score(before.variants.notides[i]))
  const oldHmT = hmCoastIdx.map((i) => score(before.variants.tides[i]))
  const baseTable = Array.from({ length: 21 }, (_, k) => 20 + k).map((b) => {
    const nw = hmCoastIdx.map((i) => atBase(b, i))
    return {
      b, med: pct(nw.map((v, k) => v - oldHm[k]), 0.5), medT: pct(nw.map((v, k) => v - oldHmT[k]), 0.5),
      s55: share(nw, (v) => v >= 55), s65: share(nw, (v) => v >= 65), s80: share(nw, (v) => v >= 80),
    }
  })
  const inBand = baseTable.filter((x) => Math.abs(x.med) <= 1)
  const chosen = [...inBand].sort((x, y) => Math.abs(x.med) - Math.abs(y.med) || x.b - y.b)[0]

  // ── per-window rows ──
  const rows: Row[] = all.map((c, i) => {
    const oldS = score(before.variants.notides[i]), newS = score(after.variants.tides[i])
    return {
      c, spot: FIXTURE.spots[c.si].id, target: (LOCS[c.si].waterType === 'fresh' ? 'lake ' : '') + tsName(c.targets),
      type: WINDOWS[c.wi].type, season: season(c.pi),
      oldS, oldT: score(before.variants.tides[i]), newS, newNT: score(after.variants.notides[i]),
      oldRows: rowsOf(before, before.variants.notides[i]), newRows: rowsOf(after, after.variants.tides[i]), d: newS - oldS,
    }
  })
  const owner = rows.filter((r) => r.target === tsName(HM))

  say(`# Model check — ${before.model} → ${after.model}`)
  say()
  say(`Fixture: ${FIXTURE.spots.map((s) => s.id + (s.station ? ` (tide ${s.station.name})` : '')).join(', ')}; periods ${FIXTURE.periods.map((p) => p.start).join(', ')} (2026), days 2–15; ${all.length} windows per variant. Shore.`)
  say(`Δ = new model with tides − old model without tides (the owner's live scores while DMI is unreachable, critique R1/R5).`)
  say()
  say('## Medians of the alternatives (R5)')
  const tSets = [...new Set(rows.map((r) => r.target))]
  say('| targets | old, no tides | old, tides | new, no tides | new, tides |')
  say('|---|---|---|---|---|')
  for (const ts of tSets) {
    const rs = rows.filter((r) => r.target === ts)
    say(`| ${ts} | ${pct(rs.map((r) => r.oldS), 0.5)} | ${pct(rs.map((r) => r.oldT), 0.5)} | ${pct(rs.map((r) => r.newNT), 0.5)} | ${pct(rs.map((r) => r.newS), 0.5)} |`)
  }
  say()
  say('## Base recentring (§7.3) and what it does to the thresholds')
  say(`Havørred + makrel at the coastal spots, all windows. Old model: share ≥ 55 / ≥ 65 / ≥ 80 = ${share(oldHm, (v) => v >= 55)} / ${share(oldHm, (v) => v >= 65)} / ${share(oldHm, (v) => v >= 80)} % without tides, ${share(oldHmT, (v) => v >= 55)} / ${share(oldHmT, (v) => v >= 65)} / ${share(oldHmT, (v) => v >= 80)} % with tides.`)
  say('| base | median Δ vs old without tides | median Δ vs old with tides | new ≥ 55 % | new ≥ 65 % | new ≥ 80 % |')
  say('|---|---|---|---|---|---|')
  for (const x of baseTable) say(`| ${x.b}${x.b === chosen?.b ? ' (chosen)' : ''} | ${sgn(x.med)} | ${sgn(x.medT)} | ${x.s55} | ${x.s65} | ${x.s80} |`)
  say(`Chosen by §7.3 against the old model without tides: ${chosen ? chosen.b : 'none in ±1'} (SCORE_WEIGHTS.base = ${curBase}${chosen && chosen.b !== curBase ? ' — UPDATE IT' : ''}).`)
  say()

  // ── distribution per cell ──
  say('## Distribution per target set × season × window (old → new)')
  say('| targets | season | window | n | p10 | p50 | p90 | ≥55 % | ≥65 % | ≥80 % | Δ p5 | Δ p50 | Δ p95 | Δ min | Δ max |')
  say('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  const types = ['1h', '06-09', '17-21', '08-18']
  const seasons = FIXTURE.periods.map((_, pi) => season(pi))
  const cellsOf = (ts: string) => seasons.flatMap((se) => types.map((ty) => ({ se, ty, rs: rows.filter((r) => r.target === ts && r.season === se && r.type === ty) })))
  const g2: { ts: string; se: string; ty: string; med: number; lim: number }[] = []
  const g55: { se: string; ty: string; old: number; neu: number }[] = []
  for (const ts of tSets) {
    for (const { se, ty, rs } of cellsOf(ts)) {
      const o = rs.map((r) => r.oldS), n = rs.map((r) => r.newS), d = rs.map((r) => r.d)
      const f = (a: number[]) => [pct(a, 0.1), pct(a, 0.5), pct(a, 0.9), share(a, (v) => v >= 55), share(a, (v) => v >= 65), share(a, (v) => v >= 80)]
      const fo = f(o), fn = f(n)
      say(`| ${ts} | ${se} | ${ty} | ${rs.length} | ${fo.map((x, k) => `${x}→${fn[k]}`).join(' | ')} | ${sgn(pct(d, 0.05))} | ${sgn(pct(d, 0.5))} | ${sgn(pct(d, 0.95))} | ${sgn(Math.min(...d))} | ${sgn(Math.max(...d))} |`)
      g2.push({ ts, se, ty, med: pct(d, 0.5), lim: ts === 'havørred' ? 12 : 10 })
      if (ts === tsName(HM) && (ty === '06-09' || ty === '17-21')) g55.push({ se, ty, old: fo[3], neu: fn[3] })
    }
  }
  say()

  // ── per-factor Δ (owner targets) ──
  say('## Per-factor Δ per window, havørred + makrel (new row − old row; 0 where a row is absent)')
  const keys = [...new Set(owner.flatMap((r) => [...Object.keys(r.oldRows), ...Object.keys(r.newRows)]))]
  say('| factor | old min…max | new min…max | Δ mean | Δ p5 | Δ p95 | Δ min | Δ max |')
  say('|---|---|---|---|---|---|---|---|')
  for (const k of keys) {
    const o = owner.map((r) => r.oldRows[k] ?? 0), n = owner.map((r) => r.newRows[k] ?? 0), d = owner.map((r, i) => n[i] - o[i])
    say(`| ${k} | ${Math.min(...o)}…${Math.max(...o)} | ${Math.min(...n)}…${Math.max(...n)} | ${mean(d).toFixed(1)} | ${sgn(pct(d, 0.05))} | ${sgn(pct(d, 0.95))} | ${sgn(Math.min(...d))} | ${sgn(Math.max(...d))} |`)
  }
  say()

  // ── big swings (G4) ──
  // Each swing is put down to the factors that moved it (base aside, which
  // shifts everything alike). §7.2 names two causes — the fake thunder row and
  // pressure on rainy fronts (up), stacked pressure/tide/solunar/compass/calm
  // on calm nights (down) — and the critique-driven changes add three: the
  // species rules (pressure and tide bonuses gone, new ones in), the time of
  // day for daylight feeders (R10) and the water temperature. A swing whose
  // largest share comes from any other factor — one the model did not mean
  // to change — is listed as unexplained.
  const CAUSE: Record<string, string> = {
    bd_lightning: 'fake thunder', bd_thunder: 'real thunder', bd_pressure: 'pressure',
    bd_tide: 'stacked tide/solunar/compass/calm', bd_solunar: 'stacked tide/solunar/compass/calm',
    bd_winddir: 'stacked tide/solunar/compass/calm', bd_wind: 'stacked tide/solunar/compass/calm',
    fac_species_name: 'species rules', bd_timeofday: 'time of day (R10)', bd_watertemp: 'water temperature',
  }
  const big = rows.filter((r) => Math.abs(r.d) > 35)
  const deltas = (r: Row) => [...new Set([...Object.keys(r.oldRows), ...Object.keys(r.newRows)])]
    .filter((k) => k !== 'bd_base' && !CLAMP.has(k)).map((k) => [k, (r.newRows[k] ?? 0) - (r.oldRows[k] ?? 0)] as const)
    .filter(([, v]) => v !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  const causeOf = (r: Row) => {
    const by = new Map<string, number>()
    for (const [k, v] of deltas(r)) {
      if (Math.sign(v) !== Math.sign(r.d)) continue
      const c = CAUSE[k] ?? `other: ${k}`
      by.set(c, (by.get(c) ?? 0) + Math.abs(v))
    }
    return [...by].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'base only'
  }
  const explained = (r: Row) => !causeOf(r).startsWith('other')
  const unexplained = big.filter((r) => !explained(r))
  const causeCount = new Map<string, number>()
  for (const r of big) {
    const k = `${r.d > 0 ? 'up' : 'down'}: ${causeOf(r)}`
    causeCount.set(k, (causeCount.get(k) ?? 0) + 1)
  }
  say(`## Windows with |Δ| > 35 (G4): ${big.length} (${big.filter((r) => r.d > 0).length} up, ${big.filter((r) => r.d < 0).length} down), unexplained ${unexplained.length}`)
  say(`By largest cause: ${[...causeCount].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join('; ')}.`)
  const fmtRows = (rs: Record<string, number>) => Object.entries(rs).map(([k, v]) => `${k.replace(/^bd_|^fac_/, '')} ${sgn(v)}`).join(', ')
  for (const r of [...unexplained, ...big.filter(explained)].slice(0, 40)) {
    const w = WINDOWS[r.c.wi]
    say(`- ${explained(r) ? '' : '**UNEXPLAINED** '}${r.spot} ${r.c.date.toISOString().slice(0, 10)} ${w.from}–${w.to} [${r.target}] ${r.oldS} → ${r.newS} (${sgn(r.d)}), ${causeOf(r)}; biggest: ${deltas(r).slice(0, 4).map(([k, v]) => `${k} ${sgn(v)}`).join(', ')}`)
    say(`  - old: ${fmtRows(r.oldRows)}`)
    say(`  - new: ${fmtRows(r.newRows)}`)
  }
  if (big.length > 40) say(`- … and ${big.length - 40} more (all explained unless counted above)`)
  say()

  // ── invariants (G5) and the lake (G6) ──
  let invBad = 0, rangeBad = 0, n = 0
  for (const v of ['tides', 'notides'] as const) for (const r of after.variants[v]) {
    if (r[0] == null) continue
    n++
    const sum = Object.values(rowsOf(after, r)).reduce((a, b) => a + b, 0)
    if (sum !== r[0]) invBad++
    if ((r[0] as number) < 0 || (r[0] as number) > 100) rangeBad++
  }
  const lake = rows.filter((r) => LOCS[r.c.si].waterType === 'fresh')
  const lakeBad = lake.filter((r) => 'bd_watertemp' in r.newRows || 'bd_tide' in r.newRows).length

  // ── R15 extras ──
  say('## Reminder threshold, share ≥ 55, havørred + makrel (R15)')
  say(g55.map((x) => `${x.se} ${x.ty}: ${x.old} % → ${x.neu} %`).join('; '))
  say()
  say('## Within-week spread per spot, p90 − p10 of the multi-hour windows over 7 days, mean of weeks (R15)')
  for (const si of LOCS.map((_, i) => i)) {
    const ts = LOCS[si].waterType === 'fresh' ? 'lake ' + tsName(HM) : tsName(HM)
    const spreads = (k: 'oldS' | 'newS') => {
      const out: number[] = []
      for (let pi = 0; pi < FIXTURE.periods.length; pi++) for (const ty of ['06-09', '17-21', '08-18']) for (const wk of [0, 1]) {
        const s = rows.filter((r) => r.c.si === si && r.c.pi === pi && r.type === ty && r.target === ts && r.c.day > wk * 7 && r.c.day <= wk * 7 + 7).map((r) => r[k])
        out.push(pct(s, 0.9) - pct(s, 0.1))
      }
      return mean(out).toFixed(1)
    }
    say(`- ${FIXTURE.spots[si].id}: ${spreads('oldS')} → ${spreads('newS')}`)
  }
  say()
  say('## January vs August, havørred + makrel at the coast (R15: how much fac_spot_name and bd_watertemp double-count makrel\'s absence)')
  const at = (se: string) => owner.filter((r) => r.season === se)
  const m = (rs: Row[], f: (r: Row) => number) => mean(rs.map(f)).toFixed(1)
  for (const se of ['Jan', 'Aug']) {
    const rs = at(se)
    say(`- ${se}: old ${m(rs, (r) => r.oldS)}, new ${m(rs, (r) => r.newS)}; new fac_spot_name ${m(rs, (r) => r.newRows.fac_spot_name ?? 0)}, new bd_watertemp ${m(rs, (r) => r.newRows.bd_watertemp ?? 0)}, old fac_spot_name ${m(rs, (r) => r.oldRows.fac_spot_name ?? 0)}`)
  }
  say()

  // ── ranking (R7) ──
  // Rank the four coastal spots per (period, day, window, targets), old vs new;
  // then the new model again with Tejn's sea temperature dropped, as the 10 km
  // snap limit would have done (its cell is 13.8 km out).
  const coastal = LOCS.map((l, i) => [l, i] as const).filter(([l]) => l.waterType !== 'fresh').map(([, i]) => i)
  const tejn = FIXTURE.spots.findIndex((s) => s.id === 'tejn')
  const groups = new Map<string, Row[]>()
  for (const r of owner) {
    if (!coastal.includes(r.c.si)) continue
    const k = `${r.c.pi}|${r.c.day}|${r.c.wi}`
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  const order = (rs: Row[], f: (r: Row) => number) => [...rs].sort((a, b) => f(b) - f(a) || a.c.si - b.c.si).map((r) => r.c.si).join(',')
  let rankChanged = 0, topChanged = 0, snapChanged = 0
  const noSst = new Map<number, ReturnType<typeof forecastFor>>()
  for (const rs of groups.values()) {
    if (order(rs, (r) => r.oldS) !== order(rs, (r) => r.newS)) rankChanged++
    if (order(rs, (r) => r.oldS)[0] !== order(rs, (r) => r.newS)[0]) topChanged++
    const alt = (r: Row) => {
      if (r.c.si !== tejn) return r.newS
      if (!noSst.has(r.c.pi)) {
        const f = forecastFor(r.c.pi, tejn, 'tides')
        noSst.set(r.c.pi, { ...f, marine: f.marine!.map((h) => ({ ...h, sstC: null })) })
      }
      const w = WINDOWS[r.c.wi]
      return scoreWindow(LOCS[tejn], r.c.date, w.from, w.to, noSst.get(r.c.pi), r.c.targets, 'shore').score
    }
    if (order(rs, (r) => r.newS) !== order(rs, alt)) snapChanged++
  }
  say(`## Ranking of the four coastal spots, havørred + makrel (R7): ${groups.size} (period, day, window) groups`)
  say(`- order changed old → new: ${rankChanged} (${share(Array(groups.size).fill(0).map((_, i) => +(i < rankChanged)), (v) => v === 1)} %); top spot changed: ${topChanged}`)
  say(`- with Tejn's sea temperature left out (a 10 km snap limit): order changes in ${snapChanged} groups against the 25 km rule`)
  say()

  // ── gates ──
  const pooled = pct(owner.filter((r) => coastal.includes(r.c.si)).map((r) => r.d), 0.5)
  const g2bad = g2.filter((x) => Math.abs(x.med) > x.lim)
  const single = owner.filter((r) => r.type === '1h' && coastal.includes(r.c.si)).map((r) => r.d)
  const singleCells = seasons.map((se) => owner.filter((r) => r.type === '1h' && r.season === se && coastal.includes(r.c.si)).map((r) => r.d))
  const worstP95 = Math.max(...singleCells.map((d) => pct(d, 0.95))), worstP5 = Math.min(...singleCells.map((d) => pct(d, 0.05)))
  const g55bad = g55.filter((x) => Math.abs(x.neu - x.old) > 10)
  const pass = (b: boolean) => (b ? 'PASS' : 'FAIL')
  say('## Gates')
  say(`- G1 pooled median Δ (havørred + makrel, coast) within ±1: ${sgn(pooled)} — ${pass(Math.abs(pooled) <= 1)}`)
  say(`- G2 median Δ per target set × season × window within ±10 (havørred alone ±12; lake included): worst ${sgn(g2.reduce((a, x) => (Math.abs(x.med) > Math.abs(a) ? x.med : a), 0))}${g2bad.length ? `; outside: ${g2bad.map((x) => `${x.ts} ${x.se} ${x.ty} ${sgn(x.med)}`).join(', ')}` : ''} — ${pass(!g2bad.length)}`)
  say(`- G3 single-hour Δ p5 ≥ −30 and p95 ≤ 30 (havørred + makrel, coast): pooled ${sgn(pct(single, 0.05))} / ${sgn(pct(single, 0.95))}, worst season ${sgn(worstP5)} / ${sgn(worstP95)} — ${pass(pct(single, 0.05) >= -30 && pct(single, 0.95) <= 30)}`)
  say(`- G4 every |Δ| > 35 window explained: ${big.length - unexplained.length}/${big.length} — ${pass(!unexplained.length)}`)
  say(`- G5 Σ rows = score and 0 ≤ score ≤ 100 in after.json: ${n - invBad - rangeBad}/${n} — ${pass(!invBad && !rangeBad)}`)
  say(`- G6 the lake has no bd_watertemp or bd_tide row: ${lake.length - lakeBad}/${lake.length} — ${pass(!lakeBad)}`)
  say(`- R15 share ≥ 55 within ±10 pp per season, 06-09 and 17-21: ${g55bad.length ? g55bad.map((x) => `${x.se} ${x.ty} ${x.old}→${x.neu}`).join(', ') : 'all within'} — ${pass(!g55bad.length)}`)

  const text = out.join('\n')
  console.log(text)
  if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, text)
})
