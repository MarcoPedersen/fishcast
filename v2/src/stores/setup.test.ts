import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import type { User } from '@supabase/supabase-js'
import { useSetupStore } from './setup'
import { useAuthStore } from './auth'
import { getScoredWindows } from '@/lib/scoring'
import { locationFromSearch } from '@/lib/placeSearch'
import { speciesFromNearby } from '@/lib/geo'
import { speciesEntry } from '@/lib/locationSpecies'
import { DK_SPOTS, locationFromSpot } from '@/lib/spots'
import { fakeDb } from '@/test/fakeSupabase'
import { SCORES_KEY } from '@/lib/forgetOnLogout'
import { fakeQuota } from '@/test/fakeQuota'

const LS_KEY = 'fc2-setup'
const read = () => {
  const raw = localStorage.getItem(LS_KEY)
  return raw ? JSON.parse(raw) : null
}

describe('setup store — local persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('stamps updatedAt on a genuine edit once sync is armed', async () => {
    const s = useSetupStore()
    s.markReady()
    s.locations.push({ id: 'a', name: 'A', lat: 56, lon: 10 })
    await nextTick()
    const saved = read()
    expect(saved.locations).toHaveLength(1)
    expect(saved.updatedAt).toBeGreaterThan(0)
  })

  // Kept bite-scores and the weather cache are derived: with the storage full,
  // they give way to the spots (lib/safeStorage writeOwn).
  it('a spot added with the storage full of kept bite-scores is kept; the scores give way', async () => {
    localStorage.setItem(SCORES_KEY, 's'.repeat(5000))
    fakeQuota(5200)
    const s = useSetupStore()
    s.markReady()
    s.locations.push({ id: 'a', name: 'A', lat: 56, lon: 10 })
    await nextTick()
    vi.restoreAllMocks()
    expect(read()?.locations).toHaveLength(1)
    expect(localStorage.getItem(SCORES_KEY)).toBeNull()
  })

  it('does not stamp or rewrite its own local load', async () => {
    localStorage.setItem(LS_KEY, JSON.stringify({
      locations: [{ id: 'a', name: 'A', lat: 56, lon: 10 }], targetSpecies: [], availability: [],
      updatedAt: 1000, ownerId: null, dirty: false,
    }))
    const s = useSetupStore()
    s.markReady()
    s.loadLocal()
    await nextTick()
    await nextTick()
    expect(s.locations).toHaveLength(1)
    expect(read().updatedAt).toBe(1000)
  })

  /**
   * Regression — an edit made while the hydration pull was in flight kept the
   * old stamp, so the pull's tie went to the remote and silently reverted it.
   * Only the store's own hydration writes are unstamped now.
   */
  it('stamps a user edit made before markReady (pull still in flight)', async () => {
    const s = useSetupStore()
    s.locations.push({ id: 'a', name: 'A', lat: 56, lon: 10 })
    await nextTick()
    expect(read().updatedAt).toBeGreaterThan(0)
  })

  /**
   * Regression — the sign-out data-loss bug. clear() empties state, but the deep
   * watcher fires afterwards; it used to stamp a fresh updatedAt onto the wiped
   * state and re-save it. That made the wipe look like the newest edit, so the
   * next login kept the empty local copy and overwrote the account's real data.
   * After clear() the key must simply be gone.
   */
  it('clear() leaves no rewritten state behind (no fresh stamp on a wipe)', async () => {
    const s = useSetupStore()
    s.markReady()
    s.locations.push({ id: 'a', name: 'A', lat: 56, lon: 10 })
    s.availability.push({ id: 'av', days: [1], from: '06:00', to: '10:00', methods: ['shore'] })
    await nextTick()
    expect(read().locations).toHaveLength(1)

    s.clear()
    await nextTick()
    await nextTick() // watcher flush + the clearing-flag release

    expect(localStorage.getItem(LS_KEY)).toBeNull()
    expect(s.locations).toHaveLength(0)
    expect(s.availability).toHaveLength(0)
  })

  it('resumes stamping normally after a clear', async () => {
    const s = useSetupStore()
    s.markReady()
    s.clear()
    await nextTick()
    await nextTick()

    s.locations.push({ id: 'b', name: 'B', lat: 55, lon: 12 })
    await nextTick()
    const saved = read()
    expect(saved.locations).toHaveLength(1)
    expect(saved.updatedAt).toBeGreaterThan(0)
  })
})

