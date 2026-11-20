// @vitest-environment vue-dom
/**
 * The catch log as mounted: what each entry's card shows and what its
 * buttons do. The real view, Pinia and router, on the in-memory DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'
import { DK_SPOTS, locationFromSpot } from '@/lib/spots'
import { coastOutdated, entryCoast, entryFingerprint, insight, resultFor, scoreOne, type EntryResult } from '@/lib/insightRun'
import { catchWarnings } from '@/lib/catchGuard'
import { catchPlaceName, scoreBlocker } from '@/lib/catchScore'
import { confirmAccept, confirmCancel, confirmState } from '@/lib/confirm'
import { clearCatchDraft, readCatchDraft } from '@/lib/catchDraft'
import { langReady, setLang, t } from '@/lib/i18n'
import { scoreColor, scoreLabel } from '@/lib/scoring'
import { STRINGS } from '@/test/strings'
import type { WindowSample } from '@/lib/catchInsights'
import type { CatchEntry, Location } from '@/lib/types'
import type { User } from '@supabase/supabase-js'
import { fakeDb } from '@/test/fakeSupabase'
import { useAuthStore } from '@/stores/auth'
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

/** Who is signed in as the log opens; null: a guest. */
let account: string | null = null
const asUser = (id: string | null) => (id ? ({ id } as User) : null)

/**
 * `reading`: opened as the page starts, before it has read its session
 * (main.ts mounts the app before auth.init); else the session is read.
 * `logOf`: the account the log on the device belongs to, as that account's
 * pull left it (null: a guest's); by default the one signed in.
 */
