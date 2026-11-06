import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { usePendingSpot, GEOCODE_TIMEOUT_MS } from './pendingSpot'
import { DK_SPOTS, findNearbySpots } from './spots'
import { smartDetectWaterType, speciesFromNearby } from './geo'

/** A reverse-geocode whose answer the test releases by hand, like a slow Nominatim. */
function slowGeocode() {
  const calls: { lat: number; lon: number; answer: (name: string) => void }[] = []
  const fn = (lat: number, lon: number) =>
    new Promise<string>((answer) => { calls.push({ lat, lon, answer }) })
  return { fn, calls }
}
const flush = () => new Promise((r) => setTimeout(r, 0))

// Djursland, beside Fornæs Fyr — there are official spots to infer from.
const LAT = 56.44, LON = 10.95

describe('map "new spot" sheet', () => {
  it('fills the sheet from the geocode when the user has not touched it', async () => {
    const g = slowGeocode()
    const s = usePendingSpot(g.fn)
    s.startAt(LAT, LON)
    expect(s.pending.value?.loading).toBe(true)
    g.calls[0].answer('Fornæs, Grenaa')
    await flush()
    const nearby = findNearbySpots(LAT, LON, 40).slice(0, 5)
    expect(s.pending.value).toMatchObject({
      name: 'Fornæs, Grenaa', loading: false,
      waterType: smartDetectWaterType(LAT, LON, 'Fornæs, Grenaa', nearby),
    })
    expect(s.pending.value!.nearbyCount).toBeGreaterThan(0)
  })

  it('a geocode landing after the sheet was dismissed does not re-open it', async () => {
    const g = slowGeocode()
    const s = usePendingSpot(g.fn)
    s.startAt(LAT, LON)
    s.cancel() // ✕, Escape or the backdrop
    g.calls[0].answer('Fornæs, Grenaa')
    await flush()
    expect(s.pending.value).toBeNull()
  })

  it('keeps a name the user typed while the place was loading', async () => {
    const g = slowGeocode()
    const s = usePendingSpot(g.fn)
    s.startAt(LAT, LON)
    s.pending.value!.name = 'Min plads'
    s.touch('name')
    g.calls[0].answer('Fornæs, Grenaa')
    await flush()
    expect(s.pending.value).toMatchObject({ name: 'Min plads', loading: false })
  })

  it('keeps a water type the user picked while the place was loading', async () => {
    const g = slowGeocode()
    const s = usePendingSpot(g.fn)
    s.startAt(LAT, LON)
    s.pending.value!.waterType = 'fresh'
    s.touch('waterType')
    g.calls[0].answer('Fornæs Fyr, Grenaa')
    await flush()
    expect(s.pending.value).toMatchObject({ waterType: 'fresh', name: 'Fornæs Fyr, Grenaa' })
  })

  it('an older click\'s geocode never overwrites a newer pin', async () => {
    const g = slowGeocode()
    const s = usePendingSpot(g.fn)
    s.startAt(LAT, LON)
    s.startAt(55.5, 12.0)
    g.calls[1].answer('Køge')
    g.calls[0].answer('Fornæs, Grenaa')
    await flush()
    expect(s.pending.value).toMatchObject({ lat: 55.5, lon: 12.0, name: 'Køge' })
  })

  it('picking an official spot invalidates a pending click geocode', async () => {
    const g = slowGeocode()
    const s = usePendingSpot(g.fn)
    s.startAt(LAT, LON)
    const spot = DK_SPOTS[0]
    s.startFromSpot(spot)
    g.calls[0].answer('Somewhere else')
    await flush()
    expect(s.pending.value).toMatchObject({ name: spot.name, lat: spot.lat, loading: false })
  })

  // The sheet says "gættet – ret hvis forkert" beside a guessed water type.
  it('marks a tapped point\'s water type as a guess, until the user picks one', async () => {
    const g = slowGeocode()
    const s = usePendingSpot(g.fn)
    s.startAt(LAT, LON)
    expect(s.pending.value?.guessed).toBe(true)
    g.calls[0].answer('Fornæs, Grenaa')
    await flush()
    expect(s.pending.value?.guessed).toBe(true)
    s.pending.value!.waterType = 'salt'
    s.touch('waterType')
    expect(s.pending.value?.guessed).toBe(false)
  })

  it('an official spot\'s water type is no guess', () => {
    const s = usePendingSpot(slowGeocode().fn)
    s.startFromSpot(DK_SPOTS[0])
    expect(s.pending.value?.guessed).toBe(false)
  })

  it('starts with the nearby-spot inference, not a bare "brackish/mixed" placeholder', () => {
    const s = usePendingSpot(slowGeocode().fn)
    s.startAt(LAT, LON)
    const nearby = findNearbySpots(LAT, LON, 40).slice(0, 5)
    expect(s.pending.value).toMatchObject({
      name: '', loading: true, waterType: smartDetectWaterType(LAT, LON, '', nearby),
    })
  })

  describe('a geocode that never answers', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it('gives up after the timeout and falls back to the coordinates', async () => {
      const s = usePendingSpot(() => new Promise<string>(() => {})) // Nominatim has no timeout
      s.startAt(LAT, LON)
      await vi.advanceTimersByTimeAsync(GEOCODE_TIMEOUT_MS)
      expect(s.pending.value).toMatchObject({ loading: false, name: `${LAT.toFixed(4)}, ${LON.toFixed(4)}` })
    })
  })
})

