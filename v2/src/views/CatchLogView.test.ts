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
import { clearCatchDraft, draftEpoch, keepCatchDraft, readCatchDraft } from '@/lib/catchDraft'
import { langReady, setLang, t } from '@/lib/i18n'
import { scoreColor, scoreLabel } from '@/lib/scoring'
import { STRINGS } from '@/test/strings'
import { CPU_BOUND_MS } from '@/test/timeouts'
import type { WindowSample } from '@/lib/catchInsights'
import type { Availability, CatchEntry, Location } from '@/lib/types'
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
 * `availability`: the times set for fishing as the view opens.
 */
async function mountLog(es: CatchEntry[] = entries(), { reading = false, logOf = account, locations = LOCS, availability = [] as Availability[] } = {}) {
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
  setup.locations = locations.map((l) => ({ ...l }))
  setup.targetSpecies = [...TARGETS]
  setup.availability = [...availability]
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
    expect(texts(coastCard.byClass('size'))).toEqual(['⚖️ 2,5 kg'])
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

  // A pull renaming the open entry's spot changed the name ✎ would show for
  // it, not the place the form holds: ✎ on another entry asked to drop what
  // was typed, with nothing typed. The place is judged as a spot now.
  it('✎ on another entry does not ask when a pull only renamed the open one’s spot', async () => {
    const root = await mountLog()
    const pen = (id: string) => buttonsOf(cardOf(root, id).byClass('entry-actions')[0])[0]
    for (const [open, next, spot] of [['scored', 'trip', 'L0'], ['trip', 'scored', 'L1']]) {
      pen(open).click()
      await nextTick()
      // Renamed on another device: the pull brings the spot and the log's names.
      const name = setup.locations.find((l) => l.id === spot)!.name + ' nord'
      setup.locations = setup.locations.map((l) => (l.id === spot ? { ...l, name } : l))
      log.entries = log.entries.map((e) => (e.locationId === spot ? { ...e, locationName: name } : e))
      await nextTick()
      pen(next).click()
      await flush()
      expect(confirmState.open, open).toBe(false)
      expect(root.byTag('textarea')[0].value, open).toBe(next)
    }
    // Another spot put in is still a change.
    root.byClass('card form')[0].findAll((n) => n.attrs.list === 'loc-options')[0].input(setup.locations[1].name)
    await nextTick()
    pen('trip').click()
    expect(confirmState.open).toBe(true)
  })

  // 'renamed' is linked to L1 under the name L1 had before a rename, so ✎
  // shows L1's name now. A pull then deleted L1: the form's place, untouched,
  // matched neither a spot nor the entry's stored name, and ✎ on another
  // entry asked to drop changes nobody made.
  it('✎ on another entry does not ask when a pull deleted the open one’s spot, renamed before ✎', async () => {
    const root = await mountLog()
    const pen = (id: string) => buttonsOf(cardOf(root, id).byClass('entry-actions')[0])[0]
    const place = () => root.byClass('card form')[0].findAll((n) => n.attrs.list === 'loc-options')[0]
    pen('renamed').click()
    await nextTick()
    expect(place().value).toBe(LOCS[1].name)
    setup.locations = setup.locations.filter((l) => l.id !== 'L1')
    await nextTick()
    pen('scored').click()
    await flush()
    expect(confirmState.open).toBe(false)
    expect(root.byTag('textarea')[0].value).toBe('scored')
    // Another place put in is still a change.
    pen('renamed').click()
    await nextTick()
    place().input('Et andet sted')
    await nextTick()
    pen('trip').click()
    expect(confirmState.open).toBe(true)
  })

  it('✎ on another entry does not ask when a pull deleted the open one’s spot while the form was away', async () => {
    let root = await mountLog()
    buttonsOf(cardOf(root, 'renamed').byClass('entry-actions')[0])[0].click()
    await nextTick()
    const es = log.entries
    view!.unmount()
    view = undefined
    root = await mountLog(es, { locations: LOCS.filter((l) => l.id !== 'L1') })
    expect(cards(root).filter((c) => c.hasClass('active')).map((c) => c.byClass('entry-notes')[0].textContent)).toEqual(['renamed'])
    buttonsOf(cardOf(root, 'scored').byClass('entry-actions')[0])[0].click()
    await flush()
    expect(confirmState.open).toBe(false)
    expect(root.byTag('textarea')[0].value).toBe('scored')
  })

  // A place that is no saved spot is its text: saved, a letter put in
  // another case is what the card shows. Judged as a spot alone, the change
  // was let go without a word.
  it('✎ on another entry asks when the open one’s place, no saved spot, was retyped in another case', async () => {
    const root = await mountLog()
    const pen = (id: string) => buttonsOf(cardOf(root, id).byClass('entry-actions')[0])[0]
    pen('free').click()
    await nextTick()
    root.byClass('card form')[0].findAll((n) => n.attrs.list === 'loc-options')[0].input('et sted uden navn')
    await nextTick()
    pen('trip').click()
    expect(confirmState.open).toBe(true)
  })

  // ✎ on the entry already open, changed, offered to drop the changes and
  // edit it "instead": the same entry as it was. It only shows the form now.
  it('✎ on the entry already open keeps its changes and brings the form into view', async () => {
    const root = await mountLog()
    const pen = () => buttonsOf(cardOf(root, 'scored').byClass('entry-actions')[0])[0]
    pen().click()
    await nextTick()
    root.byTag('textarea')[0].input('rettet')
    await nextTick()
    const shown = vi.fn()
    root.byClass('card form')[0].scrollIntoView = shown
    pen().click()
    await flush()
    expect(confirmState.open).toBe(false)
    expect(shown).toHaveBeenCalledTimes(1)
    expect(root.byTag('textarea')[0].value).toBe('rettet')
    expect(cards(root).filter((c) => c.hasClass('active')).map((c) => c.byClass('entry-notes')[0].textContent)).toEqual(['scored'])
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
  // spot within a day of it can clash; the rest go unread. 200 cards
  // mounted: 0.6 s alone, the CPU-bound limit (src/test/timeouts.ts).
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
  }, CPU_BOUND_MS)

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

  // A form put back with nothing typed in it is suggested afresh, but an
  // edit is the entry's, as it was opened: here a catch with only a place,
  // the spot the trip form suggested, and nothing else to tell it from a
  // fresh form.
  it('an edit put back is never suggested afresh, even one that holds only the place suggested', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 14, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([{ id: 'c', date: '2026-06-15', time: '06:00', speciesId: '', ...at(0), notes: '' }])
    root.byClass('seg mode')[0].byTag('button')[1].click()
    await nextTick()
    expect(fieldOf(root, 'list', 'loc-options').value).toBe(LOCS[0].name) // today's newest entry's spot
    buttonsOf(cards(root)[0].byClass('entry-actions')[0])[0].click()
    await nextTick()
    // The card has no note to find it by (shown): it is the only one.
    const seen = (r: FakeNode) => ({
      heading: r.byClass('form-h')[0].textContent,
      fields: formOf(r).findAll((n) => n.tag === 'input' || n.tag === 'select').map((n) => `${n.attrs.type ?? n.tag}=${n.value}`),
      editing: cards(r)[0].hasClass('active'),
    })
    const before = seen(root)
    expect(before).toMatchObject({ heading: t('log_edit_h'), editing: true })
    expect(before.fields).toContain('time=06:00')
    vi.setSystemTime(new Date(2026, 5, 15, 14, 30))
    root = await awayAndBack()
    expect(seen(root)).toEqual(before)
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
 * The catch form and the trip form are one form, the date, place, method and
 * note shown in both. Saving either started both over: a span typed for a
 * trip went with the catch saved beside it, and a catch begun went with the
 * trip saved. What was typed in the form not saved stays now, on its date.
 * The form saved starts over, and what both show went with the entry saved.
 */
describe('the other form, as one is saved', () => {
  const formOf = (root: FakeNode) => root.byClass('card form')[0]
  const fieldOf = (root: FakeNode, k: string, v: string) => formOf(root).findAll((n) => n.attrs[k] === v)[0]
  const select = (root: FakeNode, id: string) => {
    const s = formOf(root).byTag('select')[0]
    for (const o of s.options) o.selected = o.value === id
    s.dispatch('change')
  }
  const modes = (root: FakeNode) => root.byClass('seg mode')[0].byTag('button')
  const times = (root: FakeNode) => formOf(root).findAll((n) => n.attrs.type === 'time')
  const val = (n: FakeNode) => String(n.value)
  // v-model picks the option by its index: the fake select has no value of its own.
  const species = (root: FakeNode) => {
    const s = formOf(root).byTag('select')[0]
    return String(s.options[s.selectedIndex]?.value ?? '')
  }
  const dateNote = (root: FakeNode) => texts(formOf(root).byClass('date-note'))
  /** The trip form: date, span, place, and what the date says. */
  const tripForm = (root: FakeNode) => [val(fieldOf(root, 'type', 'date')), ...times(root).map(val), val(fieldOf(root, 'list', 'loc-options')), dateNote(root)]
  /** The catch form: date, time, species, count, length, weight, place, note, and what the date says. */
  const catchForm = (root: FakeNode) => [
    ...['date', 'time'].map((k) => val(fieldOf(root, 'type', k))), species(root),
    ...['9999', '400', '500'].map((m) => val(fieldOf(root, 'max', m))),
    val(fieldOf(root, 'list', 'loc-options')), val(root.byTag('textarea')[0]), dateNote(root),
  ]
  const on = (root: FakeNode) => formOf(root).findAll((n) => n.hasClass('seg-btn') && n.hasClass('on')).map((n) => n.textContent)
  const save = async (root: FakeNode) => { formOf(root).byClass('btn primary')[0].click(); await flush() }
  /** Away to another screen and back: the view unmounts, the stores stay. */
  async function awayAndBack() {
    const es = log.entries
    view!.unmount()
    view = undefined
    return mountLog(es)
  }
  const NIGHT = { id: 'night', days: [0, 1, 2, 3, 4, 5, 6], from: '22:00', to: '02:00', methods: ['shore' as const] }

  it('a catch saved keeps the span typed for a trip beside it, in the form and in the draft', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 14, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    modes(root)[1].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    times(root)[0].input('10:00'); times(root)[1].input('11:00')
    await nextTick()
    modes(root)[0].click()
    await nextTick()
    select(root, 'torsk')
    fieldOf(root, 'max', '400').input('45')
    await nextTick()
    root = await awayAndBack() // a draft holding both
    await save(root)
    expect(log.entries.map((e) => [e.date, e.time, e.speciesId, e.lengthCm, e.locationName])).toEqual([['2026-06-15', '14:00', 'torsk', 45, LOCS[1].name]])
    // The catch form starts over; the place went with the catch.
    expect(catchForm(root)).toEqual(['2026-06-15', '14:00', '', '', '', '', '', '', []])
    expect(readCatchDraft(null)?.form).toMatchObject({ from: '10:00', to: '11:00' })
    modes(root)[1].click()
    await nextTick()
    const trip = ['2026-06-15', '10:00', '11:00', '', []]
    expect(tripForm(root)).toEqual(trip)
    root = await awayAndBack()
    expect(tripForm(root)).toEqual(trip)
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    await nextTick()
    await save(root)
    expect(log.entries.map((e) => [e.outcome ?? 'catch', e.date, e.time ?? `${e.from}–${e.to}`]))
      .toEqual([['empty', '2026-06-15', '10:00–11:00'], ['catch', '2026-06-15', '14:00']])
  })

  it('a trip saved keeps the catch begun beside it, in the form and in the draft', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 14, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    select(root, 'havørred')
    fieldOf(root, 'type', 'time').input('13:10')
    fieldOf(root, 'max', '9999').input('2')
    fieldOf(root, 'max', '400').input('45')
    fieldOf(root, 'max', '500').input('1.2')
    buttonsOf(formOf(root)).find((b) => b.textContent.includes(t('log_released')))!.click()
    await nextTick()
    modes(root)[1].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    times(root)[0].input('08:00'); times(root)[1].input('10:00')
    root.byTag('textarea')[0].input('ingen hug')
    await nextTick()
    root = await awayAndBack() // a draft holding both
    await save(root)
    expect(log.entries.map((e) => [e.outcome, e.date, e.from, e.to, e.locationName, e.notes])).toEqual([['empty', '2026-06-15', '08:00', '10:00', LOCS[1].name, 'ingen hug']])
    expect(readCatchDraft(null)?.form).toMatchObject({ time: '13:10', speciesId: 'havørred', count: 2, lengthCm: 45, weightKg: 1.2, released: true })
    modes(root)[0].click()
    await nextTick()
    // The place and the note went with the trip.
    const caught = ['2026-06-15', '13:10', 'havørred', '2', '45', '1.2', '', '', []]
    expect(catchForm(root)).toEqual(caught)
    expect(on(root)).toContain(`🌊 ${t('log_released')}`)
    root = await awayAndBack()
    expect(catchForm(root)).toEqual(caught)
    fieldOf(root, 'list', 'loc-options').input(LOCS[0].name)
    await nextTick()
    await save(root)
    expect(log.entries[0]).toMatchObject({ date: '2026-06-15', time: '13:10', speciesId: 'havørred', count: 2, lengthCm: 45, weightKg: 1.2, released: true, locationName: LOCS[0].name })
  })

  // Only what was typed: a time left as the form suggested it is the time
  // now on the next look, as it always was.
  it('a catch begun with its time as suggested gets the time now on the next look, after a trip saved', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 14, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    select(root, 'havørred')
    await nextTick()
    modes(root)[1].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    times(root)[0].input('12:00'); times(root)[1].input('13:00')
    await nextTick()
    vi.setSystemTime(new Date(2026, 5, 15, 14, 30))
    await save(root)
    modes(root)[0].click()
    await nextTick()
    expect(catchForm(root)).toEqual(['2026-06-15', '14:30', 'havørred', '', '', '', '', '', []])
  })

  // Each form's date is its own once a time or span is typed for it: the
  // trip's last night, the catch's today. The save keeps the other's.
  it('over midnight, a catch saved today leaves the span typed for last night on last night', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 16, 1, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    setup.availability = [NIGHT]
    modes(root)[1].click()
    await nextTick()
    times(root)[0].input('23:00'); times(root)[1].input('00:45')
    await nextTick()
    modes(root)[0].click()
    await nextTick()
    select(root, 'havørred')
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    await nextTick()
    await save(root)
    expect(log.entries.map((e) => [e.date, e.time])).toEqual([['2026-06-16', '01:00']])
    modes(root)[1].click()
    await nextTick()
    expect(tripForm(root)).toEqual(['2026-06-15', '23:00', '00:45', '', [t('log_date_yesterday')]])
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    await nextTick()
    await save(root)
    expect(log.entries.map((e) => [e.date, e.time ?? `${e.from}–${e.to}`])).toEqual([['2026-06-15', '23:00–00:45'], ['2026-06-16', '01:00']])
  })

  it('over midnight, a trip saved for last night leaves the catch typed for today on today', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 16, 1, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    setup.availability = [NIGHT]
    select(root, 'havørred')
    fieldOf(root, 'type', 'time').input('00:30')
    await nextTick()
    modes(root)[1].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    times(root)[0].input('23:00'); times(root)[1].input('00:15')
    await nextTick()
    await save(root)
    expect(log.entries.map((e) => [e.date, e.from, e.to])).toEqual([['2026-06-15', '23:00', '00:15']])
    modes(root)[0].click()
    await nextTick()
    expect(catchForm(root)).toEqual(['2026-06-16', '00:30', 'havørred', '', '', '', '', '', []])
  })

  // A date set by hand is both forms' (it stays over a look at the other):
  // the trip saved on it leaves the catch begun on it there too.
  it('a date set by hand stays with the form not saved', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 14, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    fieldOf(root, 'type', 'date').input('2026-06-12')
    select(root, 'havørred')
    fieldOf(root, 'type', 'time').input('07:00')
    await nextTick()
    modes(root)[1].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    times(root)[0].input('05:00'); times(root)[1].input('06:30')
    await nextTick()
    await save(root)
    expect(log.entries.map((e) => [e.date, e.from, e.to])).toEqual([['2026-06-12', '05:00', '06:30']])
    modes(root)[0].click()
    await nextTick()
    expect(catchForm(root)).toEqual(['2026-06-12', '07:00', 'havørred', '', '', '', '', '', []])
  })

  // Set by hand to today, after the form kept last night's date: still set
  // by hand, and not the trip form's last night once the trip is saved.
  it('a date set by hand to today stays today’s with the form not saved, past a trip form prefilled with last night', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    setup.availability = [NIGHT]
    select(root, 'havørred')
    fieldOf(root, 'type', 'time').input('23:45')
    await nextTick()
    vi.setSystemTime(new Date(2026, 5, 16, 0, 29))
    vi.advanceTimersByTime(60_000) // the view's clock ticks past midnight
    await nextTick()
    expect(val(fieldOf(root, 'type', 'date'))).toBe('2026-06-15')
    fieldOf(root, 'type', 'date').input('2026-06-16')
    fieldOf(root, 'type', 'time').input('00:20')
    await nextTick()
    modes(root)[1].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    times(root)[0].input('00:00'); times(root)[1].input('00:25')
    await nextTick()
    await save(root)
    expect(log.entries.map((e) => [e.date, e.from, e.to])).toEqual([['2026-06-16', '00:00', '00:25']])
    modes(root)[0].click()
    await nextTick()
    expect(catchForm(root)).toEqual(['2026-06-16', '00:20', 'havørred', '', '', '', '', '', []])
  })

  // A catch begun last night and put back the next morning keeps its date and
  // time, left as the form put them in (the draft's rule): a trip saved
  // beside it leaves them so, over the next midnight too.
  it('a draft’s catch put back the next morning keeps its date and time beside a trip saved, over the next midnight too', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 22, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    select(root, 'havørred')
    await nextTick()
    view!.unmount()
    view = undefined
    vi.setSystemTime(new Date(2026, 5, 16, 7, 0))
    root = await mountLog([])
    modes(root)[1].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    times(root)[0].input('20:00'); times(root)[1].input('21:30')
    await nextTick()
    await save(root)
    expect(log.entries.map((e) => [e.date, e.from, e.to])).toEqual([['2026-06-15', '20:00', '21:30']])
    modes(root)[0].click()
    await nextTick()
    expect(catchForm(root)).toEqual(['2026-06-15', '22:00', 'havørred', '', '', '', '', '', [t('log_date_yesterday')]])
    vi.setSystemTime(new Date(2026, 5, 17, 0, 0))
    vi.advanceTimersByTime(60_000) // the view's clock ticks past midnight
    await nextTick(); await nextTick()
    expect(catchForm(root)).toEqual(['2026-06-15', '22:00', 'havørred', '', '', '', '', '', [t('log_date_earlier')]])
  })

  // The same catch, put back with the trip form shown: the draft's day is the
  // date both forms show, and a look at the catch form shows it there. Saved
  // first, the trip took that day with it, and the catch came back on this
  // morning at the time now, as if it was never begun last night.
  it('a draft’s catch put back the next morning behind the trip form keeps its date and time beside a trip saved', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 22, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    select(root, 'havørred')
    await nextTick()
    modes(root)[1].click()
    await nextTick()
    times(root)[0].input('20:00'); times(root)[1].input('21:30')
    await nextTick()
    view!.unmount()
    view = undefined
    vi.setSystemTime(new Date(2026, 5, 16, 7, 0))
    root = await mountLog([])
    expect(tripForm(root)).toEqual(['2026-06-15', '20:00', '21:30', '', [t('log_date_yesterday')]])
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    await nextTick()
    await save(root)
    expect(log.entries.map((e) => [e.date, e.from, e.to])).toEqual([['2026-06-15', '20:00', '21:30']])
    root = await awayAndBack()
    modes(root)[0].click()
    await nextTick()
    expect(catchForm(root)).toEqual(['2026-06-15', '22:00', 'havørred', '', '', '', '', '', [t('log_date_yesterday')]])
  })

  // But only a catch whose time was suggested for the draft's day: one begun
  // at 01:00 on the 16th, behind a trip on the night of the 15th, gets today
  // and the time now on a look at it, and so it does after the trip is saved.
  // Given the draft's day, it was on the 15th at 01:00: a day early.
  it('a draft’s catch suggested for another day than the trip behind it comes back on today, a trip saved', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 16, 1, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    setup.availability = [NIGHT]
    select(root, 'havørred')
    await nextTick()
    modes(root)[1].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    await nextTick()
    view!.unmount()
    view = undefined
    vi.setSystemTime(new Date(2026, 5, 17, 8, 0))
    root = await mountLog([])
    setup.availability = [NIGHT]
    expect(tripForm(root)).toEqual(['2026-06-15', '22:00', '01:00', LOCS[1].name, [t('log_date_earlier')]])
    await save(root)
    expect(log.entries.map((e) => [e.date, e.from, e.to])).toEqual([['2026-06-15', '22:00', '01:00']])
    modes(root)[0].click()
    await nextTick()
    expect(catchForm(root)).toEqual(['2026-06-17', '08:00', 'havørred', '', '', '', '', '', []])
  })

  // Nothing typed there, a form only looked at keeps no day: the trip form
  // seen last night beside the draft's catch is suggested afresh once the
  // catch is saved, not given last night's span again.
  it('a trip form only looked at beside a draft’s catch is suggested afresh after the catch is saved', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 22, 30), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    select(root, 'havørred')
    await nextTick()
    modes(root)[1].click()
    await nextTick()
    modes(root)[0].click()
    await nextTick()
    view!.unmount()
    view = undefined
    vi.setSystemTime(new Date(2026, 5, 16, 7, 0))
    root = await mountLog([])
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    await nextTick()
    await save(root)
    expect(log.entries.map((e) => [e.date, e.time])).toEqual([['2026-06-15', '22:30']])
    expect(readCatchDraft(null)).toBeNull()
    modes(root)[1].click()
    await nextTick()
    expect(tripForm(root)).toEqual(['2026-06-16', '05:00', '07:00', '', []])
  })

  // A catch begun with any one of its own fields: a count, a size, or kept or released.
  it('a catch begun with only a count, a size or its outcome stays as a trip is saved', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 14, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const begun: [string, (root: FakeNode) => void, number][] = [
      ['count', (root) => fieldOf(root, 'max', '9999').input('3'), 3],
      ['length', (root) => fieldOf(root, 'max', '400').input('45'), 4],
      ['weight', (root) => fieldOf(root, 'max', '500').input('1.2'), 5],
    ]
    for (const [what, type, at] of begun) {
      const root = await mountLog([])
      type(root)
      await nextTick()
      modes(root)[1].click()
      await nextTick()
      fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
      await nextTick()
      await save(root)
      modes(root)[0].click()
      await nextTick()
      expect(catchForm(root)[at], what).not.toBe('')
      view!.unmount()
      view = undefined
      clearCatchDraft()
    }
    const root = await mountLog([])
    buttonsOf(formOf(root)).find((b) => b.textContent.includes(t('log_kept')))!.click()
    await nextTick()
    modes(root)[1].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    await nextTick()
    await save(root)
    expect(readCatchDraft(null)?.form?.released).toBe(false)
    modes(root)[0].click()
    await nextTick()
    expect(on(root)).toContain(`🧺 ${t('log_kept')}`)
  })

  // Saved, the catch form starts over, and the draft holds the span typed
  // beside it. Put back the next morning, the fresh form's date and time,
  // suggested yesterday afternoon, showed as a catch begun then ("i går").
  // Nothing of its own typed, and its place, method and note as suggested,
  // the form shown is suggested afresh as it comes back, the same day too, as
  // a look at it from the trip form does. The span keeps its own date.
  it('a catch saved beside a span typed comes back as a fresh catch form on today, the trip on its own day', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 14, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    modes(root)[1].click()
    await nextTick()
    times(root)[0].input('10:00'); times(root)[1].input('11:00')
    await nextTick()
    modes(root)[0].click()
    await nextTick()
    select(root, 'torsk')
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    await nextTick()
    await save(root)
    vi.setSystemTime(new Date(2026, 5, 15, 14, 20))
    root = await awayAndBack()
    expect(catchForm(root)).toEqual(['2026-06-15', '14:20', '', '', '', '', '', '', []])
    vi.setSystemTime(new Date(2026, 5, 16, 7, 0))
    root = await awayAndBack()
    const fresh = ['2026-06-16', '07:00', '', '', '', '', '', '', []]
    expect(catchForm(root)).toEqual(fresh)
    modes(root)[1].click()
    await nextTick()
    const trip = ['2026-06-15', '10:00', '11:00', '', [t('log_date_yesterday')]]
    expect(tripForm(root)).toEqual(trip)
    modes(root)[0].click()
    await nextTick()
    expect(catchForm(root)).toEqual(fresh)
    modes(root)[1].click()
    await nextTick()
    expect(tripForm(root)).toEqual(trip)
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    await nextTick()
    await save(root)
    expect(log.entries.map((e) => [e.outcome ?? 'catch', e.date, e.time ?? `${e.from}–${e.to}`]))
      .toEqual([['empty', '2026-06-15', '10:00–11:00'], ['catch', '2026-06-15', '14:00']])
  })

  // Anything typed in it, the catch form comes back as it was left: a place,
  // a method or a note is a catch begun then (the draft's rule). Each typed
  // into the draft the save left.
  it('a catch form with a place, method or note typed after a save beside a span comes back on its day', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 14, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    modes(root)[1].click()
    await nextTick()
    times(root)[0].input('10:00'); times(root)[1].input('11:00')
    await nextTick()
    modes(root)[0].click()
    await nextTick()
    select(root, 'torsk')
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    await nextTick()
    await save(root)
    const saved = readCatchDraft(null)!
    expect(saved.form).toMatchObject({ date: '2026-06-15', time: '14:00', from: '10:00', to: '11:00', locationName: '', method: null, notes: '' })
    view!.unmount()
    view = undefined
    vi.setSystemTime(new Date(2026, 5, 16, 7, 0))
    const typed: [string, object][] = [['place', { locationName: LOCS[0].name }], ['method', { method: 'boat' }], ['note', { notes: 'næste' }]]
    for (const [what, field] of typed) {
      keepCatchDraft({ ...saved, form: { ...saved.form!, ...field } }, draftEpoch())
      root = await mountLog(log.entries)
      expect([...catchForm(root).slice(0, 2), dateNote(root)], what).toEqual(['2026-06-15', '14:00', [t('log_date_yesterday')]])
      view!.unmount()
      view = undefined
    }
  })

  // The same with the trip form shown: saved, it starts over on the window
  // just fished, beside the catch begun. Put back the next morning, that
  // window was yesterday afternoon's, shown as a trip begun then.
  it('a trip saved beside a catch begun comes back as a fresh trip form on today, the catch on its own day', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 14, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    select(root, 'havørred')
    fieldOf(root, 'type', 'time').input('13:10')
    await nextTick()
    modes(root)[1].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    times(root)[0].input('08:00'); times(root)[1].input('10:00')
    await nextTick()
    await save(root)
    expect(tripForm(root)).toEqual(['2026-06-15', '12:00', '14:00', '', []])
    vi.setSystemTime(new Date(2026, 5, 16, 7, 0))
    root = await awayAndBack()
    const fresh = ['2026-06-16', '05:00', '07:00', '', []]
    expect(tripForm(root)).toEqual(fresh)
    modes(root)[0].click()
    await nextTick()
    const caught = ['2026-06-15', '13:10', 'havørred', '', '', '', '', '', [t('log_date_yesterday')]]
    expect(catchForm(root)).toEqual(caught)
    modes(root)[1].click()
    await nextTick()
    expect(tripForm(root)).toEqual(fresh)
    modes(root)[0].click()
    await nextTick()
    expect(catchForm(root)).toEqual(caught)
    fieldOf(root, 'list', 'loc-options').input(LOCS[0].name)
    await nextTick()
    await save(root)
    expect(log.entries.map((e) => [e.outcome ?? 'catch', e.date, e.time ?? `${e.from}–${e.to}`]))
      .toEqual([['catch', '2026-06-15', '13:10'], ['empty', '2026-06-15', '08:00–10:00']])
  })

  // Left open over midnight beside a span typed for the evening, the fresh
  // catch form after a save stayed on yesterday with its time suggested then,
  // shown as a catch begun then ("i går"). Nothing of its own typed, it rolls
  // over as a form with nothing typed does, and the span keeps its date. The
  // same for a catch form only looked at beside the span. (With a place typed
  // for the trip, the catch form shows it too, and stays: 'a date kept for a
  // span typed stays as midnight passes with the catch form shown'.)
  it('a fresh catch form left open over midnight beside a span typed rolls over, the trip on its evening', async () => {
    for (const saved of [true, false]) {
      vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 30), toFake: ['Date', 'setInterval', 'clearInterval'] })
      const root = await mountLog([])
      modes(root)[1].click()
      await nextTick()
      times(root)[0].input('19:00'); times(root)[1].input('22:00')
      await nextTick()
      modes(root)[0].click()
      await nextTick()
      if (saved) {
        select(root, 'havørred')
        fieldOf(root, 'list', 'loc-options').input(LOCS[0].name)
        await nextTick()
        await save(root)
      }
      expect(catchForm(root), String(saved)).toEqual(['2026-06-15', '23:30', '', '', '', '', '', '', []])
      vi.setSystemTime(new Date(2026, 5, 16, 0, 1))
      vi.advanceTimersByTime(60_000) // the view's clock ticks past midnight
      await nextTick(); await nextTick()
      const fresh = ['2026-06-16', '00:02', '', '', '', '', '', '', []]
      expect(catchForm(root), String(saved)).toEqual(fresh)
      modes(root)[1].click()
      await nextTick()
      expect(tripForm(root), String(saved)).toEqual(['2026-06-15', '19:00', '22:00', '', [t('log_date_yesterday')]])
      modes(root)[0].click()
      await nextTick()
      expect(catchForm(root), String(saved)).toEqual(fresh)
      modes(root)[1].click()
      await nextTick()
      fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
      await nextTick()
      await save(root)
      expect(log.entries[0], String(saved)).toMatchObject({ outcome: 'empty', date: '2026-06-15', from: '19:00', to: '22:00' })
      view!.unmount()
      view = undefined
      clearCatchDraft()
    }
  })

  // ✎ asked before it put the entry over what was typed: saving the edit
  // has nothing of a new entry to keep, and starts the whole form over.
  it('an edit saved starts the whole form over, as before', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 14, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([{ id: 'c', date: '2026-06-10', time: '07:00', speciesId: 'torsk', ...at(0), notes: 'c' }])
    const cancelOf = () => buttonsOf(formOf(root)).filter((b) => b.textContent === t('log_cancel'))
    modes(root)[1].click()
    await nextTick()
    times(root)[0].input('10:00'); times(root)[1].input('11:00')
    await nextTick()
    modes(root)[0].click()
    await nextTick()
    buttonsOf(cardOf(root, 'c').byClass('entry-actions')[0])[0].click()
    confirmAccept()
    await flush()
    fieldOf(root, 'max', '400').input('50')
    await nextTick()
    await save(root)
    expect(log.entries.map((e) => [e.id, e.lengthCm])).toEqual([['c', 50]])
    expect(cancelOf()).toEqual([])
    expect(readCatchDraft(null)).toBeNull()
    modes(root)[1].click()
    await nextTick()
    expect(tripForm(root).slice(0, 3)).toEqual(['2026-06-15', '12:00', '14:00'])
  })

  // Annullér lets go of the whole form, both forms' fields and the draft, as it did.
  it('Annullér still lets go of what the other form kept', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 14, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    const cancelOf = () => buttonsOf(formOf(root)).filter((b) => b.textContent === t('log_cancel'))
    modes(root)[1].click()
    await nextTick()
    times(root)[0].input('10:00'); times(root)[1].input('11:00')
    await nextTick()
    modes(root)[0].click()
    await nextTick()
    select(root, 'torsk')
    await nextTick()
    await save(root)
    expect(cancelOf()).toHaveLength(1) // the span is still typed
    cancelOf()[0].click()
    await nextTick()
    expect(cancelOf()).toEqual([])
    expect(readCatchDraft(null)).toBeNull()
    modes(root)[1].click()
    await nextTick()
    expect(tripForm(root).slice(0, 3)).toEqual(['2026-06-15', '12:00', '14:00'])
  })
})

