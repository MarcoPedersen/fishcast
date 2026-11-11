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
const boot = vi.hoisted(() => ({ mounts: [] as string[], text: (): string => '', listening: false }))
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
  createUpdater: () => ({ leaving: () => false, resumed() {}, focused() {}, touch() {}, tick() {} }),
  nothingToLose: () => true,
}))
vi.mock('./lib/osmTiles', () => ({ dropOldTileCache: async () => {} }))

type Pending = { arrive: () => void; fail: (e: Error) => void }
let fetches: Pending[]
let stopInterval: () => void

beforeEach(() => {
  boot.mounts = []
  boot.listening = false
  fetches = []
  vi.doMock('./lib/strings.en', () => new Promise((resolve, reject) => {
    fetches.push({ arrive: () => resolve({ STRINGS_EN: { close: 'Close' } }), fail: reject })
  }))
  vi.stubGlobal('window', { addEventListener() {}, location: { hash: '' } })
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
