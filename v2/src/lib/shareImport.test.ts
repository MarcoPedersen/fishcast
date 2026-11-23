import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { parseQuery } from 'vue-router'
import { parseSharedSetup, parseSharedWindow, shareSetupUrl, shareWindowUrl } from './share'
import { CATALOGUE_MATCH_KM, importEffect, keepOwnCopies, keepOwnWindows, locationFromShared, locationsFromSharedSetup, takeInSetup } from './shareImport'
import { DK_SPOTS, locationFromSpot } from './spots'
import { fitWaterType, hiddenSpeciesIds } from './locationSpecies'
import type { Availability, Location, ScoredWindow } from './types'

beforeAll(() => { vi.stubGlobal('location', { origin: 'https://example.test', pathname: '/fishcast/v2/' }) })
afterAll(() => { vi.unstubAllGlobals() })

const opened = (url: string) => parseQuery(url.split('#/?')[1]) as Record<string, string>
const std64 = (obj: unknown) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))))
const AV: Availability = { id: 'a', days: [3], from: '05:00', to: '09:00', methods: ['shore'] }
/** What the scorer reads of a location: everything but its id and the user's own ★ and note. */
const scored = ({ id, fav, note, ...rest }: Location) => rest

/**
 * Regression — WelcomeView imported a shared spot as name, place, water,
 * bottom and coast. Depth, the official slug and the species were lost, so
 * the recipient scored the same spot lower than the sharer (makrel's 'deep'
 * bonus, 8 points; torsk's, 6). An import is now the sharer's spot.
 */
describe('a shared spot, imported', () => {
  const official = DK_SPOTS.map((s): Location => ({ id: 's-' + s.slug, ...locationFromSpot(s) }))

  it('is the sharer’s spot, for every official spot, on a setup link', () => {
    const p = parseSharedSetup(opened(shareSetupUrl(official, ['makrel'], [AV])).setup)!
    expect(p.locs).toHaveLength(Math.min(official.length, 50))
    const imported = p.locs.map((l, i) => ({ id: official[i].id, ...locationFromShared(l, p.legacy) }))
    expect(imported.map(scored)).toEqual(official.slice(0, 50).map(scored))
  })

  it('is the sharer’s spot on a window link', () => {
    for (const spot of official.filter((l) => l.depth === 'deep')) {
      const w: ScoredWindow = { location: spot, date: new Date(Date.UTC(2026, 6, 15)), from: '05:00', to: '09:00', score: 75, noData: false, bestHourStr: null, tags: [] }
      const p = parseSharedWindow(opened(shareWindowUrl(w)).win)!
      expect(scored({ id: spot.id, ...locationFromShared(p, p.legacy) })).toEqual(scored(spot))
    }
  })

  it('keeps a custom spot custom: no depth or slug it never had', () => {
    const fornaes = DK_SPOTS.find((s) => s.slug === 'fornaes-fyr')!
    const pin: Location = { id: 'x', name: 'Pin by the lighthouse', lat: fornaes.lat + 0.0001, lon: fornaes.lon, waterType: 'salt', species: [{ nameEn: 'Cod', months: [1] }] }
    const p = parseSharedSetup(opened(shareSetupUrl([pin], [], [AV])).setup)!
    const l = locationFromShared(p.locs[0], p.legacy)
    expect(l.depth).toBeUndefined()
    expect(l.spotSlug).toBeUndefined()
  })
})

/**
 * Links already in chats carry none of it. A spot within the coast store's
 * catalogue radius of an official one is taken as saved from it — as
 * locationFromSpot would have saved it — so the recipient earns its depth.
 */
