import { describe, it, expect } from 'vitest'
import { seasonGroups } from './seasons'
import { DK_REGULATIONS } from './regulations'
import { SPECIES_PREFS } from './species'
import { catchWarnings } from './catchGuard'
import { t } from './i18n'

const day = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12)
const ids = (rows: { id: string }[]) => rows.map((r) => r.id)
const reg = (id: string) => DK_REGULATIONS.species.find((s: { id: string }) => s.id === id)

/**
 * The Seasons tab listed helt as "I sæson nu" with "Højsæson" on 6 Nov, inside
 * its closed season (1 Nov – 31 Jan, salt and fresh), and the fully protected
 * stenbider as in season, with a peak badge in March–May. lfst 2026 saltwater
 * list, the freshwater list and lfst's stenbider page ("fredet hele året i alle
 * farvande"), checked 2026-11-06.
 */
describe('seasonGroups — the Seasons tab', () => {
  it('lists helt as closed on 6 Nov, not in season', () => {
    const g = seasonGroups(day(2026, 11, 6))
    expect(ids(g.open)).not.toContain('helt')
    expect(ids(g.closed)).toContain('helt')
  })

  it('never lists stenbider as in season, and never gives it a peak', () => {
    for (const d of [day(2026, 11, 6), day(2027, 4, 10), day(2027, 8, 1)]) {
      const g = seasonGroups(d)
      expect(ids(g.open)).not.toContain('stenbider')
      expect(ids(g.closed)).toContain('stenbider')
    }
    expect(reg('stenbider').bestMonths ?? []).toEqual([])
  })

  it('helt reopens on 1 Feb, at 36 cm (34 cm in Ringkøbing Fjord)', () => {
    expect(ids(seasonGroups(day(2027, 2, 1)).closed)).not.toContain('helt')
    expect(DK_REGULATIONS.sizeRange(reg('helt'))).toMatchObject({ min: 34, max: 36 })
    expect(reg('helt').bestMonths).not.toContain(11)
    expect(reg('helt').bestMonths).not.toContain(12)
    expect(reg('helt').bestMonths).not.toContain(1)
  })

  it('a species closed in every water it lives in is listed as closed', () => {
    // Pike, 20 Apr: fresh 15 Mar – 30 Apr, salt 1 Apr – 15 May.
    expect(ids(seasonGroups(day(2026, 4, 20)).closed)).toContain('gedde')
  })

  it('a species closed in one water only is listed under restrictions', () => {
    // Sea trout, 20 Dec: streams closed; on the coast only coloured fish.
    const g = seasonGroups(day(2026, 12, 20))
    expect(ids(g.restricted)).toContain('havørred')
    expect(ids(g.closed)).not.toContain('havørred')
  })

  it('a protection in one named water all year does not take a species out of season', () => {
    // Ringkøbing, Nissum and Stadil fjords protect sea trout all year.
    expect(ids(seasonGroups(day(2026, 6, 15)).open)).toContain('havørred')
  })
})

/** The species card says TOTALFREDET; the regulations must agree. */
describe('banned species agree with the regulations', () => {
  it('every species banned outright in species.ts is closed in regulations.ts', () => {
    const bad: string[] = []
    // torsk: its flag stands for the Baltic ban, an area rule (see the cod tests).
    for (const sp of Object.values(SPECIES_PREFS).filter((p) => p.banned && p.id !== 'torsk')) {
      const r = reg(sp.id)
      if (!r || r.status !== 'closed') bad.push(sp.id)
    }
    expect(bad).toEqual([])
  })

  it('warns when a stenbider is logged as kept', () => {
    const ws = catchWarnings('stenbider', 35, '2026-04-10', false, 'salt')
    expect(ws).toContain(t('guard_protected'))
  })
})
