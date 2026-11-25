// @vitest-environment vue-dom
/**
 * Modeltjek, as mounted, after an analysis. Its result belongs to the log
 * and the setup it ran with: the entries, their spots, the target species
 * and the time windows its baseline is built from. A change to any of them
 * puts the result away until it runs again, and the panel said "Loggen er
 * ændret siden sidste analyse" whichever it was: a new time window or
 * target species read as a log changed behind the user's back.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { h, nextTick, shallowRef } from 'vue'
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'
import { DK_SPOTS, locationFromSpot } from '@/lib/spots'
import { entryCoast, entryFingerprint, insight, runCoasts, runFingerprint } from '@/lib/insightRun'
import { langReady, setLang, t } from '@/lib/i18n'
import type { WindowSample } from '@/lib/catchInsights'
import type { Availability, CatchEntry, Location } from '@/lib/types'
import ModelCheckPanel from './ModelCheckPanel.vue'

const LOCS: Location[] = DK_SPOTS.filter((s) => s.waterType !== 'fresh').slice(0, 2)
  .map((s, i) => ({ id: 'L' + i, ...locationFromSpot(s) }))
const AVAIL: Availability[] = [{ id: 'a', days: [0, 1, 2, 3, 4, 5, 6], from: '06:00', to: '09:00', methods: ['shore'] }]
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d) }
const at = (i: number) => ({ locationName: LOCS[i].name, locationId: LOCS[i].id })
const ENTRIES: CatchEntry[] = [
  { id: 'c1', date: daysAgo(10), time: '06:30', speciesId: 'havørred', ...at(0), notes: '' },
  { id: 't1', outcome: 'empty', date: daysAgo(12), from: '05:00', to: '08:00', speciesId: '', count: 0, ...at(1), notes: '' },
]

function sample(score: number, loc: Location): WindowSample {
  return {
    window: { score, location: loc, date: new Date(Date.UTC(2026, 9, 1)), from: '06:00', to: '09:00' },
    hours: [{ at: 0, score, breakdown: [], cond: { tod: 'dawn' } }],
  } as unknown as WindowSample
}

/** What an analysis of these entries with this setup leaves behind. */
function analysed(entries: CatchEntry[], targets: string[]) {
  insight.results.clear()
  for (const e of entries) {
    const loc = LOCS.find((l) => l.id === e.locationId)!
    insight.results.set(e.id, { fp: entryFingerprint(e, LOCS, targets), coast: entryCoast(e, LOCS, targets, {}), result: sample(60, loc) })
  }
  insight.run = { fp: runFingerprint(entries, LOCS, AVAIL, targets), coast: runCoasts(entries, LOCS, targets, {}), base: [] }
}

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined

beforeEach(() => {
  restoreDocument = installDocument()
  localStorage.clear()
})
afterEach(() => {
  view?.unmount()
  view = undefined
  insight.results.clear()
  insight.run = null
  setLang('da')
  restoreDocument()
})

/** The panel after an analysis, opened, with the entries, targets and time windows it was given then; each can be changed. */
async function openPanel() {
  const entries = shallowRef(ENTRIES.map((e) => ({ ...e })))
  const targets = shallowRef(['havørred'])
  const availability = shallowRef(AVAIL.map((a) => ({ ...a })))
  analysed(entries.value, targets.value)
  view = mount({
    render: () => h(ModelCheckPanel, {
      entries: entries.value, locations: LOCS, availability: availability.value, targetSpecies: targets.value, shores: {},
    }),
  })
  await nextTick()
  const panel = view.root.byClass('modelcheck')[0]
  panel.byClass('mc-toggle')[0].click()
  await nextTick()
  return { panel, entries, targets, availability }
}
const notes = (panel: FakeNode) => panel.byClass('mc-sub').map((n) => n.textContent)

describe('Modeltjek after an analysis, when something it ran with changes', () => {
  it('a time window changed: the note says the setup may have, not only the log', async () => {
    const { panel, availability } = await openPanel()
    expect(notes(panel)).not.toContain(t('insight_stale'))
    availability.value = [{ ...AVAIL[0], from: '07:00' }]
    await nextTick()
    expect(notes(panel)).toContain(t('insight_stale'))
    expect(t('insight_stale')).toMatch(/opsætning/)
  })

  it('the target species changed: the same', async () => {
    const { panel, targets } = await openPanel()
    targets.value = ['havørred', 'torsk']
    await nextTick()
    expect(notes(panel)).toContain(t('insight_stale'))
  })

  it('an entry changed: the note names the log', async () => {
    const { panel, entries } = await openPanel()
    entries.value = entries.value.map((e) => (e.id === 'c1' ? { ...e, time: '07:30' } : e))
    await nextTick()
    expect(notes(panel)).toContain(t('insight_stale'))
    expect(t('insight_stale')).toMatch(/^Loggen/)
  })

  it('in English too', async () => {
    const { panel, availability } = await openPanel()
    setLang('en')
    expect(await langReady()).toBe(true)
    availability.value = [{ ...AVAIL[0], from: '07:00' }]
    await nextTick()
    expect(notes(panel)).toContain(t('insight_stale'))
    expect(t('insight_stale')).toMatch(/log/i)
    expect(t('insight_stale')).toMatch(/setup/i)
  })
})
