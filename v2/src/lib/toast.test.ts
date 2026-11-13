import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { computed } from 'vue'
import { toasts, showToast, dismissToast, clearToasts, runToastAction } from './toast'
import { langReady, setLang, t } from './i18n'
import { STRINGS } from '@/test/strings'

beforeEach(() => {
  vi.useFakeTimers()
  toasts.value = []
})
afterEach(() => {
  vi.useRealTimers()
})

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

  it('the cap still drops the oldest, even one with an action', () => {
    showToast('a', { action: { label: 'Retry', run: vi.fn() } })
    for (const m of ['b', 'c', 'd']) showToast(m)
    expect(toasts.value.map((t) => t.message)).toEqual(['b', 'c', 'd'])
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

  it('with only errors showing, a new info toast is the one that gives way', () => {
    for (const m of ['e1', 'e2', 'e3']) showToast(m, { type: 'error' })
    showToast('refreshing')
    expect(toasts.value.map((t) => t.message)).toEqual(['e1', 'e2', 'e3'])
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