async function mountLog(es: CatchEntry[] = entries(), { reading = false, logOf = account } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  setup = useSetupStore(); log = useCatchStore(); coast = useCoastStore()
  if (logOf) {
    fakeDb.seed('catches', { user_id: logOf, entries: es, updated_at: '2026-11-01T00:00:00.000Z' })
    fakeDb.session = { user: { id: logOf } }
    auth.user = asUser(logOf)
    await log.pullRemote()
  } else log.entries = es
  fakeDb.session = account ? { user: { id: account } } : null
  auth.loading = reading
  auth.user = reading ? null : asUser(account)
  setup.locations = LOCS.map((l) => ({ ...l }))
  setup.targetSpecies = [...TARGETS]
  setup.availability = []
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
  account = null
  fakeDb.reset()
  localStorage.removeItem('fc2-catches')
  clearCatchDraft() // the last test's form, kept as it unmounted
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
    const e0 = log.entries.find((x) => x.id === 'scored')!
    const [y, m, d] = e0.date.split('-').map(Number)
    const wd = new Date(y, m - 1, d).getDay()
    const when = () => cardOf(root, 'scored').byClass('entry-meta')[0].textContent
    expect(when()).toContain(`🗓 ${STRINGS.da['day' + wd]} ${d}. ${STRINGS.da['month' + (m - 1)]} ${y}`)
    setLang('en')
    await langReady() // the English table is a chunk of its own
    await nextTick()
    // The day of the month as English writes it: "Mon 9 Nov 2026", not the Danish "9.".
    expect(when()).toContain(`🗓 ${STRINGS.en['day' + wd]} ${d} ${STRINGS.en['month' + (m - 1)]} ${y}`)
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

  // ✎ put the entry over whatever the form held: a new catch half typed was
  // gone, and Annullér then left a blank form. It asks first now.
  it('✎ asks before it drops a new catch half typed; Annullér keeps the typing', async () => {
    const root = await mountLog()
    root.byTag('textarea')[0].input('halvt skrevet')
    await nextTick()
    const pen = () => buttonsOf(cardOf(root, 'scored').byClass('entry-actions')[0])[0]
    pen().click()
    expect(confirmState.open).toBe(true)
    expect(confirmState.message).toBe(t('log_edit_drop_confirm'))
    confirmCancel()
    await flush()
    expect(root.byTag('textarea')[0].value).toBe('halvt skrevet')
    expect(root.byClass('form-h')[0].textContent).toBe(t('log_add'))
    expect(cards(root).filter((c) => c.hasClass('active'))).toEqual([])
    pen().click()
    confirmAccept()
    await flush()
    expect(root.byTag('textarea')[0].value).toBe('scored')
    expect(root.byClass('form-h')[0].textContent).toBe(t('log_edit_h'))
  })

  it('✎ on another entry asks only when the open one was changed', async () => {
    const root = await mountLog()
    const pen = (id: string) => buttonsOf(cardOf(root, id).byClass('entry-actions')[0])[0]
    pen('scored').click() // nothing typed
    await nextTick()
    pen('trip').click() // 'scored' opened, left as it was
    await nextTick()
    expect(confirmState.open).toBe(false)
    expect(root.byTag('textarea')[0].value).toBe('trip')
    root.byTag('textarea')[0].input('rettet')
    await nextTick()
    pen('scored').click()
    expect(confirmState.open).toBe(true)
    confirmCancel()
    await flush()
    expect(root.byTag('textarea')[0].value).toBe('rettet')
    expect(cards(root).filter((c) => c.hasClass('active')).map((c) => c.byClass('entry-notes')[0].textContent)).toEqual(['trip'])
  })

  // While ✎ asks, a pull can change the entry or delete it. "Ja" opened the
  // copy from before: the old note, or a deleted catch that Gem put back.
  it('✎ answered after a pull opens the entry as the pull left it, and a deleted one not at all', async () => {
    const root = await mountLog()
    root.byTag('textarea')[0].input('halvt skrevet')
    await nextTick()
    buttonsOf(cardOf(root, 'scored').byClass('entry-actions')[0])[0].click()
    log.entries = log.entries.map((e) => (e.id === 'scored' ? { ...e, lengthCm: 41 } : e))
    confirmAccept()
    await flush()
    expect(root.byClass('form-h')[0].textContent).toBe(t('log_edit_h'))
    expect(String(root.findAll((n) => n.attrs.max === '400')[0].value)).toBe('41')
    root.byTag('textarea')[0].input('rettet')
    await nextTick()
    buttonsOf(cardOf(root, 'coast').byClass('entry-actions')[0])[0].click()
    log.entries = log.entries.filter((e) => e.id !== 'coast')
    confirmAccept()
    await flush()
    expect(root.byTag('textarea')[0].value).toBe('rettet')
    expect(log.entries.some((e) => e.id === 'coast')).toBe(false)
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

  // The notes field reads nothing else. These feed the form's own checks as
  // well: the spot it links, its regulation warnings, and in trip mode the
  // clash with the log, judged against every entry. None of it is a card's.
  const pick = (select: FakeNode, id: string) => {
    for (const o of select.options) o.selected = o.value === id
    select.dispatch('change')
  }
  const byAttr = (k: string, v: string) => (form: FakeNode) => form.findAll((n) => n.attrs[k] === v)[0]
  it.each([
    { mode: 'catch', field: 'location', find: byAttr('list', 'loc-options'), values: ['S', 'St', LOCS[0].name] },
    { mode: 'catch', field: 'length', find: byAttr('max', '400'), values: ['1', '12', '45'] },
    { mode: 'catch', field: 'date', find: byAttr('type', 'date'), values: [daysAgo(1), daysAgo(2), daysAgo(20)] },
    { mode: 'catch', field: 'species', find: (form: FakeNode) => form.byTag('select')[0], values: ['torsk', 'havørred', ''] },
    { mode: 'trip', field: 'location', find: byAttr('list', 'loc-options'), values: ['S', 'St', LOCS[1].name] },
    { mode: 'trip', field: 'from', find: byAttr('type', 'time'), values: ['05:00', '05:30', '06:00'] },
    { mode: 'trip', field: 'date', find: byAttr('type', 'date'), values: [daysAgo(20), daysAgo(21), daysAgo(1)] },
  ])('in $mode mode, the $field field re-renders no card either', async ({ mode, find, values }) => {
    const root = await mountMany(40)
    if (mode === 'trip') {
      root.byClass('seg mode')[0].byTag('button')[1].click()
      await nextTick()
      expect(root.byClass('form-h')[0].textContent).toBe(t('log_trip_h'))
      updated.length = 0
    }
    const el = find(root.byClass('card form')[0])
    const stringify = vi.spyOn(JSON, 'stringify')
    for (const v of values) {
      if (el.tag === 'select') pick(el, v)
      else el.input(v)
      await nextTick()
    }
    const fingerprints = stringify.mock.calls.length
    stringify.mockRestore()
    expect(fingerprints).toBe(0)
    expect(updated).toEqual(values.map(() => 'CatchLogView'))
  })

  // The trip check judged the trip against every entry at every keystroke:
  // ~10 ms a keystroke at 300 entries in node. Only entries at the trip's
  // spot within a day of it can clash; the rest go unread.
  it('in trip mode, a keystroke reads only the entries near the trip\'s day', async () => {
    let reads = 0
    const counted = (e: CatchEntry): CatchEntry => {
      const { date, ...rest } = e
      return Object.defineProperty(rest, 'date', { get: () => { reads++; return date }, enumerable: true, configurable: true }) as CatchEntry
    }
    // 200 entries at the trip's spot, a day apart from 30 days back; 2 on the trip's day.
    const far = Array.from({ length: 200 }, (_, i): CatchEntry => (i % 3
      ? { id: 'f' + i, date: daysAgo(30 + i), time: '07:00', speciesId: 'torsk', ...at(1), notes: 'f' + i }
      : { id: 'f' + i, outcome: 'empty', date: daysAgo(30 + i), from: '05:00', to: '08:00', speciesId: '', count: 0, ...at(1), notes: 'f' + i }))
    const near = [
      { id: 'n1', date: daysAgo(20), time: '12:00', speciesId: 'torsk', ...at(1), notes: 'n1' },
      { id: 'n2', outcome: 'empty' as const, date: daysAgo(20), from: '13:00', to: '14:00', speciesId: '', count: 0, ...at(1), notes: 'n2' },
    ]
    const root = await mountLog([...entries(), ...far, ...near].map(counted))
    root.byClass('seg mode')[0].byTag('button')[1].click()
    await nextTick()
    const form = root.byClass('card form')[0]
    form.findAll((n) => n.attrs.type === 'date')[0].input(daysAgo(20))
    form.findAll((n) => n.attrs.list === 'loc-options')[0].input(LOCS[1].name)
    const [from, to] = form.findAll((n) => n.attrs.type === 'time')
    to.input('08:00')
    await nextTick()
    reads = 0
    for (const v of ['04:00', '05:00', '06:00']) { from.input(v); await nextTick() }
    // A handful of reads per keystroke, where every entry was read before.
    expect(reads).toBeGreaterThan(0)
    expect(reads).toBeLessThan(3 * 20)
    // And the check still sees the trip on that day: 05:00–08:00 holds no catch and overlaps 'trip' (05:00–08:00).
    expect(root.byClass('guard')[0].textContent).toContain(t('log_trip_dup'))
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

  // The scores are kept on the device now (insightSaved): those of entries
  // deleted while the log wasn't open — a pull, another tab — go on opening it.
  it('opening the log forgets the scores of entries that are no longer in it', async () => {
    insight.results.set('gone', { fp: 'fp', coast: '', result: sample(60) })
    const root = await mountLog()
    expect(insight.results.has('gone')).toBe(false)
    expect(cardOf(root, 'scored').byClass('cscore')[0].textContent).toBe('72')
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

/**
 * A half-typed catch was lost when the user went to Lokationer to add the
 * spot and came back: the view started afresh on every visit. The unsaved
 * form is kept now (lib/catchDraft) — for the tab, in sessionStorage — until
 * it is saved, cancelled, or the entry it edits is deleted.
 */
describe('the unsaved form', () => {
  const formOf = (root: FakeNode) => root.byClass('card form')[0]
  const fieldOf = (root: FakeNode, k: string, v: string) => formOf(root).findAll((n) => n.attrs[k] === v)[0]
  const select = (root: FakeNode, id: string) => {
    const s = formOf(root).byTag('select')[0]
    for (const o of s.options) o.selected = o.value === id
    s.dispatch('change')
  }
  /** What the form shows: its heading, its fields, the buttons on, and the card it edits. */
  function shown(root: FakeNode) {
    const f = formOf(root)
    const inputs = f.findAll((n) => n.tag === 'input' || n.tag === 'textarea' || n.tag === 'select')
    return {
      heading: root.byClass('form-h')[0].textContent,
      fields: inputs.map((n) => `${n.attrs.type ?? n.tag}=${n.value}`),
      on: f.findAll((n) => n.hasClass('seg-btn') && n.hasClass('on')).map((n) => n.textContent),
      editing: cards(root).filter((c) => c.hasClass('active')).map((c) => c.byClass('entry-notes')[0].textContent),
    }
  }
  /** Away to another screen and back: the view unmounts, the stores stay. */
  async function awayAndBack(opts: { logOf?: string | null } = {}) {
    const es = log.entries
    view!.unmount()
    view = undefined
    return mountLog(es, opts)
  }

  it('comes back after going to another screen, as it was typed', async () => {
    let root = await mountLog()
    select(root, 'torsk')
    fieldOf(root, 'list', 'loc-options').input('Et nyt sted')
    fieldOf(root, 'max', '400').input('45')
    fieldOf(root, 'type', 'date').input(daysAgo(2))
    fieldOf(root, 'type', 'time').input('05:15')
    root.byTag('textarea')[0].input('halvt skrevet')
    buttonsOf(formOf(root)).find((b) => b.textContent.includes(t('log_released')))!.click()
    await nextTick()
    const before = shown(root)
    expect(before.fields).toContain('textarea=halvt skrevet')
    expect(before.on).toContain(`🌊 ${t('log_released')}`)
    root = await awayAndBack()
    expect(shown(root)).toEqual(before)
    expect(log.entries).toHaveLength(entries().length) // nothing saved by it
  })

  it('in trip mode too', async () => {
    let root = await mountLog()
    root.byClass('seg mode')[0].byTag('button')[1].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    const [from, to] = formOf(root).findAll((n) => n.attrs.type === 'time')
    from.input('04:00'); to.input('06:30')
    root.byTag('textarea')[0].input('ingen hug')
    await nextTick()
    const before = shown(root)
    expect(before.heading).toBe(t('log_trip_h'))
    root = await awayAndBack()
    expect(shown(root)).toEqual(before)
  })

  it('an edit comes back as the same edit, and saves onto its entry', async () => {
    let root = await mountLog()
    buttonsOf(cardOf(root, 'scored').byClass('entry-actions')[0])[0].click()
    await nextTick()
    root.byTag('textarea')[0].input('rettet')
    await nextTick()
    const before = shown(root)
    root = await awayAndBack()
    expect(shown(root)).toEqual(before)
    expect(before.heading).toBe(t('log_edit_h'))
    expect(before.editing).toEqual(['scored'])
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries).toHaveLength(entries().length)
    expect(log.entries.find((e) => e.id === 'scored')!.notes).toBe('rettet')
  })

  // The prefill puts today's date and the time now into a new form; on
  // coming back it must not write over what was left there.
  it('keeps its date and time over the prefill; an untouched form is prefilled afresh', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 10, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog()
    root.byTag('textarea')[0].input('kun en note')
    await nextTick()
    vi.setSystemTime(new Date(2026, 5, 15, 10, 20))
    root = await awayAndBack()
    expect(fieldOf(root, 'type', 'date').value).toBe('2026-06-15')
    expect(fieldOf(root, 'type', 'time').value).toBe('10:00')
    expect(root.byTag('textarea')[0].value).toBe('kun en note')
    // A time set by hand stays, the day after too.
    fieldOf(root, 'type', 'time').input('05:15')
    await nextTick()
    vi.setSystemTime(new Date(2026, 5, 16, 8, 0))
    root = await awayAndBack()
    expect(fieldOf(root, 'type', 'date').value).toBe('2026-06-15')
    expect(fieldOf(root, 'type', 'time').value).toBe('05:15')
    // Saved, the draft is done; and nothing typed is no draft: the form opens on now, as it always did.
    select(root, 'torsk')
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    vi.setSystemTime(new Date(2026, 5, 16, 9, 30))
    root = await awayAndBack()
    expect(fieldOf(root, 'type', 'date').value).toBe('2026-06-16')
    expect(fieldOf(root, 'type', 'time').value).toBe('09:30')
    expect(root.byTag('textarea')[0].value).toBe('')
  })

  it('keeps trip mode, freshly prefilled, when nothing was typed in it', async () => {
    let root = await mountLog()
    root.byClass('seg mode')[0].byTag('button')[1].click()
    await nextTick()
    root = await awayAndBack()
    expect(shown(root).heading).toBe(t('log_trip_h'))
  })

  /** A reload of the tab: the draft is kept in sessionStorage when the page is hidden or left. */
  it('outlives a reload of the tab, in sessionStorage only', async () => {
    const page = new EventTarget()
    const stored = new Map<string, string>()
    vi.stubGlobal('window', page)
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => { stored.set(k, v) }, removeItem: (k: string) => { stored.delete(k) } })
    const root = await mountLog()
    root.byTag('textarea')[0].input('før genindlæsning')
    await nextTick()
    page.dispatchEvent(new Event('pagehide'))
    expect([...stored.keys()]).toEqual(['fc2-catch-draft'])
    expect(stored.get('fc2-catch-draft')).toContain('før genindlæsning')
    // Never synced, nor kept for the device.
    for (let i = 0; i < localStorage.length; i++) expect(localStorage.getItem(localStorage.key(i)!)).not.toContain('før genindlæsning')
    // The app hidden (switched away from, on a phone) keeps it too. Listeners are added at mount: mount on a document that hears.
    view!.unmount()
    view = undefined
    stored.clear()
    const doc = new EventTarget()
    Object.assign(document, { visibilityState: 'hidden', addEventListener: doc.addEventListener.bind(doc), removeEventListener: doc.removeEventListener.bind(doc) })
    const again = await mountLog(log.entries)
    again.byTag('textarea')[0].input('skjult')
    await nextTick()
    doc.dispatchEvent(new Event('visibilitychange'))
    expect(stored.get('fc2-catch-draft')).toContain('skjult')
    // The reloaded page finds what the last one left.
    view!.unmount()
    view = undefined
    stored.set('fc2-catch-draft', stored.get('fc2-catch-draft')!.replace('skjult', 'fra sidste side'))
    const reloaded = await mountLog(log.entries)
    expect(reloaded.byTag('textarea')[0].value).toBe('fra sidste side')
  })

  // Kept, a half-typed new catch came back on every visit with its date and
  // time, and only saving it would let it go: Annullér was there for an edit
  // only. It shows for a new one too, once anything is typed.
  it('a new catch half typed can be let go: Annullér clears it, and the form opens afresh', async () => {
    const cancelOf = (root: FakeNode) => buttonsOf(formOf(root)).filter((b) => b.textContent === t('log_cancel'))
    let root = await mountLog()
    expect(cancelOf(root)).toEqual([]) // nothing typed: nothing to let go
    root.byTag('textarea')[0].input('opgivet')
    fieldOf(root, 'type', 'time').input('05:15')
    await nextTick()
    expect(cancelOf(root)).toHaveLength(1)
    root = await awayAndBack()
    expect(shown(root).fields).toContain('textarea=opgivet')
    cancelOf(root)[0].click()
    await nextTick()
    expect(shown(root).fields).toContain('textarea=')
    expect(fieldOf(root, 'type', 'time').value).not.toBe('05:15')
    expect(cancelOf(root)).toEqual([])
    expect(log.entries.some((e) => e.notes === 'opgivet')).toBe(false)
    root = await awayAndBack()
    expect(shown(root).fields).toContain('textarea=')
    // In trip mode too; the mode stays.
    root.byClass('seg mode')[0].byTag('button')[1].click()
    await nextTick()
    expect(cancelOf(root)).toEqual([])
    root.byTag('textarea')[0].input('ingen hug, opgivet')
    await nextTick()
    cancelOf(root)[0].click()
    await nextTick()
    expect(shown(root).heading).toBe(t('log_trip_h'))
    expect(shown(root).fields).toContain('textarea=')
  })

  it('is gone once saved, cancelled, or its entry deleted', async () => {
    let root = await mountLog()
    root.byTag('textarea')[0].input('gemt')
    select(root, 'torsk')
    await nextTick()
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries.some((e) => e.notes === 'gemt')).toBe(true)
    root = await awayAndBack()
    expect(shown(root).fields).toContain('textarea=')
    expect(shown(root).heading).toBe(t('log_add'))

    buttonsOf(cardOf(root, 'trip').byClass('entry-actions')[0])[0].click()
    await nextTick()
    root.byTag('textarea')[0].input('fortrudt')
    await nextTick()
    buttonsOf(formOf(root)).find((b) => b.textContent === t('log_cancel'))!.click()
    await nextTick()
    root = await awayAndBack()
    expect(shown(root).editing).toEqual([])
    expect(shown(root).fields).toContain('textarea=')

    buttonsOf(cardOf(root, 'scored').byClass('entry-actions')[0])[0].click()
    await nextTick()
    root.byTag('textarea')[0].input('slettes')
    await nextTick()
    cardOf(root, 'scored').byClass('del')[0].click()
    confirmAccept()
    await flush()
    root = await awayAndBack()
    expect(shown(root).editing).toEqual([])
    expect(shown(root).heading).toBe(t('log_add'))
    expect(log.entries.some((e) => e.id === 'scored')).toBe(false)
  })

  // Deleted on another device while away (a pull): saving the edit would
  // have put the entry back (catches.update adds an entry it can't find).
  it('does not bring back an entry deleted while it was away', async () => {
    let root = await mountLog()
    buttonsOf(cardOf(root, 'scored').byClass('entry-actions')[0])[0].click()
    await nextTick()
    root.byTag('textarea')[0].input('rettet')
    await nextTick()
    view!.unmount()
    view = undefined
    root = await mountLog(log.entries.filter((e) => e.id !== 'scored'))
    expect(shown(root).heading).toBe(t('log_add'))
    expect(shown(root).editing).toEqual([])
    expect(root.byTag('textarea')[0].value).toBe('')
    // …and it stays gone.
    root = await awayAndBack()
    expect(shown(root).heading).toBe(t('log_add'))
    expect(log.entries.some((e) => e.id === 'scored')).toBe(false)
  })

  // The edit comes back with the copy it opened on, which catches.update
  // merges against: without it, saving a length wrote the form's stale note
  // over the one a pull brought from the phone meanwhile.
  it('an edit that comes back still saves onto the entry as a pull left it', async () => {
    let root = await mountLog()
    buttonsOf(cardOf(root, 'scored').byClass('entry-actions')[0])[0].click()
    await nextTick()
    fieldOf(root, 'max', '400').input('55')
    await nextTick()
    view!.unmount()
    view = undefined
    root = await mountLog(log.entries.map((e) => (e.id === 'scored' ? { ...e, notes: 'fra telefonen' } : e)))
    expect(shown(root).editing).toEqual(['fra telefonen'])
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    const saved = log.entries.find((e) => e.id === 'scored')!
    expect([saved.lengthCm, saved.notes]).toEqual([55, 'fra telefonen'])
    expect(log.entries).toHaveLength(entries().length)
  })

  // Its prefill comes back with it. Taken afresh from the restored fields, a
  // time set by hand would read as untouched, and the next leave dropped it.
  it('keeps a field set by hand, and nothing else, however often it goes away', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 10, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog()
    fieldOf(root, 'type', 'time').input('05:15')
    await nextTick()
    root = await awayAndBack()
    root = await awayAndBack()
    expect(fieldOf(root, 'type', 'time').value).toBe('05:15')
  })

  it('in trip mode, comes back with the span it was left with, not one prefilled on coming back', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 10, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog()
    root.byClass('seg mode')[0].byTag('button')[1].click()
    await nextTick()
    root.byTag('textarea')[0].input('ingen hug')
    await nextTick()
    const span = (r: FakeNode) => formOf(r).findAll((n) => n.attrs.type === 'time').map((n) => n.value)
    expect(span(root)).toEqual(['08:00', '10:00'])
    vi.setSystemTime(new Date(2026, 5, 15, 11, 30))
    root = await awayAndBack()
    expect(span(root)).toEqual(['08:00', '10:00'])
    expect(root.byTag('textarea')[0].value).toBe('ingen hug')
  })

  // Left listening, every visit to the log kept its view alive, and each
  // hidden page ran every old form's keepDraft.
  it('stops listening for the page being hidden or left once the view is gone', async () => {
    const listening = new Map<unknown, string>()
    const target = (where: string) => ({
      addEventListener: (type: string, fn: unknown) => { if (type === 'pagehide' || type === 'visibilitychange') listening.set(fn, `${where} ${type}`) },
      removeEventListener: (_type: string, fn: unknown) => { listening.delete(fn) },
    })
    vi.stubGlobal('window', target('window'))
    Object.assign(document, target('document'))
    await mountLog()
    // The form's two, and the clock's own visibilitychange (useNow).
    const once = [...listening.values()].sort()
    expect(once).toEqual(['document visibilitychange', 'document visibilitychange', 'window pagehide'])
    await awayAndBack()
    expect([...listening.values()].sort()).toEqual(once)
    view!.unmount()
    view = undefined
    expect([...listening.values()]).toEqual([])
  })

  it('opens afresh on a corrupt draft', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => '{"v":1,"mode":"catch","form":{"notes":', setItem() {}, removeItem() {} })
    const root = await mountLog()
    expect(shown(root).heading).toBe(t('log_add'))
    expect(root.byTag('textarea')[0].value).toBe('')
  })

  // Logged out in another tab, or into another account: no logout runs in
  // this tab, and the next account to open the log here found the last
  // one's half-typed catch in its form. The draft follows the log the page
  // holds: once that is no longer the account's, it is not shown, and goes.
  it('is not shown once the log on the device is no longer the account’s, and goes then', async () => {
    for (const next of [null, 'user-b']) {
      account = 'user-a'
      let root = await mountLog()
      root.byTag('textarea')[0].input('A skriver')
      await nextTick()
      view!.unmount()
      view = undefined
      // Meanwhile another tab logged out (its wipe leaves a guest's log), or another account was signed in.
      account = next
      root = await mountLog(next ? entries() : [])
      expect(root.byTag('textarea')[0].value, String(next)).toBe('')
      // Gone, not hidden: back in the account, it is not there either.
      expect(readCatchDraft('user-a'), String(next)).toBeNull()
      view!.unmount()
      view = undefined
    }
  })

  // A guest who signs in is still the one at the screen, as with the finder's search.
  it('a guest’s comes along into a sign-in, and is the account’s from then on', async () => {
    let root = await mountLog()
    root.byTag('textarea')[0].input('gæstens')
    await nextTick()
    account = 'user-a'
    root = await awayAndBack()
    expect(root.byTag('textarea')[0].value).toBe('gæstens')
    account = null
    root = await awayAndBack()
    expect(root.byTag('textarea')[0].value).toBe('')
  })

  // Signed in from another tab while a guest types here: as above, while open.
  it('a guest’s open form goes on into a sign-in made in another tab', async () => {
    let root = await mountLog()
    root.byTag('textarea')[0].input('gæstens')
    await nextTick()
    useAuthStore().user = asUser('user-a')
    await nextTick()
    expect(root.byTag('textarea')[0].value).toBe('gæstens')
    account = 'user-a'
    root = await awayAndBack()
    expect(root.byTag('textarea')[0].value).toBe('gæstens')
  })

  // A refused refresh signs the tab out and leaves the account's documents
  // on the device: the log on screen is still the account's. The same person
  // goes on typing, goes to Lokationer and back, and signs in again to save
  // it. Read signed out on the way back, the typing was deleted.
  it('keeps the typing over a refused token refresh, away and back before signing in again too', async () => {
    account = 'user-a'
    let root = await mountLog()
    root.byTag('textarea')[0].input('før')
    await nextTick()
    account = null
    useAuthStore().user = null
    await nextTick()
    expect(root.byTag('textarea')[0].value).toBe('før')
    root.byTag('textarea')[0].input('før og efter')
    await nextTick()
    root = await awayAndBack({ logOf: 'user-a' })
    expect(root.byTag('textarea')[0].value).toBe('før og efter')
    account = 'user-a'
    root = await awayAndBack() // signed in again
    expect(root.byTag('textarea')[0].value).toBe('før og efter')
  })

  it('keeps the typing over a token refresh refused while on another screen', async () => {
    account = 'user-a'
    let root = await mountLog()
    root.byTag('textarea')[0].input('før')
    await nextTick()
    account = null
    root = await awayAndBack({ logOf: 'user-a' })
    expect(root.byTag('textarea')[0].value).toBe('før')
  })

  // Another tab signs in to another account while the log is open here:
  // saved, the edit put the first account's entry into the second's log.
  it('starts over when another account is signed in while it is open', async () => {
    for (const via of [['user-b'], [null, 'user-b']]) {
      account = 'user-a'
      let root = await mountLog()
      buttonsOf(cardOf(root, 'scored').byClass('entry-actions')[0])[0].click()
      await nextTick()
      root.byTag('textarea')[0].input('A retter')
      await nextTick()
      for (const id of via) {
        useAuthStore().user = asUser(id)
        await nextTick()
      }
      expect(shown(root).heading, via.join(' → ')).toBe(t('log_add'))
      expect(shown(root).editing).toEqual([])
      expect(root.byTag('textarea')[0].value).toBe('')
      expect(readCatchDraft('user-a')).toBeNull()
      // The form is the new account's from then on.
      root.byTag('textarea')[0].input('B skriver')
      await nextTick()
      account = 'user-b'
      root = await awayAndBack()
      expect(root.byTag('textarea')[0].value).toBe('B skriver')
      view!.unmount()
      view = undefined
      clearCatchDraft()
    }
  })

  /** Another tab, signed in to `who`: its pull of the account's log lands on the device, and this page reads it in (session onStorage). */
  async function pulledElsewhere(who: string, es: CatchEntry[]) {
    const here = getActivePinia()!
    setActivePinia(createPinia())
    useAuthStore().user = asUser(who)
    fakeDb.seed('catches', { user_id: who, entries: es, updated_at: '2026-11-02T00:00:00.000Z' })
    fakeDb.session = { user: { id: who } }
    await useCatchStore().pullRemote()
    setActivePinia(here)
    log.reloadLocal()
    await nextTick()
  }

  // Signed out by a refused refresh, and another tab signs in to another
  // account: its log lands here before its sign-in does. The page holds no
  // log of the account the form was typed for.
  it('starts over when another account’s log takes the place of the account’s, signed out', async () => {
    account = 'user-a'
    const root = await mountLog()
    buttonsOf(cardOf(root, 'scored').byClass('entry-actions')[0])[0].click()
    await nextTick()
    root.byTag('textarea')[0].input('A retter')
    await nextTick()
    useAuthStore().user = null
    await nextTick()
    expect(root.byTag('textarea')[0].value).toBe('A retter')
    await pulledElsewhere('user-b', entries())
    expect(shown(root).editing).toEqual([])
    expect(root.byTag('textarea')[0].value).toBe('')
    expect(readCatchDraft('user-a')).toBeNull()
  })

  // ✎ over a typed form asks first (log_edit_drop_confirm). While it asked,
  // another tab signed in to another account: its log landed here and the
  // form started over. "Ja" then opened the first account's catch in the
  // second account's form, and Gem put it into the second account's log.
  it('✎ answered after another account’s log took the page opens nothing', async () => {
    account = 'user-a'
    const root = await mountLog()
    root.byTag('textarea')[0].input('A skriver')
    await nextTick()
    buttonsOf(cardOf(root, 'scored').byClass('entry-actions')[0])[0].click()
    expect(confirmState.open).toBe(true)
    const theirs: CatchEntry = { id: 'b1', date: daysAgo(4), time: '07:00', speciesId: 'torsk', ...at(1), notes: 'b1' }
    await pulledElsewhere('user-b', [theirs])
    useAuthStore().user = asUser('user-b')
    await nextTick()
    confirmAccept()
    await flush()
    expect(shown(root).heading).toBe(t('log_add'))
    expect(root.byTag('textarea')[0].value).toBe('')
    expect(log.entries.map((e) => e.id)).toEqual(['b1'])
    view!.unmount()
    view = undefined
    expect(readCatchDraft('user-b')).toBeNull()
  })

  // Another tab's logout takes the account's catches off the device, and
  // this page reads that in (session onStorage); a refused refresh leaves
  // them. The form stayed on screen signed out, an edit of the account's
  // entry or a new catch: the next person at the page could read it, and
  // save it into the log signed out, which the next sign-in, to another
  // account, took into that account's log. The logout and the wipe reach
  // this page apart, in either order.
  it('goes once a logout elsewhere takes the account’s log, an edit or a new catch', async () => {
    for (const what of ['an edit', 'a new catch']) {
      for (const order of ['wiped, then signed out', 'signed out, then wiped']) {
        const label = `${what}, ${order}`
        account = 'user-a'
        let root = await mountLog()
        if (what === 'an edit') {
          buttonsOf(cardOf(root, 'scored').byClass('entry-actions')[0])[0].click()
          await nextTick()
        }
        root.byTag('textarea')[0].input('A skriver')
        await nextTick()
        const wipe = async () => { localStorage.removeItem('fc2-catches'); log.reloadLocal(); await nextTick() }
        const out = async () => { useAuthStore().user = null; await nextTick() }
        if (order.startsWith('wiped')) {
          await wipe()
          // Signed in, it is a pull of another device's delete: the edit wins (catches.update).
          expect(root.byTag('textarea')[0].value, label).toBe('A skriver')
          await out()
        } else {
          await out()
          expect(root.byTag('textarea')[0].value, label).toBe('A skriver') // as a refused refresh leaves it
          await wipe()
        }
        expect(shown(root).heading, label).toBe(t('log_add'))
        expect(root.byTag('textarea')[0].value, label).toBe('')
        expect(readCatchDraft('user-a'), label).toBeNull()
        // What is typed next is the signed-out page's: it goes on into a sign-in.
        root.byTag('textarea')[0].input('den næste')
        await nextTick()
        account = 'user-b'
        root = await awayAndBack()
        expect(root.byTag('textarea')[0].value, label).toBe('den næste')
        view!.unmount()
        view = undefined
        clearCatchDraft()
      }
    }
  })

  // Kept before the log stopped being the account's (away and back, or the
  // page hidden), the draft is in the tab: the form starting over takes it
  // with it.
  it('a draft kept before the log stops being the account’s goes with the form', async () => {
    for (const how of ['a logout elsewhere', 'another account signed in']) {
      account = 'user-a'
      let root = await mountLog()
      root.byTag('textarea')[0].input('A skriver')
      await nextTick()
      root = await awayAndBack()
      expect(readCatchDraft('user-a')?.form?.notes, how).toBe('A skriver')
      if (how === 'a logout elsewhere') {
        useAuthStore().user = null
        await nextTick()
        localStorage.removeItem('fc2-catches')
        log.reloadLocal()
      } else useAuthStore().user = asUser('user-b')
      await nextTick()
      expect(root.byTag('textarea')[0].value, how).toBe('')
      expect(readCatchDraft('user-a'), how).toBeNull()
      view!.unmount()
      view = undefined
      clearCatchDraft()
    }
  })

  // A refused refresh leaves the entries on the device: the edit stays.
  it('an edit stays open over a refused token refresh', async () => {
    account = 'user-a'
    const root = await mountLog()
    buttonsOf(cardOf(root, 'scored').byClass('entry-actions')[0])[0].click()
    await nextTick()
    root.byTag('textarea')[0].input('A retter')
    await nextTick()
    useAuthStore().user = null
    await nextTick()
    expect(shown(root).heading).toBe(t('log_edit_h'))
    expect(shown(root).editing).toEqual(['scored'])
    expect(root.byTag('textarea')[0].value).toBe('A retter')
  })

  // No account to leave: as signed in, the edit wins (catches.update).
  it('a guest’s edit stays open when its entry goes', async () => {
    const root = await mountLog()
    buttonsOf(cardOf(root, 'scored').byClass('entry-actions')[0])[0].click()
    await nextTick()
    root.byTag('textarea')[0].input('gæsten retter')
    await nextTick()
    log.entries = []
    await nextTick()
    expect(shown(root).heading).toBe(t('log_edit_h'))
    expect(root.byTag('textarea')[0].value).toBe('gæsten retter')
  })

  // main.ts mounts the app before auth.init has read the session, and
  // offline with an expired token auth-js tries its refresh for about 50 s
  // before the page reads as signed out (the session kept on the device).
  // The log the device holds says whose the page is meanwhile: the draft
  // shows at once, and is kept as the page is left. Waiting for the session,
  // it was neither, and then deleted.
  it('opened before the page has read its session, shows the draft of the account whose log the device holds', async () => {
    account = 'user-a'
    let root = await mountLog()
    root.byTag('textarea')[0].input('fra før genindlæsning')
    await nextTick()
    view!.unmount()
    view = undefined
    root = await mountLog(log.entries, { reading: true })
    expect(root.byTag('textarea')[0].value).toBe('fra før genindlæsning')
    root.byTag('textarea')[0].input('og imens')
    await nextTick()
    view!.unmount()
    view = undefined
    expect(readCatchDraft('user-a')?.form?.notes).toBe('og imens')
    root = await mountLog(log.entries, { reading: true })
    const auth = useAuthStore()
    auth.loading = false // read as signed out: the refresh failed offline
    await nextTick()
    expect(root.byTag('textarea')[0].value).toBe('og imens')
    auth.user = asUser('user-a') // the refresh lands
    await nextTick()
    expect(root.byTag('textarea')[0].value).toBe('og imens')
  })

  // A guest's log on the device, the session not read yet: an account may be
  // signed in whose pull has not reached the log here (it failed). Its draft
  // waits for the session: shown then, to that account; signed out, or to
  // another account, it goes. Typed into meanwhile, the typing stays.
  it('opened before the page has read its session, with a guest’s log on the device, waits for the session', async () => {
    for (const [read, typed] of [['user-a', ''], [null, ''], ['user-b', ''], ['user-a', 'skrevet imens']] as const) {
      const label = `${read}: ${typed}`
      account = 'user-a'
      let root = await mountLog(entries(), { logOf: null })
      root.byTag('textarea')[0].input('fra før genindlæsning')
      await nextTick()
      view!.unmount()
      view = undefined
      root = await mountLog(log.entries, { reading: true, logOf: null })
      expect(root.byTag('textarea')[0].value, label).toBe('')
      if (typed) root.byTag('textarea')[0].input(typed)
      const auth = useAuthStore()
      auth.user = asUser(read)
      auth.loading = false
      await nextTick()
      expect(root.byTag('textarea')[0].value, label).toBe(typed || (read === 'user-a' ? 'fra før genindlæsning' : ''))
      if (read !== 'user-a') expect(readCatchDraft('user-a'), label).toBeNull()
      view!.unmount()
      view = undefined
      clearCatchDraft()
    }
  })

  // A guest's draft goes on into whichever account the page turns out to
  // be: it needs no session to show, and is kept. A session read that never
  // ends (auth.init hanging) kept it from the form for the page's life.
  it('opened before the page has read its session, shows a guest’s draft at once, and keeps it', async () => {
    let root = await mountLog()
    root.byTag('textarea')[0].input('gæstens')
    await nextTick()
    view!.unmount()
    view = undefined
    root = await mountLog(log.entries, { reading: true })
    expect(root.byTag('textarea')[0].value).toBe('gæstens')
    root.byTag('textarea')[0].input('gæstens, og mere')
    await nextTick()
    view!.unmount()
    view = undefined
    expect(readCatchDraft(null)?.form?.notes).toBe('gæstens, og mere')
    root = await mountLog(log.entries, { reading: true })
    const auth = useAuthStore()
    auth.user = asUser('user-a')
    auth.loading = false
    await nextTick()
    expect(root.byTag('textarea')[0].value).toBe('gæstens, og mere')
  })

  // A session read that never ends (auth.init hanging on auth-js's lock),
  // or takes long, with a guest's log on the device: what is typed
  // meanwhile is typed on that log, so it is a guest's, and goes on into
  // whichever account the page turns out to be. It was kept for nobody,
  // and went as the page was left. Nothing typed, an account's draft
  // waiting for the session is left alone.
  it('opened before the page has read its session, with a guest’s log on the device, keeps what is typed meanwhile', async () => {
    account = 'user-a'
    let root = await mountLog(entries(), { logOf: null })
    root.byTag('textarea')[0].input('A sin')
    await nextTick()
    view!.unmount()
    view = undefined
    await mountLog(log.entries, { reading: true, logOf: null })
    view!.unmount() // nothing typed
    view = undefined
    expect(readCatchDraft('user-a')?.form?.notes).toBe('A sin')
    root = await mountLog(log.entries, { reading: true, logOf: null })
    root.byTag('textarea')[0].input('imens')
    await nextTick()
    view!.unmount()
    view = undefined
    root = await mountLog(log.entries, { reading: true, logOf: null })
    expect(root.byTag('textarea')[0].value).toBe('imens')
    const auth = useAuthStore()
    auth.user = asUser('user-a')
    auth.loading = false
    await nextTick()
    expect(root.byTag('textarea')[0].value).toBe('imens')
  })
})