describe('a spot from a link made before depth travelled', () => {
  const fornaes = DK_SPOTS.find((s) => s.slug === 'fornaes-fyr')!

  it('takes the depth and slug of the official spot it sits on', () => {
    const p = parseSharedSetup(std64({ locs: [{ n: 'Fornæs Fyr', la: fornaes.lat, lo: fornaes.lon, wt: 'salt', bt: 'stone' }], sp: [], av: [] }))!
    expect(locationFromShared(p.locs[0], p.legacy)).toMatchObject({ depth: 'deep', spotSlug: 'fornaes-fyr' })
    const w = parseSharedWindow(std64({ n: 'Fornæs Fyr', la: fornaes.lat, lo: fornaes.lon, d: '2026-07-15', f: '05:00', t: '09:00', s: 75 }))!
    expect(locationFromShared(w, w.legacy)).toMatchObject({ depth: 'deep', spotSlug: 'fornaes-fyr' })
  })

  /**
   * Its species too. Left to enrichMissingSpecies, they came from the spots
   * nearby (speciesFromNearby), and the same official spot scored up to 15
   * points apart for 41 spot × species pairs (rødspætte at Fornæs Fyr 54
   * against the sharer's 69).
   */
  it('is the sharer’s spot, for every official spot, on a v1 setup link and an older window link', () => {
    for (const s of DK_SPOTS) {
      const sharer = scored({ id: 'x', ...locationFromSpot(s) })
      const p = parseSharedSetup(std64({ v: 1, locs: [{ n: s.name, la: s.lat, lo: s.lon, wt: s.waterType, bt: s.bottomType }], sp: [], av: [] }))!
      expect(scored({ id: 'x', ...locationFromShared(p.locs[0], p.legacy) })).toEqual(sharer)
      const w = parseSharedWindow(std64({ n: s.name, la: s.lat, lo: s.lon, wt: s.waterType, bt: s.bottomType, d: '2026-07-15', f: '05:00', t: '09:00', s: 75 }))!
      expect(scored({ id: 'x', ...locationFromShared(w, w.legacy) })).toEqual(sharer)
    }
  })

  it('takes its own copy of the official spot’s species', () => {
    const p = parseSharedSetup(std64({ locs: [{ n: 'Fornæs Fyr', la: fornaes.lat, lo: fornaes.lon }], sp: [], av: [] }))!
    const l = locationFromShared(p.locs[0], p.legacy)
    l.species![0].months.push(13)
    expect(fornaes.species[0].months).not.toContain(13)
  })

  /**
   * Integration: the twin's species came in whatever water the link gives the
   * spot. A brackish official spot shared as Saltvand brought its pike and
   * zander, which the picker hides at salt while they still count: the state
   * fitWaterType keeps every other way in out of.
   */
  it('takes only the official spot’s species that fit the water the link gives it', () => {
    const s = DK_SPOTS.find((x) => x.waterType === 'brackish' && x.species.some((sp) => sp.nameEn === 'Pike'))!
    const p = parseSharedSetup(std64({ v: 1, locs: [{ n: s.name, la: s.lat, lo: s.lon, wt: 'salt', bt: s.bottomType }], sp: [], av: [] }))!
    const l = locationFromShared(p.locs[0], p.legacy)
    expect(hiddenSpeciesIds(l.species, 'salt')).toEqual([])
    expect(l.species).toEqual(fitWaterType(locationFromSpot(s).species, 'salt'))
    expect(l.species!.length).toBeGreaterThan(0)
  })

  /**
   * When none of the twin's fit, the link still says nothing of the
   * sharer's species: the spot is saved as never filled. The refill gives a
   * copy the spot's own that fit, none here, so it stays so. An empty list
   * is one the user cleared, which the refill leaves alone
   * (stores/setup.ts enrichMissingSpecies).
   */
  it('takes none of the official spot’s species when none fit, and leaves the list never filled', () => {
    const none = DK_SPOTS.flatMap((spot) => (['salt', 'brackish', 'fresh'] as const)
      .filter((w) => !fitWaterType(spot.species, w).length).map((w) => ({ spot, w })))
    expect(none.length).toBeGreaterThan(0)
    for (const { spot, w } of none) {
      const p = parseSharedSetup(std64({ v: 1, locs: [{ n: spot.name, la: spot.lat, lo: spot.lon, wt: w }], sp: [], av: [] }))!
      const l = locationFromShared(p.locs[0], p.legacy)
      expect(l.spotSlug).toBe(spot.slug)
      expect(l.species, `${spot.slug} at ${w}`).toBeUndefined()
    }
  })

  /**
   * A link made before Helsingør Kysten moved to Kronborg Pynten carries the
   * old pin, in Helsingør town: it is still that spot, as the sharer's copy
   * is, and is saved where the spot is now.
   */
  it('takes the official spot a link made before the spot moved names by its old pin', () => {
    const hk = DK_SPOTS.find((s) => s.slug === 'helsingore-kysten')!
    const p = parseSharedSetup(std64({ locs: [{ n: hk.name, la: 56.0350, lo: 12.5890 }], sp: [], av: [] }))!
    const l = locationFromShared(p.locs[0], p.legacy)
    expect(l).toMatchObject({ lat: hk.lat, lon: hk.lon, spotSlug: 'helsingore-kysten', depth: hk.depth })
    expect(l.species).toEqual(locationFromSpot(hk).species)
  })

  /** A link made before Gurre Sø moved onto its lake carries the old pin, 7 km off in the fields. */
  it('takes Gurre Sø for a link made before it moved', () => {
    const gs = DK_SPOTS.find((s) => s.slug === 'gurre-so')!
    const p = parseSharedSetup(std64({ locs: [{ n: gs.name, la: 56.0670, lo: 12.4010, wt: 'fresh' }], sp: [], av: [] }))!
    const l = locationFromShared(p.locs[0], p.legacy)
    expect(l).toMatchObject({ lat: gs.lat, lon: gs.lon, spotSlug: 'gurre-so', depth: gs.depth })
    expect(l.species).toEqual(locationFromSpot(gs).species)
  })

  it('takes nothing from an official spot further away than the catalogue radius', () => {
    const away = CATALOGUE_MATCH_KM * 2 / 111 // degrees of latitude
    const p = parseSharedSetup(std64({ locs: [{ n: 'Up the coast', la: fornaes.lat + away, lo: fornaes.lon }], sp: [], av: [] }))!
    const l = locationFromShared(p.locs[0], p.legacy)
    expect(l.depth).toBeUndefined()
    expect(l.spotSlug).toBeUndefined()
    expect(l.species).toBeUndefined() // enrichMissingSpecies fills these in, as before
  })

  /** The sharer's cleared list arrives as one: the recipient's lookup leaves it alone (enrichMissingSpecies). */
  it('keeps a species list the sharer emptied empty', () => {
    const cleared: Location = { id: 'c', name: 'Ryddet', lat: 55.97, lon: 12.1, waterType: 'fresh', species: [] }
    const p = parseSharedSetup(opened(shareSetupUrl([cleared], [], [AV])).setup)!
    expect(locationFromShared(p.locs[0], p.legacy).species).toEqual([])
  })
})

