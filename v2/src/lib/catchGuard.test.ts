import { describe, it, expect } from 'vitest'
import { catchWarnings } from './catchGuard'
import { t } from './i18n'

const UNDERSIZE = t('guard_undersize').split('{')[0]      // "Under mindstemål: "
const CLOSED = t('guard_closed')
const has = (ws: string[], prefix: string) => ws.some((w) => w.startsWith(prefix))

describe('catchWarnings — minimum size', () => {
  /**
   * The guard used sizes[0], the North Sea figure, everywhere: a 25 cm
   * mackerel from Hundested (Kattegat, 20 cm minimum) read "25 cm < 30 cm".
   */
  it('does not flag a mackerel that is legal in some waters as undersized', () => {
    const ws = catchWarnings('makrel', 25, '2026-08-01', false)
    expect(has(ws, UNDERSIZE)).toBe(false)
    // …but says the minimum depends on the waters, since 25 cm IS short in the North Sea.
    expect(ws.join(' ')).toContain('20–30')
  })

  it('flags a mackerel below the minimum everywhere, against the lenient minimum', () => {
    const ws = catchWarnings('makrel', 15, '2026-08-01', false)
    expect(ws).toContain(t('guard_undersize').replace('{len}', '15').replace('{min}', '20'))
  })

  it('resolves salmon size by the location water type', () => {
    expect(has(catchWarnings('laks', 45, '2026-07-01', false, 'fresh'), UNDERSIZE)).toBe(false)
    expect(catchWarnings('laks', 45, '2026-07-01', false, 'fresh').join(' ')).not.toContain('40–60')
    expect(catchWarnings('laks', 45, '2026-07-01', false, 'salt'))
      .toContain(t('guard_undersize').replace('{len}', '45').replace('{min}', '60'))
    // Water type unknown → hedged, not flat-out undersized.
    const unknown = catchWarnings('laks', 45, '2026-07-01', false)
    expect(has(unknown, UNDERSIZE)).toBe(false)
    expect(unknown.join(' ')).toContain('40–60')
  })

  it('hedges cod between the Kattegat and North Sea minimums', () => {
    const ws = catchWarnings('torsk', 32, '2026-10-01', false)
    expect(has(ws, UNDERSIZE)).toBe(false)
    expect(ws.join(' ')).toContain('30–35')
  })

  it('keeps an outright warning where only one minimum exists', () => {
    expect(catchWarnings('havørred', 35, '2026-07-01', false))
      .toContain(t('guard_undersize').replace('{len}', '35').replace('{min}', '40'))
  })

  it('says nothing about size for a released fish', () => {
    expect(catchWarnings('makrel', 15, '2026-08-01', true)).toEqual([])
  })
})

describe('catchWarnings — closed seasons', () => {
  it('a salmon in October is not "possibly closed" by the Wadden Sea closure', () => {
    const ws = catchWarnings('laks', 70, '2026-10-01', true)
    expect(ws).not.toContain(CLOSED)
    // The regional rule is named, so a Wadden Sea angler still sees it…
    expect(ws.join(' ')).toContain('Vadehavet')
    // …and a river location rules it out entirely.
    expect(catchWarnings('laks', 70, '2026-10-01', true, 'fresh')).toEqual([])
  })

  it('a perch in March is not flagged nationwide', () => {
    expect(catchWarnings('aborre', 25, '2026-03-20', true)).not.toContain(CLOSED)
  })

  /** Randers Fjord is brackish; the saltwater pike closure runs to 15 May. */
  it('a pike from brackish water on 10 May is flagged', () => {
    expect(catchWarnings('gedde', 70, '2026-05-10', true, 'brackish')).toContain(CLOSED)
    expect(catchWarnings('gedde', 70, '2026-05-10', true, 'fresh')).not.toContain(CLOSED)
  })
})
