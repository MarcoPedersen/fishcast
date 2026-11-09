// @vitest-environment vue-dom
/**
 * The catch log as mounted: what each entry's card shows and what its
 * buttons do. The real view, Pinia and router, on the in-memory DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'
import { DK_SPOTS, locationFromSpot } from '@/lib/spots'
import { coastOutdated, entryCoast, entryFingerprint, insight, resultFor, scoreOne, type EntryResult } from '@/lib/insightRun'
import { catchWarnings } from '@/lib/catchGuard'
import { catchPlaceName, scoreBlocker } from '@/lib/catchScore'
import { confirmAccept, confirmCancel, confirmState } from '@/lib/confirm'
import { setLang, t } from '@/lib/i18n'
import { scoreColor, scoreLabel } from '@/lib/scoring'
import { STRINGS } from '@/lib/strings'
import type { WindowSample } from '@/lib/catchInsights'
import type { CatchEntry, Location } from '@/lib/types'
import { useCatchStore } from '@/stores/catches'
import { useCoastStore } from '@/stores/coast'
import { useSetupStore } from '@/stores/setup'
import CatchLogView from './CatchLogView.vue'

// The real functions, watched: which ones a card calls, and with what.
vi.mock('@/lib/insightRun', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/insightRun')>()
  return { ...m, scoreOne: vi.fn(m.scoreOne), resultFor: vi.fn(m.resultFor), coastOutdated: vi.fn(m.coastOutdated) }
})
vi.mock('@/lib/catchGuard', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/catchGuard')>()
  return { ...m, catchWarnings: vi.fn(m.catchWarnings) }
})
vi.mock('@/lib/catchScore', async (importOriginal) => {
  const m = await importOriginal<typeof import('@/lib/catchScore')>()
  return { ...m, catchPlaceName: vi.fn(m.catchPlaceName), scoreBlocker: vi.fn(m.scoreBlocker) }
})
/** What a card works out for its entry: its place, warnings and score (each score lookup a JSON fingerprint). */
const PER_ENTRY = { resultFor, coastOutdated, catchWarnings, catchPlaceName, scoreBlocker }

const TARGETS = ['havørred'] // reads the coast (shoreWind), so a coast can move its scores
const LOCS: Location[] = DK_SPOTS.filter((s) => s.waterType !== 'fresh').slice(0, 2)
  .map((s, i) => ({ id: 'L' + i, ...locationFromSpot(s) }))

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d) }
const at = (i: number) => ({ locationName: LOCS[i].name, locationId: LOCS[i].id })

/** One card per state worth showing. Each entry's note is its id, to find its card by. */
function entries(): CatchEntry[] {
  const es: Omit<CatchEntry, 'notes'>[] = [
    { id: 'scored', date: daysAgo(10), time: '06:30', speciesId: 'havørred', ...at(0), lengthCm: 30, released: false, method: 'shore' },
    { id: 'coast', date: daysAgo(11), time: '07:00', speciesId: 'torsk', ...at(0), count: 3, weightKg: 2.5 },
    // Linked to L1, saved under the name it had before a rename; no time.
    { id: 'renamed', date: daysAgo(12), speciesId: 'havørred', locationName: 'Gammelt navn', locationId: 'L1', released: true },
    { id: 'free', date: daysAgo(13), time: '08:00', speciesId: '', locationName: 'Et sted uden navn' },
    { id: 'trip-nospan', outcome: 'empty', date: daysAgo(14), speciesId: '', count: 0, ...at(0) },
    { id: 'old', date: daysAgo(800), time: '06:00', speciesId: 'havørred', ...at(0) },
    { id: 'unscored', date: daysAgo(15), time: '06:00', speciesId: 'havørred', ...at(1) },
    { id: 'failed', date: daysAgo(16), time: '06:00', speciesId: 'havørred', ...at(1) },
    { id: 'none', date: daysAgo(17), time: '06:00', speciesId: 'havørred', ...at(1) },
    { id: 'loading', date: daysAgo(18), time: '06:00', speciesId: 'havørred', ...at(1) },
    { id: 'trip', outcome: 'empty', date: daysAgo(20), from: '05:00', to: '08:00', speciesId: '', count: 0, ...at(1), method: 'waders' },
  ]
  return es.map((e) => ({ ...e, notes: e.id }))
}

