import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, watch } from 'vue'
import type { User } from '@supabase/supabase-js'
import { fakeDb } from '@/test/fakeSupabase'
import { useAuthStore } from './auth'
import { useSetupStore } from './setup'
import { useCatchStore } from './catches'
import { useForecastStore } from './forecast'
import { useCoastStore } from './coast'
import { createSession, RESYNC_EVERY_MS } from './session'
import { showToast, toasts } from '@/lib/toast'
import { accountEpoch } from '@/lib/forgetOnLogout'

/**
 * The hydration orchestration main.ts and AuthView share, and the re-pull /
 * other-tab triggers. Driven by the in-memory Supabase fake (test-setup.ts).
 */

const A = 'user-a'
const T_REMOTE = Date.parse('2026-09-01T00:00:00.000Z')
const loc = (i: number) => ({ id: 'l' + i, name: 'Spot ' + i, lat: 55 + i / 100, lon: 12, species: [{ nameEn: 'Cod', months: [1] }] })
const AVAIL = { id: 'av', days: [1], from: '06:00', to: '10:00', methods: ['shore'] }
const seedSetup = (n: number, at = T_REMOTE) => fakeDb.seed('setups', {
  user_id: A,
  setup: { locations: Array.from({ length: n }, (_, i) => loc(i)), targetSpecies: [], availability: [AVAIL], lang: 'da' },
  updated_at: new Date(at).toISOString(),
})

let session: ReturnType<typeof createSession>
let stores: { auth: ReturnType<typeof useAuthStore>; setup: ReturnType<typeof useSetupStore>; catches: ReturnType<typeof useCatchStore> }

function start(user: string | null = A) {
  setActivePinia(createPinia())
  const auth = useAuthStore()
  auth.user = user ? ({ id: user } as User) : null
  fakeDb.session = user ? { user: { id: user } } : null
  const setup = useSetupStore()
  setup.loadLocal()
  const catches = useCatchStore()
  catches.loadLocal()
  stores = { auth, setup, catches }
  session = createSession()
}
async function settle(ms = 2000) {
  await nextTick()
  await vi.advanceTimersByTimeAsync(ms)
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
const reads = () => fakeDb.reads.length

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  vi.setSystemTime(new Date('2026-10-01T12:00:00.000Z'))
  localStorage.clear()
  fakeDb.reset()
})
afterEach(() => {
  stores.setup.$dispose()
  stores.catches.$dispose()
  vi.clearAllTimers()
  vi.useRealTimers()
  localStorage.clear()
})

