import { haversine } from './math'
import type {
  Forecast, HourData, LightningLevel, LightningStatus, Location, MarineHour, TideData,
} from './types'

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast'
const MARINE_API = 'https://marine-api.open-meteo.com/v1/marine'
export const GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search'
// DMI govcloud (Danish Met Institute) — free, no key for these collections
const DMI_TIDES = 'https://dmigw.govcloud.dk/v2/oceanObs/collections/tidewater/items'
const DMI_TIDE_STN = 'https://dmigw.govcloud.dk/v2/oceanObs/collections/tidewaterstation/items'
const DMI_LIGHTNING = 'https://dmigw.govcloud.dk/v2/lightningdata/collections/observation/items'
export const FORECAST_DAYS = 7
/**
 * Days asked of Open-Meteo (weather and marine). Scoring covers LOCAL days
 * 0–6, but with timezone=UTC forecast_days counts UTC days from the UTC date:
 * asking for 7 left the 7th local day with data only up to 01:00 between
 * local midnight and 01:00/02:00 (the UTC date is still yesterday then), and
 * at any hour cut an overnight window on that day off at midnight. One extra
 * day covers both, bar the 02:00 end hour of such a window in the first local
 * hour or two. 8 is the most the marine API has ever been documented to take
 * (0–8 at launch); the weather API takes up to 16. A day the marine model
 * doesn't reach comes back as null wave heights, which scoring already skips.
 * Tides keep FORECAST_DAYS from now: that already reaches past the 7th local
 * day, and DMI's page limit (1500) was sized for it.
 */
export const OPEN_METEO_DAYS = FORECAST_DAYS + 1

/**
 * When a weather response was really fetched. After a network failure the
 * service worker answers from its cache, and it stamps what it stores with this
 * header (see vite.config.ts — the two must agree). Stamping such a copy
 * Date.now() showed hours-old weather as "updated just now" and kept it "fresh"
 * for another 3 h, so nothing refetched it once the signal came back.
 */
function fetchedAt(res: Response): number {
  const now = Date.now()
  const stamp = Number(res.headers?.get('x-fc-fetched-at'))
  return stamp > 0 && stamp <= now ? stamp : now
}

async function fetchHourly(loc: Location, pastDays = 0): Promise<{ hours: HourData[]; fetchedAt: number }> {
  const params = new URLSearchParams({
    latitude: String(loc.lat),
    longitude: String(loc.lon),
    hourly: 'temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,precipitation_probability,surface_pressure',
    wind_speed_unit: 'ms',
    // For a past date we still need a little forward context (pressure/wind trend
    // look back 3h); 1 forecast day is enough alongside the past window.
    forecast_days: pastDays > 0 ? '1' : String(OPEN_METEO_DAYS),
    timezone: 'UTC',
  })
  if (pastDays > 0) params.set('past_days', String(pastDays))
  const res = await fetch(`${OPEN_METEO}?${params}`)
  if (!res.ok) throw new Error(`weather ${res.status}`)
  const data = await res.json()
  return { hours: hourlyRows(asEntries(data)[0].hourly), fetchedAt: fetchedAt(res) }
}

async function fetchMarine(loc: Location, pastDays = 0): Promise<MarineHour[] | null> {
  try {
    const params = new URLSearchParams({
      latitude: String(loc.lat),
      longitude: String(loc.lon),
      hourly: 'wave_height,wave_period',
      forecast_days: pastDays > 0 ? '1' : String(OPEN_METEO_DAYS),
      timezone: 'UTC',
    })
    if (pastDays > 0) params.set('past_days', String(pastDays))
    const res = await fetch(`${MARINE_API}?${params}`)
    if (!res.ok) return null
    const data = await res.json()
    const h = data.hourly
    if (!h?.time) return null
    return h.time.map((iso: string, i: number) => ({
      time: Date.parse(iso + 'Z'),
      waveM: h.wave_height[i],
      wavePeriod: h.wave_period[i],
    }))
  } catch {
    return null
  }
}

// ── DMI tides ────────────────────────────────────────────────
interface TideStation { id: string; name: string; lat: number; lon: number }
// The PROMISE is cached, not the result. Caching the result still let 18
// concurrent callers each miss the cache before the first response landed, so a
// refresh fetched this same 100-station document once per location.
let tideStationCache: Promise<TideStation[]> | null = null

