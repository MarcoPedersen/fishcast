/**
 * The service worker's cache of the OpenStreetMap raster tiles under both
 * maps (the setup map, the dashboard's map tab).
 *
 * Leaflet requests a tile without CORS unless told otherwise, and the worker
 * cached each as an opaque response, which Chrome counts as ~7–9 MB of quota
 * whatever its real size (a tile is ~35 KB): one look at the map took the
 * site from 0.8 MB to 75 MB, and the cap of 300 tiles allowed ~2.8 GB.
 * tile.openstreetmap.org answers a CORS request with
 * `Access-Control-Allow-Origin: *`, so both tile layers ask with CORS
 * (crossOrigin: 'anonymous') and the worker caches real 200s only.
 */

/**
 * The worker's cache for them (vite.config.ts). A new name, not the old one:
 * a CORS image can't use the opaque copies the old cache would hand it, so
 * the tiles it held would have failed to draw for up to two weeks.
 */
export const OSM_TILE_CACHE = 'osm-tiles-cors'
export const OLD_OSM_TILE_CACHE = 'osm-tiles'

/** Free the old cache's padded quota, once per start; nothing else ever would. */
export async function dropOldTileCache(caches: Pick<CacheStorage, 'delete'> | undefined = globalThis.caches): Promise<void> {
  try { await caches?.delete(OLD_OSM_TILE_CACHE) } catch { /* no Cache Storage here (blocked, or not a secure origin) */ }
}
