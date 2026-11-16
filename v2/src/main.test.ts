import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
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
  /** The auth store stand-in: one object, as Pinia's store is. */
  auth: { init: async () => {}, user: null, recovering: false },
  /** When set, main.ts gets the real updater (kept here), not the stand-in. */
  realUpdater: false, updater: null as null | { leaving(path: string): boolean },
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
vi.mock('./stores/auth', () => ({ useAuthStore: () => boot.auth }))
vi.mock('./stores/setup', () => ({ useSetupStore: () => ({ loadLocal() {} }) }))
vi.mock('./stores/catches', () => ({ useCatchStore: () => ({ loadLocal() {} }) }))
vi.mock('./stores/session', () => ({ session: { listen() { boot.listening = true }, hydrateFor: async () => {} } }))
vi.mock('./lib/swUpdate', async (orig) => {
  const real = await orig<typeof import('./lib/swUpdate')>()
  return {
    createUpdater: (host: Parameters<typeof real.createUpdater>[0]) => boot.realUpdater ? (boot.updater = real.createUpdater(host)) : ({
      leaving: () => false, resumed() {}, focused() {}, touch() {}, tick() {},
      chunkGone: (stillWanted: () => boolean) => { boot.gone.push(stillWanted); return boot.reloadsNow },
    }),
    nothingToLose: () => true,
  }
})
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
  boot.auth = { init: async () => {}, user: null, recovering: false }
  boot.realUpdater = false
  boot.updater = null
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
/** auth-js's key for the session (lib/authStorage keeps it under any key it is given). */
const SESSION_KEY = 'sb-fishcast-test-auth-token'
/** A device with no room left: every write refused, until mockRestore or the test's end. */
function deviceFull() {
  const full = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
  onTestFinished(() => { full.mockRestore(); localStorage.removeItem(SESSION_KEY) })
  return full
}

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

  // Each event is looked at a tick later. When a second English failure is in
  // before the first one's turn (a tap or 'online' queued ahead of the timer,
  // and a retry that fails at once), the first must still read as English.
  it('a second English failure before the first one’s turn does not make the first a screen’s chunk', async () => {
    const i18n = await start('da')
    const first = await englishFails(i18n)
    const second = await englishFails(i18n)
    await preloadError(first)
    await preloadError(second)
    expect(reloads).toBe(0)
    expect(boot.gone).toHaveLength(2)
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

  // 🇬🇧, then 🇩🇰 while the table is on its way (nothing seemed to happen),
  // and then it fails: no reload is coming for it, so "it comes once the app
  // can reload" told the Danish user of one that never came.
  it('says nothing of English to a user back in Danish', async () => {
    const i18n = await start('da')
    const { toasts } = await import('./lib/toast')
    i18n.setLang('en')
    await settle()
    i18n.setLang('da')
    const err = new Error('Importing a module script failed.')
    fetches[0].fail(err)
    await settle()
    await preloadError(err)
    expect(reloads).toBe(0)
    expect(toasts.value).toEqual([])
  })

  // A deploy whose English chunk is missing for good (or a network that fails
  // while the browser says it's online): the reload brings a page whose own
  // English fails again, a moment after the reload. Armed again, the updater
  // reloaded at the first move to another screen a minute on, and again, and
  // again — 11 reloads in 10 minutes of moving between screens every 20 s,
  // each with "it comes once the app can reload" (scratch probe-cycle). The
  // reload just made didn't bring English, and another won't: say so instead.
  it('does not wait for another reload when the one a moment ago did not bring English', async () => {
    sessionStorage.setItem('fc2-chunk-reload', String(Date.now() - 5000)) // the reload that loaded this page
    const i18n = await start('en')
    const { toasts } = await import('./lib/toast')
    await settle()
    const err = new Error('Importing a module script failed.')
    fetches[0].fail(err)
    await settle()
    await preloadError(err)
    expect(reloads).toBe(0)
    expect(boot.gone).toHaveLength(0)
    expect(toasts.value.map((x) => x.message)).toEqual([i18n.t('lang_en_failed')])
    expect(i18n.t('lang_en_failed')).not.toBe('lang_en_failed')
  })

  // English that arrives after all (i18n tries again when the connection
  // comes back): the toast stood for its 6 s, now in English, saying English
  // couldn't be loaded over a page that was English again.
  it('takes its toast down once English arrives after all', async () => {
    sessionStorage.setItem('fc2-chunk-reload', String(Date.now() - 5000))
    const i18n = await start('en')
    const { toasts } = await import('./lib/toast')
    await settle()
    const err = new Error('Importing a module script failed.')
    fetches[0].fail(err)
    await settle()
    await preloadError(err)
    expect(toasts.value.map((x) => x.message)).toEqual([i18n.t('lang_en_failed')])
    for (const fn of winOn['online'] ?? []) fn({ type: 'online' })
    await settle()
    fetches[fetches.length - 1].arrive()
    await settle()
    expect(i18n.shownLang.value).toBe('en')
    expect(toasts.value).toEqual([])
  })

  // Offline it is the connection that failed, not the reload: English comes
  // when it is back (i18n tries again then), as without a reload just made.
  it('offline, waits for the connection even a moment after a reload', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    sessionStorage.setItem('fc2-chunk-reload', String(Date.now() - 5000))
    const i18n = await start('en')
    const { toasts } = await import('./lib/toast')
    await settle()
    const err = new Error('Importing a module script failed.')
    fetches[0].fail(err)
    await settle()
    await preloadError(err)
    expect(boot.gone).toHaveLength(1)
    expect(toasts.value.map((x) => x.message)).toEqual([i18n.t('lang_en_offline')])
  })

  // A minute on, a tap on 🇬🇧 that fails is a new try: it waits for a reload.
  it('waits for a reload again for a failure a minute after the last reload', async () => {
    sessionStorage.setItem('fc2-chunk-reload', String(Date.now() - 61_000))
    const i18n = await start('da')
    await preloadError(await englishFails(i18n))
    expect(boot.gone).toHaveLength(1)
  })
})

