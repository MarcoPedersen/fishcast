import { describe, it, expect, vi } from 'vitest'
// @ts-ignore — no @types/node in this project; vitest runs in Node. (Vite
// refuses an import of a script in public/, which it copies to dist/ as is.)
import { readFileSync } from 'node:fs'

/**
 * Tapping a reminder did nothing. In production every reminder is shown
 * through the service worker (notifications.ts), and the worker vite-plugin-pwa
 * generates had no notificationclick handler, so a tap neither brought an open
 * FishCast forward nor opened it. public/sw-notify.js is that handler: the
 * generated worker loads it (vite.config.ts, workbox.importScripts).
 */
const read = (path: string): string => {
  try { return readFileSync(new URL(path, import.meta.url), 'utf8') } catch { return '' }
}
const worker = read('../../public/sw-notify.js')
const viteConfig = read('../../vite.config.ts')

const SCOPE = 'https://example.github.io/fishcast/v2/'
const DASHBOARD = SCOPE + '#/dashboard'

interface FakeWindow { url: string; focused: boolean; visibilityState: string; focus: ReturnType<typeof vi.fn> }
const win = (url: string, opts: { focused?: boolean; visible?: boolean; refuses?: boolean } = {}): FakeWindow => {
  const w: FakeWindow = {
    url, focused: !!opts.focused, visibilityState: opts.visible ? 'visible' : 'hidden',
    focus: vi.fn(async () => { if (opts.refuses) throw new Error('InvalidAccessError'); return w }),
  }
  return w
}

/** Runs the script as the worker would, against a fake `self`. */
function load(windows: FakeWindow[] = []) {
  const listeners: Record<string, (e: unknown) => void> = {}
  const clients = {
    matchAll: vi.fn(async () => windows),
    openWindow: vi.fn(async (url: string) => ({ url })),
  }
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => { listeners[type] = fn },
    clients,
    registration: { scope: SCOPE },
  }
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const api = new Function('self', `${worker}\n;return typeof fishcastReminderTap === 'undefined' ? undefined : fishcastReminderTap`)(self)
  return { listeners, clients, api }
}

/** A tap on a reminder carrying `data`; resolves when the worker is done with it. */
async function tap(listeners: Record<string, (e: unknown) => void>, data?: unknown) {
  let work: Promise<unknown> = Promise.resolve()
  const close = vi.fn()
  listeners.notificationclick?.({ notification: { data, close }, waitUntil: (p: Promise<unknown>) => { work = p } })
  await work
  return { close }
}

describe('a tap on a reminder', () => {
  it('ships with the app and is loaded by the generated service worker', () => {
    expect(worker).toMatch(/addEventListener\('notificationclick'/)
    expect(viteConfig).toMatch(/importScripts:\s*\['sw-notify\.js'\]/)
  })

  it('opens FishCast at the dashboard when no FishCast window is open', async () => {
    const { listeners, clients } = load()
    const { close } = await tap(listeners, { url: '/fishcast/v2/#/dashboard' })
    expect(close).toHaveBeenCalled()
    expect(clients.openWindow).toHaveBeenCalledWith(DASHBOARD)
  })

  it('brings an open FishCast window forward instead of opening another', async () => {
    const open = win(SCOPE + '#/log')
    const { listeners, clients } = load([open])
    await tap(listeners, { url: '/fishcast/v2/#/dashboard' })
    expect(open.focus).toHaveBeenCalled()
    expect(clients.openWindow).not.toHaveBeenCalled()
  })

  it('asks for every window, also one the worker does not control yet', async () => {
    const { listeners, clients } = load()
    await tap(listeners)
    expect(clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true })
  })

  // The old app lives at /fishcast/ on the same origin: it is not FishCast v2.
  it('leaves another app on the same site alone', async () => {
    const v1 = win('https://example.github.io/fishcast/#/', { focused: true })
    const { listeners, clients } = load([v1])
    await tap(listeners)
    expect(v1.focus).not.toHaveBeenCalled()
    expect(clients.openWindow).toHaveBeenCalledWith(DASHBOARD)
  })

  it('prefers the window in use, then a visible one', async () => {
    const a = win(SCOPE + '#/'), b = win(SCOPE + '#/dashboard', { visible: true }), c = win(SCOPE + '#/log', { focused: true })
    const { api } = load()
    expect(api?.plan([a, b, c], undefined, SCOPE).focus).toBe(c)
    expect(api?.plan([a, b], undefined, SCOPE).focus).toBe(b)
    expect(api?.plan([a], undefined, SCOPE).focus).toBe(a)
  })

  it('opens a new window when the open one cannot be brought forward', async () => {
    const stuck = win(SCOPE, { refuses: true })
    const { listeners, clients } = load([stuck])
    await tap(listeners)
    expect(clients.openWindow).toHaveBeenCalledWith(DASHBOARD)
  })

  it('goes where the reminder says inside the app, and to the dashboard otherwise', () => {
    const { api } = load()
    expect(api?.target({ url: '/fishcast/v2/#/log' }, SCOPE)).toBe(SCOPE + '#/log')
    expect(api?.target(undefined, SCOPE)).toBe(DASHBOARD)
    expect(api?.target({}, SCOPE)).toBe(DASHBOARD)
    expect(api?.target({ url: 'https://elsewhere.example/' }, SCOPE)).toBe(DASHBOARD)
    expect(api?.target({ url: '/fishcast/' }, SCOPE)).toBe(DASHBOARD)
  })
})
