import { describe, it, expect } from 'vitest'
import { CATALOGUE_MATCH_KM, DK_SPOTS, catalogueSpotAt, hasCopyOf, locationFromSpot, pinsOf } from './spots'
import { SPECIES_PREFS } from './species'
import { SPOT_COAST } from './spotCoast.gen'
import { angDist } from './coast'
import { haversine } from './math'

/**
 * Spot species match target species on SPECIES_PREFS `nameEn`, exactly
 * (spot finder, the dashboard's relevance bonus, and custom locations that
 * copy species from nearby spots). Ten spots listed a generic "Flatfish" that
 * no species is called, so those listings never counted for plaice, flounder
 * or dab — Rødspætte found 4 spots while Køge Bugt Strand and nine others
 * were never offered.
 */
describe('DK_SPOTS species names', () => {
  // Real species that just aren't selectable targets — harmless, kept as data.
  const NOT_TARGETS = new Set(['Brill', 'Brown Trout (river/lake)'])
  const prefs = Object.values(SPECIES_PREFS)

  it('every spot species resolves to a SPECIES_PREFS entry (or is a known non-target)', () => {
    const known = new Set(prefs.map((p) => p.nameEn))
    const unmatched = DK_SPOTS.flatMap((s) =>
      s.species.filter((sp) => !known.has(sp.nameEn) && !NOT_TARGETS.has(sp.nameEn)).map((sp) => `${s.slug}: ${sp.nameEn}`))
    expect(unmatched).toEqual([])
  })

  it('the Danish name agrees with the English one', () => {
    const byEn = new Map(prefs.map((p) => [p.nameEn, p.name]))
    const mismatched = DK_SPOTS.flatMap((s) =>
      s.species.filter((sp) => byEn.has(sp.nameEn) && byEn.get(sp.nameEn) !== sp.name).map((sp) => `${s.slug}: ${sp.name}/${sp.nameEn}`))
    expect(mismatched).toEqual([])
  })

  it('no species is listed twice at one spot', () => {
    const dupes = DK_SPOTS.flatMap((s) => {
      const seen = s.species.map((sp) => sp.nameEn)
      return seen.filter((n, i) => seen.indexOf(n) !== i).map((n) => `${s.slug}: ${n}`)
    })
    expect(dupes).toEqual([])
  })

  it('flatfish spots count for plaice and flounder', () => {
    const listing = (en: string) => DK_SPOTS.filter((s) => s.species.some((sp) => sp.nameEn === en)).map((s) => s.slug)
    expect(listing('Plaice')).toContain('koge-bugt-strand')
    expect(listing('Flounder')).toContain('ishoj-strand')
    expect(listing('Plaice').length).toBeGreaterThanOrEqual(10)
  })
})

/**
 * Saving an official spot copies its facts into the Location. `depth` was
 * left out everywhere, and torsk's 'deep' bonus reads Location.depth — so a
 * deep spot saved from the finder, the quick start or the map never earned
 * it, and its official twin in the map compare did.
 */
describe('locationFromSpot', () => {
  it('copies everything the scoring reads, depth included', () => {
    const deep = DK_SPOTS.find((s) => s.depth === 'deep')!
    expect(locationFromSpot(deep)).toEqual({
      name: deep.name, lat: deep.lat, lon: deep.lon,
      waterType: deep.waterType, bottomType: deep.bottomType, spotSlug: deep.slug, depth: 'deep',
      species: deep.species.map((s) => ({ nameEn: s.nameEn, months: s.months })),
    })
  })

  it('hands out its own species lists, not the catalogue\'s', () => {
    const spot = DK_SPOTS[0]
    const loc = locationFromSpot(spot)
    loc.species![0].months.push(99)
    expect(spot.species[0].months).not.toContain(99)
  })
})

/**
 * Fornæs Fyr listed mackerel and garfish in all 12 months, the only spot of 44
 * and 17 to do so, so a January mackerel target read "🎯 1/1 aktive her" at
 * 2 °C. The tips: mackerel come inshore in warm water, "mest juli–september";
 * garfish "fra midt i april til juni … igen i august–september". The other
 * Djursland spots in the same source list them May–October and April–September.
 */
describe('summer visitors are not listed in winter', () => {
  it('no spot lists mackerel or garfish from November to March', () => {
    const winter = [11, 12, 1, 2, 3]
    const bad = DK_SPOTS.flatMap((s) => s.species
      .filter((sp) => (sp.nameEn === 'Mackerel' || sp.nameEn === 'Garfish') && sp.months.some((m) => winter.includes(m)))
      .map((sp) => `${s.slug}: ${sp.nameEn}`))
    expect(bad).toEqual([])
  })
})

