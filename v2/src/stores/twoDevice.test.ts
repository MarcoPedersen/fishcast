import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { nextTick } from 'vue'
import type { User } from '@supabase/supabase-js'
import { fakeDb } from '@/test/fakeSupabase'
import { lang } from '@/lib/i18n'
import { toasts } from '@/lib/toast'
import { STRINGS } from '@/lib/strings'
import { useAuthStore } from './auth'
import { useSetupStore } from './setup'
import { useCatchStore } from './catches'
import { renameLocation } from '@/lib/renameLocation'
import { findCatchLocation, linkCatchLocation } from '@/lib/catchScore'

/**
 * Two devices on one account, against the in-memory Supabase fake.
 *
 * Both stores used to sync one document per user with whole-document
 * last-write-wins: on pull, a local edit stamped later than the row's
 * updated_at pushed the ENTIRE local document. Nothing recorded which row
 * version the local copy was built on, so "the account changed too" looked
 * exactly like "only I changed". Each case below is a way that lost data —
 * the first is the one the final review reproduced:
 *
 *   Sat 08:00 the phone pulls a 5-catch log. Sat 19:00 the desktop backfills
 *   c6–c8. Sun dawn, offline, the phone logs a catch (stamp Sun 06:00). Back
 *   online, 06:00 > 19:00 → keep-local → the phone's 6 entries replace the
 *   row's 8, and c6–c8 are gone from the account, then from the desktop.
 *
 * A device is its own localStorage plus app sessions on it. Sessions run one
 * at a time (each settles before the next device opens) unless a case says
 * otherwise — two apps open at once share the test's one localStorage, so
 * those cases assert on memory and on the server only.
 */

const A = 'user-a'
const iso = (ms: number) => new Date(ms).toISOString()
// Copenhagen local times, as the owner would read them (CEST = UTC+2).
const at = (day: string, hhmm: string) => Date.parse(`2026-09-${day}T${hhmm}:00+02:00`)
const FRI = at('04', '20:00')
const SAT_0800 = at('05', '08:00')
const SAT_1900 = at('05', '19:00')
const SUN_0600 = at('06', '06:00')
const SUN_0700 = at('06', '07:00')

const loc = (i: number, over: Record<string, unknown> = {}) => ({ id: 'l' + i, name: 'Spot ' + i, lat: 55 + i / 100, lon: 12, species: [{ nameEn: 'Cod', months: [1] }], ...over })
const AVAIL = { id: 'av', days: [1], from: '06:00', to: '10:00', methods: ['shore'] }
const fish = (n: number | string, over: Record<string, unknown> = {}) => ({ id: 'c' + n, date: '2026-09-04', speciesId: 'torsk', locationName: 'Spot 1', notes: 'c' + n, ...over })
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)

function seedCatches(entries: unknown[], when: number) {
  fakeDb.seed('catches', { user_id: A, entries, updated_at: iso(when) })
}
function seedSetup(locations: unknown[], when: number, over: Record<string, unknown> = {}) {
  fakeDb.seed('setups', { user_id: A, setup: { locations, targetSpecies: ['torsk'], availability: [AVAIL], lang: 'da', ...over }, updated_at: iso(when) })
}
const rowNotes = () => (fakeDb.row('catches', A)?.entries ?? []).map((e: any) => e.notes).sort()
const rowLocIds = () => (fakeDb.row('setups', A)?.setup.locations ?? []).map((l: any) => l.id).sort()
const notes = (app: App) => app.catches.entries.map((e) => e.notes).sort()
const locIds = (app: App) => app.setup.locations.map((l) => l.id).sort()

interface App {
  pinia: Pinia
  auth: ReturnType<typeof useAuthStore>
  setup: ReturnType<typeof useSetupStore>
  catches: ReturnType<typeof useCatchStore>
}

// ── Devices ──────────────────────────────────────────────────────────

