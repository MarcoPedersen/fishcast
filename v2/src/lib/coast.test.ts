import { describe, it, expect } from 'vitest'
import {
  COAST_ALGO_VERSION, DIR_NAME_KEY, angDist, coastCheck, coastIssues, coastLine, coordKey, isCoastAuto, isCoastOverride, pickedCoast, resolveShore,
  type CoastAuto,
} from './coast'
import { deriveFromFeatures, type CoastFeature } from './coastGeometry'
import { shoreRelation, shoreWeights } from './scoring'
import type { Location } from './types'

const LOC: Location = { id: 'a', name: 'A', lat: 55.6, lon: 12.6, waterType: 'salt' }
const auto = (over: Partial<CoastAuto> = {}): CoastAuto => ({
  v: COAST_ALGO_VERSION, at: 1, src: 'versatiles', water: 'sea', facing: 270, nearFacing: 268, spread: 180, exposure: 'open',
  fetchKm: Array.from({ length: 16 }, (_, k) => (k >= 9 && k <= 15 ? 25 : 0)), pinToWaterM: 3, issues: [], ...over,
})

describe('coast helpers', () => {
  it('angDist is the short way round, in [0, 180]', () => {
    expect(angDist(350, 10)).toBe(20)
    expect(angDist(10, 350)).toBe(20)
    expect(angDist(0, 180)).toBe(180)
    expect(angDist(90, 90)).toBe(0)
    expect(angDist(-30, 30)).toBe(60)
    expect(angDist(725, 5)).toBe(0)
  })

  it('coordKey rounds to 5 decimals (about a metre), so a pin keeps its entry', () => {
    expect(coordKey({ lat: 55.593100001, lon: 12.672 })).toBe('55.59310,12.67200')
  })

  it('has a long direction name key for each of the 16 compass points', () => {
    expect(DIR_NAME_KEY).toHaveLength(16)
    expect(DIR_NAME_KEY[0]).toBe('dir_n')
    expect(DIR_NAME_KEY[12]).toBe('dir_w')
  })

  it('isCoastOverride checks the values and tolerates extra keys from a newer version', () => {
    expect(isCoastOverride({ facing: 270, spread: 180, exposure: 'open' })).toBe(true)
    expect(isCoastOverride({ facing: 0, spread: 360, exposure: 'sheltered', note: 'newer field' })).toBe(true)
    for (const bad of [
      { facing: 400, spread: 180, exposure: 'open' }, { facing: -1, spread: 180, exposure: 'open' },
      { facing: 360, spread: 180, exposure: 'open' }, { facing: '90', spread: 180, exposure: 'open' },
      { facing: NaN, spread: 180, exposure: 'open' }, { facing: 90, spread: 200, exposure: 'open' },
      { facing: 90, spread: 180, exposure: 'x' }, [90, 180, 'open'], 'auto', 'none', null, undefined, 90,
    ]) expect(isCoastOverride(bad)).toBe(false)
  })

  it('tells a derived entry from a failure marker', () => {
    expect(isCoastAuto(auto())).toBe(true)
    expect(isCoastAuto({ v: 1, failedAt: 5, tries: 1 })).toBe(false)
    expect(isCoastAuto(undefined)).toBe(false)
  })
})

