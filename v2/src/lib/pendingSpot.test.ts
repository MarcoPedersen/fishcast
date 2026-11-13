import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { usePendingSpot, GEOCODE_TIMEOUT_MS } from './pendingSpot'
import { DK_SPOTS, findNearbySpots } from './spots'
import { smartDetectWaterType, speciesFromNearby } from './geo'
import { fitWaterType } from './locationSpecies'
import { STRINGS } from '@/test/strings'

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
   * Both read the 12 km now, so with no official spot that near the sheet
   * lists none (it says to pick them on the spot) and Add saves none.
   * Saved as never filled, as a searched place is, not as an emptied list:
   * an empty list is one the user cleared, and the lookup leaves it alone
   * (stores/setup.ts enrichMissingSpecies).
   */
  it('shows and saves no species where no official spot lies within 12 km', async () => {
    const g = slowGeocode()
    const s = usePendingSpot(g.fn)
    s.startAt(55.6865, 11.3159)
    g.calls[0].answer('Et sted')
    await flush()
    expect(s.pending.value!.nearbyCount).toBeGreaterThan(0) // Rørvig Strand, 40 km
    expect(s.shown.value).toEqual([])
    expect(s.otherWater.value).toBe(false) // "Ingen kendte arter i nærheden"
    expect(s.toLocation()!.species).toBeUndefined()
  })

  /**
   * An official spot's list is its own, judged by the water type picked: one
   * none of whose species fit is saved with an empty list, as a saved
   * official spot keeps one a change of water type emptied, and the lookup
   * leaves it alone.
   */
  it('an official spot none of whose species fit the water picked is saved with an empty list', () => {
    const none = DK_SPOTS.flatMap((spot) => (['salt', 'brackish', 'fresh'] as const)
      .filter((w) => !fitWaterType(spot.species, w).length).map((w) => ({ spot, w })))
    expect(none.length).toBeGreaterThan(0)
    for (const { spot, w } of none) {
      const s = usePendingSpot(slowGeocode().fn)
      s.startFromSpot(spot)
      s.pending.value!.waterType = w
      s.touch('waterType')
      expect(s.shown.value).toEqual([])
      expect(s.toLocation()!.species, `${spot.slug} at ${w}`).toEqual([])
    }
  })

  /**
   * The five nearest spots within 40 km filled in a point with none within
   * 12 km. A tap at Hald Sø whose road name says no lake is guessed
   * brackish, and was saved with herring and garfish from Virksund, 26 km
   * off, which then earned it the relevance bonus for them.
   */
  it('takes no species from spots beyond 12 km: no herring at Hald Sø', async () => {
    const g = slowGeocode()
    const s = usePendingSpot(g.fn)
    s.startAt(56.39, 9.355)
    g.calls[0].answer('Haldvej, Dollerup')
    await flush()
    expect(s.pending.value!.waterType).toBe('brackish')
    const saved = (s.toLocation()!.species ?? []).map((sp) => sp.nameEn)
    expect(saved).not.toContain('Herring')
    expect(saved).not.toContain('Garfish')
    expect(saved).toEqual([])
    expect(s.toLocation()!.species).toBeUndefined() // none within 12 km: never filled
  })

  it('saves the species the sheet shows, with their months', async () => {
    const g = slowGeocode()
    const s = usePendingSpot(g.fn)
    s.startAt(LAT, LON) // beside Fornæs Fyr
    g.calls[0].answer('Fornæs, Grenaa')
    await flush()
    const shown = s.shown.value.map((sp) => sp.nameEn)
    expect(shown.length).toBeGreaterThan(0)
    expect(s.toLocation()!.species!.map((sp) => sp.nameEn)).toEqual(shown)
    expect(s.toLocation()!.species!.every((sp) => sp.months.length > 0)).toBe(true)
  })

  it('shows and saves only species that live in the water type picked', async () => {
    const g = slowGeocode()
    const s = usePendingSpot(g.fn)
    s.startAt(56.09027, 12.45693) // Hornbæk: Gurre Sø 7 km, Helsingør Kysten 12 km
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
   * Brackish water takes salt and fresh species alike, so a tap at Hornbæk,
   * guessed brackish, listed and saved the carp, pike and zander of Gurre Sø
   * and Esrum Sø, 7 and 11 km inland. A sea spot takes the sea's official
   * spots' species; set to fresh, the lakes' (and the sea trout that run up
   * the rivers).
   */
  it('a tap at Hornbæk, guessed brackish, shows and saves no species of the lakes inland', async () => {
    const g = slowGeocode()
    const s = usePendingSpot(g.fn)
    s.startAt(56.09027, 12.45693)
    g.calls[0].answer('Hornbæk')
    await flush()
    expect(s.pending.value!.waterType).toBe('brackish')
    expect(s.shown.value.map((sp) => sp.nameEn).sort()).toEqual(['Garfish', 'Mackerel', 'Sea Trout'])
    expect(s.toLocation()!.species!.map((sp) => sp.nameEn)).toEqual(s.shown.value.map((sp) => sp.nameEn))
    s.pending.value!.waterType = 'fresh'
    s.touch('waterType')
    expect(s.shown.value.map((sp) => sp.nameEn).sort())
      .toEqual(['Brown Trout (river/lake)', 'Perch', 'Pike', 'Sea Trout', 'Zander'])
  })

  /**
   * A pin in mid-Arresø, 3 km from the lake's official spot, was saved with
   * 13 species, cod, mackerel and plaice among them: the five nearest spots
   * within 40 km, harbours included. Where official spots lie within the
   * 12 km a searched place is filled in from, a tapped point takes theirs.
   * Such a pin is guessed brackish (a lake spot 3 km off is no sign offline),
   * and a brackish spot takes no lake's species: it lists the lake's once it
   * is set to fresh, as the user or the map's lookup sets it.
   */
  it.each([
    ['mid Arresø', 55.97, 12.10],
    ['beside Mossø', 56.04, 9.79],
  ])('a point %s takes the species of the lakes within 12 km once it is fresh, as a searched place does', async (_, lat, lon) => {
    const g = slowGeocode()
    const s = usePendingSpot(g.fn)
    s.startAt(lat, lon)
    g.calls[0].answer('Et sted')
    await flush()
    expect(s.pending.value!.waterType).toBe('brackish')
    expect(s.shown.value).toEqual([])
    // Not "no known species nearby": the lake's are, for fresh water.
    expect(s.otherWater.value).toBe(true)
    s.pending.value!.waterType = 'fresh'
    s.touch('waterType')
    expect(s.otherWater.value).toBe(false)
    const saved = s.toLocation()!.species!.map((sp) => sp.nameEn)
    expect(saved.length).toBeGreaterThan(0)
    expect(saved.sort()).toEqual(speciesFromNearby(lat, lon).map((sp) => sp.nameEn).sort())
    expect(saved).toEqual(speciesFromNearby(lat, lon, 'fresh').map((sp) => sp.nameEn).sort())
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

  /**
   * Its species are its own, so the water type picked in the sheet judges
   * them as it judges a saved official spot's (changeWaterType without the
   * lookup): by what fits. Read as a nearby lake's, Arresø's spot set to
   * Brakvand in the sheet listed none, said none were known for that water
   * nearby, and was saved with none; so were Furesø, Mossø and four more
   * lakes, at Brakvand and at Saltvand.
   */
  it('an official spot keeps its own species whatever water type the sheet is set to', () => {
    for (const spot of DK_SPOTS) {
      for (const w of ['salt', 'brackish', 'fresh'] as const) {
        const s = usePendingSpot(slowGeocode().fn)
        s.startFromSpot(spot)
        s.pending.value!.waterType = w
        s.touch('waterType')
        const own = [...new Set(fitWaterType(spot.species, w).map((sp) => sp.nameEn))].sort()
        expect(s.shown.value.map((sp) => sp.nameEn).sort(), `${spot.slug} at ${w}`).toEqual(own)
        expect(s.toLocation()!.species!.map((sp) => sp.nameEn).sort(), `${spot.slug} at ${w}`).toEqual(own)
      }
    }
  })

  /**
   * The bottom type Add saves is guessed from the official spots of the
   * water type the sheet holds (geo.ts inferBottomType), so it follows the
   * type the user picks. Guessed once from every spot near, a tap at
   * Espergærde got the lakes' 'mixed', set to salt or to fresh.
   */
  it('saves the bottom type of the spots of the water type picked', async () => {
    const g = slowGeocode()
    const s = usePendingSpot(g.fn)
    s.startAt(55.99078, 12.55296)
    g.calls[0].answer('Espergærde')
    await flush()
    expect(s.pending.value!.waterType).toBe('brackish')
    expect(s.toLocation()!.bottomType).toBe('stone') // Helsingør Kysten, not Gurre Sø and Esrum Sø
    s.pending.value!.waterType = 'fresh'
    s.touch('waterType')
    expect(s.toLocation()!.bottomType).toBe('mixed') // the lakes'
    s.pending.value!.waterType = 'salt'
    s.touch('waterType')
    expect(s.toLocation()!.bottomType).toBe('stone')
  })

  // Every spot within 40 km goes to the guess, not the five nearest: those
  // are four lakes and Helsingør Kysten at Hillerød, and its 'stone' alone
  // would decide.
  it('lets the five nearest spots of the water type vote, not those of the five nearest', async () => {
    const g = slowGeocode()
    const s = usePendingSpot(g.fn)
    s.startAt(55.92857, 12.30639)
    g.calls[0].answer('Hillerød')
    await flush()
    expect(s.pending.value!.waterType).toBe('brackish')
    expect(s.toLocation()!.bottomType).toBe('mixed')
  })

  it('an official spot saves its own bottom type whatever water type the sheet is set to', () => {
    for (const spot of DK_SPOTS) {
      for (const w of ['salt', 'brackish', 'fresh'] as const) {
        const s = usePendingSpot(slowGeocode().fn)
        s.startFromSpot(spot)
        s.pending.value!.waterType = w
        s.touch('waterType')
        expect(s.toLocation()!.bottomType, `${spot.slug} at ${w}`).toBe(spot.bottomType)
      }
    }
  })

  it('refuses while the place is still loading — the sheet would save a placeholder', () => {
    const s = usePendingSpot(slowGeocode().fn)
    s.startAt(LAT, LON)
    expect(s.toLocation()).toBeNull()
  })
})

/**
 * With no species for the water type picked, the sheet said "Ingen kendte
 * arter i nærheden" beside a lake 3 km off, whose species it lists for
 * fresh water. It says none are known for that water type, and that the
 * type can be corrected.
 */
describe('the map sheet without species for its water type', () => {
  const sources = import.meta.glob<string>(['/src/views/MapView.vue'], { query: '?raw', import: 'default', eager: true })
  const v = sources['/src/views/MapView.vue'] ?? ''

  it('says the water type has none, rather than that none are nearby', () => {
    expect(v).toMatch(/<div v-else class="muted sm">\{\{ t\(otherWater \? 'no_species_this_water' : 'no_active_nearby'\) \}\}<\/div>/)
    expect(STRINGS.da.no_species_this_water).toMatch(/vandtype/)
    expect(STRINGS.en.no_species_this_water).toMatch(/water type/)
  })
})