interface Device { name: string; storage: Map<string, string> }
const device = (name: string): Device => ({ name, storage: new Map() })
let current: Device | null = null
function snapshot(): Map<string, string> {
  const m = new Map<string, string>()
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!
    m.set(k, localStorage.getItem(k)!)
  }
  return m
}
/** Make `d`'s storage the one the app sees. */
function use(d: Device) {
  if (current && current !== d) current.storage = snapshot()
  localStorage.clear()
  for (const [k, v] of d.storage) localStorage.setItem(k, v)
  current = d
}

const live: App[] = []
/** One app start on whatever storage is current: a fresh Pinia, local state loaded, signed in. */
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
  live.push(app)
  return app
}
function dispose(app: App) {
  app.setup.$dispose()
  app.catches.$dispose()
  app.auth.$dispose()
  live.splice(live.indexOf(app), 1)
}
/** What main.ts does on start and on every identity change. */
async function hydrate(app: App) {
  app.setup.pauseSync()
  app.catches.pauseSync()
  await Promise.all([app.setup.pullRemote(), app.catches.pullRemote()])
  app.setup.markReady()
  app.catches.markReady()
}
/** Let the watcher run, the 1.5 s push debounce fire, and the push (and its retries) settle. */
async function settle(ms = 2000) {
  await nextTick()
  await vi.advanceTimersByTimeAsync(ms)
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

/**
 * One app session on `d` at time `when`: open, hydrate, do `fn`, let it sync,
 * close. Offline = every read and write fails, like a phone with no signal.
 */
async function session(d: Device, when: number, fn: (app: App) => void | Promise<void> = () => {}, opts: { offline?: boolean } = {}) {
  vi.setSystemTime(when)
  use(d)
  fakeDb.failReads = fakeDb.failWrites = !!opts.offline
  const app = openApp()
  try {
    await hydrate(app)
    await fn(app)
    await settle()
  } finally {
    fakeDb.failReads = fakeDb.failWrites = false
    dispose(app)
    d.storage = snapshot()
  }
  return app
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(FRI)
  localStorage.clear()
  fakeDb.reset()
  current = null
  toasts.value = []
})
afterEach(() => {
  while (live.length) dispose(live[0])
  vi.clearAllTimers()
  vi.useRealTimers()
  lang.value = 'da'
  localStorage.clear()
})

// ── The confirmed failure ────────────────────────────────────────────

describe('the Saturday/Sunday catch log', () => {
  it('keeps the catches the desktop backfilled when the phone pushes its offline catch', async () => {
    const phone = device('phone')
    const desktop = device('desktop')
    seedCatches(range(1, 5).map((n) => fish(n)), FRI)

    await session(phone, SAT_0800) // pulls the 5-catch log
    await session(desktop, SAT_1900, (app) => {
      for (const n of [6, 7, 8]) app.catches.add({ date: '2026-09-05', speciesId: 'torsk', locationName: 'Spot 1', notes: 'c' + n })
    })
    expect(rowNotes()).toHaveLength(8)

    // Sunday dawn, no signal: the catch is logged on the Saturday-morning copy.
    await session(phone, SUN_0600, (app) => {
      app.catches.add({ date: '2026-09-06', time: '05:50', speciesId: 'havorred', locationName: 'Spot 1', notes: 'c9' })
    }, { offline: true })

    // Back online: nothing either device logged may be gone.
    const all = [...range(1, 9).map((n) => 'c' + n)].sort()
    const p = await session(phone, SUN_0700)
    expect(notes(p)).toEqual(all)
    expect(rowNotes()).toEqual(all)
    const d = await session(desktop, SUN_0700 + 60_000)
    expect(notes(d)).toEqual(all)
  })
})