function fetchTideStations(): Promise<TideStation[]> {
  if (!tideStationCache) {
    tideStationCache = (async () => {
      const res = await fetch(`${DMI_TIDE_STN}?limit=100`)
      // A 429/5xx still has a JSON body. It parsed to "no stations" and that
      // empty list was cached as a success, so every spot lost its tides for
      // the rest of the session — "Update all" couldn't bring them back. Throw
      // instead, so the .catch below clears the cache for the next refresh.
      if (!res.ok) throw new Error(`tide stations ${res.status}`)
      const data = await res.json()
      const stations: TideStation[] = (data.features || [])
        .filter((f: any) => f.properties?.country === 'DNK')
        .map((f: any) => ({
          id: f.properties.stationId, name: f.properties.name,
          lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
        }))
      // Denmark always has stations; an empty list is a bad answer, not a fact.
      if (!stations.length) throw new Error('tide stations: none in DNK')
      return stations
    })().catch(() => {
      tideStationCache = null // let a later refresh try again
      return [] as TideStation[]
    })
  }
  return tideStationCache
}

/** Closest DMI tide station, or null when nothing is within range. */
async function nearestStation(loc: Location): Promise<(TideStation & { dist: number }) | null> {
  const stations = await fetchTideStations()
  if (!stations.length) return null
  let best: (TideStation & { dist: number }) | null = null
  for (const s of stations) {
    const dist = haversine(loc.lat, loc.lon, s.lat, s.lon)
    if (!best || dist < best.dist) best = { ...s, dist }
  }
  return best && best.dist <= 120 ? best : null
}

type PredCache = Map<string, Promise<{ time: number; value: number }[]>>

/**
 * Predictions for one station. `cache` lets a batch share a station between
 * locations — several spots on the same stretch of coast resolve to the same
 * station, so without it we'd fetch identical data once per location.
 */
function stationPredictions(
  stationId: string, start: Date, end: Date, cache?: PredCache,
): Promise<{ time: number; value: number }[]> {
  const key = `${stationId}|${start.toISOString()}|${end.toISOString()}`
  const hit = cache?.get(key)
  if (hit) return hit
  const p = (async () => {
    const url = `${DMI_TIDES}?stationId=${stationId}&limit=1500&datetime=${start.toISOString()}/${end.toISOString()}`
    const res = await fetch(url)
    // Same trap as the station list: an error body became `predictions: []`,
    // a "successful" tide-less forecast that then counted as fresh for 3 h.
    if (!res.ok) throw new Error(`tide predictions ${res.status}`)
    const data = await res.json()
    return (data.features || [])
      .map((f: any) => ({ time: new Date(f.properties.predictionTime).getTime(), value: f.properties.value }))
      .sort((a: any, b: any) => a.time - b.time)
  })()
  if (cache) {
    cache.set(key, p)
    // Don't hand a failed request to the next location sharing the station.
    p.catch(() => { if (cache.get(key) === p) cache.delete(key) })
  }
  return p
}

async function fetchTides(
  loc: Location, startMs?: number, endMs?: number, cache?: PredCache,
): Promise<TideData | null> {
  if (loc.waterType === 'fresh') return null
  try {
    const nearest = await nearestStation(loc)
    if (!nearest) return null
    const start = new Date(startMs ?? Date.now())
    const end = new Date(endMs ?? start.getTime() + FORECAST_DAYS * 86400000)
    const predictions = await stationPredictions(nearest.id, start, end, cache)
    // distKm is per LOCATION even when the predictions are shared.
    return { stationName: nearest.name, distKm: Math.round(nearest.dist), predictions }
  } catch {
    return null
  }
}

// ── DMI lightning (last 45 min within ~80 km) ────────────────
const LIGHTNING_PAD = 0.8
const LIGHTNING_LIMIT = 200
// The box that decides 'danger': 0.2° covers a 10 km radius in both directions
// at Danish latitudes (0.2° of longitude is ~12 km even at 58°N).
const LIGHTNING_NEAR_PAD = 0.2
const LIGHTNING_NEAR_LIMIT = 1000
// One hung request would hold back the whole refresh (the store applies every
// location's result in one go), and lightning is worthless minutes late anyway.
const LIGHTNING_TIMEOUT_MS = 10_000

