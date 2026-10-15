import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { nextTick } from 'vue'
import type { User } from '@supabase/supabase-js'
import { fakeDb } from '@/test/fakeSupabase'
import { supabase } from '@/lib/supabase'
import { lang } from '@/lib/i18n'
import { useAuthStore } from './auth'
import { useSetupStore } from './setup'
import { useCatchStore } from './catches'
import { renameLocation } from '@/lib/renameLocation'

/**
 * Store-level pull/push, driven by the in-memory Supabase fake. The guarantee
 * under test: the account's row is never overwritten by empty state, by guest or
 * another account's local state, or by a document this session hasn't reconciled
 * with a SUCCESSFUL pull — while the account's own offline edits still reach the
 * server once a pull succeeds. Every case runs against both stores, because each
 * guard has to exist in both (the catches store had no tests at all).
 */

const A = 'user-a'
const T_REMOTE = Date.parse('2026-09-01T00:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()
const range = (n: number) => Array.from({ length: n }, (_, i) => i)

// Locations carry species so the watcher's species enrichment has nothing to
// do — otherwise its own write would add pushes these tests don't expect.
const loc = (i: number) => ({ id: 'l' + i, name: 'Spot ' + i, lat: 55 + i / 100, lon: 12, species: [{ nameEn: 'Cod', months: [1] }] })
const AVAIL = { id: 'av', days: [1], from: '06:00', to: '10:00', methods: ['shore'] }
const entry = (i: number) => ({ id: 'c' + i, date: '2026-09-01', speciesId: '', locationName: 'Spot ' + i })

interface App {
  pinia: Pinia
  auth: ReturnType<typeof useAuthStore>
  setup: ReturnType<typeof useSetupStore>
  catches: ReturnType<typeof useCatchStore>
}
const open: App[] = []

/** One app start: a fresh Pinia (like a page load), local state loaded, signed in. */
function openApp(user: string | null = A): App {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.user = user ? ({ id: user } as User) : null
  fakeDb.session = user ? { user: { id: user } } : null
  const setup = useSetupStore()
  setup.loadLocal()
  const catches = useCatchStore()
  catches.loadLocal()
  const app = { pinia, auth, setup, catches }
  open.push(app)
  return app
}
/** Close the app: stop its watchers and drop its pending timers. */
function closeApp(app: App) {
  app.setup.$dispose()
  app.catches.$dispose()
  app.auth.$dispose()
  vi.clearAllTimers()
}
/** What main.ts does on start and on every identity change. */
async function hydrate(app: App) {
  app.setup.pauseSync()
  app.catches.pauseSync()
  await Promise.all([app.setup.pullRemote(), app.catches.pullRemote()])
  app.setup.markReady()
  app.catches.markReady()
}
/** Let the watcher run, the 1.5 s push debounce fire, and the push settle. */
async function settle(ms = 2000) {
  await nextTick()
  await vi.advanceTimersByTimeAsync(ms)
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

interface Kind {
  table: string
  key: string
  store(app: App): {
    pullRemote(): Promise<void>; pushRemote(): Promise<void>; flush(): Promise<boolean>
    reloadLocal(): void; pauseSync(): void; markReady(): void
  }
  seedRemote(n: number, at?: number): void
  seedLocal(n: number, ownerId: string | null, at: number): void
  count(app: App): number
  remoteCount(): number | undefined
  add(app: App, i: number): void
  removeOne(app: App): void
  /** A genuine edit that doesn't change the item count. */
  touch(app: App): void
}

const KINDS: Record<'setup' | 'catches', Kind> = {
  setup: {
    table: 'setups',
    key: 'fc2-setup',
    store: (app) => app.setup,
    seedRemote: (n, at = T_REMOTE) => fakeDb.seed('setups', {
      user_id: A,
      setup: { locations: range(n).map(loc), targetSpecies: ['torsk'], availability: [AVAIL], lang: 'da' },
      updated_at: iso(at),
    }),
    seedLocal: (n, ownerId, at) => localStorage.setItem('fc2-setup', JSON.stringify({
      locations: range(n).map((i) => loc(100 + i)), targetSpecies: ['torsk'], availability: [AVAIL], updatedAt: at, ownerId,
    })),
    count: (app) => app.setup.locations.length,
    remoteCount: () => fakeDb.row('setups', A)?.setup.locations.length,
    add: (app, i) => { app.setup.locations.push(loc(200 + i)) },
    removeOne: (app) => { app.setup.locations = app.setup.locations.slice(1) },
    touch: (app) => { app.setup.targetSpecies = [...app.setup.targetSpecies, 'sild'] },
  },
  catches: {
    table: 'catches',
    key: 'fc2-catches',
    store: (app) => app.catches,
    seedRemote: (n, at = T_REMOTE) => fakeDb.seed('catches', {
      user_id: A, entries: range(n).map(entry), updated_at: iso(at),
    }),
    seedLocal: (n, ownerId, at) => localStorage.setItem('fc2-catches', JSON.stringify({
      entries: range(n).map((i) => entry(100 + i)), updatedAt: at, ownerId,
    })),
    count: (app) => app.catches.entries.length,
    remoteCount: () => fakeDb.row('catches', A)?.entries.length,
    add: (app, i) => { app.catches.add({ date: '2026-09-30', speciesId: '', locationName: 'New ' + i }) },
    removeOne: (app) => { app.catches.remove(app.catches.entries[0].id) },
    touch: (app) => { const e = app.catches.entries[0]; app.catches.update(e.id, { ...e, notes: 'edited' }) },
  },
}

const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? 'null')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date('2026-10-01T12:00:00.000Z'))
  localStorage.clear()
  fakeDb.reset()
})
afterEach(() => {
  while (open.length) closeApp(open.pop()!)
  vi.useRealTimers()
  lang.value = 'da'
  localStorage.clear()
})

