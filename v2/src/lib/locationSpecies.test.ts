import { describe, it, expect } from 'vitest'
import { pickableSpecies, selectedSpeciesIds, speciesEntry } from './locationSpecies'
import { SPECIES_PREFS } from './species'
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

  it('narrows the list by water type', () => {
    const fresh = pickableSpecies('fresh').map((c) => c.id)
    const salt = pickableSpecies('salt').map((c) => c.id)
    expect(fresh).not.toEqual(salt)
    expect(salt).toContain('torsk')      // cod is saltwater
    expect(fresh).not.toContain('torsk')
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
