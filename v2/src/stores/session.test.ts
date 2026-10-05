import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import type { User } from '@supabase/supabase-js'
import { fakeDb } from '@/test/fakeSupabase'
import { useAuthStore } from './auth'
import { useSetupStore } from './setup'
import { useCatchStore } from './catches'
import { createSession } from './session'

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
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
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
    expect(fakeDb.upserts).toHaveLength(0)
    expect(fakeDb.row('setups', A)!.setup.locations).toHaveLength(18)
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
    expect(fakeDb.upserts).toHaveLength(0)
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
    expect(fakeDb.upserts).toHaveLength(0)

    fakeDb.failReads = false // back online
    await session.resync()
    await settle()
    expect(fakeDb.row('setups', A)!.setup.locations).toHaveLength(19)
  })

  it('does nothing while signed out or mid-hydration', async () => {
    start(null)
    await session.hydrateFor(null)
    await session.resync()
    expect(reads()).toBe(0)

    stores.auth.user = { id: A } as User
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

  it('does not ask when everything is already synced', async () => {
    seedSetup(18)
    start()
    await session.hydrateFor(A)
    fakeDb.failWrites = true // nothing to send, so a dead connection doesn't matter
    expect(await session.logout(never)).toBe('done')
    expect(never).not.toHaveBeenCalled()
  })
})
