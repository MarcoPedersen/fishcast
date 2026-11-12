import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { effectScope, nextTick, watch } from 'vue'
import type { User } from '@supabase/supabase-js'
import { fakeDb } from '@/test/fakeSupabase'
import { COAST_ALGO_VERSION, coastLine, coordKey, transientError, type CoastAuto } from '@/lib/coast'
import { DK_SPOTS } from '@/lib/spots'
import type { Location } from '@/lib/types'
import { useAuthStore } from './auth'
import { useSetupStore } from './setup'
import { useCoastStore, useSettledShores } from './coast'
import { deriveCoast, terminate } from '@/lib/coastClient'

vi.mock('@/lib/coastClient', () => ({ deriveCoast: vi.fn(), terminate: vi.fn() }))
const DRAGOR = DK_SPOTS.find((s) => s.slug === 'dragor-havn')!
// v: the current COAST_ALGO_VERSION — the store skips older catalogue entries
// (checked below, so a bump fails here by name, not as "derived 2 times").
vi.mock('@/lib/spotCoast.gen', () => ({
  SPOT_COAST: {
    'dragor-havn': {
      v: 2, src: 'catalogue', water: 'sea', facing: 100, nearFacing: 95, spread: 270, exposure: 'semi',
      fetchKm: Array.from({ length: 16 }, () => 5), pinToWaterM: 4, issues: [],
    },
    'helsingore-kysten': {
      v: 2, src: 'catalogue', water: 'sea', facing: 124, nearFacing: 97, spread: 270, exposure: 'semi',
      fetchKm: Array.from({ length: 16 }, () => 5), pinToWaterM: 0, issues: [],
    },
  },
}))
it('the mocked catalogue entry is of the current algorithm', async () => {
  expect((await import('@/lib/spotCoast.gen')).SPOT_COAST['dragor-havn'].v).toBe(COAST_ALGO_VERSION)
})

const derive = vi.mocked(deriveCoast)
const result = (over: Partial<CoastAuto> = {}): CoastAuto => ({
  v: COAST_ALGO_VERSION, at: Date.now(), src: 'versatiles', water: 'sea', facing: 270, nearFacing: 270, spread: 180,
  exposure: 'open', fetchKm: Array.from({ length: 16 }, (_, k) => (k >= 8 ? 25 : 0)), pinToWaterM: 3, issues: [], ...over,
})
const spot = (i: number, over: Partial<Location> = {}): Location =>
  ({ id: 'l' + i, name: 'Spot ' + i, lat: 55 + i / 100, lon: 12, waterType: 'salt', species: [{ nameEn: 'Cod', months: [1] }], ...over })