function sample(score: number): WindowSample {
  return { window: { score }, hours: [{ at: 0, score, breakdown: [], cond: { tod: 'dawn', wind: 'light' } }] } as unknown as WindowSample
}

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined
let setup: ReturnType<typeof useSetupStore>
let log: ReturnType<typeof useCatchStore>
let coast: ReturnType<typeof useCoastStore>

/** Stores the entry's result as a run would have: for the entry as it is, with the coast given (default: its current one). */
function store(id: string, result: EntryResult, coastWas?: string) {
  const e = log.entries.find((x) => x.id === id)!
  insight.results.set(id, { fp: entryFingerprint(e, setup.locations, TARGETS), coast: coastWas ?? entryCoast(e, setup.locations, TARGETS, coast.shoreById), result })
}

/** The components that re-rendered, by name, since the last reset. */
const updated: string[] = []

async function mountLog(es: CatchEntry[] = entries()) {
  const pinia = createPinia()
  setActivePinia(pinia)
  setup = useSetupStore(); log = useCatchStore(); coast = useCoastStore()
  setup.locations = LOCS.map((l) => ({ ...l }))
  setup.targetSpecies = [...TARGETS]
  setup.availability = []
  log.entries = es
  if (es.some((e) => e.id === 'scored')) {
    store('scored', sample(72))
    store('coast', sample(66), 'a coast from before')
    store('failed', 'failed')
    store('none', null)
    store('trip', sample(40))
    insight.loading.add('loading')
  }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/log', name: 'catchlog', component: { render: () => null } }] })
  await router.push('/log')
  view = mount(CatchLogView, (app) => {
    app.use(pinia); app.use(router); app.config.warnHandler = () => {}
    app.mixin({ beforeUpdate(this: { $options: { __name?: string } }) { updated.push(this.$options.__name ?? '?') } })
  })
  await nextTick()
  updated.length = 0
  return view.root
}

const cards = (root: FakeNode) => root.byClass('card entry')
const cardOf = (root: FakeNode, id: string) => {
  const c = cards(root).find((n) => n.byClass('entry-notes')[0]?.textContent === id)
  if (!c) throw new Error(`no card for ${id}`)
  return c
}
const texts = (nodes: FakeNode[]) => nodes.map((n) => n.textContent)
const buttonsOf = (n: FakeNode) => n.byTag('button')
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }

beforeEach(() => {
  restoreDocument = installDocument()
  insight.results.clear()
  insight.loading.clear()
  vi.mocked(scoreOne).mockClear()
})
afterEach(() => {
  view?.unmount()
  view = undefined
  confirmCancel()
  setLang('da')
  vi.unstubAllGlobals()
  vi.useRealTimers()
  restoreDocument()
})

