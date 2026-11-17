import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { computed } from 'vue'
import { toastSpace, toasts, shownToasts, showToast, dismissToast, dismissKeyed, clearToasts, runToastAction } from './toast'
import { langReady, setLang, t } from './i18n'
import { STRINGS } from '@/test/strings'

beforeEach(() => {
  vi.useFakeTimers()
  toasts.value = []
})
afterEach(() => {
  vi.useRealTimers()
})

/** What the stack shows (Toasts.vue renders these), top to bottom. */
const shown = () => shownToasts.value.map((x) => x.message)
/** The toasts waiting for room in the stack, in their places. */
const waiting = () => toasts.value.filter((x) => x.waiting).map((x) => x.message)

describe('showToast', () => {
  // One toast per failed location (or per flap of the connection) stacked 18
  // identical "you're offline" toasts — taller than a phone screen.
  it('refreshes a toast already showing the same message instead of stacking a copy', () => {
    showToast('⚠️ sync failed', { type: 'error' })
    vi.advanceTimersByTime(5000)
    showToast('⚠️ sync failed', { type: 'error' })
    expect(toasts.value).toHaveLength(1)
    // Its 6 s start again from the repeat, not the first showing.
    vi.advanceTimersByTime(5000)
    expect(toasts.value).toHaveLength(1)
    vi.advanceTimersByTime(1000)
    expect(toasts.value).toHaveLength(0)
  })

  it('a repeat carrying a Retry replaces the old one — the newest covers whatever failed last', () => {
    showToast('📡 offline', { type: 'error', action: { label: 'Retry', run: vi.fn() } })
    const retry = vi.fn()
    showToast('📡 offline', { type: 'error', action: { label: 'Retry', run: retry } })
    expect(toasts.value).toHaveLength(1)
    toasts.value[0].action!.run()
    expect(retry).toHaveBeenCalled()
  })

  // A toast with a button vanished after 6 s, before a keyboard user could tab
  // to "Prøv igen" or a screen reader user had heard it out and found it.
  it('keeps a toast with an action until it is dismissed', () => {
    showToast('⚠️ fetch failed', { type: 'error', action: { label: 'Retry', run: vi.fn() } })
    vi.advanceTimersByTime(10 * 60_000)
    expect(toasts.value).toHaveLength(1)
    dismissToast(toasts.value[0].id)
    expect(toasts.value).toHaveLength(0)
  })

  it('stays put when the same message comes again without an action', () => {
    showToast('📡 offline', { type: 'error', action: { label: 'Retry', run: vi.fn() } })
    showToast('📡 offline', { type: 'error' })
    vi.advanceTimersByTime(60_000)
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0].action).toBeDefined()
  })

  it('stops auto-dismissing once a repeat brings an action', () => {
    showToast('📡 offline', { type: 'error' })
    vi.advanceTimersByTime(5000)
    showToast('📡 offline', { type: 'error', action: { label: 'Retry', run: vi.fn() } })
    vi.advanceTimersByTime(60_000)
    expect(toasts.value).toHaveLength(1)
  })

  it('still honours an explicit ttl on an action toast', () => {
    showToast('undo?', { action: { label: 'Undo', run: vi.fn() }, ttl: 3000 })
    vi.advanceTimersByTime(3000)
    expect(toasts.value).toHaveLength(0)
  })

  // A spot's Fortryd toast holds its undo history (lib/undoHistory): a
  // 3-second "⟳ refreshing" pushed it off the stack, and the history with it.
  // And a notice the user is waiting for ("✓ Tur uden fangst gemt") never
  // showed with three spots' toasts standing: a new notice shows as a fourth,
  // and goes by itself in a few seconds.
  it('over the cap an older toast without a button gives way first; a new one shows as a fourth', () => {
    const undo = { label: 'Undo', run: vi.fn() }
    showToast('a', { action: undo })
    showToast('b')
    showToast('c', { action: undo })
    showToast('d', { action: undo })
    expect(toasts.value.map((t) => t.message)).toEqual(['a', 'c', 'd'])
    showToast('e')
    expect(toasts.value.map((t) => t.message)).toEqual(['a', 'c', 'd', 'e'])
    // Another one: the older notice goes, the buttons stay.
    showToast('f')
    expect(toasts.value.map((t) => t.message)).toEqual(['a', 'c', 'd', 'f'])
    vi.advanceTimersByTime(60_000)
    expect(toasts.value.map((t) => t.message)).toEqual(['a', 'c', 'd'])
  })

  // A notice that stays until it is closed ("logged in until the app is closed
  // or reloaded", main.ts) is no passing word: as the oldest notice it was
  // the first to go, under a 3-second "⟳ refreshing".
  it('a notice that stays until closed is not the first to give way', () => {
    const undo = { label: 'Undo', run: vi.fn() }
    showToast('signed in for now', { ttl: 0 })
    showToast('a', { action: undo })
    showToast('b', { action: undo })
    showToast('c')
    expect(toasts.value.map((t) => t.message)).toEqual(['signed in for now', 'a', 'b', 'c'])
    vi.advanceTimersByTime(60_000)
    expect(toasts.value.map((t) => t.message)).toEqual(['signed in for now', 'a', 'b'])
  })

  it('with only buttons standing, the oldest waits for room', () => {
    showToast('a', { action: { label: 'Retry', run: vi.fn() } })
    for (const m of ['b', 'c', 'd']) showToast(m, { action: { label: 'Undo', run: vi.fn() } })
    expect(shown()).toEqual(['b', 'c', 'd'])
    expect(waiting()).toEqual(['a'])
  })

  it('shows at most three, dropping the oldest', () => {
    for (const m of ['a', 'b', 'c', 'd']) showToast(m)
    expect(toasts.value.map((t) => t.message)).toEqual(['b', 'c', 'd'])
  })

  // "Sync failed" matters more than "refreshing…": three quick infos (a
  // refresh, then offline, then back online) pushed it off inside its 6 s.
  it('drops the oldest info toast before any error toast', () => {
    showToast('⚠️ sync failed', { type: 'error' })
    for (const m of ['a', 'b', 'c']) showToast(m)
    expect(toasts.value.map((t) => t.message)).toEqual(['⚠️ sync failed', 'b', 'c'])
  })

  it('with only errors showing, a new notice shows beside them, and gives way to the next error', () => {
    for (const m of ['e1', 'e2', 'e3']) showToast(m, { type: 'error' })
    showToast('refreshing')
    expect(toasts.value.map((t) => t.message)).toEqual(['e1', 'e2', 'e3', 'refreshing'])
    showToast('e4', { type: 'error' })
    expect(toasts.value.map((t) => t.message)).toEqual(['e2', 'e3', 'e4'])
  })

  it('a dismissed toast does not take a later one with it', () => {
    showToast('a', { ttl: 1000 })
    dismissToast(toasts.value[0].id)
    showToast('a', { ttl: 5000 })
    vi.advanceTimersByTime(1000)
    expect(toasts.value).toHaveLength(1)
  })

  it('still shows different messages side by side', () => {
    showToast('a')
    showToast('b')
    expect(toasts.value.map((t) => t.message)).toEqual(['a', 'b'])
    vi.advanceTimersByTime(6000)
    expect(toasts.value).toHaveLength(0)
  })
})

