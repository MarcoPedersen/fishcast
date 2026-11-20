// @vitest-environment vue-dom
/**
 * The catch log's decimals, as mounted: a catch's length and weight on its
 * card, the longest and heaviest fish over the log, and the undersize note.
 * The Danish screen wrote them with a full stop ("⚖️ 2.5 kg", "45.5 cm").
 * They follow the language shown, and change with it while the log is open.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'
import { DK_SPOTS, locationFromSpot } from '@/lib/spots'
import { clearCatchDraft } from '@/lib/catchDraft'
import { insight } from '@/lib/insightRun'
import { langReady, setLang } from '@/lib/i18n'
import { STRINGS } from '@/test/strings'
import { fakeDb } from '@/test/fakeSupabase'
import type { CatchEntry, Location } from '@/lib/types'
import { useAuthStore } from '@/stores/auth'
import { useCatchStore } from '@/stores/catches'
import { useSetupStore } from '@/stores/setup'
import CatchLogView from './CatchLogView.vue'

const LOCS: Location[] = DK_SPOTS.filter((s) => s.waterType === 'salt').slice(0, 1)
  .map((s, i) => ({ id: 'L' + i, ...locationFromSpot(s) }))
const at = { locationName: LOCS[0].name, locationId: LOCS[0].id }
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d) }

/** Each entry's note is its id, to find its card by. */
const ENTRIES: CatchEntry[] = [
  { id: 'big', date: daysAgo(10), time: '06:30', speciesId: 'torsk', ...at, lengthCm: 45.5, weightKg: 2.5, notes: 'big' },
  { id: 'small', date: daysAgo(11), time: '07:00', speciesId: 'torsk', ...at, lengthCm: 30, weightKg: 0.75, notes: 'small' },
  // Sea trout's minimum is 40 cm on the coast: kept, it is undersized.
  { id: 'short', date: daysAgo(12), time: '07:00', speciesId: 'havørred', ...at, lengthCm: 35.5, released: false, notes: 'short' },
]

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined
let pinia: ReturnType<typeof createPinia>

async function mountLog(): Promise<FakeNode> {
  pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.loading = false
  auth.user = null
  useCatchStore().entries = ENTRIES.map((e) => ({ ...e }))
  const setup = useSetupStore()
  setup.locations = LOCS.map((l) => ({ ...l }))
  setup.targetSpecies = ['havørred']
  setup.availability = []
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/log', name: 'catchlog', component: { render: () => null } }] })
  await router.push('/log')
  view = mount(CatchLogView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
  await nextTick()
  return view.root
}

const cardOf = (root: FakeNode, id: string) => root.byClass('card entry').find((n) => n.byClass('entry-notes')[0]?.textContent === id)!
/** What the log shows with a decimal in it: each card's sizes, the stats, the undersize note. */
const shown = (root: FakeNode) => ({
  big: cardOf(root, 'big').byClass('size').map((n) => n.textContent),
  small: cardOf(root, 'small').byClass('size').map((n) => n.textContent),
  stats: root.byClass('stat-val').map((n) => n.textContent).filter((s) => / (cm|kg)$/.test(s)),
  undersize: cardOf(root, 'short').byClass('entry-guard')[0].textContent.split('⚠️').map((s) => s.trim()).filter((s) => s.includes('35')),
})
const inDanish = {
  big: ['📏 45,5 cm', '⚖️ 2,5 kg'],
  small: ['📏 30 cm', '⚖️ 0,75 kg'],
  stats: ['45,5 cm', '2,5 kg'],
  undersize: [STRINGS.da.guard_undersize.replace('{len}', '35,5').replace('{min}', '40')],
}

beforeEach(() => {
  restoreDocument = installDocument()
  fakeDb.reset()
  localStorage.removeItem('fc2-catches')
  clearCatchDraft()
  insight.results.clear()
  insight.loading.clear()
})
afterEach(() => {
  view?.unmount()
  view = undefined
  setLang('da')
  restoreDocument()
})

describe('the catch log writes its decimals', () => {
  it('with a comma in Danish', async () => {
    expect(shown(await mountLog())).toEqual(inDanish)
  })

  it('with a point once English is shown, and with a comma again after a switch back', async () => {
    const root = await mountLog()
    setLang('en')
    expect(await langReady()).toBe(true)
    setActivePinia(pinia)
    await nextTick()
    expect(shown(root)).toEqual({
      big: ['📏 45.5 cm', '⚖️ 2.5 kg'],
      small: ['📏 30 cm', '⚖️ 0.75 kg'],
      stats: ['45.5 cm', '2.5 kg'],
      undersize: [STRINGS.en.guard_undersize.replace('{len}', '35.5').replace('{min}', '40')],
    })
    setLang('da')
    await nextTick()
    expect(shown(root)).toEqual(inDanish)
  })
})
