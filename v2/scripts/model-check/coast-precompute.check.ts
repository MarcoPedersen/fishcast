/**
 * Precomputes the coast of every coastal official spot (onshore spec §1.7)
 * into src/lib/spotCoast.gen.ts, with the same deriveAt the app runs, and the
 * fixture's custom coast spots into coast-fixture.json (onshore.check.ts reads
 * them: critique R1.4 wants the DERIVED value at the fixture's Kalundborg pin).
 *
 * Network: ~150 VersaTiles tile requests at ≤ 2/s, an identifying User-Agent,
 * 429 + Retry-After honoured (coastFetch.ts). Skipped unless PRECOMPUTE=1, so
 * a normal check run never touches the network. Run from v2/:
 *   PRECOMPUTE=1 npx vitest run --config scripts/model-check/vitest.config.mjs coast-precompute
 * coast-overrides.json (official spots only) fixes a spot whose geometry is
 * clearly wrong: { slug: { facing, spread, exposure, reason } }.
 */
import { it } from 'vitest'
import fs from 'node:fs'
import { deriveAt } from '@/lib/coastFetch'
import { COAST_ALGO_VERSION, isCoastOverride, type CoastAuto } from '@/lib/coast'
import { spotCoastHeader } from '@/lib/osmCredit'
import { DK_SPOTS } from '@/lib/spots'
import { FIXTURE } from './lib'

declare const process: { env: Record<string, string | undefined> }
const here = (f: string) => new URL(`./${f}`, import.meta.url)
const UA = { 'User-Agent': 'FishCast-precompute/1 (+https://github.com/marcopedersen/fishcast)' }

it.skipIf(process.env.PRECOMPUTE !== '1')('coast-precompute', async () => {
  const overrides: Record<string, { facing: number; spread: number; exposure: string; reason: string }> =
    JSON.parse(fs.readFileSync(here('coast-overrides.json'), 'utf8'))
  const layersSeen = new Set<string>()
  const opts = { src: 'catalogue' as const, headers: UA, minGapMs: 500, onLayers: (_t: string, l: string[]) => l.forEach((x) => layersSeen.add(x)) }
  const out: Record<string, Omit<CoastAuto, 'at'>> = {}
  const rows: string[] = ['| slug | name | type | facing | near | spread | exposure | pin→water m | issues | fetchKm N…NNW | flag |', '|---|---|---|---|---|---|---|---|---|---|---|']
  const coastal = DK_SPOTS.filter((s) => s.waterType !== 'fresh' && s.spotType !== 'lake' && s.spotType !== 'river')
  for (const s of coastal) {
    const { at: _at, ...r } = await deriveAt(s.lat, s.lon, opts)
    let entry: Omit<CoastAuto, 'at'> = r
    const o = overrides[s.slug]
    if (o) {
      const co = { facing: o.facing, spread: o.spread, exposure: o.exposure }
      if (!isCoastOverride(co)) throw new Error(`bad override for ${s.slug}`)
      // A hand-set coast is sea by definition: a lagoon behind the beach read as inland (Ishøj Strand).
      entry = { ...r, water: 'sea', facing: co.facing, spread: co.spread, exposure: co.exposure, fixed: true, issues: [] }
    }
    out[s.slug] = entry
    const flag = [
      s.spotType === 'pier' && r.spread === 180 && 'pier→180',
      s.spotType === 'coast' && r.spread === 360 && 'coast→360',
      r.water !== 'sea' && `water ${r.water}`,
      r.issues.length && 'issues',
      o && `OVERRIDE: ${o.reason}`,
    ].filter(Boolean).join('; ')
    rows.push(`| ${s.slug} | ${s.name} | ${s.spotType} | ${r.facing ?? '—'} | ${r.nearFacing ?? '—'} | ${r.spread} | ${r.exposure ?? '—'} | ${r.pinToWaterM ?? '—'} | ${r.issues.join(',')} | ${r.fetchKm.join(' ')} | ${flag} |`)
  }
  const date = new Date().toISOString().slice(0, 10)
  // The header offers the table under the ODbL, crediting OSM (lib/osmCredit.ts, review C5).
  const ts = [
    ...spotCoastHeader({ date, algo: COAST_ALGO_VERSION, count: Object.keys(out).length }),
    "import type { CoastAuto } from './coast'",
    'export const SPOT_COAST: Record<string, Omit<CoastAuto, \'at\'>> = {',
    ...Object.entries(out).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`),
    '}',
    '',
  ].join('\n')
  fs.writeFileSync(new URL('../../src/lib/spotCoast.gen.ts', import.meta.url), ts)

  // The fixture's custom coastal spots (official ones come from the catalogue above).
  const fixture: Record<string, Omit<CoastAuto, 'at'>> = {}
  for (const sp of FIXTURE.spots) {
    if (sp.slug || sp.waterType === 'fresh') continue
    const { at: _at, ...r } = await deriveAt(sp.lat, sp.lon, { ...opts, src: 'versatiles' })
    fixture[sp.id] = r
  }
  fs.writeFileSync(here('coast-fixture.json'), JSON.stringify(fixture, null, 1) + '\n')

  const text = [`## Catalogue review (${Object.keys(out).length} coastal official spots)`, '', ...rows, '',
    `Layers seen in the tiles: ${[...layersSeen].sort().join(', ')}`, '',
    `Fixture custom spots: ${Object.entries(fixture).map(([k, v]) => `${k} facing ${v.facing} near ${v.nearFacing} spread ${v.spread} ${v.exposure} issues [${v.issues}] fetch ${v.fetchKm.join(' ')}`).join('; ')}`].join('\n')
  console.log(text)
  if (process.env.REPORT) fs.writeFileSync(process.env.REPORT, text)
})