describe('a star toggled offline on a stale setup', () => {
  it("keeps the spots the desktop added, and the star", async () => {
    const phone = device('phone')
    const desktop = device('desktop')
    seedSetup(range(0, 17).map((i) => loc(i)), FRI)

    await session(phone, SAT_0800)
    await session(desktop, SAT_1900, (app) => { app.setup.locations.push(loc(18), loc(19)) })
    expect(rowLocIds()).toHaveLength(20)

    await session(phone, SUN_0600, (app) => {
      const l3 = app.setup.locations.find((l) => l.id === 'l3')!
      l3.fav = true
    }, { offline: true })

    const p = await session(phone, SUN_0700)
    expect(p.setup.locations).toHaveLength(20)
    expect(p.setup.locations.find((l) => l.id === 'l3')!.fav).toBe(true)
    expect(rowLocIds()).toHaveLength(20)
    expect(fakeDb.row('setups', A)!.setup.locations.find((l: any) => l.id === 'l3').fav).toBe(true)
    const d = await session(desktop, SUN_0700 + 60_000)
    expect(d.setup.locations.find((l) => l.id === 'l3')!.fav).toBe(true)
    expect(d.setup.locations).toHaveLength(20)
  })
})

describe('a spot dragged to the top on one device', () => {
  /**
   * The merge laid every result out in this device's order, so a reorder made
   * only on the other device was undone: the phone's offline star (or just a
   * language switch) merged and pushed [1, 2, 3] back over the desktop's drag.
   */
  it.each([
    ['stars a spot', (app: App) => { app.setup.locations.find((l) => l.id === 'l1')!.fav = true }],
    ['switches language', () => { lang.value = 'en' }],
  ])('keeps the new order when the phone %s offline', async (_, edit) => {
    const phone = device('phone')
    const desktop = device('desktop')
    seedSetup([loc(1), loc(2), loc(3)], FRI)
    await session(phone, SAT_0800)
    await session(desktop, SAT_0800 + 60_000)

    await session(desktop, SAT_1900, (app) => {
      const [l3] = app.setup.locations.splice(2, 1) // LocationsView.move(2, 0)
      app.setup.locations.splice(0, 0, l3)
    })
    await session(phone, SUN_0600, edit, { offline: true })
    const p = await session(phone, SUN_0700)

    expect(p.setup.locations.map((l) => l.id)).toEqual(['l3', 'l1', 'l2'])
    expect(fakeDb.row('setups', A)!.setup.locations.map((l: any) => l.id)).toEqual(['l3', 'l1', 'l2'])
    const d = await session(desktop, SUN_0700 + 60_000)
    expect(d.setup.locations.map((l) => l.id)).toEqual(['l3', 'l1', 'l2'])
  })
})

// ── Deletions against edits ──────────────────────────────────────────

