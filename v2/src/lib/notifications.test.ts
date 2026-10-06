// Window start times are local wall-clock hours; pin the zone so "04:30" means
// the same instant on every machine. (No @types/node — declare just this bit.)
declare const process: { env: Record<string, string | undefined> }
process.env.TZ = 'Europe/Copenhagen'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Location, ScoredWindow } from './types'
import { scheduleWindowNotifications } from './notifications'

/** A Notification constructor that records what it was asked to show. */
function fakeNotification(throws = false) {
  const shown: { title: string; opts: NotificationOptions }[] = []
  const N = vi.fn(function (this: unknown, title: string, opts: NotificationOptions) {
    // Chrome for Android: the constructor exists but refuses to be called.
    if (throws) throw new TypeError('Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead.')
    shown.push({ title, opts })
  }) as unknown as typeof Notification
  Object.assign(N, { permission: 'granted' })
  return { N, shown }
}

function install(opts: { throws?: boolean; registration?: { showNotification: ReturnType<typeof vi.fn> } | null } = {}) {
  const { N, shown } = fakeNotification(opts.throws)
  vi.stubGlobal('Notification', N)
  vi.stubGlobal('window', { Notification: N })
  vi.stubGlobal('navigator', {
    serviceWorker: opts.registration === undefined
      ? undefined
      : { getRegistration: vi.fn(async () => opts.registration ?? undefined) },
  })
  return shown
}

const spot = (id: string): Location => ({ id, name: id, lat: 56, lon: 12 })
/** A window on a local calendar day (UTC-midnight encoding, as scoring makes them). */
const win = (id: string, score: number, from: string, to = '10:00', day = 16): ScoredWindow => ({
  location: spot(id), date: new Date(Date.UTC(2026, 5, day)), from, to, score,
  noData: false, bestHourStr: null, tags: [],
})

beforeEach(() => {
  // 15 June 2026, 20:00 in Copenhagen (CEST, UTC+2).
  vi.useFakeTimers({ now: new Date(2026, 5, 15, 20, 0) })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('scheduleWindowNotifications', () => {
  // Window 05:30–10:00: parseInt('05:30') dropped the minutes, so the reminder
  // promised "30 min before" fired at 04:30 — an hour early.
  it('fires 30 min before a start that is not on the hour', async () => {
    const shown = install()
    scheduleWindowNotifications([win('A', 80, '05:30')])
    await vi.advanceTimersToNextTimerAsync()
    expect(shown).toHaveLength(1)
    expect(Date.now()).toBe(new Date(2026, 5, 16, 5, 0).getTime())
  })

  // Same slot at three spots: one tag, so each notification replaced the last
  // and the one left on screen was the 3rd-best spot.
  it('sends one reminder per slot, naming the best spot', async () => {
    const shown = install()
    const n = scheduleWindowNotifications([win('C', 66, '05:00'), win('A', 85, '05:00'), win('B', 74, '05:00')])
    expect(n).toBe(1)
    await vi.runAllTimersAsync()
    expect(shown).toHaveLength(1)
    expect(shown[0].opts.body).toMatch(/^A · 05:00–10:00/)
    expect(shown[0].opts.body).toContain('+2')
  })

  it('counts slots, not spots, toward the limit of three', async () => {
    const shown = install()
    const n = scheduleWindowNotifications([
      win('A', 85, '05:00'), win('B', 80, '05:00'),
      win('A', 70, '17:00', '21:00', 15 + 1), win('C', 75, '12:00', '14:00'),
      win('D', 60, '06:00', '08:00'),
    ])
    expect(n).toBe(3)
    await vi.runAllTimersAsync()
    const tags = shown.map((s) => s.opts.tag)
    expect(new Set(tags).size).toBe(3)
  })

  // Chrome for Android: `new Notification()` throws "Illegal constructor", so
  // every reminder vanished while the toggle still said they were on.
  it('shows through the service worker when one is registered', async () => {
    const showNotification = vi.fn(async () => {})
    const shown = install({ throws: true, registration: { showNotification } })
    scheduleWindowNotifications([win('A', 80, '05:00')])
    await vi.runAllTimersAsync()
    expect(showNotification).toHaveBeenCalledTimes(1)
    expect((showNotification.mock.calls[0] as unknown[])[1]).toMatchObject({ tag: expect.any(String) })
    expect(shown).toHaveLength(0)
  })

  it('a refused notification is logged, not thrown out of the timer', async () => {
    install({ throws: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    scheduleWindowNotifications([win('A', 80, '05:00')])
    await expect(vi.runAllTimersAsync()).resolves.not.toThrow()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  // Sign-out or deleting the last slot hands the scheduler an empty list; the
  // old timers must not survive it with the previous account's spot names.
  it('an empty list cancels what was scheduled', async () => {
    const shown = install()
    scheduleWindowNotifications([win('A', 80, '05:00')])
    scheduleWindowNotifications([])
    await vi.runAllTimersAsync()
    expect(shown).toHaveLength(0)
  })
})