/**
 * Helsingør Kysten sat at 56.0350, 12.5890, 1.8 km inland in Helsingør town
 * (the Sound's shore runs at 12.617 there): the coast lookup found a pond
 * 130 m off, so its card said the map shows a lake or river and wind
 * direction went unscored. It now sits on Kronborg Pynten, the source's
 * (fishingindenmark.info) pin for the stretch below the castle, where the
 * Sound is narrowest and runs strongest.
 */
describe('Helsingør Kysten, on the Øresund shore', () => {
  const HK = DK_SPOTS.find((s) => s.slug === 'helsingore-kysten')!
  const OLD = { lat: 56.0350, lon: 12.5890 }

  it('reads the Sound at its pin, facing across it to Sweden', () => {
    const c = SPOT_COAST['helsingore-kysten']
    expect(c.water).toBe('sea')
    expect(c.pinToWaterM).toBeLessThanOrEqual(30)
    expect(c.issues).toEqual([])
    expect(angDist(c.facing!, 110)).toBeLessThanOrEqual(45) // E–SE
    expect(c.fixed).toBeUndefined() // derived, no hand-set override
  })

  it('moved from the old pin, which it keeps as a former one', () => {
    expect(haversine(HK.lat, HK.lon, OLD.lat, OLD.lon)).toBeGreaterThan(2)
    expect(HK.formerPins).toEqual([OLD])
  })

  /**
   * Saved data is never rewritten: a copy saved before the move keeps the
   * old coordinates, and is still the spot wherever the app knows a copy by
   * where it sits — within 30 m (species lookup, coast store, share links)
   * or exactly there (spot finder, quick start).
   */
  it('knows a copy saved at the old pin as the spot', () => {
    expect(catalogueSpotAt(OLD.lat, OLD.lon)?.slug).toBe('helsingore-kysten')
    expect(catalogueSpotAt(OLD.lat + 20 / 110540, OLD.lon)?.slug).toBe('helsingore-kysten')
    expect(catalogueSpotAt(OLD.lat + 60 / 110540, OLD.lon)).toBeUndefined()
    expect(hasCopyOf([{ lat: OLD.lat, lon: OLD.lon }], HK)).toBe(true)
    expect(hasCopyOf([{ lat: HK.lat, lon: HK.lon }], HK)).toBe(true)
    expect(hasCopyOf([{ lat: OLD.lat + 0.001, lon: OLD.lon }], HK)).toBe(false)
  })
})

describe('former pins', () => {
  const others = (slug: string) => DK_SPOTS.filter((s) => s.slug !== slug)

  it('are nobody else\'s: none lies within the catalogue radius of another spot\'s pins', () => {
    const clash = DK_SPOTS.flatMap((s) => (s.formerPins ?? []).flatMap((p) => others(s.slug)
      .filter((o) => pinsOf(o).some((q) => haversine(p.lat, p.lon, q.lat, q.lon) <= CATALOGUE_MATCH_KM))
      .map((o) => `${s.slug} ↔ ${o.slug}`)))
    expect(clash).toEqual([])
  })

  it('are not copied into a saved spot', () => {
    const moved = DK_SPOTS.find((s) => s.formerPins?.length)!
    expect(locationFromSpot(moved)).not.toHaveProperty('formerPins')
  })

  it('give way to another spot\'s own pin', () => {
    const a = { ...DK_SPOTS[0], slug: 'a', lat: 56, lon: 11, formerPins: [{ lat: 55, lon: 10 }] }
    const b = { ...DK_SPOTS[0], slug: 'b', lat: 55, lon: 10.0001, formerPins: undefined }
    expect(catalogueSpotAt(55, 10, [a, b])?.slug).toBe('b')
    expect(catalogueSpotAt(55, 10, [a])?.slug).toBe('a')
  })
})

/** The spot finder's "added" and the quick start's "already saved" know a copy at a former pin too. */
describe('the views that look for a saved copy of an official spot', () => {
  const raw = import.meta.glob<string>(['/src/views/SpotFinderView.vue', '/src/views/WelcomeView.vue'],
    { query: '?raw', import: 'default', eager: true })

  it('ask hasCopyOf', () => {
    expect(raw['/src/views/SpotFinderView.vue']).toContain('return hasCopyOf(setup.locations, spot)')
    expect(raw['/src/views/WelcomeView.vue']).toContain('if (!hasCopyOf(setup.locations, s)) {')
  })
})
