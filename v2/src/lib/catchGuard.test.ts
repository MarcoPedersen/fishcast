import { describe, it, expect } from 'vitest'
import { catchWarnings } from './catchGuard'
import { t } from './i18n'

const UNDERSIZE = t('guard_undersize').split('{')[0]      // "Under mindstemål: "
const CLOSED = t('guard_closed')
const has = (ws: string[], prefix: string) => ws.some((w) => w.startsWith(prefix))
/** A coast and a river in none of the named waters (Bornholm, the Wadden Sea, the fjords). */
const FORNAES = { lat: 56.444, lon: 10.959 }
const GUDENAA = { lat: 56.3552, lon: 9.5847 }

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

  it('flags a mackerel below the minimum where one applies, against the lenient minimum', () => {
    // Kattegat 20 cm; and on a North Sea / Kattegat boundary the lenient one.
    expect(catchWarnings('makrel', 15, '2026-08-01', false, 'salt', FORNAES))
      .toContain(t('guard_undersize').replace('{len}', '15').replace('{min}', '20'))
    // The Belts and the Baltic have no mackerel minimum (lfst 2026), so with
    // the waters unknown it is a hedge, not "undersized".
    const ws = catchWarnings('makrel', 15, '2026-08-01', false)
    expect(has(ws, UNDERSIZE)).toBe(false)
    expect(ws.join(' ')).toContain('20–30')
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

  /**
   * The 24 cm perch minimum holds in certain salt AND fresh waters by South
   * Zealand/Møn/Lolland/Falster (BEK nr 1673 af 10/12/2025 §6, bilag 3 and 4).
   * It was tagged salt-only, then left lake perch out entirely; a lake
   * elsewhere rules it out by its position.
   */
  it('hedges perch against the South Zealand 24 cm minimum only where it may apply', () => {
    expect(catchWarnings('aborre', 22, '2026-07-01', false, 'fresh', GUDENAA)).toEqual([])
    expect(catchWarnings('aborre', 22, '2026-07-01', false, 'fresh').join(' ')).toContain('20–24')
    // Unknown or brackish water can't rule those waters out, so the hedge stays.
    expect(catchWarnings('aborre', 22, '2026-07-01', false).join(' ')).toContain('20–24')
    expect(catchWarnings('aborre', 22, '2026-07-01', false, 'brackish').join(' ')).toContain('20–24')
    expect(catchWarnings('aborre', 22, '2026-07-01', false, 'salt').join(' ')).toContain('20–24')
  })

  /**
   * Bilag 3 of BEK 1673 runs north to the Sjællandsbro over Kalvebodløbet and
   * west to the line Albuen – Halskov Odde; bilag 4 lists the Copenhagen and
   * Køge streams (Harrestrup Å, St./Ll. Vejle Å, Køge Å, Tryggevælde Å…). The
   * perch box stopped at lat 55.3 / lon 11.3, so these got no hedge at all.
   */
  it('hedges perch in Køge Bugt, by Ishøj, in Korsør Nor and Nakskov Fjord, and in the Køge streams', () => {
    for (const at of [{ lat: 55.615, lon: 12.352 }, { lat: 55.485, lon: 12.28 }, { lat: 55.335, lon: 11.16 }, { lat: 54.835, lon: 11.08 }]) {
      expect(catchWarnings('aborre', 22, '2026-07-01', false, 'brackish', at).join(' '), JSON.stringify(at)).toContain('20–24')
    }
    expect(catchWarnings('aborre', 22, '2026-07-01', false, 'brackish', { lat: 55.593, lon: 12.672 })).toEqual([])  // Dragør
    // Køge Å and Harrestrup Å in March: the landing ban of §5 is named.
    for (const at of [{ lat: 55.455, lon: 12.15 }, { lat: 55.67, lon: 12.45 }]) {
      expect(catchWarnings('aborre', 25, '2026-03-20', false, 'fresh', at).join(' '), JSON.stringify(at)).toMatch(/Køge Bugt/)
    }
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
    // …and a river location rules it out: by water type alone the Wadden Sea
    // goes (Von Å, a stream, stays possible), and by position everything does.
    expect(catchWarnings('laks', 70, '2026-10-01', true, 'fresh').join(' ')).not.toContain('Vadehavet')
    expect(catchWarnings('laks', 70, '2026-10-01', true, 'fresh', GUDENAA)).toEqual([])
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

/**
 * Sea trout against lfst 2026: on the coast 16 Nov – 15 Jan only fish in
 * spawning colours are protected (bright fish may be kept); in fresh water the
 * whole period 16 Nov – end of February is closed.
 */
describe('catchWarnings — sea trout seasons', () => {
  const COLOURED = t('guard_coloured').split('{')[0]

  it('a bright winter sea trout from the coast is not "possibly closed", but the colour rule is named', () => {
    const ws = catchWarnings('havørred', 55, '2026-12-20', false, 'salt', FORNAES)
    expect(ws).not.toContain(CLOSED)
    expect(ws).toHaveLength(1)
    expect(has(ws, COLOURED)).toBe(true)
  })

  it('says nothing about colour for a released fish, or on 15 Nov', () => {
    expect(catchWarnings('havørred', 55, '2026-12-20', true, 'salt', FORNAES)).toEqual([])
    expect(catchWarnings('havørred', 55, '2026-11-15', false, 'salt', FORNAES)).toEqual([])
  })

  it('flags a sea trout kept from fresh water in January and February', () => {
    expect(catchWarnings('havørred', 55, '2027-01-20', false, 'fresh')).toContain(CLOSED)
    expect(catchWarnings('havørred', 55, '2027-02-10', false, 'fresh')).toContain(CLOSED)
  })

  it('names Bornholm for a sea trout kept there in October', () => {
    const ws = catchWarnings('havørred', 55, '2026-10-05', false, 'brackish', { lat: 55.101, lon: 14.707 })
    expect(ws.join(' ')).toMatch(/Bornholm/)
    expect(catchWarnings('havørred', 55, '2026-10-05', false, 'brackish', { lat: 55.593, lon: 12.672 })).toEqual([])
  })
})

/** The sizes per sea area in lfst's 2026 lists (see regulations.test.ts). */
describe('catchWarnings — sizes by sea area', () => {
  const GRAERUP = { lat: 55.6545, lon: 8.1313 }   // North Sea
  const DRAGOR = { lat: 55.593, lon: 12.672 }     // Øresund
  const under = (len: number, min: number) => t('guard_undersize').replace('{len}', String(len)).replace('{min}', String(min))

  it('flags an undersized herring, coalfish and brill where a minimum applies', () => {
    expect(catchWarnings('sild', 15, '2026-08-01', false, 'brackish', FORNAES)).toContain(under(15, 18))
    expect(catchWarnings('morksej', 32, '2026-08-01', false, 'salt', GRAERUP)).toContain(under(32, 35))
    expect(catchWarnings('slethvar', 27, '2026-08-01', false, 'brackish', DRAGOR)).toContain(under(27, 30))
  })

  it('does not scold a 26 cm Baltic plaice (25 cm in the Belts and the Baltic)', () => {
    expect(catchWarnings('roedspætte', 26, '2026-08-01', false, 'brackish', DRAGOR)).toEqual([])
    expect(catchWarnings('roedspætte', 26, '2026-08-01', false, 'brackish', FORNAES)).toContain(under(26, 27))
  })

  it('flags a 30 cm grayling after 16 May 2026', () => {
    expect(catchWarnings('stalling', 30, '2026-06-10', false, 'fresh')).toContain(under(30, 33))
    expect(catchWarnings('stalling', 30, '2026-05-01', false, 'fresh').join(' ')).not.toContain('mindstemål')
  })

  it('has no minimum for bream', () => {
    expect(catchWarnings('brasen', 22, '2026-07-01', false, 'fresh')).toEqual([])
  })

  it('hedges where the waters are unknown and one of them has no minimum', () => {
    const ws = catchWarnings('sild', 15, '2026-08-01', false)
    expect(has(ws, UNDERSIZE)).toBe(false)
    expect(ws.join(' ')).toContain('18–20')
  })
})

/** The Baltic cod ban (see regulations.test.ts): the catch log never flagged a kept Baltic cod. */
describe('catchWarnings — the Baltic cod ban', () => {
  const DRAGOR = { lat: 55.593, lon: 12.672 }
  it('flags a cod kept in the Baltic, not one from the Kattegat', () => {
    expect(catchWarnings('torsk', 45, '2026-03-10', false, 'brackish', DRAGOR)).toContain(CLOSED)
    expect(catchWarnings('torsk', 45, '2027-03-10', false, 'brackish', DRAGOR)).toContain(CLOSED)
    expect(catchWarnings('torsk', 45, '2026-03-10', false, 'brackish', FORNAES)).toEqual([])
  })

  it('names the Baltic when the location is unknown', () => {
    expect(catchWarnings('torsk', 45, '2026-03-10', false, 'brackish').join(' ')).toMatch(/Østersøen/)
  })
})

/** Sea bass may not be kept in February–March in the North Sea (lfst 2026). */
describe('catchWarnings — sea bass', () => {
  const GRAERUP = { lat: 55.6545, lon: 8.1313 }
  it('names the catch-and-release months for a kept bass, not a released one', () => {
    expect(catchWarnings('havbars', 50, '2026-02-15', false, 'salt', GRAERUP).join(' ')).toMatch(/catch-and-release/)
    expect(catchWarnings('havbars', 50, '2026-02-15', true, 'salt', GRAERUP)).toEqual([])
    expect(catchWarnings('havbars', 50, '2026-01-15', false, 'salt', GRAERUP)).toEqual([])
  })
})

/**
 * A protection that holds all year in one named water (sea trout in the
 * Ringkøbing, Nissum and Stadil fjords) is named when the catch's location
 * may lie there; with no location it would sit on every sea trout logged by
 * free text, all year. The ⚠️ rules and the Seasons tab list it.
 */
describe('catchWarnings — standing local rules', () => {
  it('names the fjord protection where the location may lie in it, not without a location', () => {
    expect(catchWarnings('havørred', 55, '2026-07-20', false)).toEqual([])
    expect(catchWarnings('havørred', 55, '2026-07-20', false, 'brackish', { lat: 56.0, lon: 8.25 }).join(' ')).toMatch(/Ringkøbing Fjord: totalfredet/)
  })
})
