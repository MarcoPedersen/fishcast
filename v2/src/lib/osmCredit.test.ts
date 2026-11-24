import { describe, it, expect } from 'vitest'
// @ts-ignore — no @types/node in this project; vitest runs in Node.
import { readFileSync } from 'node:fs'
import { STRINGS } from '@/test/strings'
import { LEAFLET_PREFIX, ODBL_URL, OSM_COPYRIGHT_URL, OSM_TILE_ATTRIBUTION, osmCreditParts, spotCoastHeader } from './osmCredit'
import { SPOT_COAST } from './spotCoast.gen'
import { COAST_ALGO_VERSION, coastLine, lineFromMap, type CoastAuto } from './coast'
import type { Location } from './types'

/**
 * Review C1: every OpenStreetMap credit the coast feature added was plain
 * text, "© OpenStreetMap-bidragydere", with no link to openstreetmap.org/
 * copyright and no word of the ODbL. The OSMF Attribution Guidelines ask the
 * credit to make clear that the data is under the Open Database License,
 * normally by linking "OpenStreetMap" to that page; ODbL §4.3 asks the same
 * of a publicly used Produced Work. And the Spots page showed coasts derived
 * from OSM data with no credit at all.
 */
const CREDIT_KEYS = ['attribution', 'coast_osm', 'coast_osm_list']

describe('the OpenStreetMap credit', () => {
  it('names the ODbL, and has one place for the link, in both languages', () => {
    const bad = (['da', 'en'] as const).flatMap((l) => CREDIT_KEYS.filter((k) => {
      const s = STRINGS[l][k] ?? ''
      // The link is the one "OpenStreetMap": the words around it don't repeat it.
      return s.split('{osm}').length !== 2 || !/\bODbL\b/.test(s) || /OpenStreetMap/.test(s)
    }).map((k) => `${l}.${k}`))
    expect(bad).toEqual([])
  })

  it('splits a credit around the link', () => {
    expect(osmCreditParts('Kystretning: kortdata © {osm}-bidragydere (ODbL) · Regler')).toEqual({
      before: 'Kystretning: kortdata © ', after: '-bidragydere (ODbL) · Regler',
    })
  })

  it('links the licence page', () => {
    expect(OSM_COPYRIGHT_URL).toBe('https://www.openstreetmap.org/copyright')
    // Leaflet renders its credit as HTML: a constant, never a translated string.
    expect(OSM_TILE_ATTRIBUTION).toBe(
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors')
  })
})

/**
 * The maps' credit line starts with Leaflet's credit to itself. Its link
 * opened in the same tab, which took the user out of the app, while the OSM
 * credit beside it opens a new one. The app's own opens a new tab too.
 */
describe("Leaflet's credit", () => {
  const leaflet: string = readFileSync(new URL('../../node_modules/leaflet/dist/leaflet-src.js', import.meta.url), 'utf8')

  it('links Leaflet in a new tab, as the OSM credit does, with no English title', () => {
    expect(LEAFLET_PREFIX).toMatch(/^<a href="https:\/\/leafletjs\.com" target="_blank" rel="noopener">[^<]*<svg [\s\S]*<\/svg> Leaflet<\/a>$/)
    expect(LEAFLET_PREFIX).not.toContain('title=')
  })

  it("keeps Leaflet's flag, as Leaflet draws it", () => {
    const flag = /var ukrainianFlag = '([^']*)'/.exec(leaflet)?.[1] ?? ''
    expect(flag).toMatch(/^<svg aria-hidden="true"[^>]*class="leaflet-attribution-flag">/)
    expect(LEAFLET_PREFIX).toContain(`>${flag} Leaflet</a>`)
  })

  it("stands in for Leaflet's own, which opens in the same tab", () => {
    expect(leaflet).toContain(`prefix: '<a href="https://leafletjs.com" title="A JavaScript library for interactive maps">' + (Browser.inlineSvg ? ukrainianFlag + ' ' : '') + 'Leaflet</a>'`)
    expect(leaflet).toMatch(/setPrefix: function \(prefix\) \{\s+this\.options\.prefix = prefix;\s+this\._update\(\);/)
  })
})

describe('where the credit is shown', () => {
  const sources = import.meta.glob<string>(['/src/**/*.{ts,vue}', '!/src/**/*.test.ts', '!/src/test/**'], {
    query: '?raw', import: 'default', eager: true,
  })
  const src = (path: string) => sources[path] ?? ''

  it('renders the link as markup in the template', () => {
    expect(src('/src/components/OsmCredit.vue')).toContain('<a :href="OSM_COPYRIGHT_URL" target="_blank" rel="noopener">OpenStreetMap</a>')
  })

  it('credits OSM on the dashboard, in the coast picker and on the Spots page', () => {
    const uses = {
      '/src/views/DashboardView.vue': `<OsmCredit :text="t('attribution')"`,
      '/src/components/CoastPicker.vue': `<OsmCredit :text="t('coast_osm')"`,
      '/src/views/LocationsView.vue': `<OsmCredit :text="t('coast_osm_list')"`,
    }
    expect(Object.entries(uses).filter(([path, use]) => !src(path).includes(use)).map(([path]) => path)).toEqual([])
  })

  it('gives Leaflet the linked credit for the OSM tiles', () => {
    const maps = ['/src/components/MapTab.vue', '/src/views/MapView.vue']
    expect(maps.filter((p) => !src(p).includes('attribution: OSM_TILE_ATTRIBUTION'))).toEqual([])
  })

  it('writes no credit by hand anywhere else, and renders no translated string as HTML', () => {
    // An unlinked "© OpenStreetMap" (coastFetch.ts' unused TILE_ATTRIBUTION,
    // Leaflet's '&copy; OpenStreetMap') is what this replaced. The generated
    // catalogue names its source in its header, a comment.
    const byHand = Object.entries(sources)
      .filter(([p, s]) => p !== '/src/lib/osmCredit.ts' && !p.endsWith('.gen.ts') && /(?:©|&copy;)\s*OpenStreetMap/.test(s))
      .map(([p]) => p)
    expect(byHand).toEqual([])
    expect(Object.entries(sources).filter(([, s]) => /\bv-html\b/.test(s)).map(([p]) => p)).toEqual([])
  })
})

