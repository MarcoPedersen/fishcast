import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, watch } from 'vue'
import type { User } from '@supabase/supabase-js'
import { useSetupStore } from './setup'
import { useAuthStore } from './auth'
import { getScoredWindows } from '@/lib/scoring'
import { locationFromSearch } from '@/lib/placeSearch'
import { speciesFromNearby } from '@/lib/geo'
import { fitWaterType, speciesEntry } from '@/lib/locationSpecies'
import { usePendingSpot } from '@/lib/pendingSpot'
import { parseSharedSetup } from '@/lib/share'
import { locationsFromSharedSetup } from '@/lib/shareImport'
import { DK_SPOTS, locationFromSpot } from '@/lib/spots'
import type { Location, WaterType } from '@/lib/types'
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

  /**
   * The refill loads the spot data first (a dynamic import, over the network
   * at a first start), and then filled the spots it had picked out before.
   * A list the user filled meanwhile was overwritten with the lookup's.
   */
  it('leaves a list filled while it loads', async () => {
    const s = useSetupStore()
    s.locations = [{ ...NEAR_OFFICIAL }]
    const run = s.enrichMissingSpecies()
    s.locations[0].species = [speciesEntry('torsk', 'salt')!] // picked on the spot card meanwhile
    expect(await run).toBe(0)
    expect(s.locations[0].species).toEqual([speciesEntry('torsk', 'salt')])
  })

  /**
   * A pull, or another tab's save, puts fresh copies of the spots in the list.
   * Put there while the refill loaded, they were left never filled: it wrote
   * to the copies no longer shown, and took the spots as looked up.
   */
  it('fills the copies a sync put there while it loads', async () => {
    const s = useSetupStore()
    s.locations = [{ ...NEAR_OFFICIAL }]
    const run = s.enrichMissingSpecies()
    s.locations = s.locations.map((l) => ({ ...l }))
    expect(await run).toBe(1)
    expect(s.locations[0].species).toEqual(speciesFromNearby(NEAR_OFFICIAL.lat, NEAR_OFFICIAL.lon))
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
 * The refill gives a list never filled what "Hent arter" gives a list the
 * user emptied (geo.ts speciesBackFor). A copy of an official spot, known by
 * its slug, its pin or a pin it had before, gets its own species from the
 * catalogue, those that fit its water. A custom spot gets what the official
 * spots nearby give its water, as before. The refill gave every spot the
 * lookup: a copy of Gurre Sø took sea trout and "Brown Trout (river/lake)"
 * from the spots within 12 km, and the button gave the same copy pike,
 * perch and zander alone.
 */
describe('setup store — a copy of an official spot is refilled with its own species', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  const spot = (slug: string) => DK_SPOTS.find((s) => s.slug === slug)!
  const gurre = spot('gurre-so')
  const former = gurre.formerPins![0]
  const names = (l: { nameEn: string }[] | undefined) => (l ?? []).map((sp) => sp.nameEn).sort()
  /** The official spot's own species that fit this water. */
  const own = (slug: string, w: WaterType) => fitWaterType(locationFromSpot(spot(slug)).species, w)
  /** A copy saved from the catalogue whose list was never filled. */
  const neverFilled = (slug: string, w?: WaterType): Omit<Location, 'id'> => {
    const { species, ...copy } = locationFromSpot(spot(slug))
    return w ? { ...copy, waterType: w } : copy
  }
  /** These spots in a store, refilled once, as at a start. */
  async function refilled(...locs: Omit<Location, 'id'>[]) {
    const s = useSetupStore()
    s.locations = locs.map((l, i) => ({ id: `c${i}`, ...l }))
    await s.enrichMissingSpecies()
    return s.locations
  }

  it('a copy of Gurre Sø gets its pike, perch and zander, not the sea trout round it', async () => {
    expect(names(speciesFromNearby(gurre.lat, gurre.lon, 'fresh')))
      .toEqual(['Brown Trout (river/lake)', 'Perch', 'Pike', 'Sea Trout', 'Zander'])
    const got = await refilled(
      neverFilled('gurre-so'), // by its slug
      { name: gurre.name, lat: gurre.lat, lon: gurre.lon, waterType: 'fresh' }, // at its pin, saved from the map
      { name: gurre.name, ...former, waterType: 'fresh' }, // at the pin it had before
    )
    for (const l of got) expect(l.species).toEqual(locationFromSpot(gurre).species)
  })

  // The spot finder and the quick start save an official spot with its own list (locationFromSpot).
  it('every official spot never filled ends up with the list the spot finder saves', async () => {
    const got = await refilled(...DK_SPOTS.map((s) => neverFilled(s.slug)))
    expect(got.map((l) => l.species)).toEqual(DK_SPOTS.map((s) => locationFromSpot(s).species))
  })

  /**
   * Of its own, those that fit its water now. Helsingør Kysten set to
   * Ferskvand keeps its sea trout, where the lookup has a lake's pike, perch
   * and zander. Gurre Sø at its old pin, set to Brakvand, has a lake's fish
   * where the lookup gives a sea spot none. None of Grærup Strand's own live
   * in fresh water, so its list stays never filled.
   */
  it('takes those of its own that fit its water, and none when none fit', async () => {
    expect(names(speciesFromNearby(former.lat, former.lon, 'brackish'))).toEqual([])
    const [coast, lake, none] = await refilled(
      neverFilled('helsingore-kysten', 'fresh'),
      { name: gurre.name, ...former, waterType: 'brackish' },
      neverFilled('graerup-strand', 'fresh'),
    )
    expect(coast.species).toEqual(own('helsingore-kysten', 'fresh'))
    expect(names(coast.species)).toEqual(['Sea Trout'])
    expect(names(lake.species)).toEqual(['Perch', 'Pike', 'Zander'])
    expect(none.species).toBeUndefined()
  })

  /** A slug this catalogue doesn't know (a newer version's spot): its own come with the catalogue that knows it. */
  it('leaves a copy of a spot the catalogue does not know never filled', async () => {
    const at = { name: 'Ny plads', lat: 56.09027, lon: 12.45693, waterType: 'fresh' as const }
    expect(speciesFromNearby(at.lat, at.lon, 'fresh').length).toBeGreaterThan(0)
    const [l] = await refilled({ ...at, spotSlug: 'ny-plads' })
    expect(l.species).toBeUndefined()
  })

  it('leaves a list emptied on a copy empty', async () => {
    const [l] = await refilled({ ...locationFromSpot(gurre), species: [] })
    expect(l.species).toEqual([])
  })

  /** Looked up once a session, as a custom spot is: set to Saltvand later, it is filled at the next start. */
  it('looks a copy never filled up once a session', async () => {
    const s = useSetupStore()
    s.locations = [{ id: 'g', ...neverFilled('graerup-strand', 'fresh') }]
    expect(await s.enrichMissingSpecies()).toBe(0)
    s.locations[0].waterType = 'salt'
    expect(await s.enrichMissingSpecies()).toBe(0)
    expect(s.locations[0].species).toBeUndefined()
    setActivePinia(createPinia())
    const next = await refilled(s.locations[0])
    expect(next[0].species).toEqual(own('graerup-strand', 'salt'))
  })

  /**
   * The setup map saves a tapped point with no list when the sheet shows
   * none (pendingSpot.toLocation). At Gurre Sø's old pin, in the fields, the
   * sheet guesses Brakvand and shows none: it is still the spot, as the
   * card's "Hent arter" and its move to the spot's pin say. An official spot
   * picked on the map keeps its own list, and the refill leaves it.
   */
  it('a spot saved from the setup map', async () => {
    const sheet = usePendingSpot(async () => 'Villingerød')
    await sheet.startAt(former.lat, former.lon)
    expect(sheet.pending.value!.waterType).toBe('brackish')
    const tapped = sheet.toLocation()!
    expect(tapped.species).toBeUndefined()
    sheet.startFromSpot(gurre)
    const picked = sheet.toLocation()!
    const [t, p] = await refilled(tapped, picked)
    expect(t.species).toEqual(own('gurre-so', 'brackish'))
    expect(p.species).toEqual(locationFromSpot(gurre).species)
  })

  /**
   * A link carries a spot's slug, and no list when the sharer's was never
   * filled. A legacy link at an official spot takes the spot's own that fit;
   * with none that fit it stays never filled, and so it stays after the
   * refill. A custom spot from a link still gets the lookup.
   */
  it('a spot from a share link', async () => {
    const std64 = (obj: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
    const graerup = spot('graerup-strand')
    const link = parseSharedSetup(std64({ v: 2, sp: [], av: [], locs: [
      { n: gurre.name, la: gurre.lat, lo: gurre.lon, wt: 'fresh', sl: 'gurre-so' },
      { n: 'Hornbæk', la: 56.09027, lo: 12.45693, wt: 'brackish' },
    ] }))!
    const legacy = parseSharedSetup(std64({ sp: [], av: [], locs: [{ n: graerup.name, la: graerup.lat, lo: graerup.lon, wt: 'fresh' }] }))!
    const imported = [...locationsFromSharedSetup(link), ...locationsFromSharedSetup(legacy)]
    expect(imported.map((l) => l.species)).toEqual([undefined, undefined, undefined])
    const [g, h, gr] = await refilled(...imported)
    expect(g.species).toEqual(locationFromSpot(gurre).species)
    expect(h.species).toEqual(speciesFromNearby(56.09027, 12.45693, 'brackish'))
    expect(gr.spotSlug).toBe('graerup-strand')
    expect(gr.species).toBeUndefined()
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

/**
 * Find pladser's search follows the setup the page holds, as the catch
 * log's form follows the log: the store says whose it is, and says so as
 * it changes. A token refresh the server refused signs the page out and
 * leaves the account's setup; another tab's logout wipes it.
 */
describe('setup store — whose setup it is', () => {
  beforeEach(() => {
    localStorage.clear()
    fakeDb.reset()
    setActivePinia(createPinia())
  })

  it('names the account the setup belongs to, null for a guest’s, as it changes', async () => {
    const s = useSetupStore()
    const seen: (string | null)[] = []
    watch(() => s.account, (a) => { seen.push(a) }, { flush: 'sync' })
    expect(s.account).toBeNull()
    // Loaded from the device, as at a start.
    localStorage.setItem(LS_KEY, JSON.stringify({ locations: [], targetSpecies: [], availability: [], ownerId: 'u1', dirty: false }))
    s.loadLocal()
    expect(s.account).toBe('u1')
    // Another tab's logout wipes it.
    localStorage.removeItem(LS_KEY)
    s.reloadLocal()
    expect(s.account).toBeNull()
    // A pull makes it the account's.
    fakeDb.seed('setups', { user_id: 'u2', setup: { locations: [], targetSpecies: [], availability: [] }, updated_at: new Date(1000).toISOString() })
    useAuthStore().user = { id: 'u2' } as User
    fakeDb.session = { user: { id: 'u2' } }
    await s.pullRemote()
    expect(s.account).toBe('u2')
    // A logout here.
    s.clear()
    expect(s.account).toBeNull()
    expect(seen).toEqual(['u1', null, 'u2', null])
  })

  it('names the account a setup becomes when the account has no row yet', async () => {
    const s = useSetupStore()
    s.locations.push({ id: 'a', name: 'A', lat: 56, lon: 10 })
    useAuthStore().user = { id: 'u1' } as User
    fakeDb.session = { user: { id: 'u1' } }
    await s.pullRemote()
    expect(s.account).toBe('u1')
  })
})