describe('resolveShore — what the scorer reads', () => {
  it('a manual override wins over the automatic value', () => {
    const l = { ...LOC, coast: { facing: 90, spread: 270 as const, exposure: 'semi' as const } }
    expect(resolveShore(l, auto())).toEqual({ mode: 'manual', facing: 90, spread: 270, exposure: 'semi', fetchKm: null })
  })

  it("'none' and fresh water have no coast to score", () => {
    expect(resolveShore({ ...LOC, coast: 'none' }, auto())).toBeNull()
    expect(resolveShore({ ...LOC, waterType: 'fresh' }, auto())).toBeNull()
    expect(resolveShore({ ...LOC, waterType: 'fresh', coast: { facing: 90, spread: 180, exposure: 'open' } })).toBeNull()
  })

  it('is undefined (not known yet) without an automatic value', () => {
    expect(resolveShore(LOC)).toBeUndefined()
  })

  it('reads the automatic profile', () => {
    const a = auto()
    expect(resolveShore(LOC, a)).toEqual({ mode: 'auto', facing: 270, spread: 180, exposure: 'open', fetchKm: a.fetchKm })
  })

  it('is null where the map shows no sea', () => {
    expect(resolveShore(LOC, auto({ water: 'inland', facing: null, exposure: null, fetchKm: [] }))).toBeNull()
    expect(resolveShore(LOC, auto({ water: 'none', facing: null, exposure: null, fetchKm: [] }))).toBeNull()
  })

  /**
   * Critique R1: from a pin in a closed basin (a slipway at the head of a harbour) every
   * profile bin is ≤ 0.4 km, so every wind scored 0 to +1 while the line
   * said "faces W". An entry the line and the profile disagree on is left
   * out of the score — the unknown-coast fallback pays — until the user picks.
   */
  it("leaves out an entry flagged 'enclosed' or 'gap' until the user picks", () => {
    expect(resolveShore(LOC, auto({ issues: ['enclosed'] }))).toBeUndefined()
    expect(resolveShore(LOC, auto({ issues: ['gap'] }))).toBeUndefined()
    expect(resolveShore(LOC, auto({ issues: ['gap'], ok: true }))).toBeUndefined()
    expect(resolveShore(LOC, auto({ issues: ['far'] }))).toMatchObject({ mode: 'auto' })
    expect(resolveShore({ ...LOC, coast: { facing: 270, spread: 180, exposure: 'semi' } }, auto({ issues: ['gap'] }))).toMatchObject({ mode: 'manual' })
  })

  /** coast-overrides.json: an official spot whose geometry was clearly wrong is hand-set, and scored by angle. */
  it('scores a hand-set catalogue entry (fixed) by its angle, not its profile', () => {
    expect(resolveShore(LOC, auto({ src: 'catalogue', fixed: true, facing: 100, spread: 270, exposure: 'semi', issues: [] })))
      .toEqual({ mode: 'manual', facing: 100, spread: 270, exposure: 'semi', fetchKm: null })
  })

  it('treats a value it does not know (a newer version) as automatic', () => {
    const l = { ...LOC, coast: 'auto' } as unknown as Location
    expect(resolveShore(l, auto())).toMatchObject({ mode: 'auto' })
    expect(resolveShore(l)).toBeUndefined()
  })
})

/**
 * Review: the gap prompt's "Mod {dir}" and the picker's first tap copied
 * spread and exposure from the automatic entry — the very entry the gap flag
 * had just distrusted. At a beach pin with a breakwater just off it (automatic spread 360) both answers
 * then scored every wind +8 "pålandsvind"; at a slipway in a closed basin "Mod V"
 * inherited the basin's 'sheltered', capping the fjord at +3.
 */
describe('pickedCoast — a direction picked on an automatic spot', () => {
  it('never writes water-all-round for a picked direction', () => {
    expect(pickedCoast(315, auto({ spread: 360, issues: ['gap'] })).spread).toBe(270)
    expect(pickedCoast(90, auto({ spread: 360 })).spread).toBe(270)
    expect(pickedCoast(90, auto({ spread: 270 })).spread).toBe(270)
    expect(pickedCoast(90, auto({ spread: 180 })).spread).toBe(180)
    expect(pickedCoast(90).spread).toBe(180)
  })

  it("doesn't inherit 'sheltered' from an entry flagged gap or enclosed", () => {
    expect(pickedCoast(270, auto({ exposure: 'sheltered', issues: ['gap'] })).exposure).toBe('semi')
    expect(pickedCoast(270, auto({ exposure: 'sheltered', issues: ['enclosed', 'gap'] })).exposure).toBe('semi')
    expect(pickedCoast(315, auto({ exposure: 'open', issues: ['gap'] })).exposure).toBe('open')
    expect(pickedCoast(270, auto({ exposure: 'sheltered' })).exposure).toBe('sheltered')
    expect(pickedCoast(270).exposure).toBe('open')
  })

  it('snaps to the 16 compass points', () => {
    expect(pickedCoast(313).facing).toBe(315)
    expect(pickedCoast(2).facing).toBe(0)
    expect(pickedCoast(354).facing).toBe(0)
  })

  it('after a gap answer on a spread-360 entry, the answer decides the score', () => {
    const a = auto({ spread: 360, exposure: 'open', issues: ['gap'], nearFacing: 313, facing: 2 })
    for (const deg of [313, 2]) {
      const s = resolveShore({ ...LOC, coast: pickedCoast(deg, a) }, a)!
      const back = (s.facing + 180) % 360
      expect(shoreRelation(s.facing, 6, s)).toBe('on')
      expect(shoreRelation(back, 6, s)).not.toBe('on') // the Conditions tab's word
      expect(shoreWeights(back, s).on).toBe(0)
    }
  })
})

