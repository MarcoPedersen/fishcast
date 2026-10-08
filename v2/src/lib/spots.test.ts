import { describe, it, expect } from 'vitest'
import { DK_SPOTS, locationFromSpot } from './spots'
import { SPECIES_PREFS } from './species'

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
