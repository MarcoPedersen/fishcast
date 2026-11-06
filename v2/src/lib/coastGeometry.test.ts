import { describe, it, expect } from 'vitest'
import { decodeMvt, deriveFromFeatures, gunzipIfNeeded, spreadCap, tileFeatures, tileRange, tileToLonLat, type CoastFeature, type FeatureKind } from './coastGeometry'
import { COAST_ALGO_VERSION, resolveShore } from './coast'
import { SPOT_COAST } from './spotCoast.gen'
import { encodeTile } from '@/test/mvtEncode'

// Synthetic coastlines only: no network, no third-party map data in the repo.
// Every fixture is drawn in metres around the pin (x east, y north) with the
// same equirectangular projection the module uses.
const LAT0 = 55.6, LON0 = 12.6
const m2ll = (dx: number, dy: number): [number, number] =>
  [LON0 + dx / (Math.cos((LAT0 * Math.PI) / 180) * 111320), LAT0 + dy / 110540]
const ring = (pts: [number, number][]) => Float64Array.from(pts.flatMap(([x, y]) => m2ll(x, y)))
const rect = (kind: FeatureKind, x0: number, y0: number, x1: number, y1: number): CoastFeature =>
  ({ kind, rings: [ring([[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]])] })
const lineF = (pts: [number, number][]): CoastFeature => ({ kind: 'landLine', rings: [ring(pts)] })
const derive = (local: CoastFeature[], coarse = local) => deriveFromFeatures(LAT0, LON0, local, coarse)
const BIG = 30000
const bin = (name: string) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'].indexOf(name)
const near = (a: number, b: number, tol: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b)) <= tol
describe('deriveFromFeatures — synthetic coastlines (onshore spec §5.1)', () => {
  it('G1: a straight coast with the sea to the west', () => {
    const r = derive([rect('sea', -BIG, -BIG, -3, BIG)])
    expect(r.water).toBe('sea')
    expect(near(r.facing!, 270, 5)).toBe(true)
    expect(r.spread).toBe(180)
    expect(r.exposure).toBe('open')
    for (const b of ['WSW', 'W', 'WNW']) expect(r.fetchKm[bin(b)]).toBe(25)
    // The landward bins: 0 from the pin; ≤ 0.1 km from the extra origins 50 m out in the sea (R2).
    for (const b of ['ENE', 'E', 'ESE']) expect(r.fetchKm[bin(b)]).toBeLessThanOrEqual(0.1)
    expect(Math.abs(r.pinToWaterM! - 3)).toBeLessThanOrEqual(4)
    expect(r.issues).toEqual([])
  })

  it('G2: sea to the north wraps to 0°, not 180°', () => {
    const r = derive([rect('sea', -BIG, 3, BIG, BIG)])
    expect(near(r.facing!, 0, 5)).toBe(true)
    for (const b of ['NNW', 'N', 'NNE']) expect(r.fetchKm[bin(b)]).toBe(25)
  })

  it('G3: a pier tip has water on three sides', () => {
    // The pier runs 300 m west from the shore at x = 300; the pin is at its tip.
    const r = derive([rect('sea', -BIG, -BIG, 300, BIG), rect('land', -3, -10, 300, 10)])
    expect(r.pinToWaterM).toBeGreaterThan(0) // the pin stands on the pier, not in the water
    expect(r.spread).toBeGreaterThanOrEqual(270)
    expect(near(r.facing!, 270, 20)).toBe(true)
    expect(r.fetchKm[bin('N')]).toBeGreaterThanOrEqual(0.5)
    expect(r.fetchKm[bin('S')]).toBeGreaterThanOrEqual(0.5)
  })

  it('G4: a pin by a closed basin (Kalundborg-like) is flagged and left out of the score (critique R1)', () => {
    const r = derive([rect('sea', 5, -100, 305, 100), rect('sea', -BIG, -BIG, -600, BIG)])
    expect(near(r.nearFacing!, 90, 30)).toBe(true) // A: the basin right at the pin
    expect(near(r.facing!, 270, 20)).toBe(true) // B: the open water further out
    expect(r.issues).toContain('gap')
    expect(r.issues).toContain('enclosed')
    // A W wind must not score as "known, ≈ 0": the spot is unknown until the user picks.
    const auto = { ...r, at: 0, src: 'versatiles' as const }
    expect(resolveShore({ id: 'k', name: 'K', lat: LAT0, lon: LON0, waterType: 'salt' }, auto)).toBeUndefined()
  })

  it('G5: a channel 4 km wide is semi-exposed', () => {
    const r = derive([rect('sea', -4003, -BIG, -3, BIG)])
    expect(near(r.facing!, 270, 5)).toBe(true)
    expect(r.exposure).toBe('semi')
    expect(r.fetchKm[bin('W')]).toBeGreaterThanOrEqual(3.9)
    expect(r.fetchKm[bin('W')]).toBeLessThanOrEqual(4.1)
  })

  it('G6: an inlet 1 km wide is sheltered', () => {
    expect(derive([rect('sea', -1003, -BIG, -3, BIG)]).exposure).toBe('sheltered')
  })

  it('G7: a lake shore with no sea within 25 km is inland', () => {
    const r = derive([rect('inland', -3003, -1500, -3, 1500)])
    expect(r.water).toBe('inland')
    expect(r.facing).toBeNull()
    expect(r.exposure).toBeNull()
  })

  it('G8: a pin 400 m inland keeps its facing and asks', () => {
    const r = derive([rect('sea', -BIG, -BIG, -400, BIG)])
    expect(near(r.facing!, 270, 5)).toBe(true)
    expect(Math.abs(r.pinToWaterM! - 400)).toBeLessThanOrEqual(8)
    expect(r.issues).toEqual(['far'])
  })

  it('G9: a pin 2 km inland has no water', () => {
    const r = derive([rect('sea', -BIG, -BIG, -2000, BIG)])
    expect(r.water).toBe('none')
    expect(r.fetchKm).toEqual([])
    expect(r.facing).toBeNull()
  })

  it('G10: a pier line across the west ray is land (3 m buffer)', () => {
    const r = derive([rect('sea', -BIG, -BIG, -3, BIG), lineF([[-103, -2000], [-103, 2000]])])
    expect(r.fetchKm[bin('W')]).toBeLessThanOrEqual(0.15)
  })

  it('G11: the fetch continues from the local grid into the coarse one', () => {
    const r = derive([rect('sea', -1100, -1100, -3, 1100)], [rect('sea', -BIG, -BIG, -3, BIG)])
    expect(r.fetchKm[bin('W')]).toBe(25)
  })

  it('G12: up to 400 m of generalised coarse "land" after the hand-over is skipped', () => {
    const local = [rect('sea', -BIG, -BIG, -3, BIG)]
    expect(derive(local, [rect('sea', -BIG, -BIG, -1150, BIG)]).fetchKm[bin('W')]).toBe(25)
    // …but not more: 500 m of coarse land past the hand-over ends the ray there.
    expect(derive(local, [rect('sea', -BIG, -BIG, -1500, BIG)]).fetchKm[bin('W')]).toBeLessThan(1.2)
  })

  /**
   * Critique R2: from one pin the profile swung with the pin — Hammerhavn
   * mole's pin moved 50 m into the harbour basin read "sheltered", every wind
   * 0, no prompt. The profile is now the max over the pin and 8 points 50 m
   * around it, so a pin a few metres inside a basin by the open sea keeps it.
   */
  it('R2: a pin in a harbour basin still sees the open sea beyond the mole', () => {
    // Open sea west of x = -40; a 15 m mole (x = -40..-25, y = ±200); behind
    // it a closed basin (x = -25..5, y = ±200) with the pin in it, 25 m from the mole.
    const feats = [rect('sea', -BIG, -BIG, -25, BIG), rect('land', -40, -200, -25, 200), rect('sea', -25, -200, 5, 200)]
    const r = derive(feats)
    expect(r.fetchKm[bin('W')]).toBe(25)
    expect(r.exposure).toBe('open')
  })

  /**
   * Review: a point 50 m around the pin read water out to its own 300 m
   * reach, so on a spit it credited the far side to the pin. A test
   * pin is on the W shore of a 240 m-wide spit; the point 50 m E reached the
   * fjord mouth beyond it, NE went 0.1 → 24.8 km, and a NE wind — off the
   * land at the pin — scored +8 "pålandsvind".
   */
  it("R2b: a point 50 m off doesn't lend the pin the water beyond a spit", () => {
    // A 1 km channel W of the pin; the spit from x = −3 to 320; open sea E of
    // it — 323 m from the pin (past its 300 m reach), 270 m from the point 50 m E.
    const r = derive([rect('sea', -1003, -BIG, -3, BIG), rect('sea', 320, -BIG, BIG, BIG)])
    for (const b of ['ENE', 'E', 'ESE']) expect(r.fetchKm[bin(b)]).toBeLessThan(0.5)
    expect(r.fetchKm[bin('W')]).toBeGreaterThanOrEqual(0.9)
  })

  /**
   * Review: the shape came from how the water right at the pin is spread
   * (RA) alone. At a beach pin a breakwater 16 m off the pin cut its
   * seaward rays short, RA fell to 0.27, and a straight coast with 135° of
   * land behind it read "water all round" — which the gap answer copied.
   */
  it('S1: a breakwater just off a straight coast does not make it water all round', () => {
    // Sea W of x = −3; a 120 m breakwater 16–25 m out blocks the pin's rays within ±75° of W.
    const r = derive([rect('sea', -BIG, -BIG, -3, BIG), rect('land', -25, -60, -16, 60)])
    expect(near(r.facing!, 270, 10)).toBe(true)
    expect(r.spread).toBe(180)
  })

  it('S2: the profile caps the shape by its longest run of land bins', () => {
    const at = (land: number[]) => spreadCap(Array.from({ length: 16 }, (_, k) => (land.includes(k) ? 0.1 : 25)))
    expect(at([4, 5, 6, 7, 8, 9])).toBe(180) // 135° of land: a straight coast
    expect(at([14, 15, 0, 1, 2, 3])).toBe(180) // …across north too
    expect(at([6, 7, 8])).toBe(270) // a mole's root
    expect(at([2, 10])).toBe(360) // a pier head: one bin each side
    expect(at([])).toBe(360)
    expect(spreadCap(new Array(16).fill(0))).toBe(180)
  })
})