/** The store's debounce (1.5 s), the boot delay (3 s), and the jobs. */
async function run(ms = 5000) {
  await nextTick()
  await vi.advanceTimersByTimeAsync(ms)
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

function fresh() {
  setActivePinia(createPinia())
  return { coast: useCoastStore(), setup: useSetupStore() }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(new Date('2026-11-05T12:00:00.000Z'))
  localStorage.clear()
  fakeDb.reset()
  derive.mockReset()
  derive.mockImplementation(async () => result())
  vi.mocked(terminate).mockReset()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('coast store — automatic coasts per device (onshore spec §1.3–1.4)', () => {
  it('derives each non-fresh spot without an override once, and keeps the result across a reload', async () => {
    const { coast } = fresh()
    const locs = [spot(1), spot(2)]
    coast.ensure(locs)
    await run()
    expect(derive).toHaveBeenCalledTimes(2)
    expect(coast.autoFor(locs[0])?.facing).toBe(270)
    coast.ensure(locs)
    await run()
    expect(derive).toHaveBeenCalledTimes(2)
    const again = fresh().coast
    expect(again.autoFor(locs[1])?.facing).toBe(270)
    again.ensure(locs)
    await run()
    expect(derive).toHaveBeenCalledTimes(2)
  })

  it('skips spots with an override, "none", or fresh water', async () => {
    const { coast } = fresh()
    coast.ensure([
      spot(1, { coast: { facing: 90, spread: 180, exposure: 'open' } }),
      spot(2, { coast: 'none' }),
      spot(3, { waterType: 'fresh' }),
    ])
    await run()
    expect(derive).not.toHaveBeenCalled()
  })

  it('takes official spots from the catalogue, by slug or within 30 m, with no network', async () => {
    const { coast } = fresh()
    const bySlug = spot(1, { lat: DRAGOR.lat, lon: DRAGOR.lon, spotSlug: 'dragor-havn' })
    // startFromSpot drops spotSlug (audit §1): the coordinate match finds it, 20 m off.
    const byPos = spot(2, { lat: DRAGOR.lat + 20 / 110540, lon: DRAGOR.lon })
    coast.ensure([bySlug, byPos])
    await run()
    expect(derive).not.toHaveBeenCalled()
    expect(coast.autoFor(bySlug)).toMatchObject({ src: 'catalogue', facing: 100 })
    expect(coast.autoFor(byPos)).toMatchObject({ src: 'catalogue', facing: 100 })
  })

  /**
   * Helsingør Kysten moved from Helsingør town to Kronborg Pynten. A copy
   * saved before keeps the old pin: it is the same spot, so it takes the
   * spot's coast — the Sound's, not the pond the old pin sat by.
   */
  it('gives a copy saved at an official spot\'s former pin that spot\'s coast, with no network', async () => {
    const { coast } = fresh()
    const fromMap = spot(1, { lat: 56.0350, lon: 12.5890 })
    const fromFinder = spot(2, { lat: 56.0350 + 20 / 110540, lon: 12.5890, spotSlug: 'helsingore-kysten' })
    coast.ensure([fromMap, fromFinder])
    await run()
    expect(derive).not.toHaveBeenCalled()
    expect(coast.autoFor(fromMap)).toMatchObject({ src: 'catalogue', water: 'sea', facing: 124 })
    expect(coast.autoFor(fromFinder)).toMatchObject({ src: 'catalogue', water: 'sea', facing: 124 })
  })

  it('re-derives on a coordinate change, and on a version bump while the old value still serves', async () => {
    const { coast } = fresh()
    const l = spot(1)
    coast.ensure([l])
    await run()
    expect(derive).toHaveBeenCalledTimes(1)
    coast.ensure([{ ...l, lat: l.lat + 0.01 }])
    await run()
    expect(derive).toHaveBeenCalledTimes(2)
    // An entry from an older algorithm: used until the new one lands.
    localStorage.setItem('fc2-coast', JSON.stringify({ v: 1, entries: { [coordKey(l)]: result({ v: 0, facing: 200 }) } }))
    const s = fresh().coast
    let release!: (r: CoastAuto) => void
    derive.mockImplementationOnce(() => new Promise((r) => { release = r }))
    s.ensure([l])
    await run()
    expect(s.shoreById[l.id] ?? s.autoFor(l)).toBeTruthy()
    expect(s.autoFor(l)?.facing).toBe(200)
    release(result({ facing: 260 }))
    await run()
    expect(s.autoFor(l)?.facing).toBe(260)
  })

  it('records a failure, backs off 1 h, then retries; "Prøv igen" ignores the backoff', async () => {
    const { coast } = fresh()
    const l = spot(1)
    derive.mockRejectedValue(new Error('offline tile'))
    coast.ensure([l])
    await run()
    expect(coast.statusFor(l)).toBe('failed')
    expect(coast.autoFor(l)).toBeUndefined()
    expect(JSON.parse(localStorage.getItem('fc2-coast')!).entries[coordKey(l)]).toMatchObject({ tries: 1 })
    coast.ensure([l])
    await run()
    expect(derive).toHaveBeenCalledTimes(1) // within the hour
    vi.setSystemTime(Date.now() + 3600_000 + 1000)
    coast.ensure([l])
    await run()
    expect(derive).toHaveBeenCalledTimes(2) // after it; fails again → 6 h
    expect(JSON.parse(localStorage.getItem('fc2-coast')!).entries[coordKey(l)]).toMatchObject({ tries: 2 })
    derive.mockResolvedValue(result())
    coast.retry(l)
    await run(100)
    expect(derive).toHaveBeenCalledTimes(3) // "Prøv igen" doesn't wait the 6 h
    expect(coast.autoFor(l)?.facing).toBe(270)
    expect(coast.statusFor(l)).toBeUndefined()
  })

  /**
   * Review: 'failed' lived only in this session's status map. After a reload
   * the stored failure kept the spot inside its backoff, unknown: the card
   * read "Kystretning ikke fundet endnu", as if still searching, and the
   * "Prøv igen" of the row and the picker (both shown on 'failed') was gone.
   */
  it('still reads a stored failure as failed after a reload, so "Prøv igen" stays', async () => {
    const { coast } = fresh()
    const l = spot(1)
    derive.mockRejectedValue(new Error('tile 503'))
    coast.ensure([l])
    await run()
    expect(coast.statusFor(l)).toBe('failed')
    vi.setSystemTime(Date.now() + 10 * 60_000)
    const again = fresh().coast // the reload
    again.ensure([l])
    await run()
    expect(derive).toHaveBeenCalledTimes(1) // inside the backoff
    expect(again.statusFor(l)).toBe('failed')
    expect(coastLine(l, again.autoFor(l), again.statusFor(l))).toEqual({ kind: 'failed' })
    derive.mockResolvedValue(result())
    again.retry(l)
    expect(again.statusFor(l)).toBe('pending')
    await run(100)
    expect(again.statusFor(l)).toBeUndefined()
    expect(again.autoFor(l)?.facing).toBe(270)
  })

  /**
   * Review: the 5 s landing cleared the 'pending' of every key it landed. A
   * failure still waiting to land, then "Prøv igen": the tap's 'pending' went
   * with the landing, and the row read "kunne ikke hentes" with "Prøv igen"
   * again until the next pass reached the spot, as if the tap did nothing.
   */
  it('"Prøv igen" before its failure has landed stays pending until the retry lands', async () => {
    const locs = [spot(1), spot(2), spot(3), spot(4)]
    let failed = false
    derive.mockImplementation((lat) => (lat === locs[0].lat && !failed
      ? (failed = true, Promise.reject(new Error('tile 503')))
      : new Promise((r) => setTimeout(() => r(result()), 8000))))
    const { coast } = fresh()
    coast.ensure(locs)
    await run(4600) // the boot delay and the debounce: spot 1 has failed, spot 2 is deriving
    expect(coast.statusFor(locs[0])).toBe('failed')
    coast.retry(locs[0])
    const seen = new Set<string | undefined>()
    for (let s = 0; s < 40 && !coast.autoFor(locs[0]); s++) {
      await run(1000)
      if (!coast.autoFor(locs[0])) seen.add(coast.statusFor(locs[0]))
    }
    expect([...seen]).toEqual(['pending'])
    expect(coast.autoFor(locs[0])?.facing).toBe(270)
    expect(coast.statusFor(locs[0])).toBeUndefined()
  })

  /**
   * Review: a failure, then the user's own direction. Nothing is derived for
   * a spot with a choice, so the stored failure stays, and after every reload
   * the picker offered "Prøv igen" beside the manual coast — a tap that read
   * 'pending' and derived nothing. "Brug automatisk retning" is the way back.
   */
  it("a spot with the user's own coast reads neither failed nor pending, after a reload too", async () => {
    const { coast } = fresh()
    const l = spot(1)
    derive.mockRejectedValue(new Error('tile 503'))
    coast.ensure([l])
    await run()
    expect(coast.statusFor(l)).toBe('failed')
    const manual = spot(1, { coast: { facing: 90, spread: 180, exposure: 'open' } })
    expect(coast.statusFor(manual)).toBeUndefined() // this session
    vi.setSystemTime(Date.now() + 10 * 60_000)
    const again = fresh().coast // the reload
    again.ensure([manual])
    await run()
    expect(again.statusFor(manual)).toBeUndefined()
    expect(again.statusFor(spot(1, { coast: 'none' }))).toBeUndefined()
    expect(again.statusFor(spot(1, { waterType: 'fresh' }))).toBeUndefined()
    expect(again.statusFor(l)).toBe('failed') // automatic again: the failure and its "Prøv igen" are back
    expect(derive).toHaveBeenCalledTimes(1)
  })

  it('a spot keeps "pending" until its result lands, never "failed" or "unknown" in between', async () => {
    const l1 = spot(1), l2 = spot(2)
    // A failure from two hours ago: past its backoff, so it is derived again.
    localStorage.setItem('fc2-coast', JSON.stringify({ v: 1, entries: { [coordKey(l1)]: { v: COAST_ALGO_VERSION, failedAt: Date.now() - 2 * 3600_000, tries: 1 } } }))
    const c = fresh().coast
    let release!: (r: CoastAuto) => void
    derive.mockImplementationOnce(async () => result()) // l1: done, waiting to land
    derive.mockImplementationOnce(() => new Promise((r) => { release = r })) // l2: holds the run open
    c.ensure([l1, l2])
    await run(4600) // the boot delay and the debounce: both derivations started, nothing landed yet
    expect(derive).toHaveBeenCalledTimes(2)
    expect(c.autoFor(l1)).toBeUndefined()
    expect(coastLine(l1, c.autoFor(l1), c.statusFor(l1))).toEqual({ kind: 'pending' })
    release(result())
    await run(100)
    expect(coastLine(l1, c.autoFor(l1), c.statusFor(l1))).toMatchObject({ kind: 'coast', src: 'auto' })
  })

  /**
   * Review: a spot whose tiles failed on a dead connection got the same
   * failure as a server error: 1 h, then 6 h, then 24 h. The signal came
   * back, 'online' fired, and the backoff still held the spot unknown.
   */
  describe('a failure on the way to the tiles (no connection, dropped, timed out)', () => {
    const stored = (l: Location) => JSON.parse(localStorage.getItem('fc2-coast')!).entries[coordKey(l)]
    let win: EventTarget
    beforeEach(() => {
      win = new EventTarget()
      vi.stubGlobal('window', win)
      vi.stubGlobal('navigator', { onLine: true })
    })

    it('does not escalate the backoff, and coming back online re-arms it', async () => {
      const { coast } = fresh()
      const l = spot(1)
      derive.mockRejectedValue(transientError('tile request: TypeError: Failed to fetch'))
      coast.ensure([l])
      await run()
      expect(coast.statusFor(l)).toBe('failed')
      expect(stored(l)).toMatchObject({ tries: 0, net: true })
      // The next start within 10 min leaves it; one after tries again.
      vi.setSystemTime(Date.now() + 5 * 60_000)
      coast.ensure([l])
      await run()
      expect(derive).toHaveBeenCalledTimes(1)
      vi.setSystemTime(Date.now() + 6 * 60_000)
      coast.ensure([l])
      await run()
      expect(derive).toHaveBeenCalledTimes(2)
      expect(stored(l)).toMatchObject({ tries: 0, net: true }) // still no step up the 1 h / 6 h / 24 h ladder
      // Back online 5 min later: re-derived, inside any backoff.
      vi.setSystemTime(Date.now() + 5 * 60_000)
      derive.mockResolvedValue(result())
      win.dispatchEvent(new Event('online'))
      await run()
      expect(derive).toHaveBeenCalledTimes(3)
      expect(coast.autoFor(l)?.facing).toBe(270)
      expect(coast.statusFor(l)).toBeUndefined()
    })

    it('a failure while the device is offline counts as one, whatever the error says', async () => {
      const { coast } = fresh()
      const locs = [spot(1), spot(2), spot(3)]
      let n = 0
      derive.mockImplementation(async () => {
        if (++n === 1) return result()
        ;(globalThis.navigator as { onLine: boolean }).onLine = false // the connection drops after the first spot
        throw new Error('coast worker error')
      })
      coast.ensure(locs)
      await run()
      expect(locs.map((l) => coast.statusFor(l))).toEqual([undefined, 'failed', 'failed'])
      expect(stored(locs[1])).toMatchObject({ tries: 0, net: true })
      vi.setSystemTime(Date.now() + 5 * 60_000)
      vi.stubGlobal('navigator', { onLine: true })
      derive.mockImplementation(async () => result())
      win.dispatchEvent(new Event('online'))
      await run()
      expect(locs.map((l) => coast.autoFor(l)?.facing)).toEqual([270, 270, 270])
    })

    it('keeps the escalation of earlier server errors, and resumes it on the next one', async () => {
      const { coast } = fresh()
      const l = spot(1)
      derive.mockRejectedValue(new Error('tile 503'))
      coast.ensure([l])
      await run()
      expect(stored(l)).toMatchObject({ tries: 1 })
      vi.setSystemTime(Date.now() + 3600_000 + 1000)
      derive.mockRejectedValue(transientError('coast derivation timed out'))
      coast.ensure([l])
      await run()
      expect(stored(l)).toMatchObject({ tries: 1, net: true })
      vi.setSystemTime(Date.now() + 60_000)
      derive.mockRejectedValue(new Error('tile 503'))
      win.dispatchEvent(new Event('online'))
      await run()
      expect(derive).toHaveBeenCalledTimes(3)
      expect(stored(l)).toMatchObject({ v: COAST_ALGO_VERSION, tries: 2 }) // the 6 h step, as two 503s in a row
      expect(stored(l).net).toBeUndefined()
    })

    it('a server error or a bad tile is not re-armed by the online event', async () => {
      const { coast } = fresh()
      const l = spot(1)
      derive.mockRejectedValue(new Error('tile 503'))
      coast.ensure([l])
      await run()
      vi.setSystemTime(Date.now() + 5 * 60_000)
      win.dispatchEvent(new Event('online'))
      await run()
      expect(derive).toHaveBeenCalledTimes(1)
      expect(stored(l)).toMatchObject({ tries: 1 })
      expect(stored(l).net).toBeUndefined()
    })
  })

  it('does nothing offline, and resumes on the online event', async () => {
    const win = new EventTarget()
    vi.stubGlobal('window', win)
    vi.stubGlobal('navigator', { onLine: false })
    const { coast } = fresh()
    coast.ensure([spot(1)])
    await run()
    expect(derive).not.toHaveBeenCalled()
    vi.stubGlobal('navigator', { onLine: true })
    win.dispatchEvent(new Event('online'))
    await run()
    expect(derive).toHaveBeenCalledTimes(1)
  })

  /**
   * The constraint behind the whole design: an automatic value is never an
   * edit of the synced setup. Writing it there on load would stamp, save and
   * push the document on every device after every update.
   */
  it('never writes the setup: 18 derivations, no setup change, no save, no push', async () => {
    setActivePinia(createPinia())
    const auth = useAuthStore()
    auth.user = { id: 'user-a' } as User
    fakeDb.session = { user: { id: 'user-a' } }
    const locs = Array.from({ length: 18 }, (_, i) => spot(i))
    fakeDb.seed('setups', { user_id: 'user-a', setup: { locations: locs, targetSpecies: ['havørred'], availability: [], lang: 'da' }, updated_at: '2026-11-01T00:00:00.000Z' })
    const setup = useSetupStore()
    setup.loadLocal()
    await setup.pullRemote()
    setup.markReady()
    await run()
    const before = { json: JSON.stringify(setup.locations), saved: localStorage.getItem('fc2-setup'), writes: fakeDb.writes.length }
    const coast = useCoastStore()
    coast.ensure(setup.locations)
    await run(10_000)
    expect(derive).toHaveBeenCalledTimes(18)
    expect(Object.keys(coast.shoreById)).toHaveLength(18)
    expect(JSON.stringify(setup.locations)).toBe(before.json)
    expect(localStorage.getItem('fc2-setup')).toBe(before.saved)
    expect(fakeDb.writes.length).toBe(before.writes)
  })

  it('clear() drops a result that lands afterwards, and removes fc2-coast', async () => {
    const { coast } = fresh()
    const l = spot(1)
    let release!: (r: CoastAuto) => void
    derive.mockImplementationOnce(() => new Promise((r) => { release = r }))
    coast.ensure([l, spot(2)])
    await run()
    coast.clear()
    expect(terminate).toHaveBeenCalled()
    release(result())
    await run()
    expect(coast.autoFor(l)).toBeUndefined()
    expect(localStorage.getItem('fc2-coast')).toBeNull()
  })

  /**
   * Review: logging out in one tab removes fc2-coast. The other tab's storage
   * event only took entries newer than its own, so it kept the old account's
   * spot coordinates in memory, and its next save wrote them all back.
   */
  it("another tab's logout wipes this tab's coasts too, and drops what it was deriving", async () => {
    const l1 = spot(1), l2 = spot(2), l3 = spot(3)
    const b = fresh()
    b.coast.ensure([l1])
    await run()
    expect(b.coast.autoFor(l1)).toBeDefined()
    let release!: (r: CoastAuto) => void
    derive.mockImplementationOnce(() => new Promise((r) => { release = r }))
    b.coast.ensure([l1, l2])
    await run()
    const a = fresh()
    a.coast.clear() // tab A logs out
    vi.mocked(terminate).mockClear()
    b.coast.reloadLocal() // tab B: the storage event
    expect(b.coast.autoFor(l1)).toBeUndefined()
    expect(b.coast.statusFor(l2)).toBeUndefined()
    expect(terminate).toHaveBeenCalled()
    release(result()) // l2's derivation, started for the old account
    await run()
    // B goes on with the next account's spot; its save holds only that one.
    b.coast.ensure([l3])
    await run()
    expect(Object.keys(JSON.parse(localStorage.getItem('fc2-coast')!).entries)).toEqual([coordKey(l3)])
  })

  it("another tab's save is merged, not taken as a wipe", async () => {
    const l1 = spot(1), l2 = spot(2)
    const a = fresh()
    a.coast.ensure([l1])
    await run()
    const b = fresh()
    b.coast.ensure([l2])
    await run()
    a.coast.reloadLocal()
    expect(a.coast.autoFor(l1)).toBeDefined()
    expect(a.coast.autoFor(l2)).toBeDefined()
  })

  it('shoreById: manual wins, none/fresh/inland → null, failure → absent, stale → used', async () => {
    const { coast, setup } = fresh()
    const manual = spot(1, { coast: { facing: 45, spread: 270, exposure: 'semi' } })
    const none = spot(2, { coast: 'none' })
    const freshW = spot(3, { waterType: 'fresh' })
    const inland = spot(4), failed = spot(5), stale = spot(6)
    localStorage.setItem('fc2-coast', JSON.stringify({ v: 1, entries: {
      [coordKey(manual)]: result({ facing: 300 }),
      [coordKey(inland)]: result({ water: 'inland', facing: null, exposure: null, fetchKm: [] }),
      [coordKey(failed)]: { v: 1, failedAt: Date.now(), tries: 1 },
      [coordKey(stale)]: result({ v: 0, facing: 210 }),
    } }))
    const c2 = fresh()
    c2.setup.locations = [manual, none, freshW, inland, failed, stale]
    const m = c2.coast.shoreById
    expect(m[manual.id]).toMatchObject({ mode: 'manual', facing: 45 })
    expect(m[none.id]).toBeNull()
    expect(m[freshW.id]).toBeNull()
    expect(m[inland.id]).toBeNull()
    expect(failed.id in m).toBe(false)
    expect(m[stale.id]).toMatchObject({ mode: 'auto', facing: 210 })
    void coast; void setup
  })

  /**
   * Review: a 'gap' or 'enclosed' spot was absent from shoreById — "not known
   * yet" — until the user picked, possibly forever. The official twins only
   * get their coast once every coastal spot of yours is known, so with the
   * owner's three gap spots no twin ever did: an offshore hour cost the
   * owner's spot −3 while the twin beside it got the direction-blind +3.
   */
  it("shoreById: a spot waiting for the user's pick is known and unscored (null), not pending", async () => {
    const gap = spot(1), closed = spot(2)
    localStorage.setItem('fc2-coast', JSON.stringify({ v: 1, entries: {
      [coordKey(gap)]: result({ issues: ['gap'] }),
      [coordKey(closed)]: result({ issues: ['enclosed', 'gap'] }),
    } }))
    const c = fresh()
    c.setup.locations = [gap, closed]
    expect(c.coast.shoreById).toEqual({ [gap.id]: null, [closed.id]: null })
  })

  /**
   * Review: confirm() sets ok without changing `at`. Another tab took only
   * strictly newer entries, so it never saw the ok — and its next save won
   * the tie with its own copy, without ok: the prompt came back on reload.
   */
  it('keeps "Ser rigtigt ud" when another tab saves the same entry afterwards', async () => {
    const l = spot(1), other = spot(2)
    localStorage.setItem('fc2-coast', JSON.stringify({ v: 1, entries: { [coordKey(l)]: result({ issues: ['far'] }) } }))
    const a = fresh(), b = fresh()
    a.setup.locations = b.setup.locations = [l, other]
    a.coast.confirm(l)
    b.coast.reloadLocal() // the storage event
    expect(b.coast.autoFor(l)?.ok).toBe(true)
    b.coast.ensure([l, other]) // B lands a result for another spot, and saves
    await run()
    expect(JSON.parse(localStorage.getItem('fc2-coast')!).entries[coordKey(l)].ok).toBe(true)
    expect(fresh().coast.autoFor(l)?.ok).toBe(true)
  })

  it('confirm writes ok on this device only; a re-derivation that moves the facing drops it', async () => {
    const { coast, setup } = fresh()
    const l = spot(1)
    setup.locations = [l]
    derive.mockResolvedValueOnce(result({ issues: ['far'] }))
    coast.ensure([l])
    await run()
    const before = JSON.stringify(setup.locations)
    coast.confirm(l)
    expect(coast.autoFor(l)?.ok).toBe(true)
    expect(JSON.stringify(setup.locations)).toBe(before)
    // Same facing within 22.5°, same shape: the confirmation stays.
    derive.mockResolvedValueOnce(result({ facing: 280, issues: ['far'] }))
    coast.retry(l)
    await run(100)
    expect(coast.autoFor(l)?.ok).toBe(true)
    // 40° away: it was confirmed for a different answer.
    derive.mockResolvedValueOnce(result({ facing: 320, issues: ['far'] }))
    coast.retry(l)
    await run(100)
    expect(coast.autoFor(l)?.ok).toBeUndefined()
  })
})

/**
 * Review: results land every 5 s while the queue runs (the first start after
 * an update derives every spot), and each landing moved havørred scores by up
 * to ~6: the dashboard's score-sorted cards jumped under the user's thumb, as
 * they did mid-refresh before the forecast hold. The dashboard sorts by the
 * settled coasts, which take a run's results in one step when it ends.
 */
describe('deriving, and the settled coasts the dashboard sorts by', () => {
  function settled() {
    const scope = effectScope()
    return { held: scope.run(() => useSettledShores())!, stop: () => scope.stop() }
  }

  it('hold while the queue runs, and take its results in one step when it ends', async () => {
    const { coast, setup } = fresh()
    const l1 = spot(1), l2 = spot(2)
    setup.locations = [l1, l2]
    const { held, stop } = settled()
    let release!: (r: CoastAuto) => void
    derive.mockImplementationOnce(async () => result())
    derive.mockImplementationOnce(() => new Promise((r) => { release = r }))
    coast.ensure([l1, l2])
    await run(4600) // both started: l1 done, l2 still running
    expect(coast.deriving).toBe(true)
    await run(5000) // the 5 s landing: l1 is in, and the Spots tab shows it
    expect(Object.keys(coast.shoreById)).toEqual([l1.id])
    expect(held.value).toEqual({})
    release(result())
    await run(100)
    expect(coast.deriving).toBe(false)
    expect(Object.keys(held.value).sort()).toEqual([l1.id, l2.id])
    stop()
  })

  it("follow the user's own changes at once when nothing runs", async () => {
    const { coast, setup } = fresh()
    const l = spot(1, { coast: { facing: 90, spread: 180, exposure: 'open' } })
    setup.locations = [l]
    const { held, stop } = settled()
    expect(held.value[l.id]).toMatchObject({ mode: 'manual', facing: 90 })
    setup.locations[0].coast = { facing: 180, spread: 180, exposure: 'open' }
    await nextTick()
    expect(held.value[l.id]).toMatchObject({ mode: 'manual', facing: 180 })
    stop()
  })

  it('never hold for good: deriving ends after a failure, offline, with nothing to do, and on logout', async () => {
    const win = new EventTarget()
    vi.stubGlobal('window', win)
    vi.stubGlobal('navigator', { onLine: true })
    const { coast, setup } = fresh()
    const l = spot(1)
    setup.locations = [l]
    const seen: boolean[] = []
    const scope = effectScope()
    scope.run(() => watch(() => coast.deriving, (d) => seen.push(d), { flush: 'sync' }))
    // A failure.
    derive.mockRejectedValue(new Error('tile 503'))
    coast.ensure([l])
    await run()
    expect(seen).toEqual([true, false])
    // Nothing to do: inside the backoff, a fresh-water spot, an override.
    coast.ensure([l, spot(2, { waterType: 'fresh' }), spot(3, { coast: 'none' })])
    await run()
    expect(seen).toEqual([true, false])
    // Offline.
    vi.stubGlobal('navigator', { onLine: false })
    coast.ensure([spot(4)])
    await run()
    expect(seen).toEqual([true, false])
    // Logout mid-run.
    vi.stubGlobal('navigator', { onLine: true })
    derive.mockImplementation(() => new Promise(() => {}))
    coast.ensure([spot(5)])
    await run()
    expect(coast.deriving).toBe(true)
    coast.clear()
    expect(coast.deriving).toBe(false)
    scope.stop()
  })
})