/**
 * Review (round E): a password-recovery link opens the app with its token in
 * the address. main.ts reads it, takes it out of the address and sets
 * auth.recovering, and the auth screen shows the new-password form. A new
 * build taking over then — just after opening, before any touch, with the
 * router not yet on the auth screen (its chunk still on its way) — reloaded
 * the page, and the form was gone with the token; the link may be single-use.
 * Here the real updater runs on main.ts's own host.
 */
describe('a password-recovery link', () => {
  it('is not reloaded away by a new build until the new password is set', async () => {
    boot.realUpdater = true
    let reloads = 0
    vi.stubGlobal('location', { reload: () => { reloads++ } })
    vi.stubGlobal('history', { replaceState() {} })
    const kept: Record<string, string> = {}
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => kept[k] ?? null, setItem: (k: string, v: string) => { kept[k] = v } })
    const takeOver: (() => void)[] = []
    vi.stubGlobal('navigator', {
      serviceWorker: { controller: {}, addEventListener: (_type: string, fn: () => void) => { takeOver.push(fn) }, getRegistration: async () => undefined },
    })
    const address = (window as unknown as { location: { hash: string } }).location
    address.hash = '#access_token=header.payload.sig&refresh_token=r1&type=recovery'
    await start('da')
    await vi.waitFor(() => expect(boot.auth.recovering).toBe(true))
    expect(address.hash).toBe('#/auth')
    takeOver.forEach((fn) => fn()) // a new build's worker takes control, within the grace
    expect(reloads).toBe(0)
    expect(boot.updater!.leaving('/dashboard')).toBe(false) // the move goes ahead, on this build
    expect(reloads).toBe(0)
    boot.auth.recovering = false // the new password is set
    expect(boot.updater!.leaving('/dashboard')).toBe(true)
    expect(reloads).toBe(1)
  })
})

/**
 * Review (round E): a chunk can fail that no tap asked for. The coast store
 * loads the spot catalogue a few seconds after a start, in the background.
 * After a deploy the old build's copy is gone once the new build's worker
 * has taken over, and main.ts reloaded at once for any chunk but English, as
 * for a screen the user is moving to. That reload dropped a password-recovery
 * link the updater now holds on to, and an edit the device refused to save
 * (stores/localSave: "the app makes none by itself then").
 */