describe('coastIssues — the check prompt', () => {
  it('adds the reasons that depend on the location', () => {
    expect(coastIssues(LOC, auto({ issues: ['far'] }))).toEqual(['far'])
    expect(coastIssues(LOC, auto({ water: 'inland', facing: null, exposure: null }))).toEqual(['inland'])
    expect(coastIssues(LOC, auto({ water: 'none', facing: null, exposure: null }))).toEqual(['nowater'])
    expect(coastIssues({ ...LOC, waterType: 'fresh' }, auto({ water: 'inland' }))).toEqual([])
  })

  it('is empty once confirmed on this device, or with no entry', () => {
    expect(coastIssues(LOC, auto({ issues: ['far'], ok: true }))).toEqual([])
    expect(coastIssues(LOC)).toEqual([])
  })

  it('stays for gap and enclosed even when confirmed: only a pick answers them', () => {
    expect(coastIssues(LOC, auto({ issues: ['far', 'gap'], ok: true }))).toEqual(['gap'])
    expect(coastIssues(LOC, auto({ issues: ['enclosed'], ok: true }))).toEqual(['enclosed'])
  })

  it('stays for inland when confirmed: "Ser rigtigt ud" never answered it', () => {
    expect(coastIssues(LOC, auto({ water: 'inland', facing: null, exposure: null, ok: true }))).toEqual(['inland'])
  })
})

/**
 * Review: the card took the first of gap, far or inland, whatever its line
 * said. Beside "Lukket havn eller bassin – vælg retningen selv", with no
 * direction shown, it asked "ca. 200 m fra vandet – passer retningen?" and
 * offered "Ser rigtigt ud": the tap hid the prompt for good and the spot
 * stayed unscored. The inland prompt's "Ser rigtigt ud" changed nothing too.
 */
describe('coastCheck — the one question the spot card asks', () => {
  it('asks whether the direction is right (far) only where the line shows one', () => {
    expect(coastCheck(LOC, auto({ issues: ['far'] }))).toMatchObject({ kind: 'far' })
    expect(coastCheck(LOC, auto({ issues: ['far', 'enclosed'] }))).toBeNull()
    expect(coastCheck(LOC, auto({ water: 'none', facing: null, exposure: null, fetchKm: [], issues: ['far'] }))).toBeNull()
    expect(coastCheck(LOC, auto({ water: 'inland', facing: null, exposure: null, fetchKm: [], issues: ['far'] }))).toMatchObject({ kind: 'inland' })
  })

  it('does so for a pin 200 m back from a small closed basin, from the geometry itself', () => {
    const LAT0 = 55.6, LON0 = 12.6
    const at = (dx: number, dy: number) => [LON0 + dx / (Math.cos((LAT0 * Math.PI) / 180) * 111320), LAT0 + dy / 110540]
    const basin: CoastFeature = { kind: 'sea', rings: [Float64Array.from([[200, -100], [500, -100], [500, 100], [200, 100], [200, -100]].flatMap(([x, y]) => at(x, y)))] }
    const a: CoastAuto = { ...deriveFromFeatures(LAT0, LON0, [basin], [basin]), at: 0, src: 'versatiles' }
    const loc = { ...LOC, lat: LAT0, lon: LON0 }
    expect(a.issues).toEqual(expect.arrayContaining(['far', 'enclosed']))
    expect(coastLine(loc, a)).toEqual({ kind: 'enclosed' })
    expect(coastCheck(loc, a)).toBeNull()
  })

  it('asks the gap question before any other', () => {
    expect(coastCheck(LOC, auto({ issues: ['far', 'gap'] }))).toMatchObject({ kind: 'gap' })
  })

  it('asks about inland water until it is answered, and nothing once the user has chosen', () => {
    const inland = auto({ water: 'inland', facing: null, exposure: null, fetchKm: [] })
    expect(coastCheck(LOC, inland)).toMatchObject({ kind: 'inland' })
    expect(coastCheck(LOC, { ...inland, ok: true })).toMatchObject({ kind: 'inland' })
    expect(coastCheck({ ...LOC, waterType: 'fresh' }, inland)).toBeNull() // "Det er ferskvand"
    expect(coastCheck({ ...LOC, coast: { facing: 90, spread: 180, exposure: 'semi' } }, inland)).toBeNull() // a pick
    expect(coastCheck({ ...LOC, coast: 'none' }, inland)).toBeNull()
    expect(coastCheck(LOC, auto({ issues: ['far'], ok: true }))).toBeNull() // "Ser rigtigt ud"
    expect(coastCheck(LOC)).toBeNull()
  })
})