/**
 * A spot at an official spot's former pin is that spot, but at the old place:
 * Gurre Sø's old pin lies 7 km off in the fields, so a copy there had its
 * weather fetched for farmland. The recipient saves the spot now, so it is
 * saved where the spot is now, as the spot finder would save it, and not where
 * the sharer's copy still sits (their own card offers to move it). Imported
 * at the old pin, the recipient's new copy started out wrong.
 */
describe('a shared spot at an official spot\'s former pin', () => {
  const hk = DK_SPOTS.find((s) => s.slug === 'helsingore-kysten')!
  const OLD = hk.formerPins![0]
  /** The sharer's copy, saved before the move and edited since. */
  const sharer: Location = {
    ...locationFromSpot(hk), id: 'x', lat: OLD.lat, lon: OLD.lon, name: 'Kronborg', bottomType: 'sand',
    species: [{ nameEn: 'Sea Trout', months: [3, 4, 5] }],
  }

  it('is saved at the spot\'s pin now, with all else the sharer gave it, from a link made today', () => {
    const p = parseSharedSetup(opened(shareSetupUrl([sharer], [], [AV])).setup)!
    expect(p.legacy).toBe(false)
    expect(scored({ id: 'x', ...locationFromShared(p.locs[0], p.legacy) })).toEqual({ ...scored(sharer), lat: hk.lat, lon: hk.lon })
    const w: ScoredWindow = { location: sharer, date: new Date(Date.UTC(2026, 6, 15)), from: '05:00', to: '09:00', score: 75, noData: false, bestHourStr: null, tags: [] }
    const pw = parseSharedWindow(opened(shareWindowUrl(w)).win)!
    expect(scored({ id: 'x', ...locationFromShared(pw, pw.legacy) })).toEqual({ ...scored(sharer), lat: hk.lat, lon: hk.lon })
  })

  /**
   * The coast the sharer picked read the shore at the old place, by a pond
   * in Helsingør town, 2.3 km from Kronborg Pynten: the spot's own coast,
   * derived at its pin now, applies instead (stores/coast.ts).
   */
  it('leaves out the coast the sharer picked at the old place', () => {
    for (const co of [{ facing: 90, spread: 180, exposure: 'open' } as const, 'none' as const]) {
      const p = parseSharedSetup(opened(shareSetupUrl([{ ...sharer, coast: co }], [], [AV])).setup)!
      expect(p.locs[0].co).toEqual(co)
      expect(locationFromShared(p.locs[0], p.legacy)).not.toHaveProperty('coast')
    }
  })

  it('stays where the link puts it outside the catalogue radius of the old pin', () => {
    const away = { ...sharer, lat: OLD.lat + 60 / 110540, coast: 'none' as const }
    const p = parseSharedSetup(opened(shareSetupUrl([away], [], [AV])).setup)!
    expect(locationFromShared(p.locs[0], p.legacy)).toMatchObject({ lat: away.lat, lon: away.lon, coast: 'none' })
  })

  /**
   * A sharer who added the spot again at its pin now holds two copies, and
   * the old one's card says the spot is saved at its pin too. Both imported
   * at that pin, the recipient got two copies at the very same place, and no
   * card said so. The old one stays where it is, as the sharer's does.
   */
  it('stays at the old pin in a setup that holds the spot at its pin now too', () => {
    const now: Location = { ...locationFromSpot(hk), id: 'y' }
    const old = { ...sharer, coast: 'none' as const }
    const p = parseSharedSetup(opened(shareSetupUrl([old, now], [], [AV])).setup)!
    expect(locationsFromSharedSetup(p)).toEqual([
      locationFromShared(p.locs[0], p.legacy, DK_SPOTS, true), locationFromShared(p.locs[1], p.legacy),
    ])
    expect(locationsFromSharedSetup(p)[0]).toMatchObject({ lat: OLD.lat, lon: OLD.lon, name: 'Kronborg', coast: 'none' })
    const q = parseSharedSetup(opened(shareSetupUrl([now, old], [], [AV])).setup)!
    expect(locationsFromSharedSetup(q).map((l) => [l.lat, l.lon])).toEqual([[hk.lat, hk.lon], [OLD.lat, OLD.lon]])
  })

  it('moves one of two copies at the old pin, and any other spot\'s copy too', () => {
    const gs = DK_SPOTS.find((s) => s.slug === 'gurre-so')!
    const gsOld: Location = { ...locationFromSpot(gs), id: 'g', ...gs.formerPins![0] }
    const p = parseSharedSetup(opened(shareSetupUrl([sharer, { ...sharer, id: 'z' }, gsOld], [], [AV])).setup)!
    expect(locationsFromSharedSetup(p).map((l) => [l.lat, l.lon])).toEqual([[hk.lat, hk.lon], [OLD.lat, OLD.lon], [gs.lat, gs.lon]])
  })

  it('moves a spot at the old pin in a setup of other spots', () => {
    const p = parseSharedSetup(opened(shareSetupUrl([{ ...locationFromSpot(DK_SPOTS[0]), id: 'a' }, sharer], [], [AV])).setup)!
    expect(locationsFromSharedSetup(p)).toEqual(p.locs.map((l) => locationFromShared(l, p.legacy)))
    expect(locationsFromSharedSetup(p)[1]).toMatchObject({ lat: hk.lat, lon: hk.lon })
  })
})

