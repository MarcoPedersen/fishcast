import { describe, it, expect, vi } from 'vitest'
import { CHECK_EVERY_MS, GRACE_MS, createUpdater, nothingToLose, type UpdateHost } from './swUpdate'

/**
 * Regression — the service worker auto-updates (skipWaiting + clientsClaim),
 * but nothing on the page acted on it: the worker script was registered bare.
 * A new build's worker took over an open page, which kept running the old
 * build until a chunk it hadn't loaded yet 404'd (staleChunk.ts) — or for
 * good, while the old chunks still sat in the HTTP cache. A cold start after a
 * deploy ran the old build from the old precache, and a PWA resumed from the
 * background never asked for an update. A regulations change or a scoring fix
 * reached the phone a launch late, or later.
 */
function setup(opts: { controlled?: boolean; idle?: boolean; reloadOk?: boolean } = {}) {
  let t = 1_000_000
  const listeners: (() => void)[] = []
  const update = vi.fn(async () => {})
  const reload = vi.fn((_path?: string) => opts.reloadOk ?? true)
  const state = { idle: opts.idle ?? true }
  const host: UpdateHost = {
    sw: {
      controller: opts.controlled === false ? null : {},
      addEventListener: (_type, fn) => { listeners.push(fn) },
      getRegistration: async () => ({ update }),
    },
    now: () => t,
    idle: () => state.idle,
    reload,
  }
  const u = createUpdater(host)
  return {
    u, update, reload, state,
    advance: (ms: number) => { t += ms },
    /** The new build's worker takes control of this page. */
    takeOver: () => listeners.forEach((fn) => fn()),
  }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('a new build taking over an open page', () => {
  it('reloads into it at once when it lands just after the app opened, before any touch', () => {
    const s = setup()
    s.advance(GRACE_MS - 1000)
    s.takeOver()
    expect(s.reload).toHaveBeenCalledWith()
  })

  it('never reloads for the first install, which claims a page no worker controlled', () => {
    const s = setup({ controlled: false })
    s.takeOver()
    expect(s.reload).not.toHaveBeenCalled()
    expect(s.u.updateReady).toBe(false)
    s.takeOver() // a real update later in the same visit
    expect(s.reload).toHaveBeenCalledTimes(1)
  })

  it('waits once the user has touched the page, or the grace is over: the next screen loads from the new build', () => {
    for (const late of [(s: ReturnType<typeof setup>) => s.u.touch(), (s: ReturnType<typeof setup>) => s.advance(GRACE_MS + 1)]) {
      const s = setup()
      late(s)
      s.takeOver()
      expect(s.reload).not.toHaveBeenCalled()
      expect(s.u.updateReady).toBe(true)
      expect(s.u.leaving('/log')).toBe(true)
      expect(s.reload).toHaveBeenCalledWith('/log')
    }
  })

  it('never reloads with a dialog open or a field being typed in, even just after opening', () => {
    const s = setup({ idle: false })
    s.takeOver()
    expect(s.reload).not.toHaveBeenCalled()
  })

  it('lets a screen change go ahead when there is nothing new, or a reload just happened', () => {
    expect(setup().u.leaving('/log')).toBe(false)
    const s = setup({ reloadOk: false })
    s.u.touch()
    s.takeOver()
    expect(s.u.leaving('/log')).toBe(false)
  })
})

describe('coming back to the app', () => {
  it('applies a build that took over meanwhile, when nothing would be lost', () => {
    const s = setup()
    s.u.touch()
    s.takeOver()
    s.state.idle = false
    s.u.resumed()
    expect(s.reload).not.toHaveBeenCalled() // a dialog is open: the next screen change, then
    s.state.idle = true
    s.u.resumed()
    expect(s.reload).toHaveBeenCalledWith()
  })

  it('opens a fresh grace: a build found on the way back reloads before the first touch', () => {
    const s = setup()
    s.u.touch()
    s.advance(3 * CHECK_EVERY_MS)
    s.u.resumed()
    s.advance(4000)
    s.takeOver()
    expect(s.reload).toHaveBeenCalledWith()
  })

  it('looks for a new build, at most hourly', async () => {
    const s = setup()
    s.u.resumed() // the page load itself just checked
    s.u.focused()
    await flush()
    expect(s.update).not.toHaveBeenCalled()
    s.advance(CHECK_EVERY_MS)
    s.u.resumed()
    s.u.focused()
    await flush()
    expect(s.update).toHaveBeenCalledTimes(1)
  })

  it('looks hourly while the app stays visible', async () => {
    const s = setup()
    s.advance(CHECK_EVERY_MS)
    s.u.tick()
    await flush()
    expect(s.update).toHaveBeenCalledTimes(1)
  })

  it('shrugs off a check that fails, and a browser with no service worker', async () => {
    const s = setup()
    s.update.mockRejectedValueOnce(new Error('offline'))
    s.advance(CHECK_EVERY_MS)
    s.u.tick()
    await flush()
    const none = createUpdater({ now: () => 0, idle: () => true, reload: () => true })
    expect(() => { none.resumed(); none.tick(); none.focused() }).not.toThrow()
    expect(none.leaving('/log')).toBe(false)
  })
})

describe('nothing to lose', () => {
  const doc = (o: { dialog?: boolean; focus?: string } = {}) => ({
    querySelector: (sel: string) => (sel === '[aria-modal="true"]' && o.dialog ? {} : null),
    activeElement: { matches: (sel: string) => !!o.focus && sel.split(',').map((x) => x.trim()).includes(o.focus) },
  })

  it('on a screen with nothing open and no field in use', () => {
    expect(nothingToLose(doc(), 'dashboard')).toBe(true)
    expect(nothingToLose(doc({ focus: 'button' }), 'locations')).toBe(true)
  })

  it('never with a dialog open, a field in use, or on a form screen', () => {
    expect(nothingToLose(doc({ dialog: true }), 'dashboard')).toBe(false)
    expect(nothingToLose(doc({ focus: 'input' }), 'locations')).toBe(false)
    expect(nothingToLose(doc({ focus: 'textarea' }), 'locations')).toBe(false)
    expect(nothingToLose(doc(), 'catchlog')).toBe(false) // its form is inline, not a dialog
    expect(nothingToLose(doc(), 'auth')).toBe(false)
  })
})

describe('the app wiring', () => {
  const main = Object.values(import.meta.glob<string>('/src/main.ts', { query: '?raw', import: 'default', eager: true }))[0] ?? ''

  it('builds the updater, and asks it before every move to another screen', () => {
    expect(main).toContain('createUpdater(')
    expect(main).toContain('updater.leaving(to.fullPath)')
    expect(main).toContain('updater.resumed()')
    expect(main).toContain('updater.tick()')
  })

  /**
   * Refused (false), a navigation started by Back makes vue-router step
   * forward through history again to undo it — racing the reload. Held with a
   * promise that never settles, it simply ends with the page.
   */
  it('holds the move to another screen while the page reloads, never refuses it', () => {
    expect(main).toContain('updater.leaving(to.fullPath) ? new Promise<never>(() => {}) : true')
  })
})