/**
 * A key says what a toast is about: the spot card's water-type toast has one
 * per spot. A newer toast under the same key takes the older one's place,
 * text and button too. Joined by text, two changes on one spot left two
 * toasts, and two spots whose change read the same shared one, whose Fortryd
 * undid only the latest spot.
 */
describe('a toast with a key', () => {
  it('replaces the one showing under the same key, its text and its button too', () => {
    const older = vi.fn()
    const newer = vi.fn()
    const id = showToast('salt to fresh', { key: 'spot1', action: { label: 'Undo', run: older } })
    expect(showToast('fresh to brackish', { key: 'spot1', action: { label: 'Undo', run: newer } })).toBe(id)
    expect(toasts.value.map((t) => t.message)).toEqual(['fresh to brackish'])
    runToastAction(id)
    expect(newer).toHaveBeenCalledOnce()
    expect(older).not.toHaveBeenCalled()
  })

  it('never joins toasts under different keys, the same text included', () => {
    const one = vi.fn()
    const two = vi.fn()
    showToast('Added to the spot: Pike.', { key: 'spot1', action: { label: 'Undo', run: one } })
    showToast('Added to the spot: Pike.', { key: 'spot2', action: { label: 'Undo', run: two } })
    expect(toasts.value).toHaveLength(2)
    runToastAction(toasts.value[0].id)
    expect(one).toHaveBeenCalledOnce()
    expect(two).not.toHaveBeenCalled()
    runToastAction(toasts.value[0].id)
    expect(two).toHaveBeenCalledOnce()
  })

  it('keeps a keyed toast apart from one without a key; text still joins those', () => {
    showToast('📡 offline', { key: 'spot1' })
    showToast('📡 offline')
    showToast('📡 offline')
    expect(toasts.value).toHaveLength(2)
  })

  // Same id, same place: the stack does not jump, and no toast slides out and in.
  it('keeps its place in the stack when replaced', () => {
    const id = showToast('a', { key: 'spot1' })
    showToast('b')
    showToast('c', { key: 'spot1' })
    expect(toasts.value.map((t) => [t.id === id, t.message])).toEqual([[true, 'c'], [false, 'b']])
  })

  it('replaced by one without a button, it goes after 6 s like any toast without one', () => {
    showToast('a', { key: 'spot1', action: { label: 'Undo', run: vi.fn() } })
    showToast('b', { key: 'spot1' })
    expect(toasts.value[0].action).toBeUndefined()
    vi.advanceTimersByTime(6000)
    expect(toasts.value).toHaveLength(0)
  })

  it('shows a new toast once the one under its key has gone', () => {
    dismissToast(showToast('a', { key: 'spot1' }))
    showToast('b', { key: 'spot1' })
    expect(toasts.value.map((t) => t.message)).toEqual(['b'])
  })

  // The other way round: joined by text, the keyed toast took the Retry's
  // place, its key was lost, and Prøv igen became Fortryd.
  it('never joins a toast without a key that shows the same text', () => {
    const retry = vi.fn()
    showToast('📡 offline', { type: 'error', action: { label: 'Retry', run: retry } })
    showToast('📡 offline', { key: 'spot1', action: { label: 'Undo', run: vi.fn() } })
    expect(toasts.value.map((t) => t.key)).toEqual([undefined, 'spot1'])
    runToastAction(toasts.value[0].id)
    expect(retry).toHaveBeenCalledOnce()
  })

  // Replaced, it keeps its place but is the newest: over the cap, the oldest
  // change waits first. Gone by its place, a newer change on spot 1 lost its
  // Fortryd before older ones on spots 2 and 3.
  it('replaced, it is the newest for the cap, though it keeps its place', () => {
    const undo = { label: 'Undo', run: vi.fn() }
    showToast('spot 1, first change', { key: 'spot1', action: undo })
    showToast('spot 2', { key: 'spot2', action: undo })
    showToast('spot 3', { key: 'spot3', action: undo })
    showToast('spot 1, second change', { key: 'spot1', action: undo })
    showToast('spot 4', { key: 'spot4', action: undo })
    expect(shown()).toEqual(['spot 1, second change', 'spot 3', 'spot 4'])
    expect(waiting()).toEqual(['spot 2'])
  })

  /**
   * Fortryd on a spot's toast brings back the toast of its earlier change,
   * under the same key (LocationsView setWater). It takes the place and the
   * id of the toast whose button was used: Toasts.vue keys each toast by id,
   * so the same element stays, its button keeps the keyboard's focus, and a
   * second tap lands on it. Added at the end, it went to the bottom of the
   * stack, and another spot's toast slid into its place under the finger.
   */
  it('a toast its button shows again under the same key takes the old one\'s place and id', () => {
    const earlier = vi.fn()
    const id = showToast('fresh to brackish', { key: 'spot1', action: { label: 'Undo', run: () => {
      showToast('salt to fresh', { key: 'spot1', action: { label: 'Undo', run: earlier } })
    } } })
    const other = showToast('spot 2', { key: 'spot2', action: { label: 'Undo', run: vi.fn() } })
    runToastAction(id)
    expect(toasts.value.map((t) => [t.id, t.message])).toEqual([[id, 'salt to fresh'], [other, 'spot 2']])
    runToastAction(id) // the same place, the same button
    expect(earlier).toHaveBeenCalledOnce()
    expect(toasts.value.map((t) => t.id)).toEqual([other])
  })

  it('a button that shows nothing under its key closes its toast; one under another key is a new toast', () => {
    const id = showToast('a', { key: 'spot1', action: { label: 'Undo', run: () => { showToast('b', { key: 'spot2' }) } } })
    runToastAction(id)
    expect(toasts.value.map((t) => [t.id === id, t.message])).toEqual([[false, 'b']])
    showToast('c', { key: 'spot1' }) // later, not from its button: a new toast at the end
    expect(toasts.value.map((t) => [t.id === id, t.message])).toEqual([[false, 'b'], [false, 'c']])
  })
})