describe('session hydration', () => {
  it('joins a hydration already under way for the same account (no second pull)', async () => {
    seedSetup(18)
    start()
    fakeDb.holdReads = true
    const first = session.hydrateFor(A) // main.ts's identity watcher
    const second = session.hydrateFor(A) // AuthView, before it routes
    expect(second).toBe(first)
    fakeDb.releaseReads()
    await first
    expect(reads()).toBe(2) // one per table
  })

  it('does not pull again for an account it has already hydrated', async () => {
    seedSetup(18)
    start()
    await session.hydrateFor(A)
    await session.hydrateFor(A)
    expect(reads()).toBe(2)
    expect(stores.setup.locations).toHaveLength(18)
  })

  it('arms sync even when the pulls fail, without pushing anything', async () => {
    seedSetup(18)
    localStorage.setItem('fc2-setup', JSON.stringify({ locations: [loc(100)], targetSpecies: [], availability: [AVAIL], updatedAt: Date.now(), ownerId: null }))
    start()
    fakeDb.failReads = true
    await session.hydrateFor(A)
    stores.setup.targetSpecies.push('torsk')
    await settle()
    expect(fakeDb.writes).toHaveLength(0)
    expect(fakeDb.row('setups', A)!.setup.locations).toHaveLength(18)
  })

  // Logged out in another tab, or into another account: no logout runs
  // here, and a bite-score still fetching for the account landed after it,
  // and put the account's scores back on the device (insightRun). A token
  // refresh the server refused leaves the account's log on the device and
  // on screen: the work for it goes on. The logout and its wipe of the
  // device reach this page apart, in either order.
  it('tells the catch log’s work once the log on screen is no longer the account’s; a guest who signs in leaves nothing', async () => {
    for (const order of ['signed out, then wiped', 'wiped, then signed out']) {
      localStorage.clear()
      fakeDb.reset()
      start(null)
      await session.hydrateFor(null)
      const at = accountEpoch()
      stores.auth.user = { id: A } as User
      fakeDb.session = { user: { id: A } }
      await session.hydrateFor(A)
      expect(accountEpoch(), order).toBe(at)
      const out = () => {
        stores.auth.user = null
        fakeDb.session = null
        return session.hydrateFor(null)
      }
      const wipe = () => {
        localStorage.removeItem('fc2-catches')
        session.onStorage({ key: 'fc2-catches' })
      }
      if (order.startsWith('signed out')) {
        await out()
        expect(accountEpoch(), order).toBe(at) // as a refused refresh leaves it
        wipe()
      } else {
        wipe()
        expect(accountEpoch(), order).toBe(at) // still signed in
        await out()
      }
      expect(accountEpoch(), order).not.toBe(at)
    }
  })

  it('tells it when another account is signed in, signed out on the way or not', async () => {
    for (const via of [['user-b'], [null, 'user-b']]) {
      localStorage.clear()
      fakeDb.reset()
      start(A)
      await session.hydrateFor(A)
      const at = accountEpoch()
      for (const id of via) {
        stores.auth.user = id ? ({ id } as User) : null
        fakeDb.session = id ? { user: { id } } : null
        await session.hydrateFor(id)
      }
      expect(accountEpoch(), via.join(' → ')).not.toBe(at)
    }
  })
})

describe('session resync (focus / reconnect)', () => {
  it("re-pulls and adopts another device's newer row", async () => {
    seedSetup(18)
    start()
    await session.hydrateFor(A)
    seedSetup(20, T_REMOTE + 60_000) // the phone pushed while this tab sat open
    await session.resync()
    await settle()
    expect(stores.setup.locations).toHaveLength(20)
    expect(fakeDb.writes).toHaveLength(0)
  })

  it("retries a failed hydration pull and then pushes the account's offline edit", async () => {
    seedSetup(18)
    localStorage.setItem('fc2-setup', JSON.stringify({
      locations: Array.from({ length: 18 }, (_, i) => loc(i)), targetSpecies: [], availability: [AVAIL],
      updatedAt: T_REMOTE, ownerId: A, dirty: false,
    }))
    start()
    fakeDb.failReads = true
    await session.hydrateFor(A)
    stores.setup.locations.push(loc(50)) // offline edit; its push can't reconcile yet
    await settle()
    expect(fakeDb.writes).toHaveLength(0)

    fakeDb.failReads = false // back online
    await session.resync()
    await settle()
    expect(fakeDb.row('setups', A)!.setup.locations).toHaveLength(19)
  })

  it('fails quietly: a background re-pull on a flaky connection does not toast', async () => {
    seedSetup(18)
    start()
    await session.hydrateFor(A)
    toasts.value = []
    fakeDb.failReads = true
    await session.resync()
    expect(toasts.value).toHaveLength(0)
  })

  it('does nothing while signed out or mid-hydration', async () => {
    start(null)
    await session.hydrateFor(null)
    await session.resync()
    expect(reads()).toBe(0)

    stores.auth.user = { id: A } as User
    fakeDb.session = { user: { id: A } }
    fakeDb.holdReads = true
    const h = session.hydrateFor(A)
    await session.resync()
    expect(reads()).toBe(2) // the hydration's own, nothing extra
    fakeDb.releaseReads()
    await h
  })
})