it('tests run against the in-memory fake, never a real Supabase client', () => {
  expect(supabase).not.toBeNull()
  expect(typeof (supabase as any).from('setups').upsert).toBe('function')
  expect((supabase as any).auth.getSession).toBeTypeOf('function')
  // The fake records every write — a real client wouldn't.
  fakeDb.session = { user: { id: 'x' } }
  return (supabase as any).from('setups').upsert({ user_id: 'x' }).then(() => {
    expect(fakeDb.upserts).toHaveLength(1)
  })
})

describe.each(Object.keys(KINDS) as (keyof typeof KINDS)[])('%s store sync', (name) => {
  const k = KINDS[name]

  // ── Successful pull ─────────────────────────────────────────

  it('replaces a guest document with the account row, and pushes nothing', async () => {
    k.seedRemote(18)
    k.seedLocal(3, null, Date.now()) // guest data is always "newer"
    const app = openApp()
    await hydrate(app)
    await settle()
    expect(k.count(app)).toBe(18)
    expect(fakeDb.upsertsTo(k.table)).toHaveLength(0)
  })

  it("pushes the account's own newer offline edits (keep-local)", async () => {
    k.seedRemote(18)
    k.seedLocal(19, A, T_REMOTE + 60_000)
    const app = openApp()
    await hydrate(app)
    await settle()
    expect(k.count(app)).toBe(19)
    expect(k.remoteCount()).toBe(19)
  })

  it('does not stamp or push back a remote document it adopted', async () => {
    k.seedRemote(18)
    const app = openApp()
    await hydrate(app)
    // AuthView used to run a second pull right after hydrate; its adopt fired the
    // watcher with sync armed, was stamped as a fresh edit and pushed straight back.
    await k.store(app).pullRemote()
    await settle()
    expect(fakeDb.upsertsTo(k.table)).toHaveLength(0)
    expect(stored(k.key).updatedAt).toBe(T_REMOTE)
  })

  it('adopts a newer row on a re-pull without pushing it back', async () => {
    k.seedRemote(18)
    const app = openApp()
    await hydrate(app)
    k.seedRemote(20, T_REMOTE + 60_000) // another device pushed meanwhile
    await k.store(app).pullRemote() // sync is armed now, unlike during hydration
    await settle()
    expect(k.count(app)).toBe(20)
    expect(fakeDb.upsertsTo(k.table)).toHaveLength(0)
    expect(stored(k.key).updatedAt).toBe(T_REMOTE + 60_000)
  })

  it('keeps an edit made while a re-pull is in flight', async () => {
    k.seedRemote(18)
    const app = openApp()
    await hydrate(app)
    fakeDb.holdReads = true
    const pull = k.store(app).pullRemote()
    k.add(app, 1)
    await nextTick()
    fakeDb.releaseReads()
    await pull
    await settle()
    expect(k.count(app)).toBe(19)
    expect(k.remoteCount()).toBe(19)
  })

  it('pushes an edit made after the pull but before sync was armed', async () => {
    k.seedRemote(18)
    const app = openApp()
    const st = k.store(app)
    st.pauseSync()
    await st.pullRemote()
    k.add(app, 1) // e.g. while the other store's pull is still pending
    await nextTick()
    st.markReady()
    await settle()
    expect(k.remoteCount()).toBe(19)
    expect(fakeDb.upsertsTo(k.table)).toHaveLength(1)
  })

  // ── Second tab ───────────────────────────────────────────────

  it("takes another tab's saved copy into memory without stamping or pushing it", async () => {
    k.seedRemote(18)
    const app = openApp()
    await hydrate(app)
    k.seedLocal(20, A, T_REMOTE + 5_000) // what the other tab's save leaves behind
    k.store(app).reloadLocal()
    await settle()
    expect(k.count(app)).toBe(20)
    expect(stored(k.key).updatedAt).toBe(T_REMOTE + 5_000)
    expect(fakeDb.upsertsTo(k.table)).toHaveLength(0)
  })

  it('follows another tab that logged out and wiped the document', async () => {
    k.seedRemote(18)
    const app = openApp()
    await hydrate(app)
    localStorage.removeItem(k.key)
    k.store(app).reloadLocal()
    await settle()
    expect(k.count(app)).toBe(0)
    expect(localStorage.getItem(k.key)).toBeNull() // not written back as this tab's own
  })

  // ── Failed pull: nothing local may reach the row un-reconciled ──

  it('never upserts guest data after a failed pull, however many edits follow', async () => {
    k.seedRemote(18)
    k.seedLocal(3, null, Date.now())
    fakeDb.failReads = true
    const app = openApp()
    await hydrate(app)
    k.touch(app)
    await settle()
    k.add(app, 1)
    await settle()
    expect(fakeDb.upsertsTo(k.table)).toHaveLength(0)
    expect(k.remoteCount()).toBe(18)
  })

  it('does not persist ownership of guest data when the pull and the push both fail', async () => {
    k.seedRemote(18)
    k.seedLocal(3, null, Date.now())
    fakeDb.failReads = true
    fakeDb.failWrites = true
    const app = openApp()
    await hydrate(app)
    k.touch(app)
    await settle()
    k.add(app, 1)
    await settle()
    expect(stored(k.key).ownerId).toBeNull()
    // …so the next online start still treats it as guest data, not newer account work.
    closeApp(open.pop()!)
    fakeDb.failReads = false
    fakeDb.failWrites = false
    const next = openApp()
    await hydrate(next)
    await settle()
    expect(k.count(next)).toBe(18)
    expect(k.remoteCount()).toBe(18)
  })

  it("holds the account's own offline edit until a pull succeeds, then pushes it", async () => {
    k.seedRemote(18)
    k.seedLocal(18, A, T_REMOTE)
    fakeDb.failReads = true
    const app = openApp()
    await hydrate(app)
    k.add(app, 1)
    await settle()
    expect(fakeDb.upsertsTo(k.table)).toHaveLength(0) // not reconciled yet
    expect(k.remoteCount()).toBe(18)

    fakeDb.failReads = false
    await k.store(app).pullRemote() // what a resumed tab / 'online' does
    await settle()
    expect(k.count(app)).toBe(19)
    expect(k.remoteCount()).toBe(19)
    expect(fakeDb.upsertsTo(k.table)).toHaveLength(1)
  })

  it('reconciles first when an edit is pushed before any pull succeeded', async () => {
    k.seedRemote(18)
    k.seedLocal(18, A, T_REMOTE)
    fakeDb.failReads = true
    const app = openApp()
    await hydrate(app)
    fakeDb.failReads = false // connection back; the next edit's push pulls first
    k.add(app, 1)
    await settle()
    expect(k.remoteCount()).toBe(19)
    expect(fakeDb.upsertsTo(k.table)).toHaveLength(1) // one push, not one per path
  })

  it('refuses an un-hydrated empty push', async () => {
    k.seedRemote(18)
    fakeDb.failReads = true
    const app = openApp()
    await k.store(app).pushRemote()
    expect(fakeDb.upsertsTo(k.table)).toHaveLength(0)
  })

  // ── Pull in flight ───────────────────────────────────────────

  it('keeps an edit made while the hydration pull is still in flight', async () => {
    k.seedRemote(18)
    k.seedLocal(18, A, T_REMOTE) // already in sync
    fakeDb.holdReads = true
    const app = openApp()
    const done = hydrate(app)
    await nextTick()
    k.removeOne(app) // the user deletes one while the pull is pending
    await nextTick()
    fakeDb.releaseReads()
    await done
    await settle()
    expect(k.count(app)).toBe(17)
    expect(k.remoteCount()).toBe(17)
  })

  it('ignores a pull that resolves after the user signed out', async () => {
    k.seedRemote(18)
    k.seedLocal(3, null, Date.now())
    fakeDb.holdReads = true
    const app = openApp()
    const pull = k.store(app).pullRemote()
    app.auth.user = null
    fakeDb.releaseReads()
    await expect(pull).resolves.toBeUndefined()
    expect(k.count(app)).toBe(3)
  })

  // ── Account with no row yet ('noop') ────────────────────────

  it('claims and pushes the guest document when the account has no row yet', async () => {
    k.seedLocal(6, null, Date.now())
    const app = openApp()
    await hydrate(app)
    await settle()
    expect(k.remoteCount()).toBe(6)
    expect(stored(k.key).ownerId).toBe(A)
  })

  /**
   * Regression — auth-js lost the session to a refresh that failed on a flaky
   * connection (auth.user stays set, no SIGNED_OUT), so supabase-js sent the
   * anon key. RLS hid the row and the read answered "no row" with no error:
   * the guest document was claimed for the account, and the next pull pushed
   * its 3 spots over the 18 locations as the account's own newer work.
   */
  it('does not take a read made without the session as "no row" for a guest document', async () => {
    k.seedRemote(18)
    k.seedLocal(3, null, Date.now())
    const app = openApp()
    fakeDb.tokenLost = true
    await hydrate(app)
    k.touch(app)
    await settle()
    expect(fakeDb.upsertsTo(k.table)).toHaveLength(0)
    expect(stored(k.key).ownerId).toBeNull()

    fakeDb.tokenLost = false // the next refresh succeeds
    await k.store(app).pullRemote() // a resync
    await settle()
    expect(k.count(app)).toBe(18)
    expect(k.remoteCount()).toBe(18)
  })

  it("does not push the account's own document over a newer row a session-less read couldn't see", async () => {
    k.seedRemote(18)
    k.seedLocal(18, A, T_REMOTE) // in sync
    const app = openApp()
    await hydrate(app)
    k.seedRemote(20, T_REMOTE + 60_000) // the phone pushed meanwhile
    fakeDb.tokenLost = true
    fakeDb.holdReads = true
    const pull = k.store(app).pullRemote() // a resync on resume, token expired
    fakeDb.tokenLost = false // …and the push's own refresh succeeds
    fakeDb.releaseReads()
    await pull
    await settle()
    expect(fakeDb.upsertsTo(k.table)).toHaveLength(0)
    expect(k.remoteCount()).toBe(20)

    fakeDb.holdReads = false
    await k.store(app).pullRemote()
    expect(k.count(app)).toBe(20)
  })

  /**
   * The claim is saved by the no-row branch itself: a successful push saves it
   * too, so only a failed one shows whether it was. Unsaved, the next start
   * read the document as guest data and threw it away as foreign the moment
   * another device had created the row.
   */
  it('persists the claim when the account has no row and the claiming push fails', async () => {
    k.seedLocal(6, null, Date.now())
    fakeDb.failWrites = true
    let app = openApp()
    await hydrate(app)
    await settle()
    expect(stored(k.key).ownerId).toBe(A)
    expect(stored(k.key).dirty).toBe(true) // logout must ask: this is the only copy
    closeApp(open.pop()!)

    // Another device creates the row with older work; this document is the
    // account's own now, so it wins by timestamp rather than losing as foreign.
    fakeDb.failWrites = false
    k.seedRemote(2, T_REMOTE)
    app = openApp()
    await hydrate(app)
    await settle()
    expect(k.count(app)).toBe(6)
    expect(k.remoteCount()).toBe(6)
  })

  it("leaves another account's leftover document alone when this account has no row", async () => {
    k.seedLocal(6, 'someone-else', Date.now())
    const app = openApp()
    await hydrate(app)
    k.touch(app)
    await settle()
    expect(fakeDb.upsertsTo(k.table)).toHaveLength(0)
  })

  /**
   * Finding: ownership was set in memory only, so after the account's first push
   * the stored document still said "guest". A later offline session's edits then
   * lost to the remote as foreign data on the next online start.
   */
  it('keeps an offline edit across three sessions after the first push', async () => {
    // Session 1, online, no row yet: one edit is pushed.
    let app = openApp()
    await hydrate(app)
    k.add(app, 1)
    await settle()
    expect(k.remoteCount()).toBe(1)
    closeApp(open.pop()!)

    // Session 2, offline: the pull fails, one more edit, its push can't go.
    vi.setSystemTime(Date.now() + 3_600_000)
    fakeDb.failReads = true
    fakeDb.failWrites = true
    app = openApp()
    await hydrate(app)
    k.add(app, 2)
    await settle()
    expect(k.count(app)).toBe(2)
    closeApp(open.pop()!)

    // Session 3, online again: the offline edit must survive and reach the row.
    vi.setSystemTime(Date.now() + 3_600_000)
    fakeDb.failReads = false
    fakeDb.failWrites = false
    app = openApp()
    await hydrate(app)
    await settle()
    expect(k.count(app)).toBe(2)
    expect(k.remoteCount()).toBe(2)
  })

  // ── Sign-out flush ──────────────────────────────────────────

  it('flush() pushes an edit still waiting in the debounce', async () => {
    k.seedRemote(18)
    const app = openApp()
    await hydrate(app)
    k.add(app, 1)
    await nextTick() // edit stamped, push not yet due
    expect(await k.store(app).flush()).toBe(true)
    expect(k.remoteCount()).toBe(19)
  })

  it('flush() reports unpushed edits when the push fails', async () => {
    k.seedRemote(18)
    const app = openApp()
    await hydrate(app)
    fakeDb.failWrites = true
    k.add(app, 1)
    await settle()
    expect(await k.store(app).flush()).toBe(false)
    fakeDb.failWrites = false
    expect(await k.store(app).flush()).toBe(true)
    expect(k.remoteCount()).toBe(19)
  })

  it('flush() remembers a failed push across an app restart', async () => {
    k.seedRemote(18)
    let app = openApp()
    await hydrate(app)
    fakeDb.failWrites = true
    k.add(app, 1)
    await settle()
    closeApp(open.pop()!)
    // Next start is offline too: nothing has reached the account.
    fakeDb.failReads = true
    app = openApp()
    await hydrate(app)
    expect(await k.store(app).flush()).toBe(false)
  })

  it('flush() has nothing to do for a document already in sync', async () => {
    k.seedRemote(18)
    const app = openApp()
    await hydrate(app)
    fakeDb.failReads = true
    fakeDb.failWrites = true
    expect(await k.store(app).flush()).toBe(true)
  })
})