async function strikesIn(loc: Location, pad: number, limit: number, from: Date, to: Date): Promise<any[]> {
  const bbox = `${loc.lon - pad},${loc.lat - pad},${loc.lon + pad},${loc.lat + pad}`
  const url = `${DMI_LIGHTNING}?limit=${limit}&bbox=${bbox}&datetime=${from.toISOString()}/${to.toISOString()}`
  const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(LIGHTNING_TIMEOUT_MS) : undefined
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`lightning ${res.status}`)
  const data = await res.json()
  if (!Array.isArray(data?.features)) throw new Error('lightning: no feature list')
  return data.features
}

/**
 * Rejects when DMI can't answer — the caller keeps its last reading. Every
 * failure used to resolve 'clear': offline, a 429 (whose JSON body has no
 * features) or an HTML error page all lifted the danger cap and removed the ⚡
 * tag from a spot with a strike 6 km away, and nothing retried for 15 minutes.
 */
export async function fetchLightningStatus(loc: Location): Promise<LightningStatus> {
  const now = new Date()
  const ago = new Date(now.getTime() - 45 * 60000)
  let features = await strikesIn(loc, LIGHTNING_PAD, LIGHTNING_LIMIT, ago, now)
  // A full page means DMI cut the list off, and the closest strike may be in
  // the part it didn't send — so ask again for just the box around the spot.
  // (If even that is full, the closest of 1000 nearby strikes is still a lower
  // bound on the danger, which is the safe direction to be wrong in.)
  if (features.length >= LIGHTNING_LIMIT) {
    features = features.concat(await strikesIn(loc, LIGHTNING_NEAR_PAD, LIGHTNING_NEAR_LIMIT, ago, now))
  }
  const strikes = features.map((f: any) => ({
    dist: haversine(loc.lat, loc.lon, f.geometry.coordinates[1], f.geometry.coordinates[0]),
    type: f.properties.type, amp: f.properties.amp,
  }))
  if (!strikes.length) return { level: 'clear', closestKm: null }
  const dangerous = strikes.filter((s: any) => s.type === 0 || s.amp < 0)
  const pool = dangerous.length ? dangerous : strikes
  const km = pool.reduce((a: any, b: any) => (a.dist < b.dist ? a : b)).dist
  let level: LightningLevel = 'clear'
  if (km < 10) level = 'danger'
  else if (km < 25) level = 'warning'
  else if (km < 50) level = 'caution'
  return { level, closestKm: Math.round(km) }
}

/**
 * Open-Meteo accepts comma-separated coordinates and answers with one entry per
 * location, in input order. That turns N weather + N marine requests into two —
 * measured on an 18-location setup: 0.47s and 0.64s respectively, against ~30s
 * for the old three-at-a-time-with-retries loop, which also failed often enough
 * that the last batch regularly showed "no weather data" before recovering.
 *
 * A single coordinate answers with a bare object rather than an array, so
 * normalise before indexing.
 */
function asEntries(data: unknown): any[] {
  return Array.isArray(data) ? data : [data]
}

function hourlyRows(h: any): HourData[] {
  return h.time.map((iso: string, i: number) => ({
    time: Date.parse(iso + 'Z'),
    temp: h.temperature_2m[i],
    windMs: h.wind_speed_10m[i],
    windDir: h.wind_direction_10m[i],
    gustMs: h.wind_gusts_10m[i],
    cloud: h.cloud_cover[i] ?? 0,
    precipPct: h.precipitation_probability[i] ?? 0,
    pressure: h.surface_pressure[i],
  }))
}

/** Hourly weather for many locations in ONE request, aligned to `locs`. */
async function fetchHourlyBatch(locs: Location[]): Promise<{ rows: (HourData[] | null)[]; fetchedAt: number }> {
  const params = new URLSearchParams({
    latitude: locs.map((l) => l.lat).join(','),
    longitude: locs.map((l) => l.lon).join(','),
    hourly: 'temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,precipitation_probability,surface_pressure',
    wind_speed_unit: 'ms',
    forecast_days: String(OPEN_METEO_DAYS),
    timezone: 'UTC',
  })
  const res = await fetch(`${OPEN_METEO}?${params}`)
  if (!res.ok) throw new Error(`weather ${res.status}`)
  const entries = asEntries(await res.json())
  const rows = locs.map((_, i) => {
    const h = entries[i]?.hourly
    return h?.time ? hourlyRows(h) : null
  })
  return { rows, fetchedAt: fetchedAt(res) }
}