describe('session listeners', () => {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const win = new EventTarget()

  it('re-pulls when the page becomes visible or comes back online', async () => {
    seedSetup(18)
    start()
    await session.hydrateFor(A)
    const stop = session.listen(win, doc)
    win.dispatchEvent(new Event('online'))
    await settle()
    expect(reads()).toBe(4)
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(reads()).toBe(4) // hidden: nothing to refresh for
    doc.visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(reads()).toBe(6)
    stop()
    win.dispatchEvent(new Event('online'))
    await settle()
    expect(reads()).toBe(6)
  })

  /**
   * Regression — a window that stays visible (a desktop browser never
   * minimised) fires no visibilitychange and no 'online', so it kept its
   * days-old copy, and its next edit pushed that copy over the phone's work:
   * reconcile can't catch it then, because that edit is the newest stamp.
   */
  it('keeps a window that stays visible current, so its next edit builds on the phone’s', async () => {
    seedSetup(18)
    start()
    await session.hydrateFor(A)
    const stop = session.listen(win, doc)
    seedSetup(20, T_REMOTE + 60_000) // the phone, while this window sat open
    await settle(RESYNC_EVERY_MS)
    stores.setup.locations.push(loc(60))
    await settle()
    expect(fakeDb.row('setups', A)!.setup.locations).toHaveLength(21)
    stop()
  })

  it('re-pulls when the window regains focus, and not on a timer while hidden', async () => {
    seedSetup(18)
    start()
    await session.hydrateFor(A)
    const stop = session.listen(win, doc)
    win.dispatchEvent(new Event('focus')) // back from another app; the page never went hidden
    await settle()
    expect(reads()).toBe(4)
    doc.visibilityState = 'hidden'
    await settle(RESYNC_EVERY_MS)
    expect(reads()).toBe(4)
    doc.visibilityState = 'visible'
    stop()
    await settle(RESYNC_EVERY_MS)
    expect(reads()).toBe(4) // the timer goes with the listeners
  })

  it("reloads another tab's save into memory", async () => {
    seedSetup(18)
    start()
    await session.hydrateFor(A)
    const stop = session.listen(win, doc)
    localStorage.setItem('fc2-catches', JSON.stringify({
      entries: [{ id: 'c1', date: '2026-09-30', speciesId: '', locationName: 'Mole' }], updatedAt: Date.now(), ownerId: A, dirty: true,
    }))
    win.dispatchEvent(Object.assign(new Event('storage'), { key: 'fc2-catches' }))
    expect(stores.catches.entries.map((e) => e.id)).toEqual(['c1'])
    stop()
  })

  it("takes another tab's derived coasts (fc2-coast)", async () => {
    start()
    const coast = useCoastStore()
    const stop = session.listen(win, doc)
    const at = { lat: 55.6, lon: 12.6 }
    localStorage.setItem('fc2-coast', JSON.stringify({ v: 1, entries: { '55.60000,12.60000': {
      v: 1, at: Date.now(), src: 'versatiles', water: 'sea', facing: 90, nearFacing: 90, spread: 180, exposure: 'open',
      fetchKm: Array.from({ length: 16 }, () => 1), pinToWaterM: 2, issues: [],
    } } }))
    win.dispatchEvent(Object.assign(new Event('storage'), { key: 'fc2-coast' }))
    expect(coast.autoFor(at)?.facing).toBe(90)
    stop()
  })
})

/**
 * Round I review: a page in the back/forward cache hears nothing, the
 * storage events of another tab's logout included. Back, it still showed the
 * signed-out account's spots and catches. With the session on the device,
 * auth-js reads none there and says nothing, so the page even stayed signed
 * in, and each sync it tried went without a session. On a device that keeps
 * nothing (site data blocked: the session, and the documents, live in each
 * page's memory) a live tab has the same gap, as no storage event ever comes.
 *
 * The page here is a stand-in window and document, in the HTML spec's
 * order: hidden as it goes into the cache (pagehide, persisted), and back
 * shown first (visibilitychange), then pageshow (persisted). What another
 * tab does meanwhile changes the device and the server only: its storage
 * events are lost.
 */