/**
 * The Spots page credits OSM when a line shows a value derived from its
 * data: an automatic coast, and the automatic findings (no water, a lake,
 * a closed basin, an unclear direction). Not for the user's own pick, an
 * ignored spot, or a lookup still pending or failed.
 */
describe('lineFromMap', () => {
  const loc = (over: Partial<Location> = {}): Location => ({ id: 'a', name: 'A', lat: 56, lon: 10, waterType: 'salt', ...over })
  const auto = (over: Partial<CoastAuto> = {}): CoastAuto => ({
    v: COAST_ALGO_VERSION, at: 1, src: 'versatiles', water: 'sea', facing: 270, nearFacing: 268, spread: 180, exposure: 'open',
    fetchKm: Array.from({ length: 16 }, (_, k) => (k >= 9 && k <= 15 ? 25 : 0)), pinToWaterM: 3, issues: [], ...over,
  })
  const MANUAL = { facing: 90, spread: 180 as const, exposure: 'open' as const }

  it('is true for what an automatic value shows', () => {
    for (const a of [auto(), auto({ src: 'catalogue' }), auto({ water: 'none', facing: null, exposure: null, fetchKm: [] }),
      auto({ water: 'inland', facing: null, exposure: null, fetchKm: [] }), auto({ issues: ['enclosed'] }), auto({ issues: ['gap'] })]) {
      expect(lineFromMap(coastLine(loc(), a))).toBe(true)
    }
    // In a west-coast lagoon, the map's lake: what the lookup found there.
    const lagoon = coastLine(loc({ lat: 56.0, lon: 8.17 }), auto({ water: 'inland', facing: null, exposure: null, fetchKm: [] }))
    expect(lagoon?.kind).toBe('lagoon')
    expect(lineFromMap(lagoon)).toBe(true)
  })

  it('is false for the user\'s own choice, fresh water and a value not there yet', () => {
    expect(lineFromMap(coastLine(loc({ coast: MANUAL }), auto()))).toBe(false)
    expect(lineFromMap(coastLine(loc({ coast: 'none' }), auto()))).toBe(false)
    expect(lineFromMap(coastLine(loc({ waterType: 'fresh' }), auto()))).toBe(false)
    expect(lineFromMap(coastLine(loc(), undefined, 'pending'))).toBe(false)
    expect(lineFromMap(coastLine(loc(), undefined, 'failed'))).toBe(false)
    expect(lineFromMap(coastLine(loc(), undefined))).toBe(false)
  })
})

/**
 * Review C5: the generated catalogue called itself "an insubstantial extract
 * of the database", which the OSMF guideline does not back for a systematic
 * run over every coastal spot, and offered the table under no licence. It is
 * a derived database: offered under the ODbL, with the licence's own notice
 * and the credit linking OSM's copyright page. The generator writes that
 * header, and the file holds what it writes.
 */
describe('the generated coast catalogue', () => {
  const raw = import.meta.glob<string>(['/src/lib/spotCoast.gen.ts', '/scripts/model-check/coast-precompute.check.ts'], {
    query: '?raw', import: 'default', eager: true,
  })
  const gen = (raw['/src/lib/spotCoast.gen.ts'] ?? '').replace(/\r\n/g, '\n')

  it('offers SPOT_COAST under the ODbL, crediting OSM with its copyright link', () => {
    const header = spotCoastHeader({ date: '2026-01-01', algo: 2, count: 48 }).join('\n')
    expect(ODBL_URL).toBe('https://opendatacommons.org/licenses/odbl/1-0/')
    expect(header).toContain('SPOT_COAST is made available under the Open Database License (ODbL) 1.0')
    expect(header).toContain(ODBL_URL)
    expect(header).toContain(`© OpenStreetMap contributors (${OSM_COPYRIGHT_URL})`)
    expect(header).not.toMatch(/insubstantial/i)
  })

  /**
   * Review: the header was // comments, which the minifier strips, so the
   * spotCoast chunk the PWA precaches and serves began with the data alone.
   * ODbL §4.2(b) asks the licence to travel with a publicly conveyed
   * derivative database: the notice is a legal comment (/*! … *\/), which
   * esbuild — Vite's minifier — keeps.
   */
  it('keeps the licence notice in the minified chunk', async () => {
    const { transform } = await import('esbuild')
    const { code } = await transform(gen, { loader: 'ts', minify: true })
    expect(code).toContain(`© OpenStreetMap contributors (${OSM_COPYRIGHT_URL})`)
    expect(code).toContain(`Open Database License (ODbL) 1.0: ${ODBL_URL}`)
    expect(code).toContain('Database Contents License')
  })

  it('starts with the header the generator writes', () => {
    const m = /fetched (\d{4}-\d{2}-\d{2}), algorithm v(\d+)/.exec(gen)
    expect(m).not.toBeNull()
    const lines = spotCoastHeader({ date: m![1], algo: Number(m![2]), count: Object.keys(SPOT_COAST).length })
    expect(gen.split('\n').slice(0, lines.length)).toEqual(lines)
    expect(raw['/scripts/model-check/coast-precompute.check.ts']).toContain('...spotCoastHeader({')
  })
})