/** Both imports on the welcome page go through it — they used to build a location by hand each. */
describe('the welcome page', () => {
  const src = Object.values(import.meta.glob<string>('/src/views/WelcomeView.vue', { query: '?raw', import: 'default', eager: true }))[0] ?? ''

  it('imports a shared setup and a shared window with locationFromShared', () => {
    expect(src).toContain('const after = takeInSetup(s, setup, uid)')
    expect(src).toContain('const loc = locationFromShared(w, w.legacy)')
    expect(src).toContain('setup.locations.push({ id: uid(), ...loc })')
  })
})

/**
 * Round P: a shared setup taken in over spots the user has already put the
 * link's copies in their place. Their ★, note and name were gone, and with
 * the id the link from every catch logged there (CatchEntry.locationId). A
 * spot both hold stays the user's, taking from the link only what theirs
 * lacks. Matched as the import knows a spot: the same place, or a copy of
 * the same official spot at any of its pins.
 */
describe('a shared setup taken in over spots the user has already', () => {
  const hk = DK_SPOTS.find((s) => s.slug === 'helsingore-kysten')!
  const OLD = hk.formerPins![0]
  const ids = () => { let n = 0; return () => 'new' + ++n }
  const takeIn = (shared: Location[], own: Location[]) => {
    const p = parseSharedSetup(opened(shareSetupUrl(shared, [], [AV])).setup)!
    return keepOwnCopies(locationsFromSharedSetup(p), own, ids())
  }
  const mine: Location = { id: 'mine', name: 'Min mole', lat: 56.09027, lon: 12.45693, waterType: 'salt', fav: true, note: 'Bedst ved vestenvind' }
  const theirs: Location = { id: 't', name: 'Hornbæk', lat: 56.09027, lon: 12.45693, waterType: 'brackish' }
  const nordhuse: Location = { id: 'n', name: 'Nordhuse', lat: 55.97, lon: 12.1, waterType: 'salt' }
  const arreso: Location = { id: 'a', name: 'Arresø', lat: 55.98, lon: 12.13, waterType: 'fresh' }

  it('keeps the user\'s own copy: its id, ★, note, name and water', () => {
    expect(takeIn([theirs], [mine])).toEqual([mine])
  })

  it('takes what the link adds: a bottom, a depth and species the user\'s copy never had', () => {
    const more = { ...theirs, bottomType: 'stone', depth: 'deep' as const, species: [{ nameEn: 'Cod', months: [1, 2] }] }
    expect(takeIn([more], [mine])).toEqual([{ ...mine, bottomType: 'stone', depth: 'deep', species: [{ nameEn: 'Cod', months: [1, 2] }] }])
  })

  // A spot saved this session from the catalogue holds its blanks as
  // undefined (locationFromSpot): a blank is one the link fills, as a field
  // the copy never had.
  it('takes what the link adds where the user\'s copy holds it as undefined', () => {
    const more = { ...theirs, bottomType: 'stone', depth: 'deep' as const }
    const blank: Location = { ...mine, bottomType: undefined, depth: undefined }
    expect(takeIn([more], [blank])[0]).toMatchObject({ id: 'mine', bottomType: 'stone', depth: 'deep' })
  })

  it('keeps a species list the user emptied empty', () => {
    const more = { ...theirs, species: [{ nameEn: 'Cod', months: [1, 2] }] }
    expect(takeIn([more], [{ ...mine, species: [] }])[0].species).toEqual([])
  })

  it('gives the link\'s other spots new ids, in the link\'s order, and leaves out the user\'s it lacks', () => {
    const got = takeIn([nordhuse, theirs], [arreso, mine])
    expect(got.map((l) => [l.id, l.name])).toEqual([['new1', 'Nordhuse'], ['mine', 'Min mole']])
  })

  it('brings a second copy of the user\'s one spot as a new spot', () => {
    expect(takeIn([theirs, { ...theirs, id: 't2' }], [mine]).map((l) => l.id)).toEqual(['mine', 'new1'])
  })

  // Round P review: a link with a spot 25 m from the user's and one right on
  // it. The first took the user's copy, and the second came in as a second
  // spot at the user's place, while the first one's own place was gone.
  it('keeps the user\'s copy for the link\'s spot at its place, not for one nearby', () => {
    const head: Location = { id: 'mh', name: 'Molehoved', lat: mine.lat + 25 / 110540, lon: mine.lon, waterType: 'salt' }
    const got = takeIn([head, theirs], [mine])
    expect(got.map((l) => [l.id, l.name, l.lat])).toEqual([['new1', 'Molehoved', head.lat], ['mine', 'Min mole', mine.lat]])
  })

  // The link's copy is at the spot's pin now; the user's at the old one,
  // where its card offers the move (LocationsView), as a shared window's does.
  it('knows the user\'s copy of an official spot at its old pin, by its slug', () => {
    const own: Location = { ...locationFromSpot(hk), id: 'mine', name: 'Kronborg', lat: OLD.lat, lon: OLD.lon, fav: true }
    expect(takeIn([{ ...locationFromSpot(hk), id: 't' }], [own])).toEqual([own])
  })

  // Saved from the setup map, the user's copy has no slug: the catalogue still knows it.
  it('knows it by its place alone, and takes the slug, depth, bottom and species it lacks', () => {
    const own: Location = { id: 'mine', name: 'Kronborg', lat: OLD.lat, lon: OLD.lon, waterType: 'salt', note: 'Ved fyret' }
    const [got] = takeIn([{ ...locationFromSpot(hk), id: 't' }], [own])
    expect(got).toEqual({ ...own, spotSlug: hk.slug, depth: hk.depth, bottomType: hk.bottomType, species: locationFromSpot(hk).species })
  })

  /**
   * Round Q: a spot whose coast is automatic (no coast field, as the coast
   * picker leaves it) took the link's hand-picked coast, and the scorer read
   * the sharer's choice in place of the one the user had left to the app. An
   * automatic coast is the user's own value, as an emptied species list is.
   */
  it('keeps the user\'s automatic coast: the link\'s picked coast, or its "none", is not taken', () => {
    for (const coast of [{ facing: 90, spread: 180, exposure: 'open' } as const, 'none' as const]) {
      const [got] = takeIn([{ ...theirs, coast }], [mine])
      expect(got, JSON.stringify(coast)).toEqual(mine)
      expect(got).not.toHaveProperty('coast')
    }
  })

  it('keeps the coast the user picked, too', () => {
    const picked: Location = { ...mine, coast: { facing: 270, spread: 270, exposure: 'sheltered' } }
    expect(takeIn([{ ...theirs, coast: 'none' }], [picked])).toEqual([picked])
  })

  // The link fills only what the user's copy never had and the scorer reads
  // without showing it as theirs: a depth, a slug, a bottom, species never
  // filled. A water type the user's copy lacks shows as Brakvand on its card
  // (LocationsView), so it stays the user's too.
  it('takes nothing else the user\'s copy lacks: not the water, not the coast', () => {
    const bare: Location = { id: 'mine', name: 'Min mole', lat: 56.09027, lon: 12.45693 }
    const more: Location = { ...theirs, waterType: 'salt', bottomType: 'stone', depth: 'deep', spotSlug: 'molen', coast: 'none', species: [{ nameEn: 'Cod', months: [1] }] }
    expect(takeIn([more], [bare])).toEqual([{ ...bare, bottomType: 'stone', depth: 'deep', spotSlug: 'molen', species: [{ nameEn: 'Cod', months: [1] }] }])
  })
})