describe('a delete on one device, an edit on the other', () => {
  it('applies the delete and keeps the edit when they touch different items', async () => {
    const phone = device('phone')
    const desktop = device('desktop')
    seedCatches([fish(1), fish(2), fish(3)], FRI)
    await session(phone, SAT_0800)
    await session(desktop, SAT_0800 + 60_000)

    await session(desktop, SAT_1900, (app) => { app.catches.remove('c1') })
    await session(phone, SUN_0600, (app) => {
      app.catches.update('c2', { ...fish(2), notes: 'c2 edited' })
    }, { offline: true })
    const p = await session(phone, SUN_0700)

    expect(notes(p)).toEqual(['c2 edited', 'c3'])
    expect(rowNotes()).toEqual(['c2 edited', 'c3'])
  })

  it('does the same for spots in the setup', async () => {
    const phone = device('phone')
    const desktop = device('desktop')
    seedSetup([loc(1), loc(2), loc(3)], FRI)
    await session(phone, SAT_0800)
    await session(desktop, SAT_0800 + 60_000)

    await session(desktop, SAT_1900, (app) => { app.setup.locations = app.setup.locations.filter((l) => l.id !== 'l1') })
    await session(phone, SUN_0600, (app) => { app.setup.locations.find((l) => l.id === 'l2')!.note = 'mole' }, { offline: true })
    const p = await session(phone, SUN_0700)

    expect(locIds(p)).toEqual(['l2', 'l3'])
    expect(rowLocIds()).toEqual(['l2', 'l3'])
    expect(p.setup.locations.find((l) => l.id === 'l2')!.note).toBe('mole')
  })

  it('keeps the edited catch when the other device deleted that same catch', async () => {
    const phone = device('phone')
    const desktop = device('desktop')
    seedCatches([fish(1), fish(2)], FRI)
    await session(phone, SAT_0800)
    await session(desktop, SAT_0800 + 60_000)

    await session(desktop, SAT_1900, (app) => { app.catches.remove('c1') })
    await session(phone, SUN_0600, (app) => { app.catches.update('c1', { ...fish(1), lengthCm: 62 }) }, { offline: true })
    const p = await session(phone, SUN_0700)

    expect(p.catches.entries.find((e) => e.id === 'c1')?.lengthCm).toBe(62)
    expect(fakeDb.row('catches', A)!.entries.find((e: any) => e.id === 'c1')?.lengthCm).toBe(62)
  })

  it("keeps the other device's edit when this device deleted that same catch offline", async () => {
    const phone = device('phone')
    const desktop = device('desktop')
    seedCatches([fish(1), fish(2)], FRI)
    await session(phone, SAT_0800)
    await session(desktop, SAT_0800 + 60_000)

    await session(desktop, SAT_1900, (app) => { app.catches.update('c1', { ...fish(1), lengthCm: 62 }) })
    await session(phone, SUN_0600, (app) => { app.catches.remove('c1') }, { offline: true })
    const p = await session(phone, SUN_0700)

    expect(p.catches.entries.find((e) => e.id === 'c1')?.lengthCm).toBe(62)
    expect(fakeDb.row('catches', A)!.entries.find((e: any) => e.id === 'c1')?.lengthCm).toBe(62)
  })
})

// ── The same field on both devices ───────────────────────────────────

describe('both devices edit the same field', () => {
  // The phone's offline edit is stamped an hour before the desktop's push in
  // one run and an hour after it in the other: a wall clock (or a skewed one)
  // must not decide which edit survives or whether the desktop's spot does.
  it.each([
    ['earlier', SAT_1900 - 3_600_000],
    ['later', SAT_1900 + 3_600_000],
  ])('goes to the device that merges, its edit stamped %s, and loses nothing else', async (_, phoneEditAt) => {
    const phone = device('phone')
    const desktop = device('desktop')
    seedSetup([loc(1, { note: 'old' }), loc(2)], FRI)
    await session(phone, SAT_0800)
    await session(desktop, SAT_0800 + 60_000)

    await session(phone, phoneEditAt, (app) => { app.setup.locations[0].note = 'phone' }, { offline: true })
    await session(desktop, SAT_1900, (app) => {
      app.setup.locations[0].note = 'desktop'
      app.setup.locations.push(loc(3))
    })
    const p = await session(phone, SUN_0700)

    expect(p.setup.locations.find((l) => l.id === 'l1')!.note).toBe('phone')
    expect(locIds(p)).toEqual(['l1', 'l2', 'l3'])
    // …and both devices converge on it.
    const d = await session(desktop, SUN_0700 + 60_000)
    expect(d.setup.locations.find((l) => l.id === 'l1')!.note).toBe('phone')
    expect(locIds(d)).toEqual(['l1', 'l2', 'l3'])
    expect(fakeDb.row('setups', A)!.setup.locations.find((l: any) => l.id === 'l1').note).toBe('phone')
  })
})

// ── Writes landing between this device's read and its write ──────────