describe('a chunk that fails in the background', () => {
  let reloads: number
  beforeEach(() => {
    boot.realUpdater = true
    reloads = 0
    vi.stubGlobal('location', { reload: () => { reloads++ } })
    vi.stubGlobal('history', { replaceState() {} })
    const kept: Record<string, string> = {}
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => kept[k] ?? null, setItem: (k: string, v: string) => { kept[k] = v } })
    vi.stubGlobal('navigator', { serviceWorker: { controller: {}, addEventListener() {}, getRegistration: async () => undefined } })
  })
  const catalogueGone = async () => {
    const err = new Error('Failed to fetch dynamically imported module: https://example.test/assets/spotCoast.gen-x.js')
    for (const fn of winOn['vite:preloadError'] ?? []) fn({ payload: err })
    await settle()
  }

  it('does not reload away a password-recovery link; the next move after the new password does', async () => {
    const address = (window as unknown as { location: { hash: string } }).location
    address.hash = '#access_token=header.payload.sig&refresh_token=r1&type=recovery'
    await start('da')
    await vi.waitFor(() => expect(boot.auth.recovering).toBe(true))
    await catalogueGone()
    expect(reloads).toBe(0)
    expect(boot.updater!.leaving('/dashboard')).toBe(false)
    boot.auth.recovering = false // the new password is set
    expect(boot.updater!.leaving('/dashboard')).toBe(true)
    expect(reloads).toBe(1)
  })

  it('does not reload away an edit the device refused to save; the next move once it is saved does', async () => {
    await start('da')
    const { useLocalSaveStore } = await import('./stores/localSave')
    const atRisk = vi.spyOn(useLocalSaveStore(), 'atRisk').mockReturnValue(true)
    await catalogueGone()
    expect(reloads).toBe(0)
    expect(boot.updater!.leaving('/log')).toBe(false)
    atRisk.mockReturnValue(false) // saved after all
    expect(boot.updater!.leaving('/log')).toBe(true)
    expect(reloads).toBe(1)
  })

  // Round E browser check: a spot's Fortryd toast, and the undo history behind
  // it (lib/undoHistory), live across every screen. The move to another
  // screen reloaded them away: the screen left takes its own state with it,
  // but not these.
  it('does not reload away a Fortryd that stands; the next move once it is gone does', async () => {
    await start('da')
    const { dismissToast, showToast, toasts } = await import('./lib/toast')
    showToast('Hornbæk: …', { key: 'water:x', action: { label: 'Fortryd', run: () => {} } })
    await catalogueGone()
    expect(reloads).toBe(0)
    expect(boot.updater!.leaving('/log')).toBe(false)
    dismissToast(toasts.value[0].id)
    expect(boot.updater!.leaving('/log')).toBe(true)
    expect(reloads).toBe(1)
  })

  // Round E review: a session the device has no room for is kept in memory
  // (lib/authStorage), and a reload signed the user out without a word.
  it('does not reload away a sign-in kept only in memory; the next move once the device holds it does', async () => {
    await start('da')
    const { authStorage } = await import('./lib/authStorage')
    const full = deviceFull()
    authStorage.setItem(SESSION_KEY, '{"refresh_token":"r1"}')
    await catalogueGone()
    expect(reloads).toBe(0)
    expect(boot.updater!.leaving('/log')).toBe(false)
    full.mockRestore() // room is made, and the next token refresh fits
    authStorage.setItem(SESSION_KEY, '{"refresh_token":"r2"}')
    expect(boot.updater!.leaving('/log')).toBe(true)
    expect(reloads).toBe(1)
    authStorage.removeItem(SESSION_KEY)
  })

  it('reloads at once with nothing only in the page, as before', async () => {
    await start('da')
    await catalogueGone()
    expect(reloads).toBe(1)
  })
})

describe('a new build while a Fortryd stands', () => {
  it('waits to reload until the Fortryd is gone, a move to another screen too', async () => {
    boot.realUpdater = true
    let reloads = 0
    vi.stubGlobal('location', { reload: () => { reloads++ } })
    vi.stubGlobal('history', { replaceState() {} })
    const kept: Record<string, string> = {}
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => kept[k] ?? null, setItem: (k: string, v: string) => { kept[k] = v } })
    const takeOver: (() => void)[] = []
    vi.stubGlobal('navigator', {
      serviceWorker: { controller: {}, addEventListener: (_type: string, fn: () => void) => { takeOver.push(fn) }, getRegistration: async () => undefined },
    })
    await start('da')
    const { dismissToast, showToast, toasts } = await import('./lib/toast')
    showToast('Hornbæk: …', { key: 'water:x', action: { label: 'Fortryd', run: () => {} } })
    takeOver.forEach((fn) => fn())
    expect(reloads).toBe(0)
    expect(boot.updater!.leaving('/dashboard')).toBe(false)
    dismissToast(toasts.value[0].id)
    expect(boot.updater!.leaving('/dashboard')).toBe(true)
    expect(reloads).toBe(1)
  })
})

describe('a new build while a sign-in lives only in memory', () => {
  it('waits to reload until the user signs out, a move to another screen too', async () => {
    boot.realUpdater = true
    let reloads = 0
    vi.stubGlobal('location', { reload: () => { reloads++ } })
    vi.stubGlobal('history', { replaceState() {} })
    const kept: Record<string, string> = {}
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => kept[k] ?? null, setItem: (k: string, v: string) => { kept[k] = v } })
    const takeOver: (() => void)[] = []
    vi.stubGlobal('navigator', {
      serviceWorker: { controller: {}, addEventListener: (_type: string, fn: () => void) => { takeOver.push(fn) }, getRegistration: async () => undefined },
    })
    await start('da')
    const { authStorage } = await import('./lib/authStorage')
    const full = deviceFull()
    authStorage.setItem(SESSION_KEY, '{"refresh_token":"r1"}') // signed in, on a device with no room
    takeOver.forEach((fn) => fn())
    expect(reloads).toBe(0)
    expect(boot.updater!.leaving('/dashboard')).toBe(false)
    authStorage.removeItem(SESSION_KEY) // signs out
    full.mockRestore()
    expect(boot.updater!.leaving('/dashboard')).toBe(true)
    expect(reloads).toBe(1)
  })
})
