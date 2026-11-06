/**
 * The owner-spot report (onshore spec §5.3, with the critique's R1.5 and
 * R2.2): derives the coast of each spot in a local setup file live, as the
 * app would, and scores canonical winds against it. LOCAL ONLY — the setup,
 * the expectations and the report are the owner's data and never enter the
 * repo; this file holds no spot names or coordinates. Run from v2/:
 *   OWNER_SETUP=<setup.json> OWNER_EXPECT=<expect.json> OUT=<report.md> \
 *     npx vitest run --config scripts/model-check/vitest.config.mjs coast-owner
 * OWNER_EXPECT: { [spot name]: { expect: [lo, hi] | null, exposure, wx: fixture
 * spot id for the weather, ofm?: an earlier OpenFreeMap facing } }.
 * Skipped unless OWNER_SETUP is set; refuses to write OUT inside the repo;
 * prints spot names and numbers, never coordinates. Network: VersaTiles,
 * ≤ 2 requests/s, ~5 derivations per spot (the pin and ±50 m), tiles shared.
 */
import { it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deriveAt } from '@/lib/coastFetch'
import { angDist, resolveShore, type CoastAuto, type Shore } from '@/lib/coast'
import { scoreWindow, shoreRelation } from '@/lib/scoring'
import { windDir } from '@/lib/conditions'
import { SPECIES_PREFS } from '@/lib/species'
import type { Forecast, HourData, Location } from '@/lib/types'
import { FIXTURE, OWNER3, forecastFor } from './lib'