/**
 * The round F browser check: a fourth spot's change pushed the oldest spot's
 * toast off the stack, and the spot's undo history went with it
 * (lib/undoHistory): Hornbæk's Torsk, picked by hand, could no longer come
 * back. Over the cap, a toast that stays until it is used or closed now
 * waits out of sight instead, and comes back as soon as there is room. What
 * goes by itself in a few seconds still just goes.
 */
describe('over the cap, a toast that stays waits for room', () => {
  const undo = () => ({ label: 'Undo', run: vi.fn() })

  it('the oldest waits, as long as it takes, and comes back in its place when one is closed', () => {
    const ids = ['a', 'b', 'c', 'd'].map((m) => showToast(m, { action: undo() }))
    expect(shown()).toEqual(['b', 'c', 'd'])
    expect(waiting()).toEqual(['a'])
    vi.advanceTimersByTime(60 * 60_000)
    expect(waiting()).toEqual(['a'])
    dismissToast(ids[3])
    expect(shown()).toEqual(['a', 'b', 'c'])
    expect(waiting()).toEqual([])
    expect(toasts.value.map((x) => x.id)).toEqual(ids.slice(0, 3)) // the same toasts, ids too
  })

  it('the newest show, and those waiting come back newest first', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'].map((m) => showToast(m, { action: undo() }))
    expect(shown()).toEqual(['c', 'd', 'e'])
    expect(waiting()).toEqual(['a', 'b'])
    dismissToast(ids[4])
    expect(shown()).toEqual(['b', 'c', 'd'])
    dismissToast(ids[2])
    expect(shown()).toEqual(['a', 'b', 'd'])
    expect(waiting()).toEqual([])
  })

  it('one used up by its button makes room once the button has run', () => {
    const run = vi.fn(() => expect(waiting()).toEqual(['a']))
    for (const m of ['a', 'b', 'c']) showToast(m, { action: undo() })
    const d = showToast('d', { action: { label: 'Undo', run } })
    runToastAction(d)
    expect(run).toHaveBeenCalledOnce()
    expect(shown()).toEqual(['a', 'b', 'c'])
  })

  // Fortryd on a spot's toast shows its earlier change, in its place and
  // with its id (LocationsView showStep): the room stays taken.
  it('a button that shows its toast again under its key keeps the room, and the place', () => {
    const ids = ['1', '2', '3'].map((n) => showToast(`spot ${n}`, { key: `spot${n}`, action: undo() }))
    const four = showToast('spot 4', { key: 'spot4', action: { label: 'Undo', run: () => {
      showToast('spot 4, earlier', { key: 'spot4', action: undo() })
    } } })
    runToastAction(four)
    expect(shown()).toEqual(['spot 2', 'spot 3', 'spot 4, earlier'])
    expect(waiting()).toEqual(['spot 1'])
    expect(toasts.value.map((x) => x.id)).toEqual([...ids, four])
  })

  // "Sync failed" still comes before an info toast; the info waits.
  it('a toast that goes by itself makes room too, when it goes', () => {
    for (const m of ['a', 'b', 'c']) showToast(m, { action: undo() })
    showToast('⚠️ sync failed', { type: 'error' })
    expect(shown()).toEqual(['b', 'c', '⚠️ sync failed'])
    expect(waiting()).toEqual(['a'])
    vi.advanceTimersByTime(6000)
    expect(shown()).toEqual(['a', 'b', 'c'])
  })

  // "Logged in until the app is closed or reloaded" (main.ts) says something
  // that is still true: it waits too.
  it('a notice that stays until closed waits too', () => {
    showToast('signed in for now', { ttl: 0 })
    const [a] = ['a', 'b', 'c'].map((m) => showToast(m, { action: undo() }))
    expect(shown()).toEqual(['a', 'b', 'c'])
    expect(waiting()).toEqual(['signed in for now'])
    dismissToast(a)
    expect(shown()).toEqual(['signed in for now', 'b', 'c'])
  })

  it('a passing notice still shows as a fourth, and keeps no waiting one out', () => {
    const [, b] = ['a', 'b', 'c', 'd'].map((m) => showToast(m, { action: undo() }))
    showToast('refreshing')
    expect(shown()).toEqual(['b', 'c', 'd', 'refreshing'])
    dismissToast(b)
    expect(shown()).toEqual(['a', 'c', 'd', 'refreshing'])
    vi.advanceTimersByTime(6000)
    expect(shown()).toEqual(['a', 'c', 'd'])
  })

  // A spot's next change while its toast waits: the toast says it, in its
  // place, as the newest, so the oldest shown waits instead.
  it('a toast under the key of one waiting takes its place and id, and shows', () => {
    const one = showToast('spot 1', { key: 'spot1', action: undo() })
    for (const n of ['2', '3', '4']) showToast(`spot ${n}`, { key: `spot${n}`, action: undo() })
    expect(waiting()).toEqual(['spot 1'])
    expect(showToast('spot 1, again', { key: 'spot1', action: undo() })).toBe(one)
    expect(shown()).toEqual(['spot 1, again', 'spot 3', 'spot 4'])
    expect(waiting()).toEqual(['spot 2'])
    expect(toasts.value[0].id).toBe(one)
  })

  // A spot's next change while its toast shows takes no room the toast did
  // not have: a passing notice showing as a fourth keeps its few seconds.
  // The cap ran at each such change, and "⟳ refreshing" went at once.
  it('a toast shown, said again under its key, leaves a passing fourth its time', () => {
    for (const n of ['1', '2', '3']) showToast(`spot ${n}`, { key: `spot${n}`, action: undo() })
    showToast('⟳ refreshing', { ttl: 3000 })
    showToast('spot 2, again', { key: 'spot2', action: undo() })
    expect(shown()).toEqual(['spot 1', 'spot 2, again', 'spot 3', '⟳ refreshing'])
    vi.advanceTimersByTime(3000)
    expect(shown()).toEqual(['spot 1', 'spot 2, again', 'spot 3'])
    // One that goes by itself, said again to stay, takes room: the oldest waits.
    showToast('note', { key: 'note' })
    showToast('note, now with a button', { key: 'note', action: undo() })
    expect(shown()).toEqual(['spot 2, again', 'spot 3', 'note, now with a button'])
    expect(waiting()).toEqual(['spot 1'])
  })

  it('the same text again refreshes the one waiting, and makes no copy', () => {
    showToast('📡 offline', { action: undo() })
    for (const m of ['b', 'c', 'd']) showToast(m, { action: undo() })
    const retry = vi.fn()
    showToast('📡 offline', { action: { label: 'Retry', run: retry } })
    expect(toasts.value.map((x) => x.message)).toEqual(['📡 offline', 'b', 'c', 'd'])
    expect(waiting()).toEqual(['📡 offline'])
    toasts.value[0].action!.run()
    expect(retry).toHaveBeenCalledOnce()
  })

  // A spot deleted (LocationsView remove), and logout (clearToasts).
  it('a toast waiting is taken down by its key, and by clearToasts', () => {
    for (const n of ['1', '2', '3', '4']) showToast(`spot ${n}`, { key: `spot${n}`, action: undo() })
    dismissKeyed('spot1')
    expect(toasts.value.map((x) => x.message)).toEqual(['spot 2', 'spot 3', 'spot 4'])
    showToast('spot 5', { key: 'spot5', action: undo() })
    expect(waiting()).toEqual(['spot 2'])
    clearToasts()
    expect(toasts.value).toEqual([])
  })

  // What asks after the toasts with a button finds those waiting too: the
  // updater holds its reload for them (main.ts pageHolds), and a spot's undo
  // history stays (lib/undoHistory).
  it('is still among the toasts, though out of sight', () => {
    for (const m of ['a', 'b', 'c']) showToast(m, { action: undo() })
    for (const m of ['e1', 'e2', 'e3']) showToast(m, { type: 'error' })
    expect(shown()).toEqual(['e1', 'e2', 'e3'])
    expect(shownToasts.value.some((x) => !!x.action)).toBe(false)
    expect(toasts.value.some((x) => !!x.action)).toBe(true)
    vi.advanceTimersByTime(6000)
    expect(shown()).toEqual(['a', 'b', 'c'])
  })
})