describe('a write that lands between the pull and the push', () => {
  it("keeps an old app version's blind upsert that landed just before this push", async () => {
    const desktop = device('desktop')
    seedCatches([fish(1), fish(2), fish(3)], FRI)
    await session(desktop, SAT_1900, async (app) => {
      // The phone still runs the previous version: it upserts its whole log,
      // stamped by its own (slow) clock — earlier than the row it replaces.
      fakeDb.onNextWrite('catches', () => seedCatches([fish(1), fish(2), fish(3), fish('old-app')], FRI - 60_000))
      app.catches.add({ date: '2026-09-05', speciesId: 'torsk', locationName: 'Spot 1', notes: 'c4' })
    })
    expect(rowNotes()).toEqual(['c1', 'c2', 'c3', 'c4', 'cold-app'])
    const d = await session(desktop, SAT_1900 + 60_000)
    expect(notes(d)).toEqual(['c1', 'c2', 'c3', 'c4', 'cold-app'])
  })

  it('gives up quietly after a few attempts while the row keeps moving, then syncs on the next pull', async () => {
    const desktop = device('desktop')
    seedCatches([fish(1)], FRI)
    let n = 0
    const interfere = () => {
      n++
      const prev = fakeDb.row('catches', A)!
      seedCatches([...prev.entries, fish('other' + n)], FRI + n * 1000)
      fakeDb.onNextWrite('catches', interfere)
    }
    await session(desktop, SAT_1900, async (app) => {
      fakeDb.onNextWrite('catches', interfere)
      app.catches.add({ date: '2026-09-05', speciesId: 'torsk', locationName: 'Spot 1', notes: 'mine' })
      await settle()
      expect(toasts.value.filter((t) => t.type === 'error')).toHaveLength(0)
      expect(await app.catches.flush()).toBe(false) // still unsynced: logout would ask
      fakeDb.beforeWrite = [] // the other device stops
      await app.catches.pullRemote()
    })
    expect(rowNotes()).toContain('mine')
    for (let i = 1; i <= n; i++) expect(rowNotes()).toContain('cother' + i)
    // Bounded: a handful of attempts per push, not a loop.
    expect(fakeDb.requests.filter((r) => r.table === 'catches').length).toBeLessThan(12)
  })

  /**
   * A conditional update that matches nothing while the row reads back
   * unmoved wasn't beaten by another device: the server is refusing it (with
   * RLS on and no UPDATE policy, Postgres answers 0 rows and no error). The
   * blind upsert got a 42501 there and said "sync failed"; the retry loop
   * read that as "moved", tried three times, and gave up in silence — every
   * edit from then on stayed on this device alone, and nothing said so.
   */
  it.each([
    ['catch log', 'catches'],
    ['setup', 'setups'],
  ] as const)('says sync failed when the %s write is refused while the row has not moved', async (_, table) => {
    const desktop = device('desktop')
    seedCatches([fish(1)], FRI)
    seedSetup([loc(1)], FRI)
    await session(desktop, SAT_1900, async (app) => {
      fakeDb.noUpdatePolicy = true
      if (table === 'catches') app.catches.add({ date: '2026-09-05', speciesId: 'torsk', locationName: 'Spot 1', notes: 'mine' })
      else app.setup.locations.push(loc(2))
      await settle()
      expect(toasts.value.filter((t) => t.type === 'error')).toHaveLength(1)
      // One refused write, not a round of retries against a row that isn't moving.
      expect(fakeDb.requests.filter((r) => r.table === table && r.kind === 'update')).toHaveLength(1)
      expect(await (table === 'catches' ? app.catches : app.setup).flush()).toBe(false) // still unsynced: logout would ask
    })
  })
})