describe('setup store — species enrichment', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  // Dragør harbour — an official spot sits well within the 12 km lookup radius,
  // which is what makes the spot-relevance bonus reachable for a custom pin.
  const NEAR_OFFICIAL = { id: 'd1', name: 'Sydmolen', lat: 55.5926, lon: 12.6716 }

  it('fills in species for a location added without them', async () => {
    const s = useSetupStore()
    s.markReady()
    s.locations.push({ ...NEAR_OFFICIAL })
    const changed = await s.enrichMissingSpecies()
    expect(changed).toBe(1)
    expect(s.locations[0].species!.length).toBeGreaterThan(0)
  })

  it('reports nothing changed on a second pass', async () => {
    const s = useSetupStore()
    s.markReady()
    s.locations.push({ ...NEAR_OFFICIAL })
    await s.enrichMissingSpecies()
    expect(await s.enrichMissingSpecies()).toBe(0)
  })

  /**
   * The actual regression: enrichment used to run only at bootstrap, so a spot
   * added from search or the map kept an empty species list for the rest of the
   * session and scored up to 12 points below an official spot in the same place.
   * Adding one must now enrich it without any explicit call.
   */
  it('enriches a location added mid-session, with no explicit call', async () => {
    const s = useSetupStore()
    s.markReady()
    s.locations.push({ ...NEAR_OFFICIAL })
    // watcher → enrichMissingSpecies() → dynamic import → mutation
    for (let i = 0; i < 10 && !s.locations[0].species?.length; i++) {
      await nextTick()
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(s.locations[0].species?.length ?? 0).toBeGreaterThan(0)
  })

  // Hornbæk's 12 km takes in Gurre Sø and the coast at Helsingør: a
  // freshwater spot there was given mackerel and garfish the picker hides.
  it('fills in only species that live in the location\'s water type', async () => {
    const s = useSetupStore()
    s.markReady()
    s.locations.push({ id: 'h', name: 'Hornbæk', lat: 56.09027, lon: 12.45693, waterType: 'fresh' })
    await s.enrichMissingSpecies()
    const names = (s.locations[0].species ?? []).map((sp) => sp.nameEn)
    expect(names).toContain('Pike')
    expect(names).not.toContain('Mackerel')
    expect(names).not.toContain('Garfish')
  })

  // Sea trout run up the rivers (regulations: salt and fresh water): a fresh
  // spot on the Gudenå at Randers was filled in without it.
  it('fills in sea trout at a river spot set to fresh water', async () => {
    const s = useSetupStore()
    s.markReady()
    s.locations.push({ id: 'r', name: 'Gudenå, Randers', lat: 56.4607, lon: 10.0364, waterType: 'fresh' })
    await s.enrichMissingSpecies()
    expect((s.locations[0].species ?? []).map((sp) => sp.nameEn)).toContain('Sea Trout')
  })

  /**
   * Hornbæk picked in the location search is guessed brackish, and brackish
   * water takes salt and fresh species alike (waterCompatible), so the lookup
   * kept everything within 12 km: the carp, pike, perch and zander of Gurre
   * Sø and Esrum Sø, 7 and 11 km inland, with Helsingør Kysten's sea trout,
   * garfish and mackerel. 8 species were saved, "7 arter valgt" (the eighth,
   * "Brown Trout (river/lake)", is no species the app knows). A sea spot
   * takes the species of the sea's official spots only. Dronningmølle has
   * only the lakes within 12 km, and is left for the user to pick.
   */
  it('a coastal place from the search takes no species from the lakes near it', async () => {
    const s = useSetupStore()
    s.markReady()
    const at = (name: string, lat: number, lon: number) =>
      ({ id: name, ...locationFromSearch({ name, admin1: 'Region Hovedstaden', lat, lon, country: 'Danmark' }) })
    s.locations.push(at('Hornbæk', 56.09027, 12.45693), at('Dronningmølle', 56.09492, 12.38523))
    expect(s.locations.map((l) => l.waterType)).toEqual(['brackish', 'brackish'])
    await s.enrichMissingSpecies()
    const names = (s.locations[0].species ?? []).map((sp) => sp.nameEn)
    expect(names.sort()).toEqual(['Garfish', 'Mackerel', 'Sea Trout'])
    expect(s.locations[1].species ?? []).toEqual([])
  })

  it('leaves a location with no official spot in range empty', async () => {
    const s = useSetupStore()
    s.markReady()
    // Mid-North Sea: nothing within the lookup radius.
    s.locations.push({ id: 'sea', name: 'Open water', lat: 56.5, lon: 3.0 })
    expect(await s.enrichMissingSpecies()).toBe(0)
    expect(s.locations[0].species ?? []).toHaveLength(0)
  })

  /**
   * A spot never filled is looked up once a session, not on every edit: the
   * store keeps which ids it has tried. Moved onto Dragør's harbour later the
   * same session, it is not looked up again until the next start.
   */
  it('looks a spot never filled up once a session', async () => {
    const s = useSetupStore()
    s.markReady()
    s.locations.push({ id: 'sea', name: 'Open water', lat: 56.5, lon: 3.0 })
    expect(await s.enrichMissingSpecies()).toBe(0)
    Object.assign(s.locations[0], { lat: NEAR_OFFICIAL.lat, lon: NEAR_OFFICIAL.lon })
    expect(await s.enrichMissingSpecies()).toBe(0)
    expect(s.locations[0].species).toBeUndefined()
  })
})

