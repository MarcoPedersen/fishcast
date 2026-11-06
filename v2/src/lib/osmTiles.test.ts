import { describe, it, expect, vi } from 'vitest'
import { OLD_OSM_TILE_CACHE, OSM_TILE_CACHE, dropOldTileCache } from './osmTiles'

/**
 * Regression — Leaflet requests tiles without CORS unless told otherwise, so
 * the service worker cached every OpenStreetMap tile as an opaque response,
 * and Chrome counts each of those as ~7–9 MB of quota whatever its size (a
 * tile is ~35 KB): 8 tiles took the site from 0.8 MB to 75 MB, and the cap of
 * 300 allowed ~2.8 GB. tile.openstreetmap.org answers CORS requests with
 * `Access-Control-Allow-Origin: *`, so the tiles are fetched in CORS mode now
 * and only real 200s are cached — under a new name, because a CORS image
 * can't use the opaque copies the old cache would hand it.
 */
const sources = import.meta.glob<string>(['/src/components/MapTab.vue', '/src/views/MapView.vue', '/src/main.ts', '/vite.config.ts'], {
  query: '?raw', import: 'default', eager: true,
})
const src = (path: string) => sources[path] ?? ''

describe('the OpenStreetMap tile layers', () => {
  it('ask for the tiles with CORS, on both maps', () => {
    const layer = (path: string) => src(path).match(/L\.tileLayer\('https:\/\/\{s\}\.tile\.openstreetmap\.org[^)]*\)/)?.[0] ?? ''
    const maps = ['/src/components/MapTab.vue', '/src/views/MapView.vue']
    expect(maps.filter((p) => !layer(p))).toEqual([])
    expect(maps.filter((p) => !layer(p).includes("crossOrigin: 'anonymous'"))).toEqual([])
  })
})

describe('the service worker’s tile cache', () => {
  // The workbox rule for the tiles, as vite.config.ts writes it.
  const rule = src('/vite.config.ts').match(/urlPattern: \/\^https:\\\/\\\/\[a-c\]\\\.tile\\\.openstreetmap\\\.org[\s\S]*?\n {10}\},/)?.[0] ?? ''

  it('caches real answers only, under the new name, and gives way on a full quota', () => {
    expect(rule).not.toBe('')
    expect(rule).toContain(`cacheName: '${OSM_TILE_CACHE}'`)
    expect(rule).toContain('cacheableResponse: { statuses: [200] }')
    expect(rule).toContain('purgeOnQuotaError: true')
    expect(OSM_TILE_CACHE).not.toBe(OLD_OSM_TILE_CACHE)
  })

  it('drops the old cache of opaque tiles at start', async () => {
    expect(src('/src/main.ts')).toContain('dropOldTileCache()')
    const caches = { delete: vi.fn(async () => true) }
    await dropOldTileCache(caches)
    expect(caches.delete).toHaveBeenCalledWith('osm-tiles')
  })

  it('shrugs off a browser without caches, or one that refuses', async () => {
    await expect(dropOldTileCache(undefined)).resolves.toBeUndefined()
    await expect(dropOldTileCache({ delete: async () => { throw new Error('SecurityError') } })).resolves.toBeUndefined()
  })
})
