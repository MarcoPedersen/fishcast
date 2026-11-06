import { describe, it, expect } from 'vitest'
import { changeWaterType, fitWaterType, hiddenSpeciesIds, pickableSpecies, selectedSpeciesIds, speciesEntry } from './locationSpecies'
import { SPECIES_PREFS } from './species'
import { DK_REGULATIONS } from './regulations'
import { speciesFromNearby } from './geo'
import { STRINGS } from './strings'
import { scoreWindow } from './scoring'
import type { Forecast, HourData, Location } from './types'

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
   * (all 12 at Tejn mole) earns it year-round. Months must be the in-season
   * window, so they cover June and exclude only the genuinely closed period.
   */
  it('uses in-season months, not the narrow peak season', () => {
    const months = speciesEntry('havørred')!.months
    expect(months).toContain(6)                 // June: not a peak month
    expect(months).not.toContain(12)            // closed 15 Nov – 15 Jan
    expect(months.length).toBeGreaterThan(6)    // broader than bestMonths
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
    for (const id of Object.keys(SPECIES_PREFS)) expect(all.has(id), id).toBe(true)
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
    const r = changeWaterType(HORNBAEK, 'salt')
    expect(r.dropped.sort()).toEqual(['gedde', 'karpe', 'sandart'])
    expect(selectedSpeciesIds(r.species)).toHaveLength(4)
    expect(changeWaterType(HORNBAEK, 'brackish')).toEqual({ species: HORNBAEK, dropped: [] })
  })

  it('finds the selected species the picker hides — an older setup can hold them', () => {
    expect(hiddenSpeciesIds(HORNBAEK, 'salt').sort()).toEqual(['gedde', 'karpe', 'sandart'])
    expect(hiddenSpeciesIds(HORNBAEK, 'fresh').sort()).toEqual(['hornfisk', 'makrel'])
    expect(hiddenSpeciesIds(HORNBAEK, 'brackish')).toEqual([])
    expect(hiddenSpeciesIds(HORNBAEK, undefined)).toEqual([])
  })
})

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
    const r = changeWaterType(RANDERS, 'fresh')
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
  })
})

describe('the spot card', () => {
  const sources = import.meta.glob<string>(['/src/views/LocationsView.vue'], { query: '?raw', import: 'default', eager: true })
  const v = sources['/src/views/LocationsView.vue'] ?? ''

  it('drops the species a new water type hides, says which, and offers to undo', () => {
    expect(v).toMatch(/const \{ species, dropped \} = changeWaterType\(l\.species, w\)/)
    expect(v).toMatch(/dropped\.length \? fill\(t\('loc_species_dropped'\), \{ names \}\)/)
    expect(v).toMatch(/showToast\(said, \{/)
    expect(v).toMatch(/label: t\('undo'\)/)
  })

  it('shows selected species the picker hides as removable', () => {
    expect(v).toMatch(/v-for="id in hiddenSpeciesIds\(l\.species, l\.waterType\)"[^>]*@click="toggleSpecies\(l, id\)"/)
    expect(v).toMatch(/t\('loc_species_unfit'\)/)
  })
})
