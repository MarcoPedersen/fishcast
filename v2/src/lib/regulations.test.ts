import { describe, it, expect } from 'vitest'
import { DK_REGULATIONS } from './regulations'
import { rulePlaceAt } from './ruleArea'
import { SPECIES_PREFS } from './species'

const reg = (id: string) => DK_REGULATIONS.species.find((s: { id: string }) => s.id === id)
const day = (y: number, m: number, d: number) => new Date(y, m - 1, d)
/** A Kattegat coast in none of the named waters (Bornholm, the Wadden Sea, the fjords). */
const FORNAES = rulePlaceAt(56.444, 10.959)

/**
 * The Seasons tab rendered these Danish-only in English mode — the 2026 cod
 * ban, the eel ban, bag limits and the weever's first-aid text. Every text it
 * shows needs an English twin, like the species name has.
 */
describe('English text for everything the Seasons tab shows', () => {
  it('has an *En field next to each note, bag limit, area and venom warning', () => {
    const missing: string[] = []
    for (const s of DK_REGULATIONS.species) {
      if (s.bagLimit && !s.bagLimitEn) missing.push(`${s.id}.bagLimit`)
      if (s.venomWarning && !s.venomWarningEn) missing.push(`${s.id}.venomWarning`)
      ;(s.restrictions || []).forEach((r: { note: string; noteEn?: string }, i: number) => {
        if (!r.noteEn) missing.push(`${s.id}.restrictions[${i}]`)
      })
      ;(s.closedSeasons || []).forEach((c: { where?: string; whereEn?: string }, i: number) => {
        if (c.where && !c.whereEn) missing.push(`${s.id}.closedSeasons[${i}]`)
      })
    }
    expect(missing).toEqual([])
  })
})

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
    expect(regional.map((c: { where: string }) => c.where)).toContain('Vadehavet')
    // The Wadden Sea is salt water — a river location can rule it out…
    expect(DK_REGULATIONS.regionalClosuresOn(reg('laks'), day(2026, 10, 1), 'fresh')
      .map((c: { where: string }) => c.where)).not.toContain('Vadehavet')
    // …and a location's position rules every named water out.
    expect(DK_REGULATIONS.regionalClosuresOn(reg('laks'), day(2026, 10, 1), 'salt', FORNAES)).toEqual([])
  })

  // lfst laks page (2026): salt water 16 Nov – 15 Jan "Overalt (i yngledragt)" —
  // like sea trout, only fish in spawning colours; fresh water closes them all.
  it('salmon in December is closed in fresh water, and protected in colour in salt water', () => {
    expect(DK_REGULATIONS.isInSeason(reg('laks'), day(2026, 12, 10), 'fresh')).toBe(false)
    expect(DK_REGULATIONS.isInSeason(reg('laks'), day(2026, 12, 10), 'salt')).toBe(true)
    expect(DK_REGULATIONS.regionalClosuresOn(reg('laks'), day(2026, 12, 10), 'salt')
      .map((c: { where: string }) => c.where).join(' ')).toMatch(/gydedragt/)
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

/**
 * Sea trout and brown trout against lfst's 2026 lists ("Fredning og mindstemål
 * i saltvand 2026", valid from 01.01.2026; the freshwater list, closures valid
 * from 17.01.2025). The app closed ALL sea trout 15 Nov – 15 Jan "on coasts and
 * streams": a day early, for bright fish that may be kept, and it reopened the
 * streams on 16 Jan although they stay closed to the end of February.
 */
describe('sea trout and brown trout closures (lfst 2026)', () => {
  const hav = () => reg('havørred')
  const hedged = (sp: unknown, d: Date, w?: string, place?: unknown) =>
    DK_REGULATIONS.regionalClosuresOn(sp, d, w, place).map((c: { where: string }) => c.where)

  it('salt water: 15 Nov is open; 16 Nov – 15 Jan only fish in spawning colours are protected', () => {
    expect(DK_REGULATIONS.closuresOn(hav(), day(2026, 11, 15), 'salt', FORNAES)).toEqual([])
    for (const d of [day(2026, 11, 16), day(2026, 12, 20), day(2027, 1, 15)]) {
      // Not a closure — bright fish with loose scales may be kept…
      expect(DK_REGULATIONS.isInSeason(hav(), d, 'salt')).toBe(true)
      // …but the colour rule is reported.
      expect(hedged(hav(), d, 'salt', FORNAES).join(' ')).toMatch(/gydedragt/)
    }
    expect(DK_REGULATIONS.closuresOn(hav(), day(2027, 1, 16), 'salt', FORNAES)).toEqual([])
  })

  it('fresh water: closed 16 Nov to the end of February, for every fish', () => {
    expect(DK_REGULATIONS.isInSeason(hav(), day(2026, 11, 16), 'fresh')).toBe(false)
    expect(DK_REGULATIONS.isInSeason(hav(), day(2027, 1, 20), 'fresh')).toBe(false)
    expect(DK_REGULATIONS.isInSeason(hav(), day(2027, 2, 28), 'fresh')).toBe(false)
    expect(DK_REGULATIONS.isInSeason(hav(), day(2027, 3, 1), 'fresh')).toBe(true)
  })

  /** The app's brackish is "fjords, belts, the Baltic": salt water in law. */
  it('a brackish coast follows the saltwater rules', () => {
    expect(DK_REGULATIONS.isInSeason(hav(), day(2027, 1, 20), 'brackish')).toBe(true)
    expect(DK_REGULATIONS.closuresOn(hav(), day(2027, 1, 20), 'brackish', FORNAES)).toEqual([])
  })

  it('Bornholm: coloured sea trout are protected from mid-September', () => {
    const ronne = rulePlaceAt(55.101, 14.707)
    expect(DK_REGULATIONS.isInSeason(hav(), day(2026, 10, 1), 'brackish', ronne)).toBe(true)
    expect(hedged(hav(), day(2026, 10, 1), 'brackish', ronne).join(' ')).toMatch(/Bornholm/)
    // Bornholm streams too (the freshwater list's footnote).
    expect(hedged(hav(), day(2026, 10, 1), 'fresh', ronne).join(' ')).toMatch(/Bornholm/)
    // Not at Dragør.
    expect(hedged(hav(), day(2026, 10, 1), 'brackish', rulePlaceAt(55.593, 12.672))).toEqual([])
  })

  it('the Wadden Sea and the west-coast fjords are named where they may apply', () => {
    expect(hedged(hav(), day(2026, 10, 1), 'salt', rulePlaceAt(55.47, 8.44)).join(' ')).toMatch(/Vadehavet/)
    expect(hedged(hav(), day(2026, 7, 1), 'salt', rulePlaceAt(56.0, 8.25)).join(' ')).toMatch(/Ringkøbing/)
    expect(hedged(hav(), day(2026, 7, 1), 'salt', FORNAES)).toEqual([])
  })

  it('brown trout: closed 16 Nov – end of February, not from 1 Nov', () => {
    expect(DK_REGULATIONS.isInSeason(reg('bækørred'), day(2026, 11, 5), 'fresh')).toBe(true)
    expect(DK_REGULATIONS.isInSeason(reg('bækørred'), day(2026, 11, 16), 'fresh')).toBe(false)
  })

  it('lake trout has its own row, at 40 cm', () => {
    expect(DK_REGULATIONS.sizeRange(reg('søørred'), 'fresh')).toMatchObject({ min: 40, max: 40 })
    expect(DK_REGULATIONS.isInSeason(reg('søørred'), day(2027, 2, 10), 'fresh')).toBe(false)
  })
})

/**
 * Minimum sizes per sea area, from lfst "Mindstemål for fisk og krebsdyr i
 * saltvand" (valid from 01.01.2026; columns: Nordsøen incl. Limfjorden and
 * Ringkøbing Fjord / Skagerrak-Kattegat / Bælterne og Østersøen) and the
 * freshwater list. A blank cell is no minimum in that area.
 */
describe('sizeRange — the 2026 minimum sizes by area', () => {
  const NS = rulePlaceAt(55.6545, 8.1313)      // Grærup Strand, North Sea
  const KAT = FORNAES                           // Kattegat
  const BALT = rulePlaceAt(55.593, 12.672)      // Dragør, Øresund (ICES 23)
  const size = (id: string, place: unknown, w = 'salt', date?: Date) => {
    const r = DK_REGULATIONS.sizeRange(reg(id), w, place, date)
    return r ? r.min === r.max ? r.min : [r.min, r.max] : null
  }

  it.each([
    ['morksej', 35, 30, null],
    ['sild', 20, 18, null],
    ['roedspætte', 27, 27, 25],
    ['slethvar', null, null, 30],
    ['pighvar', null, null, 30],
    ['makrel', 30, 20, null],
    ['hvilling', 27, 23, null],
    ['kuller', 30, 27, null],
    ['torsk', 35, 30, 35],
    ['skrubbe', null, null, 23],
    ['havørred', 40, 40, 40],
  ])('%s: North Sea %s, Kattegat %s, Baltic %s', (id, ns, kat, balt) => {
    expect(size(id as string, NS)).toBe(ns)
    expect(size(id as string, KAT)).toBe(kat)
    expect(size(id as string, BALT)).toBe(balt)
  })

  it('grayling: 33 cm from 16 May 2026, none before', () => {
    expect(size('stalling', undefined, 'fresh', day(2026, 6, 10))).toBe(33)
    expect(size('stalling', undefined, 'fresh', day(2026, 5, 1))).toBe(null)
  })

  it('bream has no national minimum', () => {
    expect(DK_REGULATIONS.sizeRange(reg('brasen'), 'fresh')).toBeNull()
    // Nor tench: the species tip claimed 25 cm, which neither lfst list has.
    expect(SPECIES_PREFS.suder.tip).not.toMatch(/Mindstemål/)
    expect(SPECIES_PREFS.suder.tipEn).not.toMatch(/Minimum size/)
  })

  /**
   * BEK nr 1673 af 10/12/2025 (in force 1 Jan 2026): perch 24–30 cm in certain
   * salt AND fresh waters by Sydsjælland, Møn, Lolland and Falster; the
   * 1 Mar – 30 Apr landing ban covers the freshwater ones (bilag 4) only.
   */
  it('perch: the South Zealand rules by water and place', () => {
    expect(DK_REGULATIONS.regionalClosuresOn(reg('aborre'), day(2026, 3, 20), 'fresh')).toHaveLength(1)
    expect(DK_REGULATIONS.regionalClosuresOn(reg('aborre'), day(2026, 3, 20), 'salt')).toHaveLength(0)
    expect(size('aborre', undefined, 'fresh')).toEqual([20, 24])
    expect(size('aborre', rulePlaceAt(56.3552, 9.5847), 'fresh')).toBe(20)   // Gudenå
  })

  it('pike may not be landed in the South Zealand waters of BEK 1673/2025', () => {
    const where = DK_REGULATIONS.regionalClosuresOn(reg('gedde'), day(2026, 7, 1), 'salt', rulePlaceAt(54.95, 11.9))
    expect(where.length).toBe(1)
    expect(DK_REGULATIONS.regionalClosuresOn(reg('gedde'), day(2026, 7, 1), 'fresh', rulePlaceAt(56.0, 12.09))).toEqual([])
  })
})