/**
 * A spot whose species the lookup never filled has no `species` at all; one
 * whose list was emptied (the last species tapped off in the spot card's
 * picker) has an empty list. The refill took both for missing: it ran on
 * the edit that emptied the list, and again at every start, so a pin in
 * mid-Arresø cleared by hand came back with the lake's perch, pike, carp,
 * zander and bream. Only a list never filled is looked up now.
 */
describe('setup store — a species list the user emptied stays empty', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  // A pin in mid-Arresø, 3 km from the lake's official spot: the lookup lists the lake's fish.
  const ARRESO = { id: 'arr', name: 'Arresø', lat: 55.97, lon: 12.1, waterType: 'fresh' as const }
  const LAKE = ['Bream', 'Carp', 'Perch', 'Pike', 'Zander']
  const names = (l: { nameEn: string }[] | undefined) => (l ?? []).map((sp) => sp.nameEn).sort()
  /** Lets the store watcher's own refill (an edit's) run to its end. */
  const settle = async () => {
    await nextTick()
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0))
  }

  it('the lookup does list species there', () => {
    expect(names(speciesFromNearby(ARRESO.lat, ARRESO.lon, 'fresh'))).toEqual(LAKE)
  })

  it('on the edit that emptied it, and at the next start', async () => {
    const s = useSetupStore()
    s.markReady()
    s.locations.push({ ...ARRESO, species: [speciesEntry('gedde', 'fresh')!] })
    await settle()
    s.locations[0].species = [] // the last species tapped off
    await settle()
    // A pass of its own too: whether or not the edit's has ended, any refill is done after it.
    expect(await s.enrichMissingSpecies()).toBe(0)
    expect(s.locations[0].species).toEqual([])
    expect(read().locations[0].species).toEqual([])
    // The next start: a new store reads the saved document.
    setActivePinia(createPinia())
    const next = useSetupStore()
    next.loadLocal()
    next.markReady()
    expect(await next.enrichMissingSpecies()).toBe(0)
    expect(next.locations[0].species).toEqual([])
  })

  it('at a start, a spot never filled is filled and one emptied is left', async () => {
    localStorage.setItem(LS_KEY, JSON.stringify({
      locations: [{ ...ARRESO, id: 'never' }, { ...ARRESO, id: 'emptied', species: [] }],
      targetSpecies: [], availability: [], updatedAt: 1000, dirty: false,
    }))
    const s = useSetupStore()
    s.loadLocal()
    s.markReady()
    expect(await s.enrichMissingSpecies()).toBe(1)
    expect(names(s.locations[0].species)).toEqual(LAKE)
    expect(s.locations[1].species).toEqual([])
  })

  /**
   * A spot saved from the catalogue copies the spot's own list
   * (locationFromSpot: the spot finder, the quick start), and the setup map
   * saves an official spot's (pendingSpot). An official spot that listed
   * none would be saved with an empty list, which now reads as one the user
   * cleared: never filled from the spots nearby, as it was before. So every
   * spot in the catalogue lists some.
   */
  it('a spot saved from the catalogue never starts as an emptied list', () => {
    expect(DK_SPOTS.filter((spot) => !locationFromSpot(spot).species?.length).map((spot) => spot.slug)).toEqual([])
  })

  /** Another tab's copy, or a pulled row, goes through the same repair (normalizeDoc): an empty list stays one. */
  it('emptied in another tab, it stays empty here through the next edit', async () => {
    const s = useSetupStore()
    s.markReady()
    s.locations.push({ ...ARRESO, species: speciesFromNearby(ARRESO.lat, ARRESO.lon, 'fresh') })
    await settle()
    const saved = read()
    localStorage.setItem(LS_KEY, JSON.stringify({ ...saved, locations: [{ ...saved.locations[0], species: [] }] }))
    s.reloadLocal()
    await settle()
    expect(s.locations[0].species).toEqual([])
    s.locations.push({ id: 'b', name: 'B', lat: 55, lon: 12, species: [] }) // any later edit runs the refill
    await settle()
    expect(await s.enrichMissingSpecies()).toBe(0)
    expect(s.locations[0].species).toEqual([])
  })
})