describe('toast actions and clearing', () => {
  // Offline, "Prøv igen" fails at once and raises the same message again. The
  // button ran the action first and dismissed afterwards — the refreshed toast
  // itself — so the warning vanished as if the retry had worked.
  it('dismisses before running, so a repeat failure shows again', () => {
    const run = vi.fn(() => showToast('📡 offline', { type: 'error', action: { label: 'Retry', run } }))
    showToast('📡 offline', { type: 'error', action: { label: 'Retry', run } })
    runToastAction(toasts.value[0].id)
    expect(run).toHaveBeenCalledOnce()
    expect(toasts.value.map((t) => t.message)).toEqual(['📡 offline'])
  })

  it('returns the id of the toast showing the message, a repeat included', () => {
    const id = showToast('📡 offline', { type: 'error' })
    expect(showToast('📡 offline', { type: 'error' })).toBe(id)
    expect(toasts.value[0].id).toBe(id)
  })

  // Logout: a sticky Retry closes over the old account's spots.
  it('clearToasts removes every toast, sticky ones included', () => {
    showToast('📡 offline', { type: 'error', action: { label: 'Retry', run: vi.fn() } })
    showToast('info')
    clearToasts()
    expect(toasts.value).toEqual([])
    vi.advanceTimersByTime(10_000) // no stale timer fires on a later toast
    expect(toasts.value).toEqual([])
  })
})