describe('two devices on the new version pushing at once', () => {
  it('lands both edits when both conditional updates race', async () => {
    seedCatches([fish(1), fish(2)], FRI)
    vi.setSystemTime(SAT_1900)
    const d1 = openApp()
    await hydrate(d1)
    const d2 = openApp()
    await hydrate(d2)
    fakeDb.holdWrites = true
    d1.catches.add({ date: '2026-09-05', speciesId: 'torsk', locationName: 'Spot 1', notes: 'd1' })
    d2.catches.add({ date: '2026-09-05', speciesId: 'torsk', locationName: 'Spot 1', notes: 'd2' })
    await settle()
    expect(fakeDb.heldWrites).toHaveLength(2) // both sent, neither landed
    fakeDb.holdWrites = false
    await fakeDb.releaseWrites()
    await settle()
    expect(rowNotes()).toEqual(['c1', 'c2', 'd1', 'd2'])
    expect(notes(d2)).toEqual(['c1', 'c2', 'd1', 'd2'])
    await d1.catches.pullRemote()
    expect(notes(d1)).toEqual(['c1', 'c2', 'd1', 'd2'])
  })

  it('lands both documents when both create the first row at once', async () => {
    vi.setSystemTime(SAT_1900)
    // Two devices, each with its own guest log, sign in to an account with no row yet.
    localStorage.setItem('fc2-catches', JSON.stringify({ entries: [fish('g1')], updatedAt: SAT_0800, ownerId: null, dirty: true }))
    const d1 = openApp()
    localStorage.setItem('fc2-catches', JSON.stringify({ entries: [fish('g2')], updatedAt: SAT_0800, ownerId: null, dirty: true }))
    const d2 = openApp()
    fakeDb.holdWrites = true
    const h = Promise.all([hydrate(d1), hydrate(d2)])
    for (let i = 0; i < 200 && fakeDb.heldWrites.length < 2; i++) await Promise.resolve()
    expect(fakeDb.heldWrites).toHaveLength(2)
    fakeDb.holdWrites = false
    await fakeDb.releaseWrites()
    await h
    await settle()
    expect(rowNotes()).toEqual(['cg1', 'cg2'])
    await d1.catches.pullRemote()
    expect(notes(d1)).toEqual(['cg1', 'cg2'])
    expect(notes(d2)).toEqual(['cg1', 'cg2'])
  })
})

// ── Catches linked to their spot ─────────────────────────────────────

describe('a spot renamed on one device while the other logs a catch there', () => {
  /**
   * Catches linked by name only: the desktop renamed "Spot 1" and rewrote its
   * catches; the phone — offline, on the old setup — then logged one more
   * under the old name. The merge keeps that catch, but by name it was linked
   * to nothing: no bite-score, out of the model check, until renamed by hand.
   */
  it('keeps the new catch linked to the renamed spot', async () => {
    const phone = device('phone')
    const desktop = device('desktop')
    seedSetup([loc(1), loc(2)], FRI)
    seedCatches([fish(1)], FRI)
    await session(phone, SAT_0800)
    await session(desktop, SAT_0800 + 60_000)

    await session(desktop, SAT_1900, async (app) => {
      await renameLocation('l1', 'Nordmolen', app.setup, app.catches)
    })
    // Sunday dawn, no signal: the phone's setup still calls the spot "Spot 1".
    await session(phone, SUN_0600, (app) => {
      // What CatchLogView saves: the typed name, and the spot it matches here.
      app.catches.add({ date: '2026-09-06', time: '05:50', speciesId: 'torsk', locationName: 'Spot 1', locationId: linkCatchLocation('Spot 1', app.setup.locations), notes: 'phone' })
    }, { offline: true })
    const p = await session(phone, SUN_0700)

    const logged = p.catches.entries.find((e) => e.notes === 'phone')!
    expect(findCatchLocation(logged, p.setup.locations)?.id).toBe('l1')
    expect(p.setup.locations.find((l) => l.id === 'l1')!.name).toBe('Nordmolen')
    const d = await session(desktop, SUN_0700 + 60_000)
    expect(findCatchLocation(d.catches.entries.find((e) => e.notes === 'phone')!, d.setup.locations)?.id).toBe('l1')
    // The rename's own rewrite reached the older catch, as before.
    expect(d.catches.entries.find((e) => e.id === 'c1')!.locationName).toBe('Nordmolen')
  })
})