describe('setup store — account language', () => {
  it("persists the account's language when it adopts the row", async () => {
    fakeDb.seed('setups', {
      user_id: A,
      setup: { locations: [loc(1)], targetSpecies: [], availability: [AVAIL], lang: 'en' },
      updated_at: iso(T_REMOTE),
    })
    const app = openApp()
    await hydrate(app)
    await settle()
    expect(lang.value).toBe('en')
    // fc2-lang is what the next cold start reads before any pull lands.
    expect(localStorage.getItem('fc2-lang')).toBe('en')
    expect(fakeDb.upsertsTo('setups')).toHaveLength(0)
  })

  /**
   * Regression — setLang's unguarded localStorage write threw inside the adopt
   * (storage full, or blocked), after the rows were swapped in but before the
   * stamp, the owner and `pulled` were set. Every push then re-pulled, took
   * the row as foreign over the user's edit, and threw again.
   */
  it('keeps syncing when storage refuses the language write', async () => {
    fakeDb.seed('setups', {
      user_id: A,
      setup: { locations: [loc(1)], targetSpecies: [], availability: [AVAIL], lang: 'en' },
      updated_at: iso(T_REMOTE),
    })
    const app = openApp()
    const blocked = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError') })
    try {
      // As session.hydrate does it: a pull that throws counts as a failed one.
      app.setup.pauseSync()
      await Promise.allSettled([app.setup.pullRemote()])
      app.setup.markReady()
      expect(lang.value).toBe('en')
      app.setup.locations.push(loc(2))
      await settle()
      expect(app.setup.locations).toHaveLength(2)
      expect(fakeDb.row('setups', A)!.setup.locations).toHaveLength(2)
    } finally {
      blocked.mockRestore()
    }
  })

  it('ignores an unknown language value in the row', async () => {
    fakeDb.seed('setups', {
      user_id: A,
      setup: { locations: [loc(1)], targetSpecies: [], availability: [AVAIL], lang: 'xx' },
      updated_at: iso(T_REMOTE),
    })
    const app = openApp()
    await hydrate(app)
    expect(lang.value).toBe('da')
  })
})