describe('toLocation', () => {
  it('trims the name and falls back to the coordinates when it is empty', async () => {
    const g = slowGeocode()
    const s = usePendingSpot(g.fn)
    s.startAt(LAT, LON)
    g.calls[0].answer('Fornæs')
    await flush()
    s.pending.value!.name = '   '
    expect(s.toLocation()).toMatchObject({ name: `${LAT.toFixed(4)}, ${LON.toFixed(4)}`, lat: LAT, lon: LON })
    s.pending.value!.name = '  Molen  '
    expect(s.toLocation()?.name).toBe('Molen')
  })

  // torsk's 'deep' bonus reads Location.depth, which only an official spot
  // knows; adding one from the setup map dropped it.
  it('keeps an official spot\'s depth, and invents none for a tapped point', async () => {
    const deep = DK_SPOTS.find((sp) => sp.depth === 'deep')!
    const s = usePendingSpot(slowGeocode().fn)
    s.startFromSpot(deep)
    expect(s.toLocation()?.depth).toBe('deep')

    const g = slowGeocode()
    const t = usePendingSpot(g.fn)
    t.startFromSpot(deep)
    t.startAt(LAT, LON) // a map tap replaces the picked spot
    g.calls[0].answer('Fornæs')
    await flush()
    expect(t.toLocation()).not.toHaveProperty('depth')
  })

  /**
   * The sheet listed Havørred, Hornfisk, Skrubbe, Rødspætte and Ising for a
   * point 40 km from Rørvig Strand, and the saved spot got none: the sheet
   * read the official spots within 40 km, the save only those within 12 km.
   */
  it('saves the species the sheet shows', async () => {
    const g = slowGeocode()
    const s = usePendingSpot(g.fn)
    s.startAt(55.6865, 11.3159)
    g.calls[0].answer('Et sted')
    await flush()
    const shown = s.shown.value.map((sp) => sp.nameEn)
    expect(shown).toEqual(expect.arrayContaining(['Sea Trout', 'Garfish']))
    expect(s.toLocation()!.species!.map((sp) => sp.nameEn)).toEqual(shown)
    expect(s.toLocation()!.species!.every((sp) => sp.months.length > 0)).toBe(true)
  })

  it('shows and saves only species that live in the water type picked', async () => {
    const g = slowGeocode()
    const s = usePendingSpot(g.fn)
    s.startAt(56.09027, 12.45693) // Hornbæk: Gurre Sø 4 km, Helsingør Kysten 10 km
    g.calls[0].answer('Hornbæk')
    await flush()
    s.pending.value!.waterType = 'salt'
    s.touch('waterType')
    const shown = s.shown.value.map((sp) => sp.nameEn)
    expect(shown).toContain('Sea Trout')
    expect(shown).not.toContain('Pike')
    expect(s.toLocation()!.species!.map((sp) => sp.nameEn)).toEqual(shown)
  })

  /**
   * A pin in mid-Arresø, 3 km from the lake's official spot, was saved with
   * 13 species, cod, mackerel and plaice among them: the five nearest spots
   * within 40 km, harbours included. Where official spots lie within the
   * 12 km a searched place is filled in from, a tapped point takes theirs.
   */
  it.each([
    ['mid Arresø', 55.97, 12.10],
    ['beside Mossø', 56.04, 9.79],
  ])('a point %s takes the species of the spots within 12 km, as a searched place does', async (_, lat, lon) => {
    const g = slowGeocode()
    const s = usePendingSpot(g.fn)
    s.startAt(lat, lon)
    g.calls[0].answer('Et sted')
    await flush()
    const saved = s.toLocation()!.species!.map((sp) => sp.nameEn)
    expect(saved.length).toBeGreaterThan(0)
    expect(saved.sort()).toEqual(speciesFromNearby(lat, lon).map((sp) => sp.nameEn).sort())
    for (const sea of ['Cod', 'Mackerel', 'Plaice', 'Garfish', 'Sea Trout']) expect(saved, sea).not.toContain(sea)
  })

  it('an official spot shows and saves its own species', () => {
    const spot = DK_SPOTS[0]
    const s = usePendingSpot(slowGeocode().fn)
    s.startFromSpot(spot)
    const own = spot.species.map((sp) => sp.nameEn).sort()
    expect(s.shown.value.map((sp) => sp.nameEn).sort()).toEqual(own)
    expect(s.toLocation()!.species!.map((sp) => sp.nameEn).sort()).toEqual(own)
  })

  it('refuses while the place is still loading — the sheet would save a placeholder', () => {
    const s = usePendingSpot(slowGeocode().fn)
    s.startAt(LAT, LON)
    expect(s.toLocation()).toBeNull()
  })
})
