import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Load Vue once up front, with no `document`: runtime-dom probes it at import.
import 'vue'

/**
 * main.ts boots the app as it loads. The English strings are a chunk of their
 * own (lib/i18n.ts), so for a user who picked English the first render waits
 * for them — or the whole app appeared in Danish and then flipped — but only
 * a short while: a slow or failed fetch must never keep the app from showing.
 *
 * What main.ts wires up besides is stood in for; the app's mount records the
 * text t() gives at that moment.
 */
const boot = vi.hoisted(() => ({
  mounts: [] as string[], text: (): string => '', listening: false,
  /** What the updater stand-in was told of chunks gone, and what it answers. */
  gone: [] as (() => boolean)[], reloadsNow: false,
}))
vi.mock('vue', async (orig) => {
  const real = await orig<typeof import('vue')>()
  return {
    ...real,
    createApp: (...args: Parameters<typeof real.createApp>) => {
      const app = real.createApp(...args)
      app.mount = (() => { boot.mounts.push(boot.text()) }) as unknown as typeof app.mount
      return app
    },
  }
})
vi.mock('./App.vue', () => ({ default: { render: () => null } }))
vi.mock('./router', () => ({
  default: {
    install() {}, onError() {}, beforeEach() {},
    resolve: (p: string) => ({ href: p }), currentRoute: { value: { name: 'welcome' } },
  },
}))
vi.mock('./stores/auth', () => ({ useAuthStore: () => ({ init: async () => {}, user: null, recovering: false }) }))
vi.mock('./stores/setup', () => ({ useSetupStore: () => ({ loadLocal() {} }) }))
vi.mock('./stores/catches', () => ({ useCatchStore: () => ({ loadLocal() {} }) }))
vi.mock('./stores/session', () => ({ session: { listen() { boot.listening = true }, hydrateFor: async () => {} } }))
vi.mock('./lib/swUpdate', () => ({
  createUpdater: () => ({
    leaving: () => false, resumed() {}, focused() {}, touch() {}, tick() {},
    chunkGone: (stillWanted: () => boolean) => { boot.gone.push(stillWanted); return boot.reloadsNow },
  }),
  nothingToLose: () => true,
}))
vi.mock('./lib/osmTiles', () => ({ dropOldTileCache: async () => {} }))

type Pending = { arrive: () => void; fail: (e: Error) => void }
let fetches: Pending[]
let stopInterval: () => void
/** The listeners main.ts (and i18n) put on window, by event type. */
let winOn: Record<string, ((e: unknown) => void)[]>

beforeEach(() => {
  boot.mounts = []
  boot.listening = false
  boot.gone = []
  boot.reloadsNow = false
  fetches = []
  winOn = {}
  vi.doMock('./lib/strings.en', () => new Promise((resolve, reject) => {
    fetches.push({ arrive: () => resolve({ STRINGS_EN: { close: 'Close' } }), fail: reject })
  }))
  vi.stubGlobal('window', {
    addEventListener: (type: string, fn: (e: unknown) => void) => { (winOn[type] ??= []).push(fn) },
    location: { hash: '' },
  })
  vi.stubGlobal('document', { addEventListener() {}, visibilityState: 'visible', documentElement: { lang: 'da' } })
  vi.stubGlobal('navigator', {})
  // main.ts's 5-minute update check: not left running after the test.
  const intervals: ReturnType<typeof setInterval>[] = []
  const realSetInterval = globalThis.setInterval
  vi.stubGlobal('setInterval', (...a: Parameters<typeof setInterval>) => { const id = realSetInterval(...a); intervals.push(id); return id })
  stopInterval = () => { for (const id of intervals) clearInterval(id) }
})
afterEach(() => {
  stopInterval()
  vi.doUnmock('./lib/strings.en')
  vi.unstubAllGlobals()
  localStorage.removeItem('fc2-lang')
})

async function start(saved: 'da' | 'en') {
  localStorage.setItem('fc2-lang', saved)
  vi.resetModules()
  const i18n = await import('./lib/i18n')
  boot.text = () => i18n.t('close')
  await import('./main')
  return i18n
}
const settle = (ms = 50) => new Promise((r) => setTimeout(r, ms))

describe('the first render', () => {
  it('waits for the English table when the saved language is English', async () => {
    const i18n = await start('en')
    await settle(200)
    expect(fetches).toHaveLength(1)
    expect(boot.mounts).toEqual([])
    fetches[0].arrive()
    await vi.waitFor(() => expect(boot.mounts).toEqual(['Close']))
    expect(i18n.t('close')).toBe('Close')
  })

  it('does not wait long: a table still on its way shows Danish, and English follows', async () => {
    const i18n = await start('en')
    await settle(200)
    expect(boot.mounts).toEqual([])
    await vi.waitFor(() => expect(boot.mounts).toEqual(['Luk']), { timeout: 3000 })
    fetches[0].arrive()
    await vi.waitFor(() => expect(i18n.t('close')).toBe('Close'))
  })

  it('does not wait for a table that failed', async () => {
    await start('en')
    await settle()
    fetches[0].fail(new Error('Failed to fetch dynamically imported module: https://example.test/assets/strings.en-x.js'))
    await vi.waitFor(() => expect(boot.mounts).toHaveLength(1), { timeout: 500 })
    expect(boot.mounts).toEqual(['Luk'])
  })

  it('waits for nothing in Danish, which fetches no English', async () => {
    await start('da')
    await vi.waitFor(() => expect(boot.mounts).toEqual(['Luk']), { timeout: 500 })
    expect(fetches).toHaveLength(0)
  })
})

