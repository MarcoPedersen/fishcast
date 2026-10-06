import { describe, it, expect } from 'vitest'
import { DK_REGULATIONS } from './regulations'

const reg = (id: string) => DK_REGULATIONS.species.find((s: { id: string }) => s.id === id)
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d)

describe('isInSeason — year-scoped closures', () => {
  /**
   * Grayling was hard-coded `status: 'closed'` with a comment "until May 15
   * 2026", so the Seasons tab still listed it as fully protected in October
   * 2026 — and the 2026-only total protection (1 Jan – 15 May) would have
   * carried on into every later year, because the closure's year was never read.
   */
  it('grayling: closed until 15 May 2026, open after', () => {
    expect(DK_REGULATIONS.isInSeason(reg('stalling'), day(2026, 5, 14))).toBe(false)
    expect(DK_REGULATIONS.isInSeason(reg('stalling'), day(2026, 5, 16))).toBe(true)
    expect(DK_REGULATIONS.isInSeason(reg('stalling'), day(2026, 10, 1))).toBe(true)
  })

  it('grayling: from 2027 only the 15 Mar – 15 May closure applies', () => {
    expect(DK_REGULATIONS.isInSeason(reg('stalling'), day(2027, 2, 1))).toBe(true)
    expect(DK_REGULATIONS.isInSeason(reg('stalling'), day(2027, 4, 1))).toBe(false)
    expect(DK_REGULATIONS.isInSeason(reg('stalling'), day(2027, 5, 16))).toBe(true)
  })

  it('a closure pinned to other years does not apply', () => {
    const sp = {
      status: 'open',
      closedSeasons: [{ startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, year: [2026] }],
    }
    expect(DK_REGULATIONS.isInSeason(sp, day(2026, 6, 1))).toBe(false)
    expect(DK_REGULATIONS.isInSeason(sp, day(2027, 6, 1))).toBe(true)
  })

  it('an end date of 28 Feb also covers 29 Feb in a leap year', () => {
    expect(DK_REGULATIONS.isInSeason(reg('bækørred'), day(2028, 2, 29))).toBe(false)
    expect(DK_REGULATIONS.isInSeason(reg('bækørred'), day(2028, 3, 1))).toBe(true)
  })
})

describe('isInSeason — closures scoped to a region or water type', () => {
  /**
   * The Wadden Sea salmon closure (15 Sep – 28 Feb) was applied nationwide, so
   * every salmon logged in October anywhere in Denmark was "possibly closed".
   */
  it('salmon in October is not closed by the Wadden-Sea-only closure', () => {
    expect(DK_REGULATIONS.isInSeason(reg('laks'), day(2026, 10, 1))).toBe(true)
    expect(DK_REGULATIONS.isInSeason(reg('laks'), day(2026, 10, 1), 'fresh')).toBe(true)
    // …but it is still reported, as a regional note, where it might apply.
    const regional = DK_REGULATIONS.regionalClosuresOn(reg('laks'), day(2026, 10, 1))
    expect(regional.map((c: { where: string }) => c.where)).toEqual(['Vadehavet'])
    // The Wadden Sea is salt water — a river location can rule it out.
    expect(DK_REGULATIONS.regionalClosuresOn(reg('laks'), day(2026, 10, 1), 'fresh')).toEqual([])
  })

  it('salmon in December is closed in both fresh and salt water', () => {
    expect(DK_REGULATIONS.isInSeason(reg('laks'), day(2026, 12, 10), 'fresh')).toBe(false)
    expect(DK_REGULATIONS.isInSeason(reg('laks'), day(2026, 12, 10), 'salt')).toBe(false)
  })

  it('salmon in February is closed in fresh water only', () => {
    expect(DK_REGULATIONS.isInSeason(reg('laks'), day(2027, 2, 10), 'fresh')).toBe(false)
    expect(DK_REGULATIONS.isInSeason(reg('laks'), day(2027, 2, 10), 'salt')).toBe(true)
    // Water type unknown: can't rule the freshwater closure out.
    expect(DK_REGULATIONS.isInSeason(reg('laks'), day(2027, 2, 10))).toBe(false)
  })

  it('perch in March is not closed nationwide by the South Zealand closure', () => {
    expect(DK_REGULATIONS.isInSeason(reg('aborre'), day(2026, 3, 20))).toBe(true)
    expect(DK_REGULATIONS.regionalClosuresOn(reg('aborre'), day(2026, 3, 20))).toHaveLength(1)
  })

  /** The saltwater pike closure lived in `saltClosedSeasons`, which nothing read. */
  it('pike on 10 May is closed in salt and brackish water, open in fresh', () => {
    expect(DK_REGULATIONS.isInSeason(reg('gedde'), day(2026, 5, 10), 'salt')).toBe(false)
    expect(DK_REGULATIONS.isInSeason(reg('gedde'), day(2026, 5, 10), 'brackish')).toBe(false)
    expect(DK_REGULATIONS.isInSeason(reg('gedde'), day(2026, 5, 10), 'fresh')).toBe(true)
    expect(DK_REGULATIONS.isInSeason(reg('gedde'), day(2026, 4, 10), 'fresh')).toBe(false)
  })

  it('saltwater eel stays closed', () => {
    expect(DK_REGULATIONS.isInSeason(reg('aal_salt'), day(2026, 7, 1))).toBe(false)
  })
})
