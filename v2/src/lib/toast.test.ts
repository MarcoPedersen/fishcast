import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { toasts, showToast, dismissToast } from './toast'

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
    showToast('📡 offline', { type: 'error' })
    vi.advanceTimersByTime(5000)
    const retry = vi.fn()
    showToast('📡 offline', { type: 'error', action: { label: 'Retry', run: retry } })
    expect(toasts.value).toHaveLength(1)
    // The newest Retry wins — it covers whatever failed last.
    toasts.value[0].action!.run()
    expect(retry).toHaveBeenCalled()
    // Its 6 s start again from the repeat, not the first showing.
    vi.advanceTimersByTime(5000)
    expect(toasts.value).toHaveLength(1)
    vi.advanceTimersByTime(1000)
    expect(toasts.value).toHaveLength(0)
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