/**
 * Another tab's save is reloaded into this one (session.listen), or this
 * tab's first edit writes its stale copy over it: for a guest, whose log and
 * spots live only in this browser, that edit is then gone. The stores are
 * loaded before the wait for the English table, so the wait (up to a second)
 * must not be a moment in which another tab's save goes unheard.
 */
describe('while the first render waits for English', () => {
  it("another tab's saves are already listened for", async () => {
    await start('en')
    await settle(200)
    expect(boot.mounts).toEqual([]) // still waiting
    expect(boot.listening).toBe(true)
    fetches[0].arrive()
    await vi.waitFor(() => expect(boot.mounts).toEqual(['Close']))
  })
})

/**
 * Review (round B): a failed English table fired the same reload as a
 * screen's missing chunk, mid-edit too — the catch log's form, an open
 * dialog, a Fortryd on screen were lost — and offline, with no service
 * worker, it landed on the browser's offline page. A screen's chunk still
 * reloads at once (the user is moving to it); English waits for a moment
 * when nothing can be lost (swUpdate.ts chunkGone), and says so meanwhile.
 */
describe('a chunk that fails to load', () => {
  let reloads: number
  beforeEach(() => {
    reloads = 0
    vi.stubGlobal('location', { reload: () => { reloads++ } })
    const kept: Record<string, string> = {}
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => kept[k] ?? null, setItem: (k: string, v: string) => { kept[k] = v } })
  })
  /** What Vite's preload wrapper does when an import fails. */
  const preloadError = async (payload: unknown) => {
    for (const fn of winOn['vite:preloadError'] ?? []) fn({ payload })
    await settle()
  }
  const englishFails = async (i18n: typeof import('./lib/i18n')) => {
    i18n.setLang('en')
    await settle()
    const err = new Error('Importing a module script failed.')
    fetches[fetches.length - 1].fail(err)
    await settle()
    return err
  }

  it("reloads at once for a screen's chunk", async () => {
    await start('da')
    await preloadError(new Error('Failed to fetch dynamically imported module: https://example.test/assets/CatchLogView-x.js'))
    expect(reloads).toBe(1)
    expect(boot.gone).toHaveLength(0)
  })

  // The order the build has (Vite 6.4.3's preload helper, run as built): the
  // wrapper fires vite:preloadError from its own catch, synchronously, and
  // only then rethrows to i18n's rejection handler. So when the listener runs
  // i18n has not yet seen its import fail; the tests below fire the event
  // after it has. Only main.ts's deferral tells the two apart — without it an
  // English failure reloaded at once, as before the change.
  it('tells English from a screen’s chunk though the event comes before i18n sees the failure', async () => {
    const i18n = await start('da')
    i18n.setLang('en')
    await settle()
    const err = new Error('Importing a module script failed.')
    fetches[0].fail(err)
    for (const fn of winOn['vite:preloadError'] ?? []) fn({ payload: err }) // before any rejection handler
    await settle()
    expect(reloads).toBe(0)
    expect(boot.gone).toHaveLength(1)
  })

  it('leaves English to the updater, which reloads only when nothing can be lost', async () => {
    const i18n = await start('da')
    const { toasts } = await import('./lib/toast')
    boot.reloadsNow = true
    await preloadError(await englishFails(i18n))
    expect(reloads).toBe(0) // not main.ts's own reload: the updater's (stand-in) did it
    expect(boot.gone).toHaveLength(1)
    expect(boot.gone[0]()).toBe(true) // English still wanted
    expect(toasts.value).toEqual([])
  })

  it('says English comes later when the reload has to wait', async () => {
    const i18n = await start('da')
    const { toasts } = await import('./lib/toast')
    await preloadError(await englishFails(i18n))
    expect(reloads).toBe(0)
    expect(toasts.value.map((x) => x.message)).toEqual([i18n.t('lang_en_later')])
    // English that arrives meanwhile, or Danish again, needs no reload.
    i18n.setLang('da')
    expect(boot.gone[0]()).toBe(false)
  })

  it('says it comes when the connection does, offline', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const i18n = await start('da')
    const { toasts } = await import('./lib/toast')
    await preloadError(await englishFails(i18n))
    expect(reloads).toBe(0)
    expect(toasts.value.map((x) => x.message)).toEqual([i18n.t('lang_en_offline')])
  })
})