describe("one catch's place changed on both devices", () => {
  /**
   * The name and the link were merged as separate fields: the desktop linked
   * the catch to saved "Spot 2", the phone typed "Havnen" offline, and the
   * merged catch said "Havnen" but resolved — by id first — to Spot 2, so the
   * list showed and scored it there although the phone's edit had won.
   */
  it("takes the phone's place whole, name and link together", async () => {
    const phone = device('phone')
    const desktop = device('desktop')
    seedSetup([loc(1), loc(2)], FRI)
    seedCatches([fish(1, { locationName: 'Bro' })], FRI)
    await session(phone, SAT_0800)
    await session(desktop, SAT_0800 + 60_000)

    await session(desktop, SAT_1900, (app) => {
      app.catches.update('c1', { ...fish(1), locationName: 'Spot 2', locationId: linkCatchLocation('Spot 2', app.setup.locations) })
    })
    await session(phone, SUN_0600, (app) => {
      app.catches.update('c1', { ...fish(1), locationName: 'Havnen', locationId: linkCatchLocation('Havnen', app.setup.locations) })
    }, { offline: true })
    const p = await session(phone, SUN_0700)

    const c1 = p.catches.entries.find((e) => e.id === 'c1')!
    expect(c1.locationName).toBe('Havnen')
    expect(findCatchLocation(c1, p.setup.locations)).toBeUndefined()
    expect(fakeDb.row('catches', A)!.entries[0].locationId).toBeUndefined()
  })
})

// ── Documents with no base ───────────────────────────────────────────

describe('a document saved by the previous app version (no base)', () => {
  it('unions an unsynced catch log with the row: nothing from either side is lost', async () => {
    const phone = device('phone')
    seedCatches([fish(1), fish(2), fish(3), fish(4)], SAT_1900) // the desktop added c4
    // What the previous version left on the phone: its own log, edited offline.
    phone.storage.set('fc2-catches', JSON.stringify({
      entries: [fish(9), fish(1), fish(2), fish(3)], updatedAt: SUN_0600, ownerId: A, dirty: true,
    }))
    const p = await session(phone, SUN_0700)
    expect(notes(p)).toEqual(['c1', 'c2', 'c3', 'c4', 'c9'])
    expect(rowNotes()).toEqual(['c1', 'c2', 'c3', 'c4', 'c9'])
  })

  it('unions an unsynced setup with the row', async () => {
    const phone = device('phone')
    seedSetup([loc(1), loc(2), loc(3)], SAT_1900, { targetSpecies: ['torsk', 'sild'] })
    phone.storage.set('fc2-setup', JSON.stringify({
      locations: [loc(1), loc(2, { fav: true }), loc(9)], targetSpecies: ['torsk', 'hornfisk'], availability: [AVAIL],
      updatedAt: SUN_0600, ownerId: A, dirty: true,
    }))
    const p = await session(phone, SUN_0700)
    expect(locIds(p)).toEqual(['l1', 'l2', 'l3', 'l9'])
    expect(p.setup.locations.find((l) => l.id === 'l2')!.fav).toBe(true) // the local copy of the same id
    expect([...p.setup.targetSpecies].sort()).toEqual(['hornfisk', 'sild', 'torsk'])
    expect(rowLocIds()).toEqual(['l1', 'l2', 'l3', 'l9'])
  })

  it('still simply adopts the row when the old document had nothing unsynced', async () => {
    const phone = device('phone')
    seedCatches([fish(1), fish(2)], SAT_1900)
    phone.storage.set('fc2-catches', JSON.stringify({ entries: [fish(1), fish(5)], updatedAt: SAT_0800, ownerId: A, dirty: false }))
    const p = await session(phone, SUN_0700)
    expect(notes(p)).toEqual(['c1', 'c2'])
    expect(fakeDb.writes).toHaveLength(0)
  })
})

// ── What must not change ─────────────────────────────────────────────