/**
 * Regression — signing in mid-session. `main.ts` used to pull only at page load,
 * so logging in afterwards left sync armed over empty local state and the first
 * edit pushed that blank over the account's real row. pauseSync() disarms until
 * a pull completes, and pushRemote() refuses anything no pull has reconciled
 * (storeSync.test.ts drives that against the Supabase fake).
 */
describe('setup store — sync arming', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('pauseSync keeps an edit local but still stamps it, so a pull cannot revert it', async () => {
    const s = useSetupStore()
    s.markReady()
    s.pauseSync()
    s.locations.push({ id: 'a', name: 'A', lat: 56, lon: 10 })
    await nextTick()
    expect(read().locations).toHaveLength(1)
    expect(read().updatedAt).toBeGreaterThan(0)
    expect(read().dirty).toBe(true)
  })

  it('re-arms after markReady so later edits do stamp', async () => {
    const s = useSetupStore()
    s.pauseSync()
    s.markReady()
    s.locations.push({ id: 'a', name: 'A', lat: 56, lon: 10 })
    await nextTick()
    expect(read().updatedAt).toBeGreaterThan(0)
  })
})

/**
 * Regression — a shared link could plant a window with no `days` (and a
 * location with no lat/lon). getScoredWindows then threw, blanking the
 * dashboard and the editor on every synced device. share.ts validates now,
 * but documents poisoned before that must heal on load and on adopt.
 */
describe('setup store — poisoned documents', () => {
  const POISONED = {
    locations: [{ id: 'ok', name: 'Mole', lat: 55.6, lon: 12.6 }, { id: 'bad', name: 'x' }],
    targetSpecies: ['torsk'],
    availability: [{ id: 'w', from: '06:00', to: '09:00' }],
  }
  beforeEach(() => {
    localStorage.clear()
    fakeDb.reset()
    setActivePinia(createPinia())
  })

  it('repairs a poisoned local document on load', () => {
    localStorage.setItem(LS_KEY, JSON.stringify({ ...POISONED, updatedAt: 1, ownerId: null }))
    const s = useSetupStore()
    s.loadLocal()
    expect(s.locations.map((l) => l.id)).toEqual(['ok'])
    expect(s.availability[0].days).toEqual([])
    expect(() => getScoredWindows(s.locations, s.availability, {}, s.targetSpecies)).not.toThrow()
  })

  it('repairs a poisoned account row when adopting it', async () => {
    fakeDb.seed('setups', { user_id: 'u1', setup: { ...POISONED, lang: 'da' }, updated_at: new Date(1000).toISOString() })
    useAuthStore().user = { id: 'u1' } as User
    fakeDb.session = { user: { id: 'u1' } }
    const s = useSetupStore()
    await s.pullRemote()
    expect(s.locations.map((l) => l.id)).toEqual(['ok'])
    expect(() => getScoredWindows(s.locations, s.availability, {}, s.targetSpecies)).not.toThrow()
  })
})
