/**
 * Scores every window of the fixture with the model in src/ and writes
 * <OUT>.json.gz (OUT=before|after|v3). before.json.gz was recorded from the
 * model as it was at ed34b06, before scoring.ts / species.ts / solunar.ts
 * changed, and is committed: it is the baseline every later run compares
 * against. v3.json.gz is model v3 at 71d2038, before the onshore-wind change,
 * enumerated with onshoreTargetSets (the owner's three targets added): the
 * baseline onshore.check.ts compares against. after.json.gz is v3 too, but
 * without the three-target set the onshore row is sized for.
 */
import { it } from 'vitest'
import { scoreWindow } from '@/lib/scoring'
import { LOCS, VARIANTS, WINDOWS, cells, encoder, forecastFor, onshoreTargetSets, targetSets, writeRecords, type RecordFile, type Variant } from './lib'

declare const process: { env: Record<string, string | undefined> }

it('record', () => {
  const out = process.env.OUT
  if (out !== 'before' && out !== 'after' && out !== 'v3') throw new Error('set OUT=before, OUT=after or OUT=v3')
  const sets = out === 'v3' ? onshoreTargetSets : targetSets
  const file: RecordFile = { model: process.env.MODEL ?? out, keys: [], variants: { tides: [], notides: [] } }
  const enc = encoder(file.keys)
  // One forecast per (period, spot, variant), as the app holds one per spot.
  const fc = new Map<string, ReturnType<typeof forecastFor>>()
  // Per day too: the tide range is the dashboard's [day − 1, day + 7) one.
  const forecast = (pi: number, si: number, v: Variant, date: Date) => {
    const k = `${pi}|${si}|${v}|${date.getTime()}`
    if (!fc.has(k)) fc.set(k, forecastFor(pi, si, v, date))
    return fc.get(k)!
  }
  for (const v of VARIANTS) {
    for (const c of cells(sets)) {
      const w = WINDOWS[c.wi]
      file.variants[v].push(enc(scoreWindow(LOCS[c.si], c.date, w.from, w.to, forecast(c.pi, c.si, v, c.date), c.targets, 'shore')))
    }
  }
  writeRecords(out, file)
  console.log(`${out}: ${file.variants.tides.length} windows × ${VARIANTS.length} variants, ${file.keys.length} row keys: ${file.keys.join(' ')}`)
})