describe('an entry card shows', () => {
  it('one card per entry, newest first', async () => {
    const root = await mountLog()
    expect(texts(cards(root).map((c) => c.byClass('entry-notes')[0]))).toEqual(log.sorted.map((e) => e.id))
  })

  it('the place: the linked spot by its current name, else the text it was saved with', async () => {
    const root = await mountLog()
    expect(cardOf(root, 'renamed').byClass('entry-meta')[0].textContent).toContain(`📍 ${LOCS[1].name}`)
    expect(cardOf(root, 'renamed').byClass('entry-meta')[0].textContent).not.toContain('Gammelt navn')
    expect(cardOf(root, 'free').byClass('entry-meta')[0].textContent).toContain('📍 Et sted uden navn')
    expect(cardOf(root, 'scored').byClass('entry-meta')[0].textContent).toContain(`🕐 06:30 · 📍 ${LOCS[0].name} · 🎣 ${t('method_shore')}`)
    expect(cardOf(root, 'trip').byClass('entry-meta')[0].textContent).toContain(`🕐 05:00–08:00 · 📍 ${LOCS[1].name} · 🦺 ${t('method_waders')}`)
  })

  it('the catch itself: species, count, sizes, kept or released; a trip says it caught nothing', async () => {
    const root = await mountLog()
    const scored = cardOf(root, 'scored')
    expect(scored.byClass('sp')[0].textContent).toContain('Havørred')
    expect(texts(scored.byClass('rel kept'))).toEqual([`🧺 ${t('log_kept')}`])
    expect(texts(scored.byClass('size'))).toEqual(['📏 30 cm'])
    const coastCard = cardOf(root, 'coast')
    expect(texts(coastCard.byClass('qty'))).toEqual(['×3'])
    expect(texts(coastCard.byClass('size'))).toEqual(['⚖️ 2.5 kg'])
    expect(texts(cardOf(root, 'renamed').byClass('rel released'))).toEqual([`🌊 ${t('log_released')}`])
    expect(texts(cardOf(root, 'trip').byClass('sp nofish'))).toEqual([t('log_trip_label')])
    expect(cardOf(root, 'trip').byClass('sizes')).toEqual([])
  })

  it('the regulation warnings for the catch at its spot, none for a trip', async () => {
    const root = await mountLog()
    for (const e of log.entries) {
      const loc = setup.locations.find((l) => l.id === e.locationId)
      const want = e.outcome === 'empty' ? [] : catchWarnings(e.speciesId, e.lengthCm, e.date, e.released, loc?.waterType, loc)
      expect(texts(cardOf(root, e.id).byClass('entry-guard')[0]?.elements ?? []), e.id).toEqual(want.map((w) => `⚠️ ${w}`))
    }
    // 30 cm is short of any sea trout minimum: the check above is not all empty lists.
    expect(cardOf(root, 'scored').byClass('entry-guard')[0].elements.length).toBeGreaterThan(0)
  })

  it('why an entry has no score, where it can have none', async () => {
    const root = await mountLog()
    const hint = (id: string) => texts(cardOf(root, id).byClass('score-hint'))
    expect(hint('renamed')).toEqual([`📊 ${t('log_score_need_time')}`])
    expect(hint('free')).toEqual([`📊 ${t('log_score_need_loc')}`])
    expect(hint('trip-nospan')).toEqual([`📊 ${t('log_score_need_span')}`])
    expect(hint('old')).toEqual([`📊 ${t('log_score_too_old')}`])
    for (const id of ['renamed', 'free', 'trip-nospan', 'old']) expect(cardOf(root, id).byClass('score-line'), id).toEqual([])
    for (const id of ['scored', 'coast', 'unscored', 'failed', 'none', 'loading', 'trip']) expect(hint(id), id).toEqual([])
  })

  it('the score, coloured and labelled, for a catch and for a trip', async () => {
    const root = await mountLog()
    const scored = cardOf(root, 'scored').byClass('score-line')[0]
    expect(scored.byClass('cscore')[0].classes).toEqual(['cscore', scoreColor(72)])
    expect(scored.byClass('cscore')[0].textContent).toBe('72')
    expect(scored.byClass('cscore-lbl')[0].textContent).toBe(`${t('log_score_label')} · ${scoreLabel(72)}`)
    const trip = cardOf(root, 'trip').byClass('score-line')[0]
    expect(trip.byClass('cscore')[0].classes).toEqual(['cscore', scoreColor(40)])
    expect(trip.byClass('cscore-lbl')[0].textContent).toBe(`${t('log_score_trip_label')} · ${scoreLabel(40)}`)
  })

  it('that a score is from an older coast, with a way to score it again', async () => {
    const root = await mountLog()
    const line = cardOf(root, 'coast').byClass('score-line')[0]
    expect(line.textContent).toContain(`🧭 ${t('log_score_coast_stale')}`)
    expect(texts(buttonsOf(line))).toEqual([`▸ ${t('log_conditions')}`, t('log_score_rerun')])
    expect(cardOf(root, 'scored').textContent).not.toContain('🧭')
  })

  it('a button to score an unscored entry, a retry after a failed fetch, and the in-between states', async () => {
    const root = await mountLog()
    expect(texts(buttonsOf(cardOf(root, 'unscored').byClass('score-line')[0]))).toEqual([t('log_score_btn')])
    const failed = cardOf(root, 'failed').byClass('score-line')[0]
    expect(texts(buttonsOf(failed))).toEqual([t('log_score_retry')])
    expect(failed.textContent).toContain(t('log_score_failed'))
    expect(cardOf(root, 'none').byClass('score-line')[0].textContent).toBe(t('log_score_na'))
    expect(cardOf(root, 'loading').byClass('score-line')[0].textContent).toBe(t('log_scoring'))
  })

  it('in the language picked, switched while it is open', async () => {
    const root = await mountLog()
    setLang('en')
    await nextTick()
    expect(texts(cardOf(root, 'free').byClass('score-hint'))).toEqual([`📊 ${STRINGS.en.log_score_need_loc}`])
    expect(cardOf(root, 'scored').byClass('cscore-lbl')[0].textContent).toBe(`${STRINGS.en.log_score_label} · ${scoreLabel(72)}`)
    const e = log.entries.find((x) => x.id === 'scored')!
    const loc = setup.locations[0]
    expect(texts(cardOf(root, 'scored').byClass('entry-guard')[0].elements))
      .toEqual(catchWarnings(e.speciesId, e.lengthCm, e.date, e.released, loc.waterType, loc).map((w) => `⚠️ ${w}`))
  })

  it('an entry turning two years old overnight, while the log is open', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 59), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([{ id: 'edge', date: iso(new Date(2026, 5, 15 - 730)), time: '06:00', speciesId: 'havørred', ...at(0), notes: 'edge' }])
    expect(texts(buttonsOf(cardOf(root, 'edge').byClass('score-line')[0]))).toEqual([t('log_score_btn')])
    vi.setSystemTime(new Date(2026, 5, 16, 0, 1))
    vi.advanceTimersByTime(60_000) // the view's clock ticks
    await nextTick(); await nextTick()
    expect(texts(cardOf(root, 'edge').byClass('score-hint'))).toEqual([`📊 ${t('log_score_too_old')}`])
    expect(cardOf(root, 'edge').byClass('score-line')).toEqual([])
  })
})

