// Which service-worker cache each API request lands in. The rules live in
// vite.config.ts and are matched against the URLs the app really builds, so
// a change on either side that sends past weather into the forecast cache
// fails here.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchHistory } from './history'
import { fetchForecast, fetchForecasts } from './weather'
import type { Location } from './types'

const config = Object.values(import.meta.glob<string>('/vite.config.ts', { query: '?raw', import: 'default', eager: true }))[0]

/** workbox's runtimeCaching rules, in order: the first match handles a request. */
const rules = (config ?? '').split('urlPattern:').slice(1).map((chunk) => {
  const re = chunk.match(/^\s*\/(.*)\/([a-z]*),/)
  const cache = chunk.match(/cacheName:\s*'([^']+)'/)
  if (!re || !cache) throw new Error('unreadable runtimeCaching rule: ' + chunk.slice(0, 80))
  return { pattern: new RegExp(re[1], re[2]), cache: cache[1] }
})
const cacheFor = (url: string) => rules.find((r) => r.pattern.test(url))?.cache ?? null

const SALT: Location = { id: 'coast', name: 'Dragør mole', lat: 55.59, lon: 12.68, waterType: 'salt' }

/** Every URL the call asks for; each request fails, which is all this needs. */
async function urlsOf(call: () => Promise<unknown>): Promise<string[]> {
  const urls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (raw: string) => {
    urls.push(String(raw))
    return new Response('{}', { status: 503 })
  }))
  await call().catch(() => null)
  return urls
}

afterEach(() => vi.unstubAllGlobals())

describe('service-worker caches', () => {
  it('reads the rules from vite.config.ts', () => {
    expect(rules.map((r) => r.cache)).toEqual(expect.arrayContaining(['fishcast-history', 'fishcast-weather']))
  })

  /**
   * The history rule matched only past_days=, which nothing sends since the
   * archive moved to start_date/end_date: an "analyse all" put one marine
   * archive answer per span into the 30-entry forecast cache, stamped like a
   * forecast, and evicted the copies kept for offline starts.
   */
  it('keeps past weather out of the forecast cache', async () => {
    const urls = (await urlsOf(() => fetchHistory(SALT, { start: Date.UTC(2026, 7, 1), end: Date.UTC(2026, 7, 3) })))
      .filter((u) => u.includes('open-meteo.com'))
    expect(urls.map((u) => new URL(u).host).sort()).toEqual(['historical-forecast-api.open-meteo.com', 'marine-api.open-meteo.com'])
    for (const u of urls) expect([u, cacheFor(u)]).toEqual([u, 'fishcast-history'])
  })

  it('stamps the dashboard forecasts in the forecast cache', async () => {
    const urls = [
      ...(await urlsOf(() => fetchForecasts([SALT, { ...SALT, id: 'b', lat: 55.7 }]))),
      ...(await urlsOf(() => fetchForecast(SALT))),
    ].filter((u) => u.includes('open-meteo.com'))
    expect(urls).toHaveLength(4)
    for (const u of urls) expect([u, cacheFor(u)]).toEqual([u, 'fishcast-weather'])
  })
})
