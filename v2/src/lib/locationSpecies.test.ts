import { describe, it, expect } from 'vitest'
import { changeWaterType, countedSpeciesIds, fitWaterType, hiddenSpeciesIds, pickableSpecies, selectedSpeciesIds, speciesEntry } from './locationSpecies'
import { SPECIES_PREFS } from './species'
import { DK_REGULATIONS } from './regulations'
import { speciesFromNearby } from './geo'
import { STRINGS } from './strings'
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
  const HORN = near(56.09027, 12.45693)
  const ARRESO = near(55.97, 12.1) // Nordhuse, mid-Arresø (waterGuess.test.ts)

  it('a spot filled in at a guess gets what the lookup gives the corrected water', () => {
    const r = changeWaterType(HORN('brackish'), 'fresh', 'brackish', HORN)
    expect(r.species).toEqual(HORN('fresh'))
    expect(names(r.species)).toEqual(['Brown Trout (river/lake)', 'Carp', 'Perch', 'Pike', 'Sea Trout', 'Zander'])
    // The toast names those the new water hides, as before.
    expect(r.dropped.sort()).toEqual(['hornfisk', 'makrel'])
    const back = changeWaterType(r.species, 'salt', 'fresh', HORN)
    expect(back.species).toEqual(HORN('salt'))
    expect(back.dropped.sort()).toEqual(['gedde', 'karpe', 'sandart'])
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

  it('species picked by hand stay as changeWaterType leaves them', () => {
    const picked = [...HORN('brackish'), speciesEntry('torsk', 'brackish')!]
    expect(changeWaterType(picked, 'fresh', 'brackish', HORN)).toEqual(changeWaterType(picked, 'fresh', 'brackish'))
    expect(names(changeWaterType(picked, 'fresh', 'brackish', HORN).species)).toEqual(['Sea Trout'])
    // Saved by an older build's lookup, Hornbæk's 8 are no longer the lookup's.
    expect(changeWaterType(HORNBAEK_8, 'salt', 'brackish', HORN)).toEqual(changeWaterType(HORNBAEK_8, 'salt', 'brackish'))
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
      for (const key of ['loc_species_dropped', 'loc_species_unfit'] as const) {
        expect(STRINGS[lang][key], `${lang}.${key}`).not.toMatch(/lever ikke|live/)
      }
    }
    // …and that the ones it hides don't count.
    expect(STRINGS.da.loc_species_unfit).toMatch(/tæller ikke/)
    expect(STRINGS.en.loc_species_unfit).toMatch(/not counted/)
  })
})

describe('the spot card', () => {
  const sources = import.meta.glob<string>(['/src/views/LocationsView.vue'], { query: '?raw', import: 'default', eager: true })
  const v = sources['/src/views/LocationsView.vue'] ?? ''

  it('drops the species a new water type hides, says which, and offers to undo', () => {
    // A custom spot's lookup runs again when its species are still the lookup's; an official spot's are its own.
    expect(v).toMatch(/const lookup = l\.spotSlug \? undefined : \(wt: WaterType \| undefined\) => speciesFromNearby\(l\.lat, l\.lon, wt\)/)
    expect(v).toMatch(/const \{ species, dropped \} = changeWaterType\(l\.species, w, before\.waterType, lookup\)/)
    // Month changes alone are applied too, without a toast.
    expect(v).toMatch(/if \(species !== l\.species\) l\.species = species/)
    expect(v).toMatch(/dropped\.length \? fill\(t\('loc_species_dropped'\), \{ names \}\)/)
    expect(v).toMatch(/showToast\(said, \{/)
    expect(v).toMatch(/label: t\('undo'\)/)
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