/**
 * Round Q: the import's question counted every spot, target species and
 * window of the user's as replaced. Helsingør Kysten, which the user had,
 * was counted as lost while it was kept with its ★ and note, and a link of
 * the user's own setup read as losing everything. What goes is what the
 * import leaves out of the user's setup: their spots the link has no copy of
 * (keepOwnCopies' pairing), their target species the link lacks, and their
 * windows the link lacks. The rest is kept, and said so.
 */
describe('what taking in a shared setup takes away, and what it keeps', () => {
  const hk = DK_SPOTS.find((s) => s.slug === 'helsingore-kysten')!
  const ids = () => { let n = 0; return () => 'new' + ++n }
  const link = (locs: Location[], sp: string[], av: Availability[]) => parseSharedSetup(opened(shareSetupUrl(locs, sp, av)).setup)!
  const myHk: Location = { ...locationFromSpot(hk), id: 'hk', name: 'Kronborg', fav: true, note: 'Ved fyret' }
  const arreso: Location = { id: 'a', name: 'Arresø', lat: 55.98, lon: 12.13, waterType: 'fresh' }
  const nordhuse: Location = { id: 'n', name: 'Nordhuse', lat: 55.97, lon: 12.1, waterType: 'salt' }
  const mine = { days: [6, 0], from: '17:00', to: '21:00', methods: ['boat' as const] }
  const MINE: Availability = { id: 'w', ...mine }
  const OTHER: Availability = { id: 'o', days: [3], from: '05:00', to: '09:00', methods: ['shore'] }

  it('counts the user\'s spots the link has a copy of as kept, and the rest as gone', () => {
    const own = { locations: [myHk, arreso], targetSpecies: ['gedde', 'torsk'], availability: [MINE] }
    const shared = link([{ ...locationFromSpot(hk), id: 'x' }, nordhuse], ['torsk'], [OTHER])
    expect(importEffect(shared, own)).toEqual({
      gone: { spots: 1, species: 1, windows: 1 },
      kept: { spots: 1, species: 1, windows: 0 },
    })
  })

  it('counts a window the link has too as kept, and keeps it as the user\'s, id and all', () => {
    const own = { locations: [], targetSpecies: [], availability: [MINE, OTHER] }
    const shared = link([nordhuse], [], [{ ...MINE, id: 'theirs', days: [0, 6] }])
    expect(importEffect(shared, own)).toEqual({ gone: { spots: 0, species: 0, windows: 1 }, kept: { spots: 0, species: 0, windows: 1 } })
    expect(takeInSetup(shared, own, ids()).availability).toEqual([MINE])
  })

  it('pairs each of the user\'s windows once: a second copy in the link is a new window', () => {
    const got = keepOwnWindows([{ d: [0, 6], f: '17:00', t: '21:00', m: ['boat'] }, { d: [0, 6], f: '17:00', t: '21:00', m: ['boat'] }], [MINE], ids())
    expect(got).toEqual([MINE, { id: 'new1', ...mine, days: [0, 6] }])
  })

  it('a link without windows keeps all of the user\'s, and counts them kept', () => {
    const own = { locations: [arreso], targetSpecies: [], availability: [MINE, OTHER] }
    const shared = link([nordhuse], ['torsk'], [])
    expect(importEffect(shared, own).kept.windows).toBe(2)
    expect(importEffect(shared, own).gone.windows).toBe(0)
    expect(takeInSetup(shared, own, ids()).availability).toEqual([MINE, OTHER])
  })

  /** Shared from one phone and opened on another, or opened again by mistake. */
  it('a link of the user\'s own setup takes nothing away, and leaves the setup as it is', () => {
    const own = {
      locations: [myHk, { ...arreso, coast: 'none' }, { ...nordhuse, coast: { facing: 270, spread: 180, exposure: 'open' }, note: 'Vest' }] as Location[],
      targetSpecies: ['torsk', 'havørred'],
      availability: [MINE, OTHER],
    }
    const shared = link(own.locations, own.targetSpecies, own.availability)
    expect(importEffect(shared, own)).toEqual({ gone: { spots: 0, species: 0, windows: 0 }, kept: { spots: 3, species: 2, windows: 2 } })
    expect(takeInSetup(shared, own, ids())).toEqual(own)
  })

  it('takes the link\'s target species in the link\'s order', () => {
    const own = { locations: [], targetSpecies: ['gedde', 'torsk'], availability: [] }
    expect(takeInSetup(link([nordhuse], ['havørred', 'torsk'], [OTHER]), own, ids()).targetSpecies).toEqual(['havørred', 'torsk'])
  })
})