describe('the rules the account row already had', () => {
  it('still replaces guest data with the account row on sign-in, and writes nothing', async () => {
    const phone = device('phone')
    seedSetup(range(0, 17).map((i) => loc(i)), FRI)
    seedCatches([fish(1), fish(2)], FRI)
    phone.storage.set('fc2-setup', JSON.stringify({ locations: [loc(100), loc(101), loc(102)], targetSpecies: [], availability: [AVAIL], updatedAt: SUN_0600, ownerId: null, dirty: true }))
    phone.storage.set('fc2-catches', JSON.stringify({ entries: [fish('guest')], updatedAt: SUN_0600, ownerId: null, dirty: true }))
    const p = await session(phone, SUN_0700)
    expect(p.setup.locations).toHaveLength(18)
    expect(notes(p)).toEqual(['c1', 'c2'])
    expect(fakeDb.writes).toHaveLength(0)
  })

  it('still never pushes an empty local document, whatever it claims', async () => {
    const phone = device('phone')
    seedSetup(range(0, 17).map((i) => loc(i)), FRI)
    seedCatches([fish(1), fish(2)], FRI)
    // Wiped, then stamped and marked unsynced — and claiming the very row as its base.
    phone.storage.set('fc2-setup', JSON.stringify({ locations: [], targetSpecies: [], availability: [], updatedAt: SUN_0600, ownerId: A, dirty: true, baseAt: FRI, base: { locations: [loc(1)], targetSpecies: [], availability: [] } }))
    phone.storage.set('fc2-catches', JSON.stringify({ entries: [], updatedAt: SUN_0600, ownerId: A, dirty: true, baseAt: FRI, base: [fish(1)] }))
    const p = await session(phone, SUN_0700)
    expect(p.setup.locations).toHaveLength(18)
    expect(notes(p)).toEqual(['c1', 'c2'])
    expect(fakeDb.writes).toHaveLength(0)
  })
})

// ── Telling the user ─────────────────────────────────────────────────

describe('the merge notice', () => {
  const merged = () => toasts.value.filter((t) => t.message.includes(STRINGS.da.toast_sync_merged))

  it('says once, quietly, that changes from another device were merged in', async () => {
    const phone = device('phone')
    const desktop = device('desktop')
    seedCatches([fish(1)], FRI)
    seedSetup([loc(1)], FRI)
    await session(phone, SAT_0800)
    await session(desktop, SAT_1900, (app) => {
      app.catches.add({ date: '2026-09-05', speciesId: 'torsk', locationName: 'Spot 1', notes: 'desktop' })
      app.setup.locations.push(loc(2))
    })
    await session(phone, SUN_0600, (app) => {
      app.catches.add({ date: '2026-09-06', speciesId: 'torsk', locationName: 'Spot 1', notes: 'phone' })
      app.setup.locations[0].fav = true
    }, { offline: true })
    toasts.value = []
    await session(phone, SUN_0700) // both stores merge
    expect(merged()).toHaveLength(1)
    expect(merged()[0].type).toBe('info')
    expect(toasts.value.filter((t) => t.type === 'error')).toHaveLength(0)
  })

  it('stays silent for an ordinary push, an ordinary adopt, and a merge that changes nothing here', async () => {
    const phone = device('phone')
    const desktop = device('desktop')
    seedCatches([fish(1)], FRI)
    await session(phone, SAT_0800)
    await session(desktop, SAT_0800 + 60_000)
    await session(phone, SAT_1900, (app) => { app.catches.add({ date: '2026-09-05', speciesId: 'torsk', locationName: 'Spot 1', notes: 'p' }) })
    await session(desktop, SAT_1900 + 60_000) // adopts the phone's push
    // Both edit the same field; the merge keeps this device's value, so nothing new arrives here.
    await session(phone, SUN_0600, (app) => { app.catches.update('c1', { ...fish(1), notes: 'phone' }) }, { offline: true })
    await session(desktop, SUN_0600 + 60_000, (app) => { app.catches.update('c1', { ...fish(1), notes: 'desktop' }) })
    await session(phone, SUN_0700)
    expect(merged()).toHaveLength(0)
    expect(fakeDb.row('catches', A)!.entries.find((e: any) => e.id === 'c1').notes).toBe('phone')
  })
})