/**
 * stores/coast.ts skips a catalogue entry of an older algorithm and derives
 * the spot live instead: a geometry change without a re-run of the
 * precompute would quietly drop all 48 official spots from the catalogue.
 */
it('the official catalogue is of the current algorithm', () => {
  expect(Object.keys(SPOT_COAST).length).toBeGreaterThan(40)
  for (const [slug, e] of Object.entries(SPOT_COAST)) expect([slug, e.v]).toEqual([slug, COAST_ALGO_VERSION])
})

describe('MVT decoding and tile maths', () => {
  const square: [number, number][] = [[0, 0], [4096, 0], [4096, 4096], [0, 4096], [0, 0]]

  it('decodes a hand-encoded tile: one ocean square', () => {
    const L = decodeMvt(encodeTile([{ name: 'ocean', features: [{ type: 3, rings: [square] }] }]))
    expect(Object.keys(L)).toEqual(['ocean'])
    expect(L.ocean.extent).toBe(4096)
    expect(L.ocean.features[0].type).toBe(3)
    expect(L.ocean.features[0].parts[0]).toEqual(square)
  })

  it('reads string tags, and filters layers', () => {
    const L = decodeMvt(encodeTile([
      { name: 'water_polygons', features: [{ type: 3, rings: [square], props: { kind: 'dock' } }] },
      { name: 'buildings', features: [{ type: 3, rings: [square] }] },
    ]), ['water_polygons'])
    expect(Object.keys(L)).toEqual(['water_polygons'])
    expect(L.water_polygons.features[0].props).toEqual({ kind: 'dock' })
  })

  it('decodes a gzip-wrapped copy the same', async () => {
    const raw = encodeTile([{ name: 'ocean', features: [{ type: 3, rings: [square] }] }])
    const gz = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
    expect(gz[0]).toBe(0x1f)
    expect(decodeMvt(await gunzipIfNeeded(gz))).toEqual(decodeMvt(raw))
    expect(await gunzipIfNeeded(raw)).toBe(raw)
  })

  it('maps tile corners to lon/lat (Gudermannian cross-check)', () => {
    const gd = (z: number, y: number) => (2 * Math.atan(Math.exp(Math.PI * (1 - (2 * y) / 2 ** z))) - Math.PI / 2) * 180 / Math.PI
    for (const [z, x, y] of [[13, 4358, 2528], [8, 137, 79], [8, 138, 80], [0, 0, 0], [1, 1, 1]]) {
      const [lon, lat] = tileToLonLat(z, x, y)
      expect(lon).toBeCloseTo((x / 2 ** z) * 360 - 180, 9)
      expect(lat).toBeCloseTo(gd(z, y), 9)
    }
  })

  it('covers ±1.1 km with at most 4 z13 tiles, and ±25 km with at most 4 z8 tiles', () => {
    for (const [lat, lon] of [[55.6, 12.6], [55.10, 14.70], [55.678, 11.085]]) {
      expect(tileRange(lat, lon, 1100, 13).length).toBeLessThanOrEqual(4)
      expect(tileRange(lat, lon, 25000, 8).length).toBeLessThanOrEqual(4)
    }
  })

  it('turns a decoded tile into features by Shortbread layer and kind', () => {
    const L = decodeMvt(encodeTile([
      { name: 'ocean', features: [{ type: 3, rings: [square] }] },
      { name: 'water_polygons', features: [{ type: 3, rings: [square], props: { kind: 'lake' } }, { type: 3, rings: [square], props: { kind: 'swimming_pool' } }] },
      { name: 'pier_lines', features: [{ type: 2, lines: [[[0, 0], [100, 100]]] }] },
    ]))
    const f = tileFeatures(13, 4358, 2528, L)
    expect(f.map((x) => x.kind)).toEqual(['sea', 'inland', 'landLine'])
    const [lon, lat] = tileToLonLat(13, 4358, 2528)
    expect(f[0].rings[0][0]).toBeCloseTo(lon, 9)
    expect(f[0].rings[0][1]).toBeCloseTo(lat, 9)
  })
})