/**
 * The place and method are both forms' fields. The trip form suggests them
 * (today's newest entry's, or the window's one method), and a catch begun
 * behind it takes them as its own. The next suggestion wrote over them: the
 * trip form put back the next morning, looked at again, or shown as midnight
 * passed suggested the day's anew, and the catch lost its place and method.
 * While the catch form holds a catch begun, the trip form leaves them alone,
 * as it does once a span is typed.
 */
describe('a catch begun behind the trip form', () => {
  const formOf = (root: FakeNode) => root.byClass('card form')[0]
  const fieldOf = (root: FakeNode, k: string, v: string) => formOf(root).findAll((n) => n.attrs[k] === v)[0]
  const select = (root: FakeNode, id: string) => {
    const s = formOf(root).byTag('select')[0]
    for (const o of s.options) o.selected = o.value === id
    s.dispatch('change')
  }
  const modes = (root: FakeNode) => root.byClass('seg mode')[0].byTag('button')
  const look = async (root: FakeNode, m: 'catch' | 'empty') => { modes(root)[m === 'catch' ? 0 : 1].click(); await nextTick() }
  const val = (n: FakeNode) => String(n.value)
  const species = (root: FakeNode) => {
    const s = formOf(root).byTag('select')[0]
    return String(s.options[s.selectedIndex]?.value ?? '')
  }
  const dateNote = (root: FakeNode) => texts(formOf(root).byClass('date-note'))
  const on = (root: FakeNode) => formOf(root).findAll((n) => n.hasClass('seg-btn') && n.hasClass('on')).map((n) => n.textContent)
  /** The trip form: date, span, place, the buttons on, and what the date says. */
  const tripForm = (root: FakeNode) => [
    val(fieldOf(root, 'type', 'date')), ...formOf(root).findAll((n) => n.attrs.type === 'time').map(val),
    val(fieldOf(root, 'list', 'loc-options')), on(root), dateNote(root),
  ]
  /** The catch form: date, time, species, place, the buttons on, and what the date says. */
  const catchForm = (root: FakeNode) => [
    ...['date', 'time'].map((k) => val(fieldOf(root, 'type', k))), species(root),
    val(fieldOf(root, 'list', 'loc-options')), on(root), dateNote(root),
  ]
  const save = async (root: FakeNode) => { formOf(root).byClass('btn primary')[0].click(); await flush() }
  async function awayAndBack() {
    const es = log.entries
    view!.unmount()
    view = undefined
    return mountLog(es)
  }
  /** A catch logged earlier today at the first spot: the trip form suggests its place and method. */
  const earlier = (time: string, method: 'boat' | 'waders'): CatchEntry =>
    ({ id: 'e', date: '2026-06-15', time, speciesId: 'torsk', ...at(0), method, notes: 'e' })
  const TRIP = t('log_mode_empty')
  const CATCH = t('log_mode_catch')
  const BOAT = `🚢 ${t('method_boat')}`
  const WADERS = `🦺 ${t('method_waders')}`

  // Put back the next morning with the trip form shown, the trip form is
  // suggested afresh (round W): this morning's span. Its place and method
  // were too, none with no entry today, and the catch lost the ones it was
  // begun with. The next look at the trip form suggested them anew as well.
  // Nothing begun behind it, the trip form is suggested afresh, place and all.
  it('keeps the place and method it took from the trip form, put back the next morning and over looks', async () => {
    for (const begun of [true, false]) {
      vi.useFakeTimers({ now: new Date(2026, 5, 15, 14, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
      let root = await mountLog([earlier('10:00', 'boat')])
      await look(root, 'empty')
      expect(tripForm(root), String(begun)).toEqual(['2026-06-15', '12:00', '14:00', LOCS[0].name, [TRIP, BOAT], []])
      await look(root, 'catch')
      if (begun) select(root, 'havørred')
      await nextTick()
      await look(root, 'empty')
      vi.setSystemTime(new Date(2026, 5, 16, 7, 0))
      root = await awayAndBack()
      if (!begun) {
        expect(tripForm(root)).toEqual(['2026-06-16', '05:00', '07:00', '', [TRIP], []])
        view!.unmount()
        view = undefined
        clearCatchDraft()
        continue
      }
      const trip = ['2026-06-16', '05:00', '07:00', LOCS[0].name, [TRIP, BOAT], []]
      const caught = ['2026-06-15', '14:00', 'havørred', LOCS[0].name, [CATCH, BOAT], [t('log_date_yesterday')]]
      expect(tripForm(root)).toEqual(trip)
      for (let i = 0; i < 2; i++) {
        await look(root, 'catch')
        expect(catchForm(root), String(i)).toEqual(caught)
        await look(root, 'empty')
        expect(tripForm(root), String(i)).toEqual(trip)
      }
      await look(root, 'catch')
      await save(root)
      expect(log.entries[0]).toMatchObject({ date: '2026-06-15', time: '14:00', speciesId: 'havørred', locationId: 'L0', method: 'boat' })
    }
  })

  // The same day: a pull brings a newer entry from another device, at
  // another spot and by another method, and a look at the trip form
  // suggested that one's: no place (the trip would hold that catch), and
  // its method. A catch is begun by any of its own fields: a species, a time
  // typed, a count, a size, or kept or released. Nothing begun, the look
  // suggests the newer entry's, as it did.
  it('keeps them over a look at the trip form after a pull brought a newer entry, however the catch was begun', async () => {
    const released = (root: FakeNode) => buttonsOf(formOf(root)).find((b) => b.textContent.includes(t('log_released')))!
    const begun: [string, (root: FakeNode) => void][] = [
      ['species', (root) => select(root, 'havørred')],
      ['time', (root) => fieldOf(root, 'type', 'time').input('13:50')],
      ['count', (root) => fieldOf(root, 'max', '9999').input('2')],
      ['length', (root) => fieldOf(root, 'max', '400').input('45')],
      ['weight', (root) => fieldOf(root, 'max', '500').input('1.2')],
      ['released', (root) => released(root).click()],
      ['nothing', () => {}],
    ]
    for (const [what, begin] of begun) {
      vi.useFakeTimers({ now: new Date(2026, 5, 15, 14, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
      const root = await mountLog([earlier('10:00', 'boat')])
      await look(root, 'empty')
      await look(root, 'catch')
      begin(root)
      await nextTick()
      log.entries = [{ id: 'p', date: '2026-06-15', time: '13:30', speciesId: 'torsk', ...at(1), method: 'waders', notes: 'p' }, ...log.entries]
      await nextTick()
      await look(root, 'empty')
      const kept = what !== 'nothing'
      expect(tripForm(root), what).toEqual(['2026-06-15', '12:00', '14:00', kept ? LOCS[0].name : '', [TRIP, kept ? BOAT : WADERS], []])
      await look(root, 'catch')
      expect([val(fieldOf(root, 'list', 'loc-options')), on(root).filter((b) => b !== CATCH && !b.includes(t('log_released')))], what)
        .toEqual(kept ? [LOCS[0].name, [BOAT]] : ['', [WADERS]])
      view!.unmount()
      view = undefined
      clearCatchDraft()
    }
  })

  // Shown as midnight passes, the trip form rolls over to the new day's
  // suggestion: no entry today, so no place and no method.
  it('keeps them as midnight passes with the trip form shown', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 30), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([earlier('20:00', 'waders')])
    await look(root, 'empty')
    await look(root, 'catch')
    select(root, 'havørred')
    await nextTick()
    await look(root, 'empty')
    vi.setSystemTime(new Date(2026, 5, 16, 0, 1))
    vi.advanceTimersByTime(60_000) // the view's clock ticks past midnight
    await nextTick(); await nextTick()
    expect(tripForm(root).slice(3, 5)).toEqual([LOCS[0].name, [TRIP, WADERS]])
    await look(root, 'catch')
    expect(catchForm(root).slice(2, 5)).toEqual(['havørred', LOCS[0].name, [CATCH, WADERS]])
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

  // Moved to today, the date followed no more: a time put right after it,
  // or typed a part at a time as a desktop browser takes it (02:45 on the
  // way from 23:45 to 21:45), stayed on today and was refused as later than now.
  it('a date that followed a time to today follows the next one back to yesterday', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    select(root, 'havørred')
    const time = () => fieldOf(root, 'type', 'time')
    time().input('23:45')
    await nextTick()
    await clockAt(new Date(2026, 5, 16, 3, 0))
    time().input('02:45')
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, dateNote(root)]).toEqual(['2026-06-16', []])
    time().input('21:45')
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, dateNote(root)]).toEqual(['2026-06-15', [t('log_date_yesterday')]])
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.time])).toEqual([['2026-06-15', '21:45']])
  })

  it('in trip mode, a date that followed a span to today follows the next one back', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 30), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    root.byClass('seg mode')[0].byTag('button')[1].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    const [from, to] = formOf(root).findAll((n) => n.attrs.type === 'time')
    from.input('19:00'); to.input('22:00')
    await nextTick()
    await clockAt(new Date(2026, 5, 16, 0, 20))
    from.input('00:00'); to.input('00:10')
    await nextTick()
    expect(fieldOf(root, 'type', 'date').value).toBe('2026-06-16')
    from.input('22:30') // put right: it began last night
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, dateNote(root)]).toEqual(['2026-06-15', [t('log_date_yesterday')]])
  })

  // The other form's prefill wrote the same date over it and called it a
  // date that follows no time. A time put right after a look at the trip
  // form and back stayed on today and was refused as later than now.
  it('a date that followed a time to today still follows over a look at the trip form and back', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    select(root, 'havørred')
    fieldOf(root, 'type', 'time').input('23:45')
    await nextTick()
    await clockAt(new Date(2026, 5, 16, 0, 10))
    fieldOf(root, 'type', 'time').input('00:05')
    await nextTick()
    expect(fieldOf(root, 'type', 'date').value).toBe('2026-06-16')
    modes()[1].click()
    await nextTick()
    modes()[0].click()
    await nextTick()
    fieldOf(root, 'type', 'time').input('23:55') // put right: last night's
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, dateNote(root)]).toEqual(['2026-06-15', [t('log_date_yesterday')]])
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.time])).toEqual([['2026-06-15', '23:55']])
  })

  it('in trip mode, a date that followed a span to today still follows over a look at the catch form and back', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 30), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    modes()[1].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    const span = () => formOf(root).findAll((n) => n.attrs.type === 'time')
    span()[0].input('19:00'); span()[1].input('22:00')
    await nextTick()
    await clockAt(new Date(2026, 5, 16, 0, 20))
    span()[0].input('00:00'); span()[1].input('00:10')
    await nextTick()
    expect(fieldOf(root, 'type', 'date').value).toBe('2026-06-16')
    modes()[0].click()
    await nextTick()
    modes()[1].click()
    await nextTick()
    span()[0].input('22:30') // put right: it began last night
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, dateNote(root)]).toEqual(['2026-06-15', [t('log_date_yesterday')]])
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.from, e.to])).toEqual([['2026-06-15', '22:30', '00:10']])
  })

  // The form takes a time inside the minute now as not later than now (its
  // clock ticks once a minute). The kept date took it as later and went a
  // day back: a fish typed in as 00:21 at 00:20:30 was saved nearly a day
  // early, without a word, where a fresh form saved it today.
  it('a date kept over midnight takes a time inside the minute now as today’s, as the form does', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    select(root, 'havørred')
    fieldOf(root, 'type', 'time').input('23:45')
    await nextTick()
    await clockAt(new Date(2026, 5, 16, 0, 20, 30))
    fieldOf(root, 'type', 'time').input('00:21')
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, dateNote(root)]).toEqual(['2026-06-16', []])
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.time])).toEqual([['2026-06-16', '00:21']])
  })

  it('in trip mode, a span that ends inside the minute now has ended, as the form takes it', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 30), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    root.byClass('seg mode')[0].byTag('button')[1].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    const [from, to] = formOf(root).findAll((n) => n.attrs.type === 'time')
    from.input('19:00'); to.input('22:00')
    await nextTick()
    await clockAt(new Date(2026, 5, 16, 0, 20, 30))
    from.input('00:00'); to.input('00:21')
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, formOf(root).byClass('btn primary')[0].attrs.disabled]).toEqual(['2026-06-16', false])
  })

  // The night the clocks go back, 02:00–03:00 comes twice. At the second
  // 02:30 the first 02:45 is past, and the form saves it on today; the kept
  // date, comparing clock faces, went a day back.
  it('the night the clocks go back, a time in the hour that came twice is today’s', async () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 24, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    select(root, 'havørred')
    fieldOf(root, 'type', 'time').input('23:45')
    await nextTick()
    await clockAt(new Date(Date.UTC(2026, 9, 25, 1, 30))) // 02:30 the second time
    fieldOf(root, 'type', 'time').input('02:45')
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, dateNote(root)]).toEqual(['2026-10-25', []])
  })

  it('a date put in by hand before midnight is never moved by a time typed after it', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    select(root, 'havørred')
    fieldOf(root, 'type', 'date').input('2026-06-10')
    await nextTick()
    await midnight()
    await clockAt(new Date(2026, 5, 16, 0, 20))
    fieldOf(root, 'type', 'time').input('00:15')
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, dateNote(root)]).toEqual(['2026-06-10', []])
  })

  it('a kept date stays where it is as the time is cleared', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    select(root, 'havørred')
    fieldOf(root, 'type', 'time').input('23:45')
    await nextTick()
    await clockAt(new Date(2026, 5, 16, 0, 20))
    fieldOf(root, 'type', 'time').input('')
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, dateNote(root)]).toEqual(['2026-06-15', [t('log_date_yesterday')]])
  })

  it('after a save, the next catch’s date is today’s and follows no time', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    select(root, 'havørred')
    fieldOf(root, 'type', 'time').input('23:45')
    await nextTick()
    await clockAt(new Date(2026, 5, 16, 0, 20))
    fieldOf(root, 'type', 'time').input('00:15')
    await nextTick()
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    select(root, 'havørred')
    fieldOf(root, 'type', 'time').input('23:30')
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, texts(formOf(root).byClass('guard')[0].elements)])
      .toEqual(['2026-06-16', [`⚠️ ${t('log_future_warn')}`]])
  })

  // The entry opened by ✎ has its own date, which can be the one kept.
  it('the date of an entry being edited is never moved, nor said to be yesterday’s', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([{ id: 'c', date: '2026-06-15', time: '22:00', speciesId: 'torsk', ...at(0), notes: 'c' }])
    fieldOf(root, 'type', 'time').input('23:45')
    await nextTick()
    await clockAt(new Date(2026, 5, 16, 0, 20))
    buttonsOf(cardOf(root, 'c').byClass('entry-actions')[0])[0].click()
    confirmAccept()
    await flush()
    expect([fieldOf(root, 'type', 'date').value, dateNote(root)]).toEqual(['2026-06-15', []])
    fieldOf(root, 'type', 'time').input('00:10')
    await nextTick()
    expect(fieldOf(root, 'type', 'date').value).toBe('2026-06-15')
  })

  // The rollover writes the prefill of the fields it fills in, and only of those.
  it('a form left as it was is still untouched after midnight', async () => {
    for (const m of ['catch', 'trip']) {
      vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
      const root = await mountLog([{ id: 'c', date: '2026-06-10', time: '07:00', speciesId: 'torsk', ...at(0), notes: 'c' }])
      if (m === 'trip') root.byClass('seg mode')[0].byTag('button')[1].click()
      await nextTick()
      await midnight()
      expect(buttonsOf(formOf(root)).filter((b) => b.textContent === t('log_cancel')), m).toHaveLength(0)
      buttonsOf(cardOf(root, 'c').byClass('entry-actions')[0])[0].click()
      expect(confirmState.open, m).toBe(false)
      view!.unmount()
      view = undefined
      clearCatchDraft()
    }
  })

  it('in trip mode, a place or a method put in alone is still typed after midnight', async () => {
    for (const m of ['place', 'method']) {
      vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 30), toFake: ['Date', 'setInterval', 'clearInterval'] })
      let root = await mountLog([])
      root.byClass('seg mode')[0].byTag('button')[1].click()
      await nextTick()
      if (m === 'place') fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
      else formOf(root).byClass('seg-btn').find((b) => b.textContent.includes(t('method_boat')))!.click()
      await nextTick()
      await midnight()
      expect(buttonsOf(formOf(root)).filter((b) => b.textContent === t('log_cancel')), m).toHaveLength(1)
      view!.unmount()
      view = undefined
      root = await mountLog([])
      expect([fieldOf(root, 'list', 'loc-options').value, formOf(root).byClass('seg-btn on').map((b) => b.textContent)], m)
        .toEqual(m === 'place' ? [LOCS[1].name, [t('log_mode_empty')]] : ['', [t('log_mode_empty'), `🚢 ${t('method_boat')}`]])
      view!.unmount()
      view = undefined
      clearCatchDraft()
    }
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

  // Told from the prefill by its value, a time typed as the one the form
  // suggested read as untouched: no Annullér, no draft of it kept on a visit
  // to another screen, ✎ dropped it without asking, and the next rollover or
  // look at the other form wrote the time now over it.
  it('a time or span typed as the one prefilled counts as typed', async () => {
    for (const m of ['catch', 'trip']) {
      vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 30), toFake: ['Date', 'setInterval', 'clearInterval'] })
      let root = await mountLog([{ id: 'c', date: '2026-06-10', time: '07:00', speciesId: 'torsk', ...at(0), notes: 'c' }])
      const modes = () => root.byClass('seg mode')[0].byTag('button')
      if (m === 'trip') modes()[1].click()
      await nextTick()
      const times = () => formOf(root).findAll((n) => n.attrs.type === 'time')
      const was = times().map((n) => String(n.value))
      expect(was, m).toEqual(m === 'trip' ? ['21:30', '23:30'] : ['23:30'])
      times().forEach((n, i) => n.input(was[i]))
      await nextTick()
      expect(buttonsOf(formOf(root)).filter((b) => b.textContent === t('log_cancel')), m).toHaveLength(1)
      view!.unmount()
      view = undefined
      vi.setSystemTime(new Date(2026, 5, 15, 23, 45))
      root = await mountLog(log.entries)
      await midnight()
      // A look at the other form and back.
      modes()[m === 'trip' ? 0 : 1].click()
      await nextTick()
      modes()[m === 'trip' ? 1 : 0].click()
      await nextTick()
      expect([fieldOf(root, 'type', 'date').value, ...times().map((n) => n.value)], m).toEqual(['2026-06-15', ...was])
      buttonsOf(cardOf(root, 'c').byClass('entry-actions')[0])[0].click()
      expect(confirmState.open, m).toBe(true)
      confirmCancel()
      await flush()
      view!.unmount()
      view = undefined
      clearCatchDraft()
    }
  })

  // A draft kept by the version before has no marks: a time unlike its
  // prefill was typed, as that version told it.
  it('a draft kept before times typed by hand were marked tells them by value', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    keepCatchDraft({
      who: null, mode: 'catch', editing: null,
      form: { date: '2026-06-15', time: '23:10', from: '', to: '', speciesId: 'torsk', locationName: '', count: '', lengthCm: '', weightKg: '', released: null, method: null, notes: '' },
      prefill: { date: '2026-06-15', time: '23:40', from: '', to: '', loc: '', method: null },
    }, draftEpoch())
    const root = await mountLog([])
    await midnight()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value]).toEqual(['2026-06-15', '23:10'])
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

  // The date is both modes' one field. Kept over midnight for a span typed,
  // a look at the catch form rolled it on with the catch's prefill, and back
  // in trip mode the evening's trip was refused as not yet over.
  it('in trip mode, a date kept over midnight stays over a look at the catch form and back', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 30), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    modes()[1].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    const [from, to] = formOf(root).findAll((n) => n.attrs.type === 'time')
    from.input('19:00'); to.input('22:00')
    await nextTick()
    await midnight()
    modes()[0].click()
    await nextTick()
    // The catch form keeps the date and the time it had: a time of now on
    // yesterday's date would be a catch a day early.
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)])
      .toEqual(['2026-06-15', '23:30', [t('log_date_yesterday')]])
    modes()[1].click()
    await nextTick()
    const span = formOf(root).findAll((n) => n.attrs.type === 'time').map((n) => n.value)
    expect([fieldOf(root, 'type', 'date').value, ...span, dateNote(root)]).toEqual(['2026-06-15', '19:00', '22:00', [t('log_date_yesterday')]])
    const save = formOf(root).byClass('btn primary')[0]
    expect(save.attrs.disabled).toBe(false)
    save.click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.from, e.to])).toEqual([['2026-06-15', '19:00', '22:00']])
  })

  it('a date kept over midnight stays over a look at the trip form and back', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    select(root, 'havørred')
    fieldOf(root, 'type', 'time').input('23:45')
    await nextTick()
    await midnight()
    modes()[1].click()
    await nextTick()
    // No span of today's put with yesterday's date: the trip form waits for one.
    const span = () => formOf(root).findAll((n) => n.attrs.type === 'time').map((n) => n.value)
    expect([fieldOf(root, 'type', 'date').value, ...span(), dateNote(root)]).toEqual(['2026-06-15', '', '', [t('log_date_yesterday')]])
    modes()[0].click()
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)])
      .toEqual(['2026-06-15', '23:45', [t('log_date_yesterday')]])
    const save = formOf(root).byClass('btn primary')[0]
    expect(save.attrs.disabled).toBe(false)
    save.click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.time])).toEqual([['2026-06-15', '23:45']])
  })

  // The same date, with midnight passing while the other form is shown: the
  // shown form's prefill rolled it on, and the evening's trip was refused as
  // not yet over. It stays, as a look at the other form keeps it.
  it('a date kept for a span typed stays as midnight passes with the catch form shown', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 30), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    modes()[1].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    const [from, to] = formOf(root).findAll((n) => n.attrs.type === 'time')
    from.input('19:00'); to.input('22:00')
    await nextTick()
    modes()[0].click()
    await nextTick()
    await midnight()
    // The catch form keeps the time it had: one of now on yesterday's date would be a catch a day early.
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)])
      .toEqual(['2026-06-15', '23:30', [t('log_date_yesterday')]])
    modes()[1].click()
    await nextTick()
    const span = formOf(root).findAll((n) => n.attrs.type === 'time').map((n) => n.value)
    expect([fieldOf(root, 'type', 'date').value, ...span, dateNote(root)]).toEqual(['2026-06-15', '19:00', '22:00', [t('log_date_yesterday')]])
    const save = formOf(root).byClass('btn primary')[0]
    expect(save.attrs.disabled).toBe(false)
    save.click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.from, e.to])).toEqual([['2026-06-15', '19:00', '22:00']])
  })

  it('a date kept for a time typed stays as midnight passes with the trip form shown', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    select(root, 'havørred')
    fieldOf(root, 'type', 'time').input('23:45')
    await nextTick()
    modes()[1].click()
    await nextTick()
    await midnight()
    // The trip form keeps the span it was prefilled with last night, on last night's date.
    const span = formOf(root).findAll((n) => n.attrs.type === 'time').map((n) => n.value)
    expect([fieldOf(root, 'type', 'date').value, ...span, dateNote(root)]).toEqual(['2026-06-15', '21:50', '23:50', [t('log_date_yesterday')]])
    modes()[0].click()
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)])
      .toEqual(['2026-06-15', '23:45', [t('log_date_yesterday')]])
    const save = formOf(root).byClass('btn primary')[0]
    expect(save.attrs.disabled).toBe(false)
    save.click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.time])).toEqual([['2026-06-15', '23:45']])
  })

  // A catch begun last night and put back the next morning: its date and
  // time, left as the form put them in, are when it was begun, the best
  // record there is of when the fish was caught. Rolled on as the draft came
  // back, finishing it stored it at the morning's time, hours late and scored
  // against the wrong weather. It comes back as it was, says it is
  // yesterday's, and a time typed moves the date, as with the form open.
  it('a draft with its date and time untouched comes back the next morning as it was, saying so', async () => {
    for (const time of ['', '06:30']) {
      vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
      let root = await mountLog([])
      select(root, 'havørred')
      root.byTag('textarea')[0].input('sidste nat')
      await nextTick()
      view!.unmount()
      view = undefined
      vi.setSystemTime(new Date(2026, 5, 16, 7, 0))
      root = await mountLog([])
      expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root), root.byTag('textarea')[0].value], time)
        .toEqual(['2026-06-15', '23:50', [t('log_date_yesterday')], 'sidste nat'])
      if (time) {
        fieldOf(root, 'type', 'time').input(time)
        await nextTick()
        expect([fieldOf(root, 'type', 'date').value, dateNote(root)]).toEqual(['2026-06-16', []])
      }
      formOf(root).byClass('btn primary')[0].click()
      await flush()
      expect(log.entries.map((e) => [e.date, e.time]), time).toEqual([time ? ['2026-06-16', '06:30'] : ['2026-06-15', '23:50']])
      view!.unmount()
      view = undefined
    }
  })

  // Put back the next morning, the draft kept its date and time, but a look
  // at the trip form and back rolled them on to the morning's prefill, and
  // finishing last night's catch stored it at 07:00 today.
  it('a draft put back the next morning keeps its date and time over a look at the trip form and back', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    select(root, 'havørred')
    root.byTag('textarea')[0].input('sidste nat')
    await nextTick()
    view!.unmount()
    view = undefined
    vi.setSystemTime(new Date(2026, 5, 16, 7, 0))
    root = await mountLog([])
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    modes()[1].click()
    await nextTick()
    // No span of this morning's put with last night's date: the trip form waits for one.
    const span = () => formOf(root).findAll((n) => n.attrs.type === 'time').map((n) => n.value)
    expect([fieldOf(root, 'type', 'date').value, ...span(), dateNote(root)]).toEqual(['2026-06-15', '', '', [t('log_date_yesterday')]])
    modes()[0].click()
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)])
      .toEqual(['2026-06-15', '23:50', [t('log_date_yesterday')]])
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.time])).toEqual([['2026-06-15', '23:50']])
  })

  // A desktop date field takes a date a part at a time: the draft's own date
  // typed in again goes through other days on the way. Any change to the
  // date ended the draft's mark, and the next look at the other form rolled
  // last night's catch on to the morning.
  it('a draft’s date typed in again as it was still stays over a look at the trip form and back', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    select(root, 'havørred')
    root.byTag('textarea')[0].input('sidste nat')
    await nextTick()
    view!.unmount()
    view = undefined
    vi.setSystemTime(new Date(2026, 5, 16, 7, 0))
    root = await mountLog([])
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    const date = () => fieldOf(root, 'type', 'date')
    date().input('2026-06-01'); date().input('2026-06-15') // the day typed a digit at a time
    await nextTick()
    modes()[1].click()
    await nextTick()
    const span = () => formOf(root).findAll((n) => n.attrs.type === 'time').map((n) => n.value)
    expect([date().value, ...span(), dateNote(root)]).toEqual(['2026-06-15', '', '', [t('log_date_yesterday')]])
    modes()[0].click()
    await nextTick()
    expect([date().value, fieldOf(root, 'type', 'time').value, dateNote(root)]).toEqual(['2026-06-15', '23:50', [t('log_date_yesterday')]])
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.time])).toEqual([['2026-06-15', '23:50']])
  })

  it('a trip draft put back the next morning keeps its date and span over a look at the catch form and back', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    root.byClass('seg mode')[0].byTag('button')[1].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    await nextTick()
    view!.unmount()
    view = undefined
    vi.setSystemTime(new Date(2026, 5, 16, 7, 0))
    root = await mountLog([])
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    const span = () => formOf(root).findAll((n) => n.attrs.type === 'time').map((n) => n.value)
    // The last two hours before 23:50, prefilled last night (lib/tripPrefill).
    expect([fieldOf(root, 'type', 'date').value, ...span(), dateNote(root)]).toEqual(['2026-06-15', '21:50', '23:50', [t('log_date_yesterday')]])
    modes()[0].click()
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)])
      .toEqual(['2026-06-15', '23:50', [t('log_date_yesterday')]])
    modes()[1].click()
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, ...span(), dateNote(root)]).toEqual(['2026-06-15', '21:50', '23:50', [t('log_date_yesterday')]])
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.from, e.to])).toEqual([['2026-06-15', '21:50', '23:50']])
  })

  // Nothing typed since, the draft's date is still when it was begun at the
  // next midnight too: the day's rollover keeps it, as a look at the other form does.
  it('a draft put back the next morning keeps its date and time over the next midnight', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    select(root, 'havørred')
    await nextTick()
    view!.unmount()
    view = undefined
    vi.setSystemTime(new Date(2026, 5, 16, 7, 0))
    root = await mountLog([])
    vi.setSystemTime(new Date(2026, 5, 17, 0, 1))
    vi.advanceTimersByTime(60_000)
    await nextTick(); await nextTick()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)])
      .toEqual(['2026-06-15', '23:50', [t('log_date_earlier')]])
  })

  // Only a draft's date from an earlier day stays. One put back the same day
  // is today's, and a look at the other form fills in that form's prefill.
  it('a draft put back the same day leaves the other form its prefill', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 10, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    select(root, 'havørred')
    await nextTick()
    view!.unmount()
    view = undefined
    vi.setSystemTime(new Date(2026, 5, 15, 14, 0))
    root = await mountLog([])
    root.byClass('seg mode')[0].byTag('button')[1].click()
    await nextTick()
    const span = formOf(root).findAll((n) => n.attrs.type === 'time').map((n) => n.value)
    expect([fieldOf(root, 'type', 'date').value, ...span]).toEqual(['2026-06-15', '12:00', '14:00'])
  })

  // The same at midnight: a draft put back the same day is the form as it
  // was left, and rolls over with the day like a form never left. Only one
  // put back on a later day keeps its date over midnight.
  it('a draft put back the same day rolls over at midnight, as a form never left does', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 40), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    select(root, 'havørred')
    await nextTick()
    view!.unmount()
    view = undefined
    vi.setSystemTime(new Date(2026, 5, 15, 23, 55))
    root = await mountLog([])
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value]).toEqual(['2026-06-15', '23:40'])
    await midnight()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)]).toEqual(['2026-06-16', '00:02', []])
  })

  // Saved, the draft is done with: the fresh form after it is today's, and
  // rolls over at the next midnight. Still marked as a draft's, it kept the
  // morning's date and time all night, as yesterday's.
  it('a draft put back the next morning and saved leaves a fresh form that rolls over at midnight', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    select(root, 'havørred')
    await nextTick()
    view!.unmount()
    view = undefined
    vi.setSystemTime(new Date(2026, 5, 16, 7, 0))
    root = await mountLog([])
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.time])).toEqual([['2026-06-15', '23:50']])
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value]).toEqual(['2026-06-16', '07:00'])
    vi.setSystemTime(new Date(2026, 5, 17, 0, 1))
    vi.advanceTimersByTime(60_000)
    await nextTick(); await nextTick()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)]).toEqual(['2026-06-17', '00:02', []])
  })

  // With no times set for fishing, the trip form suggests the last two hours
  // (lib/tripPrefill). Just after midnight they were cut at 00:00: at 00:02,
  // 00:00–00:02. They run from last night, on its date, which the date says
  // is yesterday's, as for a night window's span; and the trip saves on it.
  it('in trip mode just after midnight, the last two hours run from last night, and the trip saves on its date', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 16, 0, 2), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    const pinia = getActivePinia()!
    root.byClass('seg mode')[0].byTag('button')[1].click()
    await nextTick()
    const tripForm = () => [fieldOf(root, 'type', 'date').value, ...formOf(root).findAll((n) => n.attrs.type === 'time').map((n) => n.value), dateNote(root)]
    expect(tripForm()).toEqual(['2026-06-15', '22:02', '00:02', [t('log_date_yesterday')]])
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    await nextTick()
    // It has ended, and is no span of no length.
    const guard = formOf(root).byClass('guard')[0].textContent
    expect([guard.includes(t('log_trip_future')), guard.includes(t('avail_time_warn'))]).toEqual([false, false])
    expect(formOf(root).byClass('btn primary')[0].attrs.disabled).toBe(false)
    setLang('en')
    await langReady() // the English table is a chunk of its own
    setActivePinia(pinia)
    await nextTick()
    expect(dateNote(root)).toEqual([STRINGS.en.log_date_yesterday])
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.from, e.to])).toEqual([['2026-06-15', '22:02', '00:02']])
  })

  // Shown as midnight passes, an untouched trip form rolls over to them. A
  // look at the catch form puts it on today at the time now, and a time
  // typed there stays on today over a look at the trip form and back.
  it('in trip mode, an untouched trip form rolls over at midnight to the last two hours from last night', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    const tripForm = () => [fieldOf(root, 'type', 'date').value, ...formOf(root).findAll((n) => n.attrs.type === 'time').map((n) => n.value), dateNote(root)]
    const catchForm = () => [fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)]
    modes()[1].click()
    await nextTick()
    expect(tripForm()).toEqual(['2026-06-15', '21:50', '23:50', []])
    await midnight()
    const night = ['2026-06-15', '22:02', '00:02', [t('log_date_yesterday')]]
    expect(tripForm()).toEqual(night)
    modes()[0].click()
    await nextTick()
    expect(catchForm()).toEqual(['2026-06-16', '00:02', []])
    select(root, 'havørred')
    fieldOf(root, 'type', 'time').input('00:01')
    await nextTick()
    modes()[1].click()
    await nextTick()
    expect(tripForm()).toEqual(night)
    modes()[0].click()
    await nextTick()
    expect(catchForm()).toEqual(['2026-06-16', '00:01', []])
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.time])).toEqual([['2026-06-16', '00:01']])
  })

  // Nothing typed in either mode: the date has nothing to stay for. (Looked
  // at after 02:00: before it, the trip form's own last two hours began
  // last night, and are dated so.)
  it('a look at the other form with neither time nor span typed still rolls the date on', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    select(root, 'havørred')
    await nextTick()
    vi.setSystemTime(new Date(2026, 5, 16, 2, 30))
    root.byClass('seg mode')[0].byTag('button')[1].click()
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, dateNote(root)]).toEqual(['2026-06-16', []])
  })

  // By day the date is today's, not kept over midnight: a time or span typed
  // in one form leaves the other its prefill, as it did before.
  it('by day, a time typed in the catch form leaves the trip form its prefill', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 14, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    fieldOf(root, 'type', 'time').input('13:00')
    await nextTick()
    root.byClass('seg mode')[0].byTag('button')[1].click()
    await nextTick()
    // The last two hours, with no times set for fishing (lib/tripPrefill).
    const span = formOf(root).findAll((n) => n.attrs.type === 'time').map((n) => n.value)
    expect([fieldOf(root, 'type', 'date').value, ...span]).toEqual(['2026-06-15', '12:00', '14:00'])
  })

  it('by day, a span typed in the trip form leaves the catch form its time now', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 14, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    modes()[1].click()
    await nextTick()
    const [from, to] = formOf(root).findAll((n) => n.attrs.type === 'time')
    from.input('10:00'); to.input('11:00')
    await nextTick()
    vi.setSystemTime(new Date(2026, 5, 15, 14, 30))
    modes()[0].click()
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value]).toEqual(['2026-06-15', '14:30'])
  })

  // The trip form's prefill is the window just fished (lib/tripPrefill): an
  // hour past midnight, a night window's is last night's. It wrote that date
  // over the catch form's, and a catch typed in as 00:30 today was on
  // yesterday after a look at the trip form and back.
  const NIGHT = { id: 'night', days: [0, 1, 2, 3, 4, 5, 6], from: '22:00', to: '02:00', methods: ['shore' as const] }
  it('a time typed today stays on today over a look at a trip form prefilled with last night', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 16, 1, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    setup.availability = [NIGHT]
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    const span = () => formOf(root).findAll((n) => n.attrs.type === 'time').map((n) => n.value)
    select(root, 'havørred')
    fieldOf(root, 'type', 'time').input('00:30')
    await nextTick()
    modes()[1].click()
    await nextTick()
    // The trip form has its own prefill: last night's window, up to now.
    expect([fieldOf(root, 'type', 'date').value, ...span(), dateNote(root)]).toEqual(['2026-06-15', '22:00', '01:00', [t('log_date_yesterday')]])
    modes()[0].click()
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)]).toEqual(['2026-06-16', '00:30', []])
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.time])).toEqual([['2026-06-16', '00:30']])
  })

  // The same with a visit to another screen from the trip form: the draft
  // kept the date shown only, and the catch typed in as 00:30 came back on yesterday.
  // (The trip form, untouched, is suggested afresh as it comes back: from the
  // times set for fishing, which the view has as it opens.)
  it('a time typed today stays on today over a visit to another screen from the trip form', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 16, 1, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    setup.availability = [NIGHT]
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    const span = () => formOf(root).findAll((n) => n.attrs.type === 'time').map((n) => n.value)
    select(root, 'havørred')
    fieldOf(root, 'type', 'time').input('00:30')
    await nextTick()
    modes()[1].click()
    await nextTick()
    view!.unmount()
    view = undefined
    root = await mountLog([], { availability: [NIGHT] })
    expect([fieldOf(root, 'type', 'date').value, ...span(), dateNote(root)]).toEqual(['2026-06-15', '22:00', '01:00', [t('log_date_yesterday')]])
    modes()[0].click()
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)]).toEqual(['2026-06-16', '00:30', []])
  })

  // A date set by hand is no form's own: both show it.
  it('a date set by hand in the trip form is the catch form’s too', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 16, 1, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    setup.availability = [NIGHT]
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    fieldOf(root, 'type', 'time').input('00:30')
    await nextTick()
    modes()[1].click()
    await nextTick()
    fieldOf(root, 'type', 'date').input('2026-06-14')
    await nextTick()
    modes()[0].click()
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)]).toEqual(['2026-06-14', '00:30', []])
  })

  // Both typed: the catch's time today, the trip's span last night. The one
  // date field shows the date of the form shown.
  it('a time typed today and a span typed for last night each keep their own date', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 16, 1, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    setup.availability = [NIGHT]
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    const times = () => formOf(root).findAll((n) => n.attrs.type === 'time')
    select(root, 'havørred')
    fieldOf(root, 'type', 'time').input('00:30')
    await nextTick()
    modes()[1].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    times()[0].input('23:00'); times()[1].input('00:45')
    await nextTick()
    const trip = ['2026-06-15', '23:00', '00:45', [t('log_date_yesterday')]]
    expect([fieldOf(root, 'type', 'date').value, ...times().map((n) => n.value), dateNote(root)]).toEqual(trip)
    modes()[0].click()
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)]).toEqual(['2026-06-16', '00:30', []])
    modes()[1].click()
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, ...times().map((n) => n.value), dateNote(root)]).toEqual(trip)
    const save = formOf(root).byClass('btn primary')[0]
    expect(save.attrs.disabled).toBe(false)
    save.click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.from, e.to])).toEqual([['2026-06-15', '23:00', '00:45']])
  })

  // The catch form's time, as the form put it in at 01:00, is one on the
  // 16th. A span typed for last night kept its date for the catch form shown
  // after it, and the catch sat at 01:00 on the 15th: a day early, if saved.
  // Typed as the trip form suggested it, the span is typed all the same.
  it('a span typed for last night leaves an untouched catch form on today, at the time now', async () => {
    for (const typed of [['23:00', '00:45'], ['22:00', '01:00']]) {
      vi.useFakeTimers({ now: new Date(2026, 5, 16, 1, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
      const root = await mountLog([])
      setup.availability = [NIGHT]
      const modes = () => root.byClass('seg mode')[0].byTag('button')
      const times = () => formOf(root).findAll((n) => n.attrs.type === 'time')
      modes()[1].click()
      await nextTick()
      fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
      times()[0].input(typed[0]); times()[1].input(typed[1])
      await nextTick()
      await clockAt(new Date(2026, 5, 16, 1, 30))
      modes()[0].click()
      await nextTick()
      const catchForm = () => [fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)]
      expect(catchForm(), typed[0]).toEqual(['2026-06-16', '01:30', []])
      modes()[1].click()
      await nextTick()
      expect([fieldOf(root, 'type', 'date').value, ...times().map((n) => n.value), dateNote(root)], typed[0])
        .toEqual(['2026-06-15', ...typed, [t('log_date_yesterday')]])
      modes()[0].click()
      await nextTick()
      expect(catchForm(), typed[0]).toEqual(['2026-06-16', '01:30', []])
      select(root, 'havørred')
      await nextTick()
      formOf(root).byClass('btn primary')[0].click()
      await flush()
      expect(log.entries.map((e) => [e.date, e.time]), typed[0]).toEqual([['2026-06-16', '01:30']])
      view!.unmount()
      view = undefined
      clearCatchDraft()
    }
  })

  // Left open over midnight, the catch form put its time in again for the
  // new day: that is the day the time is for, not the day the form opened on.
  it('a catch form rolled over at midnight has its time for the new day, past a span typed for last night', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    setup.availability = [NIGHT]
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    const times = () => formOf(root).findAll((n) => n.attrs.type === 'time')
    await midnight()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value]).toEqual(['2026-06-16', '00:02'])
    modes()[1].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    times()[0].input('23:00'); times()[1].input('23:45')
    await nextTick()
    await clockAt(new Date(2026, 5, 16, 0, 30))
    modes()[0].click()
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)]).toEqual(['2026-06-16', '00:30', []])
  })

  // The same over a draft: the catch's 00:30 typed today, a look at the trip
  // form prefilled with last night, and the view left. Put back the next
  // morning, the catch form had its date back, and the trip form shown after
  // it put the span suggested for the night of the 15th on the 16th. Nothing
  // typed in it, the trip form shown as the draft comes back is suggested
  // afresh: the last two hours, today.
  it('an untouched trip form shows no span on a day it was not suggested for, after a draft is put back', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 16, 1, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    setup.availability = [NIGHT]
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    const tripForm = () => [fieldOf(root, 'type', 'date').value, ...formOf(root).findAll((n) => n.attrs.type === 'time').map((n) => n.value), dateNote(root)]
    const catchForm = () => [fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)]
    select(root, 'havørred')
    fieldOf(root, 'type', 'time').input('00:30')
    await nextTick()
    modes()[1].click()
    await nextTick()
    view!.unmount()
    view = undefined
    vi.setSystemTime(new Date(2026, 5, 17, 8, 0))
    root = await mountLog([], { availability: [NIGHT] })
    const fresh = ['2026-06-17', '06:00', '08:00', []]
    expect(tripForm()).toEqual(fresh)
    modes()[0].click()
    await nextTick()
    expect(catchForm()).toEqual(['2026-06-16', '00:30', [t('log_date_yesterday')]])
    modes()[1].click()
    await nextTick()
    // Its span on the day it was suggested for.
    expect(tripForm()).toEqual(fresh)
    modes()[0].click()
    await nextTick()
    expect(catchForm()).toEqual(['2026-06-16', '00:30', [t('log_date_yesterday')]])
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.time])).toEqual([['2026-06-16', '00:30']])
  })

  // A draft kept with the trip form shown brings last night's date back, and
  // it stays over a look at the other form (draftDay). The catch form,
  // untouched, had its time put in at 01:00 on the 16th, and showed it on the 15th.
  it('a draft put back from a trip form on last night leaves an untouched catch form on today', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 16, 1, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    setup.availability = [NIGHT]
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    const tripForm = () => [fieldOf(root, 'type', 'date').value, ...formOf(root).findAll((n) => n.attrs.type === 'time').map((n) => n.value), dateNote(root)]
    modes()[1].click()
    await nextTick()
    root.byTag('textarea')[0].input('ingen hug')
    await nextTick()
    view!.unmount()
    view = undefined
    vi.setSystemTime(new Date(2026, 5, 16, 1, 10))
    root = await mountLog([])
    setup.availability = [NIGHT]
    expect(tripForm()).toEqual(['2026-06-15', '22:00', '01:00', [t('log_date_yesterday')]])
    modes()[0].click()
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)]).toEqual(['2026-06-16', '01:10', []])
    modes()[1].click()
    await nextTick()
    // The trip form as the draft put it back, its own date and span.
    expect([...tripForm(), root.byTag('textarea')[0].value]).toEqual(['2026-06-15', '22:00', '01:00', [t('log_date_yesterday')], 'ingen hug'])
  })

  // A catch begun last night, its time as the form put it in, behind a trip
  // form only looked at. Put back the next morning, the trip form showed the
  // span suggested last night, as a trip begun then. It is suggested afresh,
  // and the catch keeps the draft's day, as a look at it kept it.
  it('a draft put back on a trip form only looked at shows it afresh, and the catch begun behind it on its day', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 22, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    const tripForm = () => [fieldOf(root, 'type', 'date').value, ...formOf(root).findAll((n) => n.attrs.type === 'time').map((n) => n.value), dateNote(root)]
    const catchForm = () => [fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)]
    select(root, 'havørred')
    await nextTick()
    modes()[1].click()
    await nextTick()
    expect(tripForm()).toEqual(['2026-06-15', '20:00', '22:00', []])
    view!.unmount()
    view = undefined
    vi.setSystemTime(new Date(2026, 5, 16, 7, 0))
    root = await mountLog([])
    const fresh = ['2026-06-16', '05:00', '07:00', []]
    const begun = ['2026-06-15', '22:00', [t('log_date_yesterday')]]
    expect(tripForm()).toEqual(fresh)
    for (let i = 0; i < 2; i++) {
      modes()[0].click()
      await nextTick()
      expect(catchForm(), String(i)).toEqual(begun)
      modes()[1].click()
      await nextTick()
      expect(tripForm(), String(i)).toEqual(fresh)
    }
    modes()[0].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    await nextTick()
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.time, e.speciesId])).toEqual([['2026-06-15', '22:00', 'havørred']])
  })

  // But only a catch whose time was suggested for that day: one begun at
  // 01:00 on the 16th, behind a trip form suggested for the night of the
  // 15th, gets today and the time now, as a look at it gave it.
  it('a draft put back on a trip form only looked at leaves a catch suggested for another day on today', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 16, 1, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    setup.availability = [NIGHT]
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    const tripForm = () => [fieldOf(root, 'type', 'date').value, ...formOf(root).findAll((n) => n.attrs.type === 'time').map((n) => n.value), dateNote(root)]
    select(root, 'havørred')
    await nextTick()
    modes()[1].click()
    await nextTick()
    expect(tripForm()).toEqual(['2026-06-15', '22:00', '01:00', [t('log_date_yesterday')]])
    view!.unmount()
    view = undefined
    vi.setSystemTime(new Date(2026, 5, 17, 8, 0))
    root = await mountLog([], { availability: [NIGHT] })
    expect(tripForm()).toEqual(['2026-06-17', '06:00', '08:00', []])
    modes()[0].click()
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)]).toEqual(['2026-06-17', '08:00', []])
  })

  // A span typed under a date set by hand, and the date set back to the day
  // the form put in from the catch form: no date was kept for the span as
  // the catch form was shown, and the date is the one both forms show. The
  // catch form, untouched, rolls over at midnight, and the span keeps the
  // date it was typed for.
  it('a span typed under a date set by hand and set back keeps its date as an untouched catch form rolls over', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 30), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    const times = () => formOf(root).findAll((n) => n.attrs.type === 'time')
    modes()[1].click()
    await nextTick()
    fieldOf(root, 'type', 'date').input('2026-06-14')
    times()[0].input('19:00'); times()[1].input('22:00')
    await nextTick()
    modes()[0].click()
    await nextTick()
    fieldOf(root, 'type', 'date').input('2026-06-15')
    await nextTick()
    await midnight()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)]).toEqual(['2026-06-16', '00:02', []])
    modes()[1].click()
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, ...times().map((n) => n.value), dateNote(root)]).toEqual(['2026-06-15', '19:00', '22:00', [t('log_date_yesterday')]])
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    await nextTick()
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.from, e.to])).toEqual([['2026-06-15', '19:00', '22:00']])
  })

  // A draft's catch whose note, its one field typed, is cleared again is a
  // form as suggested: it rolls over at the next midnight. The trip form,
  // nothing typed in it either, keeps no draft's day and is suggested afresh:
  // the last two hours, from last night.
  it('a draft’s catch with its note cleared rolls over at the next midnight, the trip form too', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 50), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    root.byTag('textarea')[0].input('sidste nat')
    await nextTick()
    view!.unmount()
    view = undefined
    vi.setSystemTime(new Date(2026, 5, 16, 7, 0))
    root = await mountLog([])
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)]).toEqual(['2026-06-15', '23:50', [t('log_date_yesterday')]])
    root.byTag('textarea')[0].input('')
    await nextTick()
    vi.setSystemTime(new Date(2026, 5, 17, 0, 1))
    vi.advanceTimersByTime(60_000) // the view's clock ticks past midnight
    await nextTick(); await nextTick()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)]).toEqual(['2026-06-17', '00:02', []])
    root.byClass('seg mode')[0].byTag('button')[1].click()
    await nextTick()
    const span = formOf(root).findAll((n) => n.attrs.type === 'time').map((n) => n.value)
    expect([fieldOf(root, 'type', 'date').value, ...span, dateNote(root)]).toEqual(['2026-06-16', '22:02', '00:02', [t('log_date_yesterday')]])
  })

  // A catch begun with only its count, a size or kept/released typed is as
  // much a catch begun as one with a species. Put back the next morning, it
  // keeps the day it was begun on, and beside a span typed it keeps it as
  // midnight passes. Taken for a form as suggested, it showed this morning's
  // date and time beside last night's length.
  it('a catch with only its count, a size or kept/released typed keeps its day, put back or over midnight', async () => {
    const modes = (root: FakeNode) => root.byClass('seg mode')[0].byTag('button')
    const released = (root: FakeNode) => buttonsOf(formOf(root)).find((b) => b.textContent.includes(t('log_released')))!
    const typed: [string, (root: FakeNode) => void, unknown[]][] = [
      ['count', (root) => fieldOf(root, 'max', '9999').input('2'), ['2', '', '', false]],
      ['length', (root) => fieldOf(root, 'max', '400').input('45'), ['', '45', '', false]],
      ['weight', (root) => fieldOf(root, 'max', '500').input('1.2'), ['', '', '1.2', false]],
      ['released', (root) => released(root).click(), ['', '', '', true]],
    ]
    const shown = (root: FakeNode) => [
      fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value,
      ...['9999', '400', '500'].map((m) => String(fieldOf(root, 'max', m).value)), released(root).hasClass('on'), dateNote(root),
    ]
    for (const [what, type, own] of typed) {
      vi.useFakeTimers({ now: new Date(2026, 5, 15, 22, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
      let root = await mountLog([])
      type(root)
      await nextTick()
      view!.unmount()
      view = undefined
      vi.setSystemTime(new Date(2026, 5, 16, 7, 0))
      root = await mountLog([])
      expect(shown(root), what).toEqual(['2026-06-15', '22:00', ...own, [t('log_date_yesterday')]])
      view!.unmount()
      view = undefined
      clearCatchDraft()
      vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 30), toFake: ['Date', 'setInterval', 'clearInterval'] })
      root = await mountLog([])
      modes(root)[1].click()
      await nextTick()
      const span = formOf(root).findAll((n) => n.attrs.type === 'time')
      span[0].input('19:00'); span[1].input('22:00')
      await nextTick()
      modes(root)[0].click()
      await nextTick()
      type(root)
      await nextTick()
      await midnight()
      expect(shown(root), what).toEqual(['2026-06-15', '23:30', ...own, [t('log_date_yesterday')]])
      view!.unmount()
      view = undefined
      clearCatchDraft()
    }
  })

  // Beside a span typed, a catch form showing only the place the trip form
  // suggested is a form as suggested: it rolls over at midnight, the place
  // with it, and the span keeps its evening. A method or note typed in it
  // is a catch begun, and it stays on its day.
  it('beside a span typed, a catch form with only the place suggested rolls over at midnight, one with a method or note typed stays', async () => {
    const earlier: CatchEntry = { id: 'e', date: '2026-06-15', time: '18:00', speciesId: 'torsk', ...at(0), notes: 'e' }
    for (const what of ['place', 'method', 'note']) {
      vi.useFakeTimers({ now: new Date(2026, 5, 15, 23, 30), toFake: ['Date', 'setInterval', 'clearInterval'] })
      const root = await mountLog([earlier])
      const modes = () => root.byClass('seg mode')[0].byTag('button')
      const span = () => formOf(root).findAll((n) => n.attrs.type === 'time')
      modes()[1].click()
      await nextTick()
      span()[0].input('19:00'); span()[1].input('22:00')
      await nextTick()
      modes()[0].click()
      await nextTick()
      if (what === 'method') buttonsOf(formOf(root)).find((b) => b.textContent.includes(t('method_boat')))!.click()
      if (what === 'note') root.byTag('textarea')[0].input('på blink')
      await nextTick()
      await midnight()
      expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, fieldOf(root, 'list', 'loc-options').value, dateNote(root)], what)
        .toEqual(what === 'place' ? ['2026-06-16', '00:02', LOCS[0].name, []] : ['2026-06-15', '23:30', LOCS[0].name, [t('log_date_yesterday')]])
      modes()[1].click()
      await nextTick()
      expect([fieldOf(root, 'type', 'date').value, ...span().map((n) => n.value), dateNote(root)], what)
        .toEqual(['2026-06-15', '19:00', '22:00', [t('log_date_yesterday')]])
      view!.unmount()
      view = undefined
      clearCatchDraft()
    }
  })

  // A trip begun in the night, its span the window just fished, put back the
  // next morning: the catch form, its time suggested for today, gets today
  // and the time now. Back on the trip form, the draft's date was gone, and
  // the trip was prefilled again with this morning's last two hours: last
  // night's trip, if saved, sat on this morning.
  it('a trip draft from a night window put back the next morning keeps its date and span over a look at the catch form and back', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 16, 1, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    setup.availability = [NIGHT]
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    const tripForm = () => [fieldOf(root, 'type', 'date').value, ...formOf(root).findAll((n) => n.attrs.type === 'time').map((n) => n.value), dateNote(root)]
    modes()[1].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    await nextTick()
    view!.unmount()
    view = undefined
    vi.setSystemTime(new Date(2026, 5, 16, 7, 0))
    root = await mountLog([])
    setup.availability = [NIGHT]
    const night = ['2026-06-15', '22:00', '01:00', [t('log_date_yesterday')]]
    expect(tripForm()).toEqual(night)
    modes()[0].click()
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)]).toEqual(['2026-06-16', '07:00', []])
    modes()[1].click()
    await nextTick()
    expect(tripForm()).toEqual(night)
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.from, e.to])).toEqual([['2026-06-15', '22:00', '01:00']])
  })

  // The same for a catch: its time put in at 01:00 on the 16th, after a look
  // at a trip form prefilled with the night of the 15th. Put back a day
  // later, the trip form gets its own prefill, and the catch form back got
  // today and the time now: the catch, if saved, sat a day and seven hours late.
  it('a catch draft put back a day later keeps its date and time over a look at a trip form suggested for another night', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 16, 1, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    setup.availability = [NIGHT]
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    const catchForm = () => [fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)]
    modes()[1].click()
    await nextTick()
    modes()[0].click()
    await nextTick()
    select(root, 'havørred')
    await nextTick()
    view!.unmount()
    view = undefined
    vi.setSystemTime(new Date(2026, 5, 17, 8, 0))
    root = await mountLog([])
    setup.availability = [NIGHT]
    const caught = ['2026-06-16', '01:00', [t('log_date_yesterday')]]
    expect(catchForm()).toEqual(caught)
    modes()[1].click()
    await nextTick()
    // The trip form's own prefill: the last two hours, the night's window long over.
    const span = formOf(root).findAll((n) => n.attrs.type === 'time').map((n) => n.value)
    expect([fieldOf(root, 'type', 'date').value, ...span, dateNote(root)]).toEqual(['2026-06-17', '06:00', '08:00', []])
    modes()[0].click()
    await nextTick()
    expect(catchForm()).toEqual(caught)
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.time])).toEqual([['2026-06-16', '01:00']])
  })

  // Both forms of a draft hold an entry: a span typed for last night, and a
  // catch begun at 01:30 today with its time left as put in. Put back the
  // next day, each form shows its own date over looks at the other: the
  // span's typed date came back, and the catch got the time now.
  it('a draft with a span typed and a catch begun keeps each form’s date over looks at the other, put back the next day', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 16, 1, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    setup.availability = [NIGHT]
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    const times = () => formOf(root).findAll((n) => n.attrs.type === 'time')
    const catchForm = () => [fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)]
    const tripForm = () => [fieldOf(root, 'type', 'date').value, ...times().map((n) => n.value), dateNote(root)]
    modes()[1].click()
    await nextTick()
    times()[0].input('23:00'); times()[1].input('00:45')
    await nextTick()
    await clockAt(new Date(2026, 5, 16, 1, 30))
    modes()[0].click()
    await nextTick()
    select(root, 'havørred')
    await nextTick()
    view!.unmount()
    view = undefined
    vi.setSystemTime(new Date(2026, 5, 17, 8, 0))
    root = await mountLog([])
    setup.availability = [NIGHT]
    const caught = ['2026-06-16', '01:30', [t('log_date_yesterday')]]
    const trip = ['2026-06-15', '23:00', '00:45', [t('log_date_earlier')]]
    expect(catchForm()).toEqual(caught)
    for (let i = 0; i < 2; i++) {
      modes()[1].click()
      await nextTick()
      expect(tripForm(), String(i)).toEqual(trip)
      modes()[0].click()
      await nextTick()
      expect(catchForm(), String(i)).toEqual(caught)
    }
  })

  // The draft's day is the form's however often the view is left: put back
  // a second time with the other form shown, the trip got last night's date
  // back once, and lost it on the next look at the catch form and back.
  it('a trip draft put back the next morning keeps its date over looks at the catch form, the view left and come back to between', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 16, 1, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    setup.availability = [NIGHT]
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    const tripForm = () => [fieldOf(root, 'type', 'date').value, ...formOf(root).findAll((n) => n.attrs.type === 'time').map((n) => n.value), dateNote(root)]
    modes()[1].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    await nextTick()
    view!.unmount()
    view = undefined
    vi.setSystemTime(new Date(2026, 5, 16, 7, 0))
    root = await mountLog([])
    setup.availability = [NIGHT]
    modes()[0].click()
    await nextTick()
    view!.unmount()
    view = undefined
    vi.setSystemTime(new Date(2026, 5, 16, 7, 10))
    root = await mountLog([])
    setup.availability = [NIGHT]
    const night = ['2026-06-15', '22:00', '01:00', [t('log_date_yesterday')]]
    for (let i = 0; i < 2; i++) {
      modes()[1].click()
      await nextTick()
      expect(tripForm(), String(i)).toEqual(night)
      modes()[0].click()
      await nextTick()
      expect(fieldOf(root, 'type', 'date').value, String(i)).toBe('2026-06-16')
    }
  })

  // Saved, the draft is done with, and so are the days it brought: the fresh
  // form's time is now, today's, and a span typed for last night leaves it there.
  it('a draft from last night, saved, leaves a fresh catch form on today past a span typed for last night', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 22, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    select(root, 'havørred')
    await nextTick()
    view!.unmount()
    view = undefined
    vi.setSystemTime(new Date(2026, 5, 16, 1, 0))
    root = await mountLog([])
    setup.availability = [NIGHT]
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    const times = () => formOf(root).findAll((n) => n.attrs.type === 'time')
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.time])).toEqual([['2026-06-15', '22:00']])
    modes()[1].click()
    await nextTick()
    fieldOf(root, 'list', 'loc-options').input(LOCS[1].name)
    times()[0].input('23:00'); times()[1].input('00:45')
    await nextTick()
    await clockAt(new Date(2026, 5, 16, 1, 30))
    modes()[0].click()
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)]).toEqual(['2026-06-16', '01:30', []])
  })

  // A draft kept before the days were recorded brings none: last night's
  // catch put back the next morning keeps its date and time over a look at
  // the trip form and back, as that version kept them.
  it('a draft kept before the days were recorded keeps its date over a look at the other form, as before', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 16, 7, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    keepCatchDraft({
      who: null, mode: 'catch', editing: null, byHand: [],
      form: { date: '2026-06-15', time: '23:50', from: '', to: '', speciesId: 'havørred', locationName: '', count: '', lengthCm: '', weightKg: '', released: null, method: null, notes: '' },
      prefill: { date: '2026-06-15', time: '23:50', from: '', to: '', loc: '', method: null },
    }, draftEpoch())
    const root = await mountLog([])
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    modes()[1].click()
    await nextTick()
    const span = formOf(root).findAll((n) => n.attrs.type === 'time').map((n) => n.value)
    expect([fieldOf(root, 'type', 'date').value, ...span, dateNote(root)]).toEqual(['2026-06-15', '', '', [t('log_date_yesterday')]])
    modes()[0].click()
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)]).toEqual(['2026-06-15', '23:50', [t('log_date_yesterday')]])
  })

  // The draft's day is kept as a date, not as a mark a change to the date
  // clears. Saved, the draft is done with, and so is its day: still kept, a
  // trip form prefilled with that night took the fresh catch form back to
  // it, and a catch logged at 01:00 today was on yesterday.
  it('a draft put back the next day and saved leaves no day for a look at a night trip to keep', async () => {
    vi.useFakeTimers({ now: new Date(2026, 5, 15, 22, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    let root = await mountLog([])
    select(root, 'havørred')
    await nextTick()
    view!.unmount()
    view = undefined
    vi.setSystemTime(new Date(2026, 5, 16, 1, 0))
    root = await mountLog([])
    setup.availability = [NIGHT]
    const modes = () => root.byClass('seg mode')[0].byTag('button')
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries.map((e) => [e.date, e.time])).toEqual([['2026-06-15', '22:00']])
    modes()[1].click()
    await nextTick()
    expect(fieldOf(root, 'type', 'date').value).toBe('2026-06-15')
    modes()[0].click()
    await nextTick()
    expect([fieldOf(root, 'type', 'date').value, fieldOf(root, 'type', 'time').value, dateNote(root)]).toEqual(['2026-06-16', '01:00', []])
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

describe('the catch form’s checks', () => {
  const formOf = (root: FakeNode) => root.byClass('card form')[0]
  const fieldOf = (root: FakeNode, k: string, v: string) => formOf(root).findAll((n) => n.attrs[k] === v)[0]
  const select = (root: FakeNode, id: string) => {
    const s = formOf(root).byTag('select')[0]
    for (const o of s.options) o.selected = o.value === id
    s.dispatch('change')
  }
  const guard = (root: FakeNode) => texts(formOf(root).byClass('guard')[0]?.elements ?? [])

  // A length of 0 cm was saved and shown as '📏 0 cm', as the longest fish
  // in the stats too; a count of 2.5 was saved as 2 without a word.
  it('refuses a length or weight of 0 and a count of part of a fish, and says why', async () => {
    const root = await mountLog([])
    select(root, 'torsk')
    const save = formOf(root).byClass('btn primary')[0]
    for (const [max, bad, good] of [['400', '0', '45'], ['500', '0', '2.5'], ['9999', '2.5', '2']]) {
      fieldOf(root, 'max', max).input(bad)
      await nextTick()
      expect([save.attrs.disabled, guard(root).includes(`⚠️ ${t('log_range_warn')}`)], `${max}: ${bad}`).toEqual([true, true])
      fieldOf(root, 'max', max).input(good)
      await nextTick()
      expect([save.attrs.disabled, guard(root).includes(`⚠️ ${t('log_range_warn')}`)], `${max}: ${good}`).toEqual([false, false])
    }
    save.click()
    await flush()
    expect(log.entries.map((e) => [e.lengthCm, e.weightKg, e.count])).toEqual([[45, 2.5, 2]])
  })

  // Save stores today for a cleared date, and the season's warnings were
  // for no date at all: none.
  it('with the date cleared, warns as for today, the day it saves on', async () => {
    vi.useFakeTimers({ now: new Date(2026, 11, 1, 10, 0), toFake: ['Date', 'setInterval', 'clearInterval'] })
    const root = await mountLog([])
    select(root, 'havørred')
    fieldOf(root, 'list', 'loc-options').input(LOCS[0].name)
    await nextTick()
    const loc = setup.locations[0]
    const want = catchWarnings('havørred', undefined, '2026-12-01', undefined, loc.waterType, loc).map((w) => `⚠️ ${w}`)
    expect(want.length).toBeGreaterThan(0)
    expect(guard(root)).toEqual(want)
    fieldOf(root, 'type', 'date').input('')
    await nextTick()
    expect(guard(root)).toEqual(want)
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(log.entries.map((e) => e.date)).toEqual(['2026-12-01'])
  })
})

/** A catch saved inside a trip logged as "uden fangst": the form offers to delete the trip (log_trip_replace_confirm). */
describe('a catch saved inside a trip without a catch', () => {
  const formOf = (root: FakeNode) => root.byClass('card form')[0]
  const day = daysAgo(5)
  const trip: CatchEntry = { id: 't', outcome: 'empty', date: day, from: '05:00', to: '08:00', speciesId: '', count: 0, ...at(1), notes: 't' }
  const ask = () => t('log_trip_replace_confirm').replace('{loc}', LOCS[1].name).replace('{from}', '05:00').replace('{to}', '08:00')

  it('asks whether to delete the trip, for a new catch and for one moved into it', async () => {
    const root = await mountLog([trip, { id: 'c', date: day, time: '09:30', speciesId: 'havørred', ...at(1), notes: 'c' }])
    buttonsOf(cardOf(root, 'c').byClass('entry-actions')[0])[0].click()
    await nextTick()
    formOf(root).findAll((n) => n.attrs.type === 'time')[0].input('06:00')
    await nextTick()
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect([confirmState.open, confirmState.message]).toEqual([true, ask()])
    confirmCancel()
    await flush()
    expect(log.entries.map((e) => e.id).sort()).toEqual(['c', 't'])
  })

  // A name is the user's own text: "$&" or "$'" in it is no replace pattern.
  it('names a spot with a dollar sign as written', async () => {
    const name = "Mole $& $' $$"
    const locations = [LOCS[0], { ...LOCS[1], name }]
    const root = await mountLog([trip, { id: 'c', date: day, time: '09:30', speciesId: 'havørred', ...at(1), notes: 'c' }], { locations })
    buttonsOf(cardOf(root, 'c').byClass('entry-actions')[0])[0].click()
    await nextTick()
    formOf(root).findAll((n) => n.attrs.type === 'time')[0].input('06:00')
    await nextTick()
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(confirmState.message).toBe(t('log_trip_replace_confirm').replace('{loc}', () => name).replace('{from}', '05:00').replace('{to}', '08:00'))
    confirmCancel()
    await flush()
  })

  // Saved under the spot's name from before a rename, the catch's stored
  // name differs from the one the form shows: a note changed, and it read
  // as moved, and asked again, each time, to delete a trip already kept.
  it('does not ask again for a catch whose spot was renamed, edited where it is', async () => {
    const root = await mountLog([trip, { id: 'c', date: day, time: '06:00', speciesId: 'havørred', locationName: 'Gammelt navn', locationId: 'L1', notes: 'c' }])
    buttonsOf(cardOf(root, 'c').byClass('entry-actions')[0])[0].click()
    await nextTick()
    root.byTag('textarea')[0].input('kun en note')
    await nextTick()
    formOf(root).byClass('btn primary')[0].click()
    await flush()
    expect(confirmState.open).toBe(false)
    expect(log.entries.find((e) => e.id === 'c')!.notes).toBe('kun en note')
  })
})

// The kept/released and method buttons showed their state by colour only,
// and the row of mode buttons was a group with no name.
describe('the form’s toggles to a screen reader', () => {
  const formOf = (root: FakeNode) => root.byClass('card form')[0]
  const pressed = (root: FakeNode) => formOf(root).byClass('seg-btn').map((b) => `${b.textContent}=${b.attrs['aria-pressed']}`)
  const button = (root: FakeNode, text: string) => formOf(root).byClass('seg-btn').find((b) => b.textContent.includes(text))!

  it('each says whether it is on', async () => {
    const root = await mountLog([])
    button(root, t('log_kept')).click()
    button(root, t('method_boat')).click()
    await nextTick()
    expect(pressed(root)).toEqual([
      `${t('log_mode_catch')}=true`, `${t('log_mode_empty')}=false`,
      `🧺 ${t('log_kept')}=true`, `🌊 ${t('log_released')}=false`,
      `🎣 ${t('method_shore')}=false`, `🦺 ${t('method_waders')}=false`, `🚢 ${t('method_boat')}=true`,
    ])
    button(root, t('log_released')).click()
    await nextTick()
    expect(pressed(root).slice(2, 4)).toEqual([`🧺 ${t('log_kept')}=false`, `🌊 ${t('log_released')}=true`])
    button(root, t('log_mode_empty')).click()
    await nextTick()
    button(root, t('method_waders')).click()
    await nextTick()
    expect(pressed(root)).toEqual([
      `${t('log_mode_catch')}=false`, `${t('log_mode_empty')}=true`,
      `🎣 ${t('method_shore')}=false`, `🦺 ${t('method_waders')}=true`, `🚢 ${t('method_boat')}=false`,
    ])
  })

  it('each row is a group named for what it picks', async () => {
    const root = await mountLog([])
    const names = () => formOf(root).findAll((n) => n.attrs.role === 'group').map((g) => {
      const by = g.attrs['aria-labelledby']
      return by ? formOf(root).findAll((n) => n.attrs.id === by).map((n) => n.textContent).join() : g.attrs['aria-label']
    })
    expect(names()).toEqual([t('log_mode_label'), t('log_outcome'), t('method_label')])
    button(root, t('log_mode_empty')).click()
    await nextTick()
    expect(names()).toEqual([t('log_mode_label'), t('method_label')])
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