describe('an entry card\'s buttons', () => {
  it('▸ Forhold opens and closes the conditions the score was given under', async () => {
    const root = await mountLog()
    const card = cardOf(root, 'scored')
    const toggle = card.byClass('cond-toggle')[0]
    expect(toggle.attrs['aria-expanded']).toBe(false)
    expect(card.byClass('cond-line')).toEqual([])
    toggle.click()
    await nextTick()
    expect(toggle.attrs['aria-expanded']).toBe(true)
    expect(toggle.textContent).toBe(`▾ ${t('log_conditions')}`)
    expect(texts(card.byClass('chip'))).toEqual([
      `🌅 ${t('ins_tod')}: ${t('ins_tod_dawn')}`, `💨 ${t('ins_wind')}: ${t('ins_wind_light')}`,
    ])
    // One card's conditions, not every card's.
    expect(cardOf(root, 'trip').byClass('cond-line')).toEqual([])
    toggle.click()
    await nextTick()
    expect(card.byClass('cond-line')).toEqual([])
  })

  it('✎ opens the entry in the form and marks its card', async () => {
    const root = await mountLog()
    buttonsOf(cardOf(root, 'scored').byClass('entry-actions')[0])[0].click()
    await nextTick()
    expect(root.byClass('card form')[0].hasClass('editing')).toBe(true)
    expect(root.byClass('form-h')[0].textContent).toBe(t('log_edit_h'))
    expect(root.byTag('textarea')[0].value).toBe('scored')
    expect(cards(root).filter((c) => c.hasClass('active')).map((c) => c.byClass('entry-notes')[0].textContent)).toEqual(['scored'])
    buttonsOf(cardOf(root, 'trip').byClass('entry-actions')[0])[0].click()
    await nextTick()
    expect(root.byClass('form-h')[0].textContent).toBe(t('log_trip_edit_h'))
    expect(cards(root).filter((c) => c.hasClass('active')).map((c) => c.byClass('entry-notes')[0].textContent)).toEqual(['trip'])
  })

  it('🗑 asks, and deletes the entry on yes', async () => {
    const root = await mountLog()
    const del = cardOf(root, 'scored').byClass('del')[0]
    expect(del.attrs['aria-label']).toBe(t('log_remove'))
    del.click()
    expect(confirmState.open).toBe(true)
    expect(confirmState.message).toBe(t('log_remove_confirm'))
    confirmAccept()
    await flush()
    expect(log.entries.map((e) => e.id)).not.toContain('scored')
    expect(cards(root).map((c) => c.byClass('entry-notes')[0].textContent)).not.toContain('scored')
    cardOf(root, 'trip').byClass('del')[0].click()
    expect(confirmState.message).toBe(t('log_trip_remove_confirm'))
  })

  it('Beregn bid-score scores the entry with the setup\'s spots, targets and coasts; a failed fetch offers a retry', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('offline'))))
    const root = await mountLog()
    buttonsOf(cardOf(root, 'unscored').byClass('score-line')[0])[0].click()
    expect(scoreOne).toHaveBeenCalledTimes(1)
    expect(scoreOne).toHaveBeenCalledWith(log.entries.find((e) => e.id === 'unscored'), setup.locations, setup.targetSpecies, coast.shoreById)
    await nextTick()
    expect(cardOf(root, 'unscored').byClass('score-line')[0].textContent).toBe(t('log_scoring'))
    await vi.waitFor(() => expect(cardOf(root, 'unscored').byClass('score-line')[0].textContent).toContain(t('log_score_failed')))
    expect(texts(buttonsOf(cardOf(root, 'unscored').byClass('score-line')[0]))).toEqual([t('log_score_retry')])
  })

  it('Beregn igen scores an entry from an older coast again', async () => {
    const root = await mountLog()
    const rerun = buttonsOf(cardOf(root, 'coast').byClass('score-line')[0]).find((b) => b.textContent === t('log_score_rerun'))!
    vi.mocked(scoreOne).mockImplementationOnce(async () => {})
    rerun.click()
    expect(scoreOne).toHaveBeenCalledWith(log.entries.find((e) => e.id === 'coast'), setup.locations, setup.targetSpecies, coast.shoreById)
  })
})

