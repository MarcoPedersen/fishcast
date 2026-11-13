import { describe, it, expect } from 'vitest'
import { changeWaterType, countedSpeciesIds, fitWaterType, hiddenSpeciesIds, pickableSpecies, selectedSpeciesIds, speciesEntry } from './locationSpecies'
import { SPECIES_PREFS } from './species'
import { DK_REGULATIONS } from './regulations'
import { speciesFromNearby, speciesLookupFor } from './geo'
import { DK_SPOTS, locationFromSpot } from './spots'
import { usePendingSpot } from './pendingSpot'
import { STRINGS } from '@/test/strings'
import { scoreWindow } from './scoring'
import type { Forecast, HourData, Location, WaterType } from './types'

describe('locationSpecies', () => {
  it('only offers species the scorer can actually match', () => {
    // Every offered id must exist in SPECIES_PREFS with a nameEn, or picking it
    // would add a species that earns no relevance bonus.
    for (const c of pickableSpecies()) {
      expect(SPECIES_PREFS[c.id]?.nameEn, c.id).toBeTruthy()
      expect(c.months.length, c.id).toBeGreaterThan(0)
    }
    expect(pickableSpecies().length).toBeGreaterThan(10)
  })

  /**
   * DK_REGULATIONS spells sandart "Pike-Perch / Zander"; SPECIES_PREFS says
   * "Zander", and the relevance check compares that string exactly. Storing the
   * regulations spelling would look selected and score nothing.
   */
  it('stores the SPECIES_PREFS spelling, not the regulations one', () => {
    const e = speciesEntry('sandart')
    expect(e).not.toBeNull()
    expect(e!.nameEn).toBe(SPECIES_PREFS['sandart'].nameEn)
    expect(e!.nameEn).not.toContain('Pike-Perch')
  })

  /**
   * Regression on a real mistake: months were first taken from `bestMonths`,
   * which is the PEAK season — sea trout [3,4,5,9,10,11]. A hand-picked sea
   * trout would then earn relevance in 6 months where the official spot data
   * (all 12 at Nordmolen) earns it year-round. Months must be the in-season
   * window, so they cover June and exclude only the genuinely closed period.
   */
  it('uses in-season months, not the narrow peak season', () => {
    const months = speciesEntry('havørred', 'fresh')!.months
    expect(months).toContain(6)                 // June: not a peak month
    expect(months).not.toContain(12)            // streams: closed 16 Nov – end of February
    expect(months).not.toContain(1)
    expect(months.length).toBeGreaterThan(6)    // broader than bestMonths
  })

  /**
   * On the coast only sea trout in spawning colours are protected in winter
   * (lfst 2026); the coast is the winter fishery. A hand-picked sea trout at a
   * coastal pin lost its relevance in December, when the closure was read as
   * covering every fish everywhere.
   */
  it('keeps the winter months for sea trout on the coast', () => {
    expect(speciesEntry('havørred', 'salt')!.months).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(speciesEntry('havørred', 'brackish')!.months).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  /**
   * Closures scoped to one area used to apply nationwide: the Wadden Sea salmon
   * closure (15 Sep – 28 Feb) cut a hand-picked salmon to Mar–Sep, and the
   * South Zealand perch closure took March and April off perch everywhere.
   */
  it('regional closures do not remove months nationwide', () => {
    const laks = speciesEntry('laks')!.months
    expect(laks).toContain(10)
    expect(laks).toContain(11)
    expect(laks).not.toContain(12)              // closed in fresh and salt water
    expect(speciesEntry('aborre')!.months).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('narrows the list by water type', () => {
    const fresh = pickableSpecies('fresh').map((c) => c.id)
    const salt = pickableSpecies('salt').map((c) => c.id)
    expect(fresh).not.toEqual(salt)
    expect(salt).toContain('torsk')      // cod is saltwater
    expect(fresh).not.toContain('torsk')
  })

  /**
   * Map pins with no official spot nearby default to brackish — exactly the
   * pins this picker exists for — yet brackish only offered the 8 species
   * tagged 'brackish', though 47 of the 57 official spots are brackish and list
   * mackerel, cod, plaice and pike. Same rule as the spot finder now.
   */
  it('offers sea and freshwater species at a brackish location', () => {
    const brackish = pickableSpecies('brackish').map((c) => c.id)
    for (const id of ['makrel', 'torsk', 'roedspætte', 'ising', 'havbars', 'gedde']) {
      expect(brackish, id).toContain(id)
    }
    expect(brackish).toEqual(pickableSpecies().map((c) => c.id))
  })

  /**
   * Candidates were built from DK_REGULATIONS, so garfish — listed at 44 of the
   * 57 official spots — and tench, which simply have no regulations row (no
   * closed season), could never be picked.
   */
  it('offers species that have no regulations row, open all year', () => {
    expect(speciesEntry('hornfisk')).toEqual({ nameEn: 'Garfish', months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] })
    expect(speciesEntry('suder')?.months).toHaveLength(12)
    expect(pickableSpecies('salt').map((c) => c.id)).toContain('hornfisk')
  })

  it('every SPECIES_PREFS species is pickable for some water type', () => {
    const all = new Set(['salt', 'fresh', 'brackish'].flatMap((w) => pickableSpecies(w as 'salt').map((c) => c.id)))
    for (const id of Object.keys(SPECIES_PREFS)) {
      // Stenbider is protected all year (lfst 2026): no month is open, so it
      // has nothing to score for, like a target it can't be.
      if (id === 'stenbider') { expect(all.has(id), id).toBe(false); continue }
      expect(all.has(id), id).toBe(true)
    }
  })

  it('round-trips: an entry it writes is an id it reads back', () => {
    const e = speciesEntry('havørred')!
    expect(selectedSpeciesIds([e])).toContain('havørred')
    expect(selectedSpeciesIds([])).toEqual([])
    expect(selectedSpeciesIds(undefined)).toEqual([])
  })
})

// ── The point of the whole feature: a hand-picked species must score ──
const DATE = new Date(Date.UTC(2026, 5, 15)) // June
function forecast(): Forecast {
  const hourly: HourData[] = []
  for (let h = 0; h < 30; h++) {
    hourly.push({
      time: new Date(DATE.getUTCFullYear(), DATE.getUTCMonth(), DATE.getUTCDate(), h).getTime(),
      temp: 12, windMs: 2, windDir: 270, gustMs: 4, cloud: 40, precipPct: 0, pressure: 1013,
    })
  }
  return { fetched: 0, hourly, marine: null, tides: null }
}

describe('hand-picked species earn the spot-relevance bonus', () => {
  const bare: Location = { id: 'x', name: 'Custom pin', lat: 56, lon: 10, waterType: 'salt' }

  it('scores higher once the species is attached by hand', () => {
    const before = scoreWindow(bare, DATE, '06:00', '10:00', forecast(), ['havørred'])
    const picked: Location = { ...bare, species: [speciesEntry('havørred')!] }
    const after = scoreWindow(picked, DATE, '06:00', '10:00', forecast(), ['havørred'])
    expect(after.score).toBeGreaterThan(before.score)
    expect(after.relevance?.activeIds).toEqual(['havørred'])
  })
})

/**
 * A spot's species and its water type drifted apart. Hornbæk took the
 * species of every official spot within 12 km — a lake and the coast — and
 * the card said "7 arter valgt" while the picker lit 4: changed to Saltvand,
 * pike, zander and carp stayed on the spot, out of sight and out of reach,
 * and still counted towards its score whenever they were targets.
 */
describe('species and the water type', () => {
  // speciesFromNearby at Hornbæk: Gurre Sø and Helsingør Kysten merged.
  const HORNBAEK = ['Perch', 'Pike', 'Carp', 'Sea Trout', 'Garfish', 'Mackerel', 'Brown Trout (river/lake)', 'Zander']
    .map((nameEn) => ({ nameEn, months: [1, 2, 3] }))

  it('keeps the species the picker shows for that water type', () => {
    const shown = (w: 'salt' | 'fresh') => new Set(pickableSpecies(w).map((c) => c.id))
    for (const w of ['salt', 'fresh'] as const) {
      const ids = selectedSpeciesIds(fitWaterType(HORNBAEK, w))
      expect(ids.filter((id) => !shown(w).has(id)), w).toEqual([])
    }
    expect(selectedSpeciesIds(fitWaterType(HORNBAEK, 'salt')).sort()).toEqual(['aborre', 'havørred', 'hornfisk', 'makrel'])
    // Brackish water holds both, and a name the app doesn't know is nothing it can judge.
    expect(fitWaterType(HORNBAEK, 'brackish')).toEqual(HORNBAEK)
    expect(fitWaterType(HORNBAEK, 'salt').map((s) => s.nameEn)).toContain('Brown Trout (river/lake)')
    expect(fitWaterType(undefined, 'salt')).toEqual([])
  })

  it('a change of water type drops what no longer fits, and names it', () => {
    const r = changeWaterType(HORNBAEK, 'salt', 'brackish')
    expect(r.dropped.sort()).toEqual(['gedde', 'karpe', 'sandart'])
    expect(selectedSpeciesIds(r.species)).toHaveLength(4)
    expect(changeWaterType(HORNBAEK, 'brackish', 'salt')).toEqual({ species: HORNBAEK, dropped: [] })
  })

  /**
   * Integration: a species picked by hand takes the open months of the spot's
   * water (speciesEntry), but a change of type kept the old ones. A sea trout
   * picked at a brackish guess (1–12) kept December when the map turned the
   * spot fresh, and a December window there read "🎯 1/1 aktive her" (+15)
   * beside "🚫 Fredningstid: Havørred". Corrected to Saltvand, a river's sea
   * trout (3–11) scored its coastal winter 15 below one picked at salt.
   */
  it('a change of water type gives the species picked by hand the open months of the new water', () => {
    const picked = [speciesEntry('havørred', 'brackish')!, speciesEntry('laks', 'brackish')!]
    const fresh = changeWaterType(picked, 'fresh', 'brackish')
    expect(fresh).toEqual({ species: [speciesEntry('havørred', 'fresh'), speciesEntry('laks', 'fresh')], dropped: [] })
    expect(changeWaterType(fresh.species, 'salt', 'fresh').species)
      .toEqual([speciesEntry('havørred', 'salt'), speciesEntry('laks', 'salt')])
    // An official spot's months say when the fish is there, not when it is
    // open: they stay as they were.
    expect(changeWaterType(HORNBAEK, 'brackish', 'salt')).toEqual({ species: HORNBAEK, dropped: [] })
  })

  it('…so the relevance bonus follows the closed months of the new water', () => {
    const DEC = new Date(Date.UTC(2026, 11, 10))
    const at = (species: Location['species']): Location =>
      ({ id: 'r', name: 'Å', lat: 56, lon: 10, waterType: 'fresh', species })
    const f = { ...forecast(), hourly: forecast().hourly.map((h, i) => ({ ...h, time: new Date(2026, 11, 10, i).getTime() })) }
    const changed = changeWaterType([speciesEntry('havørred', 'brackish')!], 'fresh', 'brackish').species
    const w = scoreWindow(at(changed), DEC, '15:00', '17:00', f, ['havørred'])
    expect(w.relevance?.activeIds ?? []).toEqual([])
    expect(w.score).toBe(scoreWindow(at([speciesEntry('havørred', 'fresh')!]), DEC, '15:00', '17:00', f, ['havørred']).score)
  })

  it('finds the selected species the picker hides — an older setup can hold them', () => {
    expect(hiddenSpeciesIds(HORNBAEK, 'salt').sort()).toEqual(['gedde', 'karpe', 'sandart'])
    expect(hiddenSpeciesIds(HORNBAEK, 'fresh').sort()).toEqual(['hornfisk', 'makrel'])
    expect(hiddenSpeciesIds(HORNBAEK, 'brackish')).toEqual([])
    expect(hiddenSpeciesIds(HORNBAEK, undefined)).toEqual([])
  })
})

/**
 * A saved setup can hold species its water type hides: one from before a
 * change of type dropped them, or a spot saved with a lake's fish while it
 * was guessed brackish and set to Saltvand by an older build. It is the
 * user's synced data, so nothing rewrites it on load. But those species
 * scored all the same: a salt spot holding pike earned "🎯 1/1 aktive her"
 * (+15) for a gedde target, and the card counted them, so it said "7 arter
 * valgt" while the picker lit 4. Neither the score nor the count reads them
 * now; the picker still lists them, to remove.
 */
describe('species that do not fit the water type count for nothing', () => {
  const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  const HORNBAEK = ['Perch', 'Pike', 'Carp', 'Sea Trout', 'Garfish', 'Mackerel', 'Brown Trout (river/lake)', 'Zander']
    .map((nameEn) => ({ nameEn, months: ALL }))
  const at = (waterType: WaterType | undefined, species: Location['species'] = HORNBAEK): Location =>
    ({ id: 'h', name: 'Hornbæk', lat: 56.09, lon: 12.46, waterType, species })
  const score = (l: Location, targets: string[]) => scoreWindow(l, DATE, '06:00', '10:00', forecast(), targets)

  it('scores none of them', () => {
    expect(score(at('salt'), ['gedde']).relevance).toBeUndefined()
    expect(score(at('salt'), ['gedde']).score).toBe(score(at('salt', []), ['gedde']).score)
    expect(score(at('fresh'), ['makrel']).relevance).toBeUndefined()
    // What fits still does.
    expect(score(at('salt'), ['aborre']).relevance?.activeIds).toEqual(['aborre'])
    expect(score(at('brackish'), ['gedde']).relevance?.activeIds).toEqual(['gedde'])
  })

  it('the card counts exactly the species the score can use', () => {
    for (const w of ['salt', 'brackish', 'fresh', 'both', undefined] as const) {
      const counted = countedSpeciesIds(HORNBAEK, w)
      for (const id of Object.keys(SPECIES_PREFS)) {
        const active = score(at(w), [id]).relevance?.activeIds ?? []
        expect(active.includes(id), `${w} ${id}`).toBe(counted.includes(id))
      }
    }
    expect(countedSpeciesIds(HORNBAEK, 'salt').sort()).toEqual(['aborre', 'havørred', 'hornfisk', 'makrel'])
    expect(countedSpeciesIds(HORNBAEK, 'fresh').sort()).toEqual(['aborre', 'gedde', 'havørred', 'karpe', 'sandart'])
    // The eighth, "Brown Trout (river/lake)", is no species the app knows: never offered nor scored.
    expect(countedSpeciesIds(HORNBAEK, 'brackish')).toHaveLength(7)
    expect(countedSpeciesIds(undefined, 'salt')).toEqual([])
  })
})

/**
 * A guessed water type can change after the species were filled in: the
 * map's lookup turns a guessed brackish lake pin fresh (waterGuess.ts
 * guessFollowsMap), or the user corrects the guess. A sea spot takes no
 * lake's species (speciesFromNearby), so a pin in mid-Arresø guessed
 * brackish has none, and kept none once fresh: changeWaterType only drops.
 * Hornbæk turned fresh kept only its sea trout, without the lakes' fish a
 * spot added as fresh there gets. When the species are still what the
 * lookup gave for the old water type, or there are none, the lookup runs
 * again for the new one. Picked by hand, they stay as changeWaterType
 * leaves them.
 */
describe('a change of water type re-runs the lookup for the species it filled in', () => {
  const names = (l: { nameEn?: string }[] | undefined) => (l ?? []).map((s) => s.nameEn).sort()
  const near = (lat: number, lon: number) => (w: WaterType | undefined) => speciesFromNearby(lat, lon, w)
  /** near, each water type looked up once: the grid tests below ask the same point for it again and again. */
  const nearOnce = (lat: number, lon: number) => {
    const seen = new Map<WaterType | undefined, ReturnType<typeof speciesFromNearby>>()
    return (w: WaterType | undefined) => {
      if (!seen.has(w)) seen.set(w, speciesFromNearby(lat, lon, w))
      return seen.get(w)!.map((x) => ({ ...x }))
    }
  }
  const HORN = near(56.09027, 12.45693)
  const ARRESO = near(55.97, 12.1) // Nordhuse, mid-Arresø (waterGuess.test.ts)

  it('a spot filled in at a guess gets what the lookup gives the corrected water', () => {
    const r = changeWaterType(HORN('brackish'), 'fresh', 'brackish', HORN)
    expect(r.species).toEqual(HORN('fresh'))
    expect(names(r.species)).toEqual(['Brown Trout (river/lake)', 'Perch', 'Pike', 'Sea Trout', 'Zander'])
    // The toast names those the lookup took off: here, those the new water hides.
    expect(r.dropped.sort()).toEqual(['hornfisk', 'makrel'])
    const back = changeWaterType(r.species, 'salt', 'fresh', HORN)
    expect(back.species).toEqual(HORN('salt'))
    // Perch too: the picker offers it at salt, but no sea spot near Hornbæk lists it.
    expect(back.dropped.sort()).toEqual(['aborre', 'gedde', 'sandart'])
    expect(back.relooked).toBe(true)
  })

  /**
   * The lookup can take off species the new water type still shows: a
   * brackish spot takes no lake's species, though the picker offers pike
   * there. The toast named only those the water hid, so Silkeborg set from
   * Ferskvand to Brakvand lost its pike, zander, perch and bream with no
   * toast, and so no undo, and Hornbæk set to Saltvand lost a perch the
   * toast left out. It names every species the change takes off, and says
   * the official spots nearby don't list them for that water (`relooked`).
   */
  it('the toast names every species the lookup takes off', () => {
    const SILKEBORG = near(56.1697, 9.5451)
    const r = changeWaterType(SILKEBORG('fresh'), 'brackish', 'fresh', SILKEBORG)
    expect(r.species).toEqual([])
    expect(r.dropped.sort()).toEqual(['aborre', 'brasen', 'gedde', 'sandart'])
    expect(r.relooked).toBe(true)
    // Every list the lookup fills in, every change of type, on a 0.1° grid.
    // Mismatches are collected and checked once: an expect() per change made
    // this one of the suite's slowest tests.
    let changes = 0
    const wrong: string[] = []
    for (let lat = 54.6; lat <= 57.7; lat += 0.1) for (let lon = 8.1; lon <= 15.1; lon += 0.1) {
      const at = nearOnce(lat, lon)
      for (const from of ['salt', 'brackish', 'fresh'] as const) for (const to of ['salt', 'brackish', 'fresh'] as const) {
        const start = at(from)
        if (from === to || !start.length) continue
        changes++
        const c = changeWaterType(start, to, from, at)
        const left = selectedSpeciesIds(c.species)
        const off = selectedSpeciesIds(start).filter((id) => !left.includes(id))
        if (c.dropped.sort().join() !== off.sort().join()) wrong.push(`${lat.toFixed(1)},${lon.toFixed(1)} ${from}->${to}: ${c.dropped} vs ${off}`)
      }
    }
    expect(wrong).toEqual([])
    expect(changes).toBeGreaterThan(1000)
  })

  /**
   * The lookup puts species on too, and the toast named only those it took
   * off: Hornbæk set from Brakvand to Ferskvand gained perch, pike, carp
   * and zander unnamed, and a spot with none that gained the lake's fish
   * got no toast at all, so no undo. The ids put on are named as well
   * (`added`), only species the app knows: the official spots' "Brown
   * Trout (river/lake)" is never offered nor scored, so never named.
   */
  it('the toast names the species the lookup puts on, those the app knows', () => {
    const r = changeWaterType(HORN('brackish'), 'fresh', 'brackish', HORN)
    expect(names(r.species)).toContain('Brown Trout (river/lake)')
    expect(r.added?.sort()).toEqual(['aborre', 'gedde', 'sandart'])
    expect(changeWaterType(r.species, 'salt', 'fresh', HORN).added?.sort()).toEqual(['hornfisk', 'makrel'])
    // A spot with none puts on all the lookup gives that the app knows.
    expect(changeWaterType(undefined, 'fresh', 'brackish', ARRESO).added?.sort()).toEqual(['aborre', 'brasen', 'gedde', 'karpe', 'sandart'])
    // Species picked by hand are never re-looked-up: nothing is put on.
    expect(changeWaterType([speciesEntry('torsk', 'salt')!], 'fresh', 'salt', HORN).added ?? []).toEqual([])
    // Every list the lookup fills in, and none, every change of type, on a 0.1° grid.
    let changes = 0
    let gained = 0
    const wrong: string[] = []
    for (let lat = 54.6; lat <= 57.7; lat += 0.1) for (let lon = 8.1; lon <= 15.1; lon += 0.1) {
      const at = nearOnce(lat, lon)
      for (const from of ['salt', 'brackish', 'fresh'] as const) for (const to of ['salt', 'brackish', 'fresh'] as const) {
        if (from === to) continue
        const start = at(from)
        const c = changeWaterType(start.length ? start : undefined, to, from, at)
        const had = selectedSpeciesIds(start)
        const on = selectedSpeciesIds(c.species).filter((id) => !had.includes(id))
        if ((c.added ?? []).sort().join() !== on.sort().join()) wrong.push(`${lat.toFixed(1)},${lon.toFixed(1)} ${from}->${to}: ${c.added} vs ${on}`)
        changes++
        if (on.length) gained++
      }
    }
    expect(wrong).toEqual([])
    expect(changes).toBeGreaterThan(1000)
    expect(gained).toBeGreaterThan(500)
  })

  it('a lake pin guessed brackish, with none, gets the species of the lake once the map turns it fresh', () => {
    expect(ARRESO('brackish')).toEqual([])
    const r = changeWaterType(undefined, 'fresh', 'brackish', ARRESO)
    expect(r.species).toEqual(ARRESO('fresh'))
    expect(names(r.species)).toEqual(['Bream', 'Carp', 'Perch', 'Pike', 'Zander'])
    expect(r.dropped).toEqual([])
    // Nothing for the new water either: nothing changes.
    expect(changeWaterType(undefined, 'salt', 'fresh', near(56.5, 3.0))).toEqual({ species: undefined, dropped: [] })
  })

  /**
   * An empty list is one the user cleared (the last species tapped off in
   * the picker), and the lookup leaves it alone, as the refill at a start
   * does (stores/setup.ts enrichMissingSpecies): Hornbæk cleared at
   * Brakvand and set to Ferskvand took the lakes' perch, pike and zander
   * back on. Only no list at all is never filled. An empty list where the
   * lookup lists nothing for the old water either is the lookup's own as
   * far as anyone can tell (the map sheet saved its "none" as one), so it
   * still follows the lookup: the Arresø pin, and Silkeborg set back to
   * Ferskvand.
   */
  it('a list the user emptied stays empty; one the lookup emptied still follows it', () => {
    expect(names(HORN('brackish'))).toEqual(['Garfish', 'Mackerel', 'Sea Trout'])
    expect(changeWaterType([], 'fresh', 'brackish', HORN)).toEqual({ species: [], dropped: [] })
    expect(names(changeWaterType([], 'fresh', 'brackish', ARRESO).species)).toEqual(['Bream', 'Carp', 'Perch', 'Pike', 'Zander'])
    const SILKEBORG = near(56.1697, 9.5451)
    const off = changeWaterType(SILKEBORG('fresh'), 'brackish', 'fresh', SILKEBORG)
    expect(off.species).toEqual([])
    expect(changeWaterType(off.species, 'fresh', 'brackish', SILKEBORG).species).toEqual(SILKEBORG('fresh'))
  })

  it('species picked by hand stay as changeWaterType leaves them', () => {
    const picked = [...HORN('brackish'), speciesEntry('torsk', 'brackish')!]
    expect(changeWaterType(picked, 'fresh', 'brackish', HORN)).toEqual(changeWaterType(picked, 'fresh', 'brackish'))
    expect(names(changeWaterType(picked, 'fresh', 'brackish', HORN).species)).toEqual(['Sea Trout'])
    // Saved by an older build's lookup, Hornbæk's 8 are no longer the lookup's.
    expect(changeWaterType(HORNBAEK_8, 'salt', 'brackish', HORN)).toEqual(changeWaterType(HORNBAEK_8, 'salt', 'brackish'))
  })

  /**
   * An official spot's species are its own, not the lookup's. One saved from
   * the setup map has no spotSlug (pendingSpot.toLocation; stores/coast.ts
   * knows it by sitting within 30 m of one), and where no other official
   * spot lies within 12 km its own list is exactly the lookup's. Handed the
   * lookup, Arresø, Furesø, Mossø and four more lakes set to Brakvand lost
   * every species with no toast to undo it, and Helsingør Kysten set to
   * Ferskvand took the carp and pike of Gurre Sø.
   */
  it('an official spot, saved from the map or the catalogue, keeps its own species', () => {
    for (const spot of DK_SPOTS) {
      const sheet = usePendingSpot(async () => spot.name)
      sheet.startFromSpot(spot)
      for (const [how, saved] of [['map', sheet.toLocation()!], ['catalogue', locationFromSpot(spot)]] as const) {
        expect(speciesLookupFor(saved), `${spot.slug} from the ${how}`).toBeUndefined()
      }
    }
    const arreso = DK_SPOTS.find((s) => s.slug === 'arreso')!
    const sheet = usePendingSpot(async () => arreso.name)
    sheet.startFromSpot(arreso)
    const fromMap = sheet.toLocation()!
    expect(fromMap.spotSlug).toBeUndefined()
    const r = changeWaterType(fromMap.species, 'brackish', 'fresh', speciesLookupFor(fromMap))
    expect(names(r.species)).toEqual(names(fromMap.species))
    // A custom spot gets the lookup at its place.
    expect(speciesLookupFor({ lat: 56.09027, lon: 12.45693 })?.('brackish')).toEqual(HORN('brackish'))
  })

  /**
   * Helsingør Kysten moved from Helsingør town to Kronborg Pynten, 2.3 km.
   * One saved from the map before keeps the old coordinates and no slug:
   * still the official spot, so a change to Ferskvand keeps its own sea
   * trout and takes no carp or pike from Gurre Sø, 6 km off the old pin.
   */
  it('a copy saved from the map at an official spot\'s former pin keeps its own species', () => {
    const hk = DK_SPOTS.find((s) => s.slug === 'helsingore-kysten')!
    const old = { lat: 56.0350, lon: 12.5890, species: locationFromSpot(hk).species }
    expect(speciesLookupFor(old)).toBeUndefined()
    const r = changeWaterType(old.species, 'fresh', 'brackish', speciesLookupFor(old))
    expect(names(r.species)).toEqual(['Sea Trout'])
    // With the lookup it would have taken Gurre Sø's perch, pike and carp (Esrum Sø is 13 km off, out of range).
    expect(names(speciesFromNearby(old.lat, old.lon, 'fresh'))).toContain('Pike')
  })

  /**
   * Gurre Sø moved 7 km, from the fields by Villingerød onto its lake. A copy
   * saved from the map before keeps the old pin and no slug: still the lake's
   * spot, so a list the user cleared stays clear when the water type changes,
   * where the lookup at the old pin would put Esrum Sø's brown trout on
   * it.
   */
  it('a copy saved from the map at Gurre Sø\'s former pin keeps its own species', () => {
    const gs = DK_SPOTS.find((s) => s.slug === 'gurre-so')!
    const old = { lat: 56.0670, lon: 12.4010, species: locationFromSpot(gs).species }
    expect(speciesLookupFor(old)).toBeUndefined()
    expect(names(changeWaterType(old.species, 'brackish', 'fresh', speciesLookupFor(old)).species)).toEqual(['Perch', 'Pike', 'Zander'])
    expect(changeWaterType([], 'fresh', 'brackish', speciesLookupFor(old)).species).toEqual([])
    expect(names(speciesFromNearby(old.lat, old.lon, 'fresh'))).toContain('Zander')
  })
})
const HORNBAEK_8 = speciesFromNearby(56.09027, 12.45693)

/**
 * Sea trout run up the rivers. DK_REGULATIONS gives havørred salt and fresh
 * water ("Åer, strande, havkyster", closed in "Saltvandskyster og åer");
 * SPECIES_PREFS, which the scorer and the spot finder read, salt and brackish.
 * Judged by SPECIES_PREFS alone, the Gudenå at Randers set to Ferskvand lost
 * its Havørred, with a toast saying it doesn't live there, and a new fresh
 * spot there was filled in without it.
 */
describe('a river spot keeps its sea trout', () => {
  const names = (l: { nameEn?: string }[] | undefined) => (l ?? []).map((s) => s.nameEn)
  // The Gudenå in Randers: the official spots within 12 km.
  const RANDERS = speciesFromNearby(56.4607, 10.0364)

  it('through a change to fresh water, and the lookup that fills in a new spot', () => {
    expect(names(RANDERS)).toContain('Sea Trout')
    const r = changeWaterType(RANDERS, 'fresh', 'brackish')
    expect(r.dropped).not.toContain('havørred')
    expect(names(r.species)).toContain('Sea Trout')
    expect(names(fitWaterType(RANDERS, 'fresh'))).toContain('Sea Trout')
    expect(hiddenSpeciesIds(RANDERS, 'fresh')).not.toContain('havørred')
    // Herring is a sea fish by both tables.
    expect(r.dropped).toContain('sild')
  })

  it('the picker offers it at a fresh spot, and every species either table puts in fresh water', () => {
    const fresh = pickableSpecies('fresh').map((c) => c.id)
    expect(fresh).toContain('havørred')
    expect(fresh).toContain('laks')
    for (const reg of DK_REGULATIONS.species as { id: string; waterType: string[] }[]) {
      if (SPECIES_PREFS[reg.id] && reg.waterType.includes('fresh')) expect(fresh, reg.id).toContain(reg.id)
    }
  })

  it('the messages say the app hides them, not that the fish cannot live there', () => {
    for (const lang of ['da', 'en'] as const) {
      for (const key of ['loc_species_dropped', 'loc_species_dropped_nearby', 'loc_species_unfit'] as const) {
        expect(STRINGS[lang][key], `${lang}.${key}`).toBeTruthy()
        expect(STRINGS[lang][key], `${lang}.${key}`).not.toMatch(/lever ikke|live/)
      }
      // The lookup's toast says why: the official spots nearby don't list them.
      expect(STRINGS[lang].loc_species_dropped_nearby, lang).toMatch(/\{names\}/)
    }
    expect(STRINGS.da.loc_species_dropped_nearby).toMatch(/officielle pladser i nærheden/)
    expect(STRINGS.en.loc_species_dropped_nearby).toMatch(/official spots nearby/)
    // …and that the ones it hides don't count.
    expect(STRINGS.da.loc_species_unfit).toMatch(/tæller ikke/)
    expect(STRINGS.en.loc_species_unfit).toMatch(/not counted/)
  })

  it('the toast says what a change put on, in both languages', () => {
    expect(STRINGS.da.loc_species_added).toMatch(/^Tilføjet .*\{names\}/)
    expect(STRINGS.en.loc_species_added).toMatch(/^Added .*\{names\}/)
  })
})

describe('the spot card', () => {
  const sources = import.meta.glob<string>(['/src/views/LocationsView.vue'], { query: '?raw', import: 'default', eager: true })
  const v = sources['/src/views/LocationsView.vue'] ?? ''

  it('drops the species a new water type hides, says which, and offers to undo', () => {
    // A custom spot's lookup runs again when its species are still the lookup's; an official spot's are its own (speciesLookupFor).
    expect(v).toMatch(/const \{ species, dropped, added = \[\], relooked \} = changeWaterType\(l\.species, w, before\.waterType, speciesLookupFor\(l\)\)/)
    // Month changes alone are applied too, without a toast.
    expect(v).toMatch(/if \(species !== l\.species\) l\.species = species/)
    // What the lookup took off is named as such: the new water may still show it.
    expect(v).toMatch(/dropped\.length \? fill\(t\(relooked \? 'loc_species_dropped_nearby' : 'loc_species_dropped'\), \{ names \}\)/)
    // …and what it put on, so a change that only puts species on has its toast, and its undo, too.
    expect(v).toMatch(/added\.length \? fill\(t\('loc_species_added'\), \{ names: added\.map\(\(id\) => spName\(SPECIES_PREFS\[id\]\)\)\.join\(', '\) \}\)/)
    expect(v).toMatch(/showToast\(said, \{/)
    // The toast stays until used or closed, so its text and button are read
    // when shown (lib/toast): built once, they kept the old language after a switch.
    expect(v).toMatch(/const said = \(\) => \{\s+const names = dropped\.map\(\(id\) => spName\(SPECIES_PREFS\[id\]\)\)\.join\(', '\)/)
    expect(v).toMatch(/label: \(\) => t\('undo'\)/)
  })

  it('shows selected species the picker hides as removable', () => {
    expect(v).toMatch(/v-for="id in hiddenSpeciesIds\(l\.species, l\.waterType\)"[^>]*@click="toggleSpecies\(l, id\)"/)
    expect(v).toMatch(/t\('loc_species_unfit'\)/)
  })

  it('counts the species the score uses, and asks for them when none does', () => {
    expect(v).toMatch(/function speciesCount\(l: Location\): number \{\s+return countedSpeciesIds\(l\.species, l\.waterType\)\.length\s+\}/)
    expect(v).toMatch(/v-else-if="!speciesCount\(l\)" class="sp-missing"/)
    expect(v).toMatch(/if \(added && !speciesCount\(added\)\) speciesOpenId\.value = id/)
  })
})