describe('coastLine — the spot card state', () => {
  it('describes manual, none, automatic and the waiting states', () => {
    expect(coastLine({ ...LOC, coast: { facing: 90, spread: 180, exposure: 'semi' } })).toMatchObject({ kind: 'coast', src: 'manual', dir: 90, spread: 180, exposure: 'semi' })
    expect(coastLine({ ...LOC, coast: 'none' })).toMatchObject({ kind: 'off', src: 'manual' })
    expect(coastLine(LOC, auto())).toMatchObject({ kind: 'coast', src: 'auto', dir: 270, spread: 180, exposure: 'open' })
    expect(coastLine(LOC, undefined, 'pending')).toMatchObject({ kind: 'pending' })
    expect(coastLine(LOC, undefined, 'failed')).toMatchObject({ kind: 'failed' })
    expect(coastLine(LOC)).toMatchObject({ kind: 'unknown' })
    expect(coastLine(LOC, auto({ water: 'none', facing: null, exposure: null }))).toMatchObject({ kind: 'nowater' })
    expect(coastLine(LOC, auto({ water: 'inland', facing: null, exposure: null }))).toMatchObject({ kind: 'inland' })
    expect(coastLine({ ...LOC, waterType: 'fresh' })).toBeNull()
  })

  /** Critique R8.3: a 0-lobe basin also came out spread 270 and read "Mole eller pynt". */
  it("gives an enclosed basin its own line, not 'pier or point'", () => {
    expect(coastLine(LOC, auto({ spread: 270, issues: ['enclosed', 'gap'] }))).toMatchObject({ kind: 'enclosed' })
  })

  /**
   * Review: at every spot flagged 'gap' the
   * card read e.g. "Kysten vender mod V · … · auto" while resolveShore left
   * the entry out and the score paid the unknown-coast fallback.
   */
  it("doesn't show a gap entry as a known coast: it isn't scored until the user picks", () => {
    expect(coastLine(LOC, auto({ issues: ['gap'] }))).toEqual({ kind: 'gap' })
    expect(coastLine(LOC, auto({ issues: ['far', 'gap'], ok: true }))).toEqual({ kind: 'gap' })
    expect(coastLine({ ...LOC, coast: { facing: 90, spread: 180, exposure: 'semi' } }, auto({ issues: ['gap'] }))).toMatchObject({ kind: 'coast', src: 'manual' })
  })

  it('claims an automatic coast exactly when the scorer reads one', () => {
    for (const a of [auto(), auto({ issues: ['far'] }), auto({ issues: ['gap'] }), auto({ issues: ['enclosed', 'gap'] }),
      auto({ water: 'inland', facing: null, exposure: null, fetchKm: [] }), auto({ src: 'catalogue', fixed: true, issues: [] })]) {
      const line = coastLine(LOC, a)
      expect([a.issues.join(), line?.kind === 'coast' && line.src === 'auto']).toEqual([a.issues.join(), resolveShore(LOC, a) != null])
    }
  })

  it('keeps showing the old value while a newer algorithm re-derives it', () => {
    expect(coastLine(LOC, auto({ v: 0 }), 'pending')).toMatchObject({ kind: 'coast', src: 'auto' })
  })
})