describe('renaming a spot that has catches', () => {
  it("keeps the catch another device logged since this one last pulled", async () => {
    // The desktop pulled the setup and a 2-catch log at Spot 1; the window stays
    // focused, so no re-pull runs before the rename.
    fakeDb.seed('setups', { user_id: A, setup: { locations: [loc(1), loc(2)], targetSpecies: [], availability: [AVAIL], lang: 'da' }, updated_at: iso(T_REMOTE) })
    const at1 = (i: number) => ({ ...entry(i), locationName: 'Spot 1' })
    fakeDb.seed('catches', { user_id: A, entries: [at1(1), at1(2)], updated_at: iso(T_REMOTE) })
    const app = openApp()
    await hydrate(app)
    // The phone logs a third catch there, and its push lands.
    fakeDb.seed('catches', { user_id: A, entries: [at1(3), at1(1), at1(2)], updated_at: iso(T_REMOTE + 60_000) })
    vi.setSystemTime(new Date(T_REMOTE + 120_000))
    await renameLocation('l1', 'Molen', app.setup, app.catches)
    await settle()
    const row = fakeDb.row('catches', A)!.entries.map((e: any) => `${e.id}:${e.locationName}`).sort()
    expect(row).toEqual(['c1:Molen', 'c2:Molen', 'c3:Molen'])
    expect(app.setup.locations.find((x) => x.id === 'l1')!.name).toBe('Molen')
  })
})