/**
 * The form's date and time are one moment, as the log keeps them (stores/
 * catches CATCH_WHEN). Left open over midnight, the form rolled the date on
 * by itself while the time stayed as typed: a catch at 23:40, its time put in
 * at 23:50 and saved at 00:05, was stored at 23:40 the next day, a day late
 * and in the future.
 */
describe('the form over midnight', () => {
  const formOf = (root: FakeNode) => root.byClass('card form')[0]
  const fieldOf = (root: FakeNode, k: string, v: string) => formOf(root).findAll((n) => n.attrs[k] === v)[0]
  const select = (root: FakeNode, id: string) => {
    const s = formOf(root).byTag('select')[0]
    for (const o of s.options) o.selected = o.value === id
    s.dispatch('change')
  }
  /** The clock passes midnight, and the view's clock ticks. */
  async function midnight() {
    vi.setSystemTime(new Date(2026, 5, 16, 0, 1))
    vi.advanceTimersByTime(60_000)
    await nextTick(); await nextTick()
  }

  it('a time put in by hand before midnight keeps its date, and the catch saves on it', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    fieldOf(root, 'type', 'time').input('23:40')
    select(root, 'havørred')
    await nextTick()
    await midnight()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value]).toEqual(['2026-06-15', '23:40'])
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.time])).toEqual([['2026-06-15', '23:40']])
  })

  const dateNote = (root: FakeNode) => texts(formOf(root).byClass('date-note'))
  /** The clock reads `d`, and the view's clock has ticked to it. */
  async function clockAt(d: Date) {
    vi.setSystemTime(d.getTime() - 60_000)
    vi.advanceTimersByTime(60_000)
    await nextTick()
  }

  // Kept over midnight for the 23:40 catch, the date stayed yesterday's for
  // the next fish too: caught at 00:15 and typed in at 00:20, it was stored
  // at 00:15 the day before, nearly a day early, with nothing said.
  it('a date kept over midnight follows a time typed after it, and says it is yesterday’s while it is', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    select(root, 'havørred')
    fieldOf(root, 'type', 'time').input('23:45')
    await nextTick()
    expect(dateNote(root)).toEqual([])
    await midnight()
    expect(dateNote(root)).toEqual([t('log_date_yesterday')])
    await clockAt(new Date(2026, 5, 16, 0, 20))
    fieldOf(root, 'type', 'time').input('23:55') // later than now: still last night's
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, dateNote(root)]).toEqual(['2026-06-15', [t('log_date_yesterday')]])
    fieldOf(root, 'type', 'time').input('00:15')
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value]).toEqual(['2026-06-16', '00:15'])
    expect(dateNote(root)).toEqual([])
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.time])).toEqual([['2026-06-16', '00:15']])
  })

  it('a date set by hand stays where it was put, with no note', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    fieldOf(root, 'type', 'time').input('23:45')
    await nextTick()
    await midnight()
    fieldOf(root, 'type', 'date').input('2026-06-14')
    fieldOf(root, 'type', 'time').input('00:15')
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, dateNote(root)]).toEqual(['2026-06-14', []])
  })

  // A phone left on the log for two nights wakes on a date two days back.
  it('a date kept over more than one midnight says it is not today, and follows a time typed after it', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    fieldOf(root, 'type', 'time').input('23:45')
    await nextTick()
    vi.setSystemTime(new Date(2026, 5, 17, 0, 30))
    vi.advanceTimersByTime(60_000)
    await nextTick(); await nextTick()
    expect([fieldOf(root, 'type', 'date').value, dateNote(root)]).toEqual(['2026-06-15', [t('log_date_earlier')]])
    fieldOf(root, 'type', 'time').input('23:10')
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, dateNote(root)]).toEqual(['2026-06-16', [t('log_date_yesterday')]])
  })

  it('says yesterday in the language picked', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    const pinia = getActivePinia()!
    fieldOf(root, 'type', 'time').input('23:45')
    await nextTick()
    await midnight()
    expect(dateNote(root)).toEqual([STRINGS.da.log_date_yesterday])
    setLang('en')
    await langReady() // the English table is a chunk of its own
    setActivePinia(pinia)
    await nextTick()
    expect(dateNote(root)).toEqual([STRINGS.en.log_date_yesterday])
  })

  it('in trip mode, a date kept over midnight follows a span typed after it', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 30), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    root.byClass('seg mode')[0].byTag('button')[1].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    const [from, to] = formOf(root).findAll((n) => n.attrs.type === 'time')
    from.input('19:00'); to.input('22:00')
    await nextTick()
    await midnight()
    expect(dateNote(root)).toEqual([t('log_date_yesterday')])
    await clockAt(new Date(2026, 5, 16, 0, 20))
    from.input('22:30'); to.input('00:10') // over midnight: it began last night
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, dateNote(root)]).toEqual(['2026-06-15', [t('log_date_yesterday')]])
    from.input('00:00')
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, dateNote(root)]).toEqual(['2026-06-16', []])
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.from, e.to])).toEqual([['2026-06-16', '00:00', '00:10']])
  })

  // The rollover took every field's value as its prefill: a time or span
  // typed before midnight read as untouched after it. Leaving the view
  // dropped it, ✎ opened an entry over it without asking, Annullér went away.
  it('a time or span typed before midnight still counts as typed after it', async () => {
    for (const m of ['catch', 'trip']) {
      vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 30), toFake: ['Date', 'setInterval', 'clearInterval'] })
      let root = await mountLog([{ id: 'c', date: '2026-06-10', time: '07:00', speciesId: 'torsk', ...at(0), notes: 'c' }])
      if (m === 'trip') root.byClass('seg mode')[0].byTag('button')[1].click()
      await nextTick()
      const times = () => formOf(root).findAll((n) => n.attrs.type === 'time')
      if (m === 'trip') { times()[0].input('19:00'); times()[1].input('22:00') } else times()[0].input('23:20')
      await nextTick()
      await midnight()
      // The time typed again as it was: the form looks at itself afresh.
      const last = times()[times().length - 1]
      const was = String(last.value)
      last.input('21:00'); last.input(was)
      await nextTick()
      expect(buttonsOf(formOf(root)).filter((b) => b.textContent === t('log_cancel')), m).toHaveLength(1)
      buttonsOf(cardOf(root, 'c').byClass('entry-actions')[0])[0].click()
      expect(confirmState.open, m).toBe(true)
      confirmCancel()
      await flush()
      view!.unmount()
      view = undefined
      root = await mountLog(log.entries)
      expect([fieldOf(root, 'type', 'date').value, ...times().map((n) => n.value)], m)
        .toEqual(m === 'trip' ? ['2026-06-15', '19:00', '22:00'] : ['2026-06-15', '23:20'])
      view!.unmount()
      view = undefined
      clearCatchDraft()
    }
  })

  it('a form with neither touched still rolls over, date and time together', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    select(root, 'havørred')
    await nextTick()
    await midnight()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value]).toEqual(['2026-06-16', '00:02'])
  })

  it('in trip mode, a span put in before midnight keeps its date, and can be saved', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 30), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    root.byClass('seg mode')[0].byTag('button')[1].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    const [from, to] = formOf(root).findAll((n) => n.attrs.type === 'time')
    from.input('19:00'); to.input('22:00')
    await nextTick()
    await midnight()
    expect(fieldOf(root, 'type', 'date').value).toBe('2026-06-15')
    expect(formOf(root).byClass('guard')[0].textContent).not.toContain(t('log_trip_future'))
    const save = formOf(root).byClass('btn primary')[0]
    expect(save.attrs.disabled).toBe(false)
    save.click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.from, e.to])).toEqual([['2026-06-15', '19:00', '22:00']])
  })

  // The place and method the trip was prefilled with (the newest entry
  // today) belong to that trip too. With its span kept, they rolled on to
  // the new day's: no entry yet, so no place, and Save waited for one.
  it('in trip mode, a span put in before midnight keeps the place and method it was prefilled with', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 30), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([{ id: 'c', date: '2026-06-15', time: '20:00', speciesId: 'havørred', ...at(0), method: 'waders', notes: 'c' }])
    root.byClass('seg mode')[0].byTag('button')[1].click()
    await nextTick()
    const [from, to] = formOf(root).findAll((n) => n.attrs.type === 'time')
    from.input('21:00'); to.input('23:00')
    await nextTick()
    await midnight()
    expect(fieldOf(root, 'list', 'loc-options').value).toBe(LOCS[0].name)
    expect(texts(formOf(root).byClass('seg-btn').filter((b) => b.hasClass('on')))).toContain(`🦺 ${t('method_waders')}`)
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries.filter((e) => e.outcome === 'empty').map((e) => [e.date, e.from, e.to, e.locationId, e.method]))
      .toEqual([['2026-06-15', '21:00', '23:00', 'L0', 'waders']])
  })

  // Right after midnight the form says today. A catch at 23:40 last night,
  // its time put right and its date not, was saved: the form checked the
  // date alone, and the catch sat first in the log, a day ahead, scored
  // from a forecast. A trip that hasn't ended is refused (log_trip_future).
  it('a catch later than now is not saved, and the form says why', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 16, 0, 10), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    fieldOf(root, 'type', 'time').input('23:40')
    select(root, 'havørred')
    await nextTick()
    const save = formOf(root).byClass('btn primary')[0]
    expect(save.attrs.disabled).toBe(true)
    expect(texts(formOf(root).byClass('guard')[0].elements)).toEqual([`⚠️ ${t('log_future_warn')}`])
    save.click()
    await flush()
    expect(log.entries).toEqual([])
    // The date put right, it saves.
    fieldOf(root, 'type', 'date').input('2026-06-15')
    await nextTick()
    expect(formOf(root).byClass('guard').filter((g) => g.textContent.includes(t('log_future_warn')))).toEqual([])
    expect(save.attrs.disabled).toBe(false)
    save.click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.time])).toEqual([['2026-06-15', '23:40']])
  })

  it('the minute now is not later than now, and a time just ahead stops being so as the clock reaches it', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 16, 10, 0, 40), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    select(root, 'havørred')
    fieldOf(root, 'type', 'time').input('10:01') // the clock the form reads ticks once a minute
    await nextTick()
    const save = formOf(root).byClass('btn primary')[0]
    expect(save.attrs.disabled).toBe(false)
    fieldOf(root, 'type', 'time').input('10:05')
    await nextTick()
    expect(save.attrs.disabled).toBe(true)
    vi.advanceTimersByTime(4 * 60_000)
    await nextTick()
    expect(save.attrs.disabled).toBe(false)
  })

  it('says so in the language picked', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 16, 0, 10), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    const pinia = getActivePinia()!
    fieldOf(root, 'type', 'time').input('23:40')
    await nextTick()
    expect(texts(formOf(root).byClass('guard')[0].elements)).toEqual([`⚠️ ${STRINGS.da.log_future_warn}`])
    setLang('en')
    await langReady() // the English table is a chunk of its own
    setActivePinia(pinia)
    await nextTick()
    expect(texts(formOf(root).byClass('guard')[0].elements)).toEqual([`⚠️ ${STRINGS.en.log_future_warn}`])
  })
})

describe('Modeltjek on the log', () => {
  // One night's fishing, its fish either side of midnight: counted by date,
  // it was "2 ture med fangst", as the panel's groups were (catchOutingKeys).
  it('counts a night session over midnight as one trip with a catch', async () => {
    const root = await mountLog([
      { id: 'n1', date: daysAgo(3), time: '23:30', speciesId: 'havørred', ...at(0), notes: 'n1' },
      { id: 'n2', date: daysAgo(2), time: '00:40', speciesId: 'havørred', ...at(0), notes: 'n2' },
    ])
    const line = root.byClass('card modelcheck')[0].byClass('mc-sub')[0].textContent
    expect(line).toBe(t('insight_count').replace('{a}', t('insight_trip_one')).replace('{b}', '0'))
  })
})