describe('a page back from the back/forward cache', () => {
  const realStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!
  let unwatch = () => {}
  afterEach(() => {
    unwatch()
    Object.defineProperty(globalThis, 'localStorage', realStorage)
  })

  /** main.ts: hydrate for each identity the auth store takes. */
  function followIdentity() {
    unwatch = watch(() => stores.auth.user?.id ?? null, (id) => { session.hydrateFor(id) })
  }
  /** The page, listened to as main.ts does; leave() and back() as described above. */
  function page() {
    const win = new EventTarget()
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    const fire = (at: EventTarget, type: string, persisted?: boolean) =>
      at.dispatchEvent(Object.assign(new Event(type), persisted === undefined ? {} : { persisted }))
    const stop = session.listen(win, doc)
    return {
      stop,
      leave() { fire(win, 'pagehide', true); doc.visibilityState = 'hidden'; fire(doc, 'visibilitychange') },
      back() { doc.visibilityState = 'visible'; fire(doc, 'visibilitychange'); fire(win, 'pageshow', true) },
    }
  }
  /** Site data blocked: even reading localStorage throws. */
  function blockStorage() {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw Object.assign(new Error('Access is denied for this document.'), { name: 'SecurityError' }) },
    })
  }
  const seedCatch = () => fakeDb.seed('catches', {
    user_id: A, entries: [{ id: 'c1', date: '2026-09-30', speciesId: 'torsk', locationName: 'Mole' }], updated_at: new Date(T_REMOTE).toISOString(),
  })
  /** Signed in, hydrated, and listened to: 18 spots and a catch. */
  async function signedIn() {
    seedSetup(18)
    seedCatch()
    start()
    await session.hydrateFor(A)
    followIdentity()
    const p = page()
    expect([stores.setup.locations.length, stores.catches.entries.length]).toEqual([18, 1])
    return p
  }
  /** What another tab's logout leaves: no session, and none of the documents on the device. */
  function logoutElsewhere() {
    fakeDb.session = null
    for (const key of ['fc2-setup', 'fc2-catches', 'fc2-coast']) localStorage.removeItem(key)
  }
  const shown = () => [stores.setup.locations.length, stores.catches.entries.length]
  /** A coast derived at a spot of the account's, in this page's memory only. */
  const AT = { lat: 55.6, lon: 12.6 }
  function derivedCoast() {
    const coast = useCoastStore()
    coast.entries = { '55.60000,12.60000': {
      v: 1, at: Date.now(), src: 'versatiles', water: 'sea', facing: 90, nearFacing: 90, spread: 180, exposure: 'open',
      fetchKm: Array.from({ length: 16 }, () => 1), pinToWaterM: 2, issues: [],
    } } as never
    expect(coast.autoFor(AT)?.facing).toBe(90)
    return coast
  }

  it('signed out in another tab meanwhile: shows signed out, without the account’s spots and catches, and sends nothing', async () => {
    const p = await signedIn()
    p.leave()
    logoutElsewhere()
    const before = { reads: reads(), requests: fakeDb.requests.length }
    toasts.value = []
    p.back()
    await settle()
    expect(stores.auth.user).toBeNull()
    expect(shown()).toEqual([0, 0])
    expect(reads()).toBe(before.reads) // no re-pull without a session
    expect(fakeDb.requests).toHaveLength(before.requests)
    expect(toasts.value).toEqual([])
    expect([localStorage.getItem('fc2-setup'), localStorage.getItem('fc2-catches')]).toEqual([null, null])
    p.stop()
  })

  it('nothing changed meanwhile: keeps everything as it was, and re-pulls once, as at any return', async () => {
    const p = await signedIn()
    const was = { locations: stores.setup.locations, entries: stores.catches.entries }
    p.leave()
    const before = reads()
    p.back()
    await settle()
    expect(stores.auth.user?.id).toBe(A)
    expect(stores.setup.locations).toBe(was.locations) // not even reloaded
    expect(stores.catches.entries).toBe(was.entries)
    expect(reads()).toBe(before + 2) // one per table
    expect(fakeDb.writes).toHaveLength(0)
    p.stop()
  })

  // A browser that gives pageshow before the page is shown: the session is
  // read at pageshow, and the re-pull waits for the page to be shown.
  it('pageshow first: re-pulls once, as the page is shown', async () => {
    const p = await signedIn()
    const win = new EventTarget()
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    const stop = session.listen(win, doc)
    p.stop()
    win.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }))
    doc.visibilityState = 'hidden'
    doc.dispatchEvent(new Event('visibilitychange'))
    const before = reads()
    win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
    await settle()
    expect(reads()).toBe(before)
    doc.visibilityState = 'visible'
    doc.dispatchEvent(new Event('visibilitychange'))
    await settle()
    expect(reads()).toBe(before + 2)
    expect(stores.auth.user?.id).toBe(A)
    stop()
  })

  it('a guest’s page: nothing changes, and nothing is pulled', async () => {
    localStorage.setItem('fc2-setup', JSON.stringify({ locations: [loc(1)], targetSpecies: [], availability: [AVAIL], updatedAt: Date.now(), dirty: true }))
    start(null)
    await session.hydrateFor(null)
    followIdentity()
    const p = page()
    const was = stores.setup.locations
    p.leave()
    p.back()
    await settle()
    expect(stores.auth.user).toBeNull()
    expect(stores.setup.locations).toBe(was)
    expect(reads()).toBe(0)
    p.stop()
  })

  // The listener's reason: two tabs writing the device each from its own
  // stale copy. Back, the page's next edit wrote over the other tab's save.
  it('takes another tab’s save made meanwhile, instead of writing its stale copy over it', async () => {
    const p = await signedIn()
    p.leave()
    // Another tab of the account adds a spot; its push has not reached the account (offline there).
    const theirs = JSON.parse(localStorage.getItem('fc2-setup')!)
    theirs.locations.push(loc(50))
    Object.assign(theirs, { dirty: true, updatedAt: Date.now() })
    localStorage.setItem('fc2-setup', JSON.stringify(theirs))
    p.back()
    await settle()
    expect(stores.setup.locations).toHaveLength(19)
    stores.setup.locations.push(loc(60))
    await settle()
    expect(fakeDb.row('setups', A)!.setup.locations.map((l: { id: string }) => l.id)).toEqual(expect.arrayContaining(['l50', 'l60']))
    p.stop()
  })

  // Another tab signed out without a logout (its token refresh refused):
  // the device keeps the documents, as that tab does.
  it('signed out meanwhile with the documents still on the device: keeps them, as the other tabs do', async () => {
    const p = await signedIn()
    p.leave()
    fakeDb.session = null
    p.back()
    await settle()
    expect(stores.auth.user).toBeNull()
    expect(shown()).toEqual([18, 1])
    p.stop()
  })

  it('signed out in another tab meanwhile, on a device that keeps nothing: the account’s spots and catches go too', async () => {
    blockStorage()
    const p = await signedIn()
    p.leave()
    fakeDb.session = null // signed out there: lib/authStorage drops this page's copy as it is shown again
    const before = reads()
    p.back()
    await settle()
    expect(stores.auth.user).toBeNull()
    expect(shown()).toEqual([0, 0])
    expect(reads()).toBe(before)
    p.stop()
  })

  it('a live tab on a device that keeps nothing: a sign-out in another tab takes the account’s spots and catches', async () => {
    blockStorage()
    const p = await signedIn()
    const coast = derivedCoast()
    // auth-js tells this tab SIGNED_OUT on its own channel; no storage event can come.
    fakeDb.session = null
    stores.auth.user = null
    await settle()
    expect(shown()).toEqual([0, 0])
    expect(coast.autoFor(AT)).toBeUndefined() // derived at the account's spot, as logout clears it
    p.stop()
  })

  // That edit has no other copy: the logout asked about the other tab's
  // edits, not this one's. Signing in to the account again sends it.
  it('keeps a document that holds an edit no account has, on a device that keeps nothing', async () => {
    blockStorage()
    const p = await signedIn()
    fakeDb.failWrites = true
    stores.catches.add({ date: '2026-10-01', speciesId: 'torsk', locationName: 'Mole' })
    await settle() // its push fails
    fakeDb.session = null
    stores.auth.user = null
    await settle()
    expect(shown()).toEqual([0, 2])
    p.stop()
  })

  it('keeps a setup that holds an edit no account has, on a device that keeps nothing', async () => {
    blockStorage()
    const p = await signedIn()
    fakeDb.failWrites = true
    stores.setup.locations.push(loc(60))
    await settle() // its push fails
    fakeDb.session = null
    stores.auth.user = null
    await settle()
    expect(shown()).toEqual([19, 0])
    p.stop()
  })

  // Safari has told only pagehide and pageshow at a return from the cache,
  // with no visibilitychange either way: pageshow alone starts the return.
  it('a browser that tells only pagehide and pageshow: signed out in another tab meanwhile, shows signed out without the account’s data', async () => {
    const p = await signedIn()
    p.stop()
    const win = new EventTarget()
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
    const stop = session.listen(win, doc)
    win.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }))
    logoutElsewhere()
    const before = reads()
    win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
    await settle()
    expect(stores.auth.user).toBeNull()
    expect(shown()).toEqual([0, 0])
    expect(reads()).toBe(before)
    stop()
  })

  // On a device that keeps nothing the page went from the first account
  // straight to the second (lib/authStorage takes the other tab's copy), and
  // never through signed out. The second has no rows yet, so the pull leaves
  // a document of another account as it is (never sends it): the page showed
  // the first account's spots and catches to the second.
  it('signed out and into another account in another tab meanwhile, on a device that keeps nothing: the first account’s spots and catches go', async () => {
    blockStorage()
    const p = await signedIn()
    p.leave()
    fakeDb.session = { user: { id: 'user-b' } }
    p.back()
    await settle()
    expect(stores.auth.user?.id).toBe('user-b')
    expect(shown()).toEqual([0, 0])
    expect([fakeDb.row('setups', 'user-b'), fakeDb.row('catches', 'user-b')]).toEqual([undefined, undefined])
    p.stop()
  })

  // A refused token refresh signs this tab out without a logout. The device
  // keeps the documents, and the next sign-in to the account sends its edits.
  it('a live tab signed out where the device keeps the documents: keeps them', async () => {
    const p = await signedIn()
    const coast = derivedCoast()
    fakeDb.session = null
    stores.auth.user = null
    await settle()
    expect(shown()).toEqual([18, 1])
    expect(coast.autoFor(AT)?.facing).toBe(90)
    p.stop()
  })
})

