// Window start times are local wall-clock hours; pin the zone so "04:30" means
// the same instant on every machine. (No @types/node — declare just this bit.)
declare const process: { env: Record<string, string | undefined> }
process.env.TZ = 'Europe/Copenhagen'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Location, ScoredWindow } from './types'
import { enableNotifications, reminderNote, scheduleWindowNotifications } from './notifications'
import { STRINGS } from './strings'

/** A Notification constructor that records what it was asked to show. */
function fakeNotification(throws = false) {
  const shown: { title: string; opts: NotificationOptions; n: { onclick?: () => void; close: () => void } }[] = []
  const N = vi.fn(function (this: { onclick?: () => void; close: () => void }, title: string, opts: NotificationOptions) {
    // Chrome for Android: the constructor exists but refuses to be called.
    if (throws) throw new TypeError('Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead.')
    this.close = vi.fn()
    shown.push({ title, opts, n: this })
  }) as unknown as typeof Notification
  Object.assign(N, { permission: 'granted' })
  return { N, shown }
}

function install(opts: { throws?: boolean; registration?: { showNotification: ReturnType<typeof vi.fn> } | null } = {}) {
  const { N, shown } = fakeNotification(opts.throws)
  vi.stubGlobal('Notification', N)
  vi.stubGlobal('window', { Notification: N, focus: vi.fn() })
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

  it('says "1 more spot" in the singular', async () => {
    const shown = install()
    scheduleWindowNotifications([win('A', 85, '05:00'), win('B', 74, '05:00')])
    await vi.runAllTimersAsync()
    expect(shown[0].opts.body).toMatch(/\+1 andet sted$/)
  })

  // 25 Oct 2026 has 25 hours. App re-arms at each local midnight, and a 24 h
  // look-ahead from 00:00 that day stopped at 23:00 — the next midnight's
  // re-arm then saw the 23:15 and 23:45 reminders as already past.
  it('looks ahead to the same time tomorrow on the 25-hour day', async () => {
    vi.setSystemTime(new Date(2026, 9, 25, 0, 0, 20))
    install()
    const oct = (w: ScoredWindow, day: number): ScoredWindow => ({ ...w, date: new Date(Date.UTC(2026, 9, day)) })
    const n = scheduleWindowNotifications([
      oct(win('A', 80, '23:45', '01:00'), 25), // reminder 25 Oct 23:15
      oct(win('B', 80, '00:15', '03:00'), 26), // reminder 25 Oct 23:45
      oct(win('C', 80, '01:00', '03:00'), 26), // reminder 26 Oct 00:30: the next re-arm's
    ])
    expect(n).toBe(2)
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

  // A tap on a reminder opens the app at the dashboard or brings it forward
  // (public/sw-notify.js); the reminder says where, under the app's base path.
  it('carries where a tap takes the user: the dashboard', async () => {
    const showNotification = vi.fn(async () => {})
    install({ registration: { showNotification } })
    scheduleWindowNotifications([win('A', 80, '05:00')])
    await vi.runAllTimersAsync()
    expect((showNotification.mock.calls[0] as unknown[])[1]).toMatchObject({ data: { url: '/fishcast/v2/#/dashboard' } })
  })

  // With no service worker (not registered yet, or none in this browser) the
  // page shows the reminder itself, and a click on it did nothing either.
  it('a reminder the page shows itself brings the page forward when clicked', async () => {
    const shown = install()
    scheduleWindowNotifications([win('A', 80, '05:00')])
    await vi.runAllTimersAsync()
    expect(shown[0].n.onclick).toBeTypeOf('function')
    shown[0].n.onclick?.()
    expect((window as unknown as { focus: ReturnType<typeof vi.fn> }).focus).toHaveBeenCalled()
    expect(shown[0].n.close).toHaveBeenCalled()
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

  // Permission revoked in the browser after reminders were armed: the next
  // rescheduling must cancel them, not return before it gets that far.
  it('a revoked permission cancels what was scheduled', async () => {
    const shown = install()
    scheduleWindowNotifications([win('A', 80, '05:00')])
    Object.assign(Notification, { permission: 'denied' })
    expect(scheduleWindowNotifications([win('A', 80, '05:00')])).toBe(0)
    await vi.runAllTimersAsync()
    expect(shown).toHaveLength(0)
  })
})

/**
 * "🔔 Påmindelser" with notifications blocked did nothing at all: no message,
 * no change, a dead button. And turned on, nothing said the reminders are
 * timers in the page, which fire only while FishCast is open.
 */
describe('turning reminders on', () => {
  afterEach(() => { localStorage.removeItem('fc2-notifs') })

  function browser(permission: NotificationPermission, answer: NotificationPermission = permission) {
    const requestPermission = vi.fn(async () => answer)
    const N = Object.assign(function () {}, { permission, requestPermission })
    vi.stubGlobal('Notification', N)
    vi.stubGlobal('window', { Notification: N })
    return requestPermission
  }

  it('is on once the user allows it', async () => {
    browser('default', 'granted')
    expect(await enableNotifications()).toBe('on')
    expect(localStorage.getItem('fc2-notifs')).toBe('1')
  })

  it('says blocked when the user blocks it', async () => {
    browser('default', 'denied')
    expect(await enableNotifications()).toBe('denied')
    expect(localStorage.getItem('fc2-notifs')).toBeNull()
  })

  it('says blocked without asking when the browser already blocks it', async () => {
    const ask = browser('denied')
    expect(await enableNotifications()).toBe('denied')
    expect(ask).not.toHaveBeenCalled()
  })

  it('tells a closed prompt from a block', async () => {
    browser('default', 'default')
    expect(await enableNotifications()).toBe('dismissed')
  })

  it('says when the browser has no notifications', async () => {
    vi.stubGlobal('window', {})
    expect(await enableNotifications()).toBe('unsupported')
  })

  it('has something to say for every outcome, and "on" says they come only while the app is open', () => {
    for (const o of ['on', 'denied', 'dismissed', 'unsupported'] as const) expect(reminderNote(o), o).toMatch(/\S/)
    expect(reminderNote('on')).toBe(STRINGS.da.notif_on_open_only)
    expect(STRINGS.da.notif_on_open_only).toMatch(/kun mens FishCast er åben/)
    expect(STRINGS.en.notif_on_open_only).toMatch(/only while FishCast is open/)
  })

  // On an iPhone, Safari has no notifications until FishCast is added to the
  // Home Screen (iOS 16.4+), and an installed app has no address bar whose
  // icon the "blocked" advice pointed at.
  it('the advice fits an iPhone and an installed app', () => {
    expect(STRINGS.da.notif_unsupported).toMatch(/iPhone[\s\S]*hjemmeskærmen/)
    expect(STRINGS.en.notif_unsupported).toMatch(/iPhone[\s\S]*Home Screen/)
    expect(STRINGS.da.notif_denied).not.toMatch(/adresse/)
    expect(STRINGS.en.notif_denied).not.toMatch(/address/)
    expect(STRINGS.da.notif_denied).toMatch(/telefonens indstillinger/)
    expect(STRINGS.en.notif_denied).toMatch(/phone/)
  })

  it('the bell shows it after every tap that turns reminders on or fails to', () => {
    const app = Object.values(import.meta.glob<string>('/src/App.vue', { query: '?raw', import: 'default', eager: true }))[0]
    expect(app).toMatch(/const r = await enableNotifications\(\)[\s\S]{0,400}showToast\(reminderNote\(r\)/)
  })
})