/** Marine for many locations in ONE request. Best-effort: nulls on failure. */
async function fetchMarineBatch(locs: Location[]): Promise<(MarineHour[] | null)[]> {
  try {
    const params = new URLSearchParams({
      latitude: locs.map((l) => l.lat).join(','),
      longitude: locs.map((l) => l.lon).join(','),
      hourly: 'wave_height,wave_period',
      forecast_days: String(OPEN_METEO_DAYS),
      timezone: 'UTC',
    })
    const res = await fetch(`${MARINE_API}?${params}`)
    if (!res.ok) return locs.map(() => null)
    const entries = asEntries(await res.json())
    return locs.map((_, i) => {
      const h = entries[i]?.hourly
      if (!h?.time) return null
      return h.time.map((iso: string, j: number) => ({
        time: Date.parse(iso + 'Z'),
        waveM: h.wave_height[j],
        wavePeriod: h.wave_period[j],
      }))
    })
  } catch {
    return locs.map(() => null)
  }
}

/**
 * What a forecast answers for. The coordinates drive everything, and fresh
 * water skips tides (fetchTides), so a cached forecast whose key no longer
 * matches its location is the wrong data however young it is — a spot switched
 * from fresh to salt sat without tides for up to 3 h, and salt→fresh kept them.
 */
export function forecastKey(loc: Location): string {
  return `${loc.lat},${loc.lon},${loc.waterType === 'fresh' ? 'fresh' : 'sea'}`
}

/**
 * Forecasts for many locations: two batched Open-Meteo requests plus tides,
 * which stay per-station (DMI takes one stationId at a time) but are shared
 * between locations resolving to the same station.
 *
 * Returns null for any location whose weather is missing — the caller decides
 * what that means (the store marks it an error and offers a retry).
 */
export async function fetchForecasts(locs: Location[]): Promise<(Forecast | null)[]> {
  if (!locs.length) return []
  const predCache: PredCache = new Map()
  // One window for the whole batch. Letting each call default to Date.now()
  // put a different timestamp in every cache key, so locations sharing a
  // station still fetched the same predictions separately.
  const start = Date.now()
  const end = start + FORECAST_DAYS * 86400000
  const [{ rows: hourly, fetchedAt: fetched }, marine, tides] = await Promise.all([
    fetchHourlyBatch(locs),
    fetchMarineBatch(locs),
    Promise.all(locs.map((l) => fetchTides(l, start, end, predCache))),
  ])
  return locs.map((l, i) =>
    hourly[i]
      ? { fetched, fetchedFor: forecastKey(l), hourly: hourly[i]!, marine: marine[i], tides: tides[i] }
      : null,
  )
}

export async function fetchForecast(loc: Location): Promise<Forecast> {
  const [{ hours, fetchedAt: fetched }, marine, tides] = await Promise.all([fetchHourly(loc), fetchMarine(loc), fetchTides(loc)])
  return { fetched, fetchedFor: forecastKey(loc), hourly: hours, marine, tides }
}

/**
 * Fetch weather covering a specific (recent) past date — used to backtest the
 * bite-score against a logged catch. Open-Meteo keeps ~92 days of past data.
 */
export async function fetchForecastForDate(loc: Location, date: Date): Promise<Forecast | null> {
  const dayMs = 86400000
  const startOfDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  // Today as a LOCAL calendar day, in the same encoding as the catch date (UTC
  // midnight of the local date parts). The UTC date lagged a day for the first
  // two hours after Danish midnight, so a catch logged at 00:30 counted as
  // tomorrow's and got no score.
  const todayStart = (() => { const n = new Date(); return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) })()
  const daysAgo = Math.round((todayStart - startOfDay) / dayMs)
  if (daysAgo < 0 || daysAgo > 92) return null // future or beyond the past-data window
  const pastDays = Math.min(92, daysAgo + 1)
  const [{ hours: hourly }, marine, tides] = await Promise.all([
    fetchHourly(loc, pastDays),
    fetchMarine(loc, pastDays),
    fetchTides(loc, startOfDay - dayMs, startOfDay + 2 * dayMs),
  ])
  return { fetched: Date.now(), hourly, marine, tides }
}

export interface GeoResult {
  name: string
  admin1: string
  lat: number
  lon: number
  country: string
}

export async function geocode(query: string, lang: string): Promise<GeoResult[]> {
  const res = await fetch(
    `${GEOCODING}?name=${encodeURIComponent(query)}&count=6&language=${lang}&format=json`,
  )
  const data = await res.json()
  return (data.results ?? []).map((r: any) => ({
    name: r.name,
    admin1: r.admin1 ?? '',
    lat: r.latitude,
    lon: r.longitude,
    country: r.country_code,
  }))
}