/**
 * A toast with a button stays until it is used or closed, and its text was
 * built once, in the language of that moment: switched to Danish while
 * "Removed Pike, Zander, Perch, Carp from the spot … Undo" stood under the
 * Locations page, the page turned Danish and the toast stayed English.
 */
describe('a toast left on screen through a language switch', () => {
  afterEach(() => setLang('da'))

  it('reads its text and its button in the language now shown', async () => {
    setLang('da')
    showToast(() => t('toast_offline'), { type: 'error', action: { label: () => t('toast_retry'), run: vi.fn() } })
    expect(toasts.value[0].message).toBe(STRINGS.da.toast_offline)
    expect(toasts.value[0].action!.label).toBe(STRINGS.da.toast_retry)
    setLang('en')
    await langReady()
    expect(toasts.value[0].message).toBe(STRINGS.en.toast_offline)
    expect(toasts.value[0].action!.label).toBe(STRINGS.en.toast_retry)
  })

  it('what shows it is told when the language changes', async () => {
    setLang('da')
    showToast(() => t('undo'), { action: { label: () => t('undo'), run: vi.fn() } })
    // What Toasts.vue renders: a template reads these the same way.
    const shown = computed(() => toasts.value.map((x) => x.message + ' | ' + x.action?.label))
    expect(shown.value).toEqual([STRINGS.da.undo + ' | ' + STRINGS.da.undo])
    setLang('en')
    await langReady()
    expect(shown.value).toEqual([STRINGS.en.undo + ' | ' + STRINGS.en.undo])
  })

  it('a repeat with the same text still refreshes the one showing', () => {
    showToast(() => t('toast_offline'), { type: 'error' })
    showToast('' + t('toast_offline'), { type: 'error' })
    showToast(() => t('toast_offline'), { type: 'error', action: { label: () => t('toast_retry'), run: vi.fn() } })
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0].action!.label).toBe(STRINGS.da.toast_retry)
  })

  it('a plain string stays as it was given', () => {
    showToast('📡 offline', { action: { label: 'Retry', run: vi.fn() } })
    setLang('en')
    expect(toasts.value[0].message).toBe('📡 offline')
    expect(toasts.value[0].action!.label).toBe('Retry')
  })
})

/**
 * Standing toasts covered the page's last buttons ("← Tilbage", "Næste →",
 * "Gem tur uden fangst"), and the page couldn't scroll them clear: the
 * stack's height, plus its 16 px off the bottom and a little air, is room
 * the page leaves at its end (Toasts.vue sets --toast-space; style.css .shell).
 */
describe('the room the page leaves for the toasts', () => {
  it('is none without toasts, and the stack and its offset with them', () => {
    expect(toastSpace(0)).toBe('0px')
    expect(toastSpace(240)).toBe('264px')
  })
})