/**
 * Regression — logout wiped edits that had never reached the account: one
 * still in its push debounce, or one whose push failed offline. And when
 * signOut itself failed (offline), it wiped them anyway while the session
 * survived, so the next start signed straight back in without them.
 */
describe('session logout', () => {
  const never = vi.fn(async () => true)
  beforeEach(() => never.mockClear())

  async function signedInWithEdit() {
    seedSetup(18)
    start()
    await session.hydrateFor(A)
    stores.catches.add({ date: '2026-09-30', speciesId: 'torsk', locationName: 'Mole' })
    await nextTick() // stamped; its push is still waiting in the debounce
  }

  it('pushes an edit still waiting in the debounce before wiping', async () => {
    await signedInWithEdit()
    expect(await session.logout(never)).toBe('done')
    expect(never).not.toHaveBeenCalled()
    expect(fakeDb.row('catches', A)!.entries).toHaveLength(1)
    expect(stores.auth.user).toBeNull()
    expect(localStorage.getItem('fc2-catches')).toBeNull()
  })

  it('asks before discarding an edit that cannot be pushed, and keeps it on cancel', async () => {
    await signedInWithEdit()
    fakeDb.failWrites = true
    const cancel = vi.fn(async () => false)
    expect(await session.logout(cancel)).toBe('cancelled')
    expect(cancel).toHaveBeenCalledOnce()
    expect(stores.auth.user).not.toBeNull()
    expect(stores.catches.entries).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem('fc2-catches')!).entries).toHaveLength(1)
  })

  it('wipes once the user confirms losing the unsynced edit', async () => {
    await signedInWithEdit()
    fakeDb.failWrites = true
    expect(await session.logout(async () => true)).toBe('done')
    expect(stores.catches.entries).toHaveLength(0)
  })

  it('keeps everything, signed in, when signOut fails', async () => {
    await signedInWithEdit()
    fakeDb.failWrites = true
    fakeDb.signOutError = { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 }
    expect(await session.logout(async () => true)).toBe('failed')
    expect(stores.auth.user).not.toBeNull()
    expect(stores.catches.entries).toHaveLength(1)
    expect(stores.setup.locations).toHaveLength(18)
  })

  /**
   * Device caches that belong to the account too. The weather is keyed by the
   * old account's location ids and holds its spots' station data, and the
   * reminder flag kept firing for whoever signed in next.
   */
  function seedDeviceCaches() {
    const fc = useForecastStore()
    fc.forecasts = { l0: { fetched: Date.now(), hourly: [], marine: null, tides: null } }
    localStorage.setItem('fc2-forecasts', JSON.stringify(fc.forecasts))
    localStorage.setItem('fc2-notifs', '1')
    localStorage.setItem('fc2-insight-results', '{"v":1,"results":[]}')
    return fc
  }

  it('also clears the cached weather and turns reminders off', async () => {
    await signedInWithEdit()
    const fc = seedDeviceCaches()
    expect(await session.logout(never)).toBe('done')
    expect(fc.forecasts).toEqual({})
    expect(localStorage.getItem('fc2-forecasts')).toBeNull()
    expect(localStorage.getItem('fc2-notifs')).toBeNull()
  })

  // The derived coasts are keyed by the old account's spot coordinates.
  it("also clears this device's derived coasts", async () => {
    await signedInWithEdit()
    localStorage.setItem('fc2-coast', JSON.stringify({ v: 1, entries: {} }))
    expect(await session.logout(never)).toBe('done')
    expect(localStorage.getItem('fc2-coast')).toBeNull()
  })

  // The bite-scores kept on the device (insightSaved) hold the old account's
  // spots — names and coordinates — and its entries' fingerprints.
  it("also clears this device's kept bite-scores", async () => {
    await signedInWithEdit()
    localStorage.setItem('fc2-insight-results', JSON.stringify({ v: 1, results: [] }))
    expect(await session.logout(never)).toBe('done')
    expect(localStorage.getItem('fc2-insight-results')).toBeNull()
  })

  // The catch log's unsaved form, kept for the tab (catchDraft): the next
  // user of this tab must not find the last one's half-typed catch.
  it("also clears the catch log's unsaved form", async () => {
    await signedInWithEdit()
    const kept = new Map([['fc2-catch-draft', '{"v":1,"mode":"catch"}']])
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => { kept.set(k, v) }, removeItem: (k: string) => { kept.delete(k) } })
    try {
      expect(await session.logout(never)).toBe('done')
      expect(kept.has('fc2-catch-draft')).toBe(false)
    } finally { vi.unstubAllGlobals() }
  })

  // A sticky "offline — Prøv igen" toast outlived logout, and its Retry
  // fetched the old account's 18 spots back into fc2-forecasts.
  it('also clears the toasts, Retry buttons included', async () => {
    await signedInWithEdit()
    showToast('📡 offline', { type: 'error', action: { label: 'Prøv igen', run: vi.fn() } })
    expect(await session.logout(never)).toBe('done')
    expect(toasts.value).toEqual([])
  })

  it('leaves them alone when logout fails or is cancelled', async () => {
    await signedInWithEdit()
    const fc = seedDeviceCaches()
    fakeDb.failWrites = true
    expect(await session.logout(async () => false)).toBe('cancelled')
    fakeDb.signOutError = { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 }
    expect(await session.logout(async () => true)).toBe('failed')
    expect(Object.keys(fc.forecasts)).toEqual(['l0'])
    expect(localStorage.getItem('fc2-notifs')).toBe('1')
    expect(localStorage.getItem('fc2-insight-results')).toBe('{"v":1,"results":[]}')
  })

  it('does not ask when everything is already synced', async () => {
    seedSetup(18)
    start()
    await session.hydrateFor(A)
    fakeDb.failWrites = true // nothing to send, so a dead connection doesn't matter
    expect(await session.logout(never)).toBe('done')
    expect(never).not.toHaveBeenCalled()
  })
})