describe('typing in the form', () => {
  /** The cards above and `n` more catches, every other one scored. */
  async function mountMany(n: number) {
    const more: CatchEntry[] = Array.from({ length: n }, (_, i) => ({
      id: 'm' + i, date: daysAgo(30 + i), time: '06:00', speciesId: i % 2 ? 'torsk' : 'havørred', ...at(i % 2), lengthCm: 20 + i, notes: 'm' + i,
    }))
    const root = await mountLog([...entries(), ...more])
    more.forEach((e, i) => { if (i % 2 === 0) store(e.id, sample(50 + i)) })
    await nextTick()
    updated.length = 0
    return root
  }

  // Every keystroke re-rendered the whole list: each card's warnings, place
  // and score lookups ran again, about five JSON fingerprints a card, ~100 ms
  // a keystroke at 150 entries.
  it('re-renders the form only: no card works anything out again', async () => {
    const root = await mountMany(40)
    expect(cards(root)).toHaveLength(51)
    for (const fn of Object.values(PER_ENTRY)) vi.mocked(fn).mockClear()
    const stringify = vi.spyOn(JSON, 'stringify')
    const notes = root.byTag('textarea')[0]
    for (const text of ['F', 'Fi', 'Fis']) { notes.input(text); await nextTick() }
    const fingerprints = stringify.mock.calls.length
    stringify.mockRestore()
    expect(fingerprints).toBe(0)
    for (const [name, fn] of Object.entries(PER_ENTRY)) expect(vi.mocked(fn), name).not.toHaveBeenCalled()
    // The form did take each keystroke; no card re-rendered.
    expect(updated).toEqual(['CatchLogView', 'CatchLogView', 'CatchLogView'])
  })

  it('a score starting or landing re-renders that entry\'s card, and no other', async () => {
    const root = await mountMany(40)
    insight.loading.add('unscored')
    await nextTick()
    // The Modeltjek panel reads the same results once it has run: its business.
    expect(updated.filter((n) => n !== 'ModelCheckPanel')).toEqual(['CatchEntryCard'])
    expect(cardOf(root, 'unscored').byClass('score-line')[0].textContent).toBe(t('log_scoring'))
    updated.length = 0
    insight.loading.delete('unscored')
    store('unscored', sample(81))
    await nextTick()
    expect(updated.filter((n) => n !== 'ModelCheckPanel')).toEqual(['CatchEntryCard'])
    expect(cardOf(root, 'unscored').byClass('cscore')[0].textContent).toBe('81')
  })

  it('a renamed spot and new targets still reach the cards', async () => {
    const root = await mountLog()
    setup.locations[1].name = 'Nyt navn'
    await nextTick()
    expect(cardOf(root, 'renamed').byClass('entry-meta')[0].textContent).toContain('📍 Nyt navn')
    // Scored for other targets, the stored scores no longer apply.
    setup.targetSpecies = ['torsk']
    await nextTick()
    expect(texts(buttonsOf(cardOf(root, 'scored').byClass('score-line')[0]))).toEqual([t('log_score_btn')])
  })
})