declare const process: { env: Record<string, string | undefined> }
const UA = { 'User-Agent': 'FishCast-owner-check/1 (+https://github.com/marcopedersen/fishcast)' }
const DIRS8 = [0, 45, 90, 135, 180, 225, 270, 315]
const FALLBACK = SPECIES_PREFS.havørred.bonuses.windOrChop
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** One hour of 6 m/s from `dir`, SST 9 °C, 0.5 m waves: the canonical havørred row (scoring.test.ts's base case). */
function canonical(loc: Location, shore: Shore | null, dir: number, ms = 6): number | null {
  const day = new Date(Date.UTC(2026, 3, 15))
  const t = new Date(2026, 3, 15, 12).getTime()
  const hourly: HourData[] = [-3, 0].map((h) => ({ time: t + h * 3600000, temp: 10, windMs: ms, windDir: dir, gustMs: ms + 2, cloud: 40, precipPct: 0, pressure: 1013 }))
  const f: Forecast = { fetched: 0, hourly, marine: hourly.map((h) => ({ time: h.time, waveM: 0.5, wavePeriod: 4, sstC: 9 })), tides: null }
  const w = scoreWindow(loc, day, '12:00', '12:30', f, ['havørred'], 'shore', shore)
  const r = w.breakdown?.find((b) => b.key === 'bd_shorewind')
  return shore ? (r?.points ?? 0) : null
}
const lerpExpect = (e: [number, number]) => (e[0] + e[1]) / 2
const offRange = (deg: number, e: [number, number]) => (deg >= e[0] && deg <= e[1] ? 0 : Math.min(angDist(deg, e[0]), angDist(deg, e[1])))

it.skipIf(!process.env.OWNER_SETUP)('coast-owner', async () => {
  const out = process.env.OUT
  if (!out) throw new Error('set OUT=<report.md> outside the repo')
  const repo = path.resolve(fileURLToPath(new URL('../../..', import.meta.url)))
  const target = path.resolve(out)
  if (target.toLowerCase().startsWith(repo.toLowerCase() + path.sep)) throw new Error('OUT must be outside the repository')
  const setup = JSON.parse(fs.readFileSync(process.env.OWNER_SETUP!, 'utf8'))
  const locs: Location[] = (setup.setup ?? setup).locations
  const expect: Record<string, { expect: [number, number] | null; exposure: string; wx: string; ofm?: number; owner?: boolean }> =
    process.env.OWNER_EXPECT ? JSON.parse(fs.readFileSync(process.env.OWNER_EXPECT, 'utf8')) : {}
  const opts = { headers: UA, minGapMs: 500 }
  const lines: string[] = []
  const say = (s = '') => lines.push(s)
  const dirName = (d: number | null) => (d == null ? '—' : `${d}° ${windDir(d, true)}`)

  interface Row { loc: Location; auto: CoastAuto; shore: Shore | null | undefined; jit: CoastAuto[] }
  const rows: Row[] = []
  for (const loc of locs) {
    if (loc.waterType === 'fresh') continue
    const auto = await deriveAt(loc.lat, loc.lon, opts)
    const jit: CoastAuto[] = []
    for (const a of [0, 90, 180, 270]) {
      const r = (a * Math.PI) / 180
      jit.push(await deriveAt(loc.lat + (50 * Math.cos(r)) / 110540, loc.lon + (50 * Math.sin(r)) / (111320 * Math.cos((loc.lat * Math.PI) / 180)), opts))
    }
    rows.push({ loc, auto, shore: resolveShore(loc, auto), jit })
    console.log(`derived ${loc.name}`)
  }

  // ── 1. facings, and the gates ──
  say('## Owner spots: derived coast (VersaTiles, this algorithm)')
  say('| spot | facing B | near A | spread | exposure | pin→water | issues | scored as | expected | Δ | OFM earlier |')
  say('|---|---|---|---|---|---|---|---|---|---|---|')
  const misses: string[] = [], vsOfm: string[] = []
  for (const { loc, auto, shore } of rows) {
    const e = expect[loc.name]
    const d = e?.expect && auto.facing != null ? offRange(auto.facing, e.expect) : null
    const scored = shore === undefined ? `unknown → prompt, +${FALLBACK} fallback` : shore === null ? 'none' : shore.mode
    say(`| ${loc.name} | ${dirName(auto.facing)} | ${dirName(auto.nearFacing)} | ${auto.spread} | ${auto.exposure ?? '—'} | ${auto.pinToWaterM ?? '—'} m | ${auto.issues.join(', ')} | ${scored} | ${e?.expect ? (e.expect[0] === e.expect[1] ? e.expect[0] : e.expect.join('–')) + '°' : '—'} ${e?.exposure ?? ''}${e?.owner ? ' (owner)' : ''} | ${d ?? '—'}° | ${e?.ofm ?? '—'}° |`)
    if (e?.expect && d != null && d > 45) misses.push(`${loc.name}: facing ${auto.facing}° vs expected ${e.expect.join('–')}° — propose a manual coast facing ${Math.round(lerpExpect(e.expect) / 22.5) * 22.5}°`)
    if (e?.ofm != null && auto.facing != null && angDist(auto.facing, e.ofm) > 30) vsOfm.push(`${loc.name}: VersaTiles ${auto.facing}° vs OpenFreeMap ${e.ofm}° (${angDist(auto.facing, e.ofm)}°)`)
  }
  say()
  say(`Facing gate (within 45° of the expected): ${misses.length ? 'MISSES — ' + misses.join('; ') : 'all spots with an expected value PASS'}`)
  say(`VersaTiles vs the earlier OpenFreeMap run, > 30° apart: ${vsOfm.length ? vsOfm.join('; ') : 'none'}`)
  say()

  // R1.5: the scored canonical winds, not just facing B.
  say(`## Canonical winds: havørred alone, 6 m/s, SST 9 °C, 0.5 m waves (bd_shorewind; "—" = coast unknown, the +${FALLBACK} windOrChop fallback pays)`)
  say(`| spot | ${DIRS8.map((d) => windDir(d, true)).join(' | ')} | from expected | from opposite | gate |`)
  say(`|---|${DIRS8.map(() => '---').join('|')}|---|---|---|`)
  const canon = new Map<string, (number | null)[]>()
  for (const { loc, shore } of rows) {
    const pts = DIRS8.map((d) => canonical(loc, shore ?? null, d))
    canon.set(loc.name, pts)
    const e = expect[loc.name]?.expect
    const f = e ? canonical(loc, shore ?? null, lerpExpect(e)) : null, o = e ? canonical(loc, shore ?? null, (lerpExpect(e) + 180) % 360) : null
    const gate = !e ? 'n/a' : shore == null ? (shore === undefined ? 'PROMPT (user picks)' : 'NOT SCORED') : f! >= 5 && o! <= 0 ? 'PASS' : 'FAIL'
    say(`| ${loc.name} | ${pts.map((p) => (p == null ? '—' : p)).join(' | ')} | ${f ?? '—'} | ${o ?? '—'} | ${gate} |`)
  }
  say()

  // R2.2: ±50 m in 4 directions — the canonical row moves ≤ 3, or the spot gets a prompt.
  say('## Jitter: the pin moved 50 m N / E / S / W')
  say('| spot | facing at the 4 points | largest change of a canonical row | prompt at the pin | gate |')
  say('|---|---|---|---|---|')
  for (const { loc, auto, shore, jit } of rows) {
    const base = DIRS8.map((d) => canonical(loc, shore ?? null, d) ?? FALLBACK)
    let worst = 0
    for (const j of jit) {
      const s = resolveShore(loc, j)
      const p = DIRS8.map((d) => canonical(loc, s ?? null, d) ?? FALLBACK)
      worst = Math.max(worst, ...p.map((x, k) => Math.abs(x - base[k])))
    }
    const prompt = auto.issues.length > 0
    say(`| ${loc.name} | ${jit.map((j) => j.facing ?? '—').join(' / ')} | ${worst} | ${prompt ? auto.issues.join(', ') : 'no'} | ${worst <= 3 || prompt ? 'PASS' : 'FAIL'} |`)
  }
  say()

  // ── 2. the fixture weather of the same coast side ──
  say('## Relation and row by month, with the weather of the nearest fixture spot of the same coast side')
  say('Hours with ≥ 1.5 m/s: on / side / off %; mean bd_shorewind per hour for the owner\'s three targets / havørred alone.')
  const months = FIXTURE.periods.map((p) => MONTH[Number(p.start.slice(5, 7)) - 1])
  say(`| spot (weather) | ${months.join(' | ')} |`)
  say(`|---|${months.map(() => '---').join('|')}|`)
  for (const { loc, shore } of rows) {
    const wx = expect[loc.name]?.wx ?? 'dragor'
    const fsi = FIXTURE.spots.findIndex((s) => s.id === wx)
    const cellsTxt = FIXTURE.periods.map((p, pi) => {
      const start = new Date(p.start + 'T00:00:00Z')
      let on = 0, side = 0, off = 0, n = 0
      const o3: number[] = [], hv: number[] = []
      for (let day = 1; day <= 14; day++) {
        const date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + day))
        const f = forecastFor(pi, fsi, 'tides', date)
        for (let h = 0; h < 24; h++) {
          const t = new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), h).getTime()
          const hd = f.hourly.find((x) => Math.abs(x.time - t) < 1800000)
          if (hd?.windMs != null && hd.windMs >= 1.5) {
            n++
            const r = shoreRelation(hd.windDir, hd.windMs, shore ?? null)
            if (r === 'on') on++; else if (r === 'side') side++; else if (r === 'off') off++
          }
          const from = `${h}:00`, to = `${h}:30`
          const pt = (ts: string[]) => scoreWindow(loc, date, from, to, f, ts, 'shore', shore ?? null).breakdown?.find((b) => b.key === 'bd_shorewind')?.points ?? 0
          o3.push(pt(OWNER3)); hv.push(pt(['havørred']))
        }
      }
      const m = (a: number[]) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)
      return shore ? `${Math.round((100 * on) / n)}/${Math.round((100 * side) / n)}/${Math.round((100 * off) / n)} · ${m(o3)}/${m(hv)}` : '—'
    })
    say(`| ${loc.name} (${wx}) | ${cellsTxt.join(' | ')} |`)
  }

  fs.writeFileSync(target, lines.join('\n') + '\n')
  console.log(`wrote the report (${rows.length} spots)`)
})
