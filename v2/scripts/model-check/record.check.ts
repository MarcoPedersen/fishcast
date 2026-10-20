/**
 * Scores every window of the fixture with the model in src/ and writes
 * <OUT>.json.gz (OUT=before|after). before.json.gz was recorded from the model
 * as it was at ed34b06, before scoring.ts / species.ts / solunar.ts changed,
 * and is committed: it is the baseline every later run compares against.
 */
import { it } from 'vitest'
import { scoreWindow } from '@/lib/scoring'
import { LOCS, VARIANTS, WINDOWS, cells, encoder, forecastFor, writeRecords, type RecordFile, type Variant } from './lib'

declare const process: { env: Record<string, string | undefined> }

it('record', () => {
  const out = process.env.OUT
  if (out !== 'before' && out !== 'after') throw new Error('set OUT=before or OUT=after')
  const file: RecordFile = { model: process.env.MODEL ?? out, keys: [], variants: { tides: [], notides: [] } }
  const enc = encoder(file.keys)
  // One forecast per (period, spot, variant), as the app holds one per spot.
  const fc = new Map<string, ReturnType<typeof forecastFor>>()
  const forecast = (pi: number, si: number, v: Variant) => {
    const k = `${pi}|${si}|${v}`
    if (!fc.has(k)) fc.set(k, forecastFor(pi, si, v))
    return fc.get(k)!
  }
  for (const v of VARIANTS) {
    for (const c of cells()) {
      const w = WINDOWS[c.wi]
      file.variants[v].push(enc(scoreWindow(LOCS[c.si], c.date, w.from, w.to, forecast(c.pi, c.si, v), c.targets, 'shore')))
    }
  }
  writeRecords(out, file)
  console.log(`${out}: ${file.variants.tides.length} windows × ${VARIANTS.length} variants, ${file.keys.length} row keys: ${file.keys.join(' ')}`)
})
