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

async function fetchHourly(loc: Location, pastDays = 0): Promise<HourData[]> {
  const params = new URLSearchParams({
    latitude: String(loc.lat),
    longitude: String(loc.lon),
    hourly: 'temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,precipitation_probability,surface_pressure',
    wind_speed_unit: 'ms',
    // For a past date we still need a little forward context (pressure/wind trend
    // look back 3h); 1 forecast day is enough alongside the past window.
    forecast_days: pastDays > 0 ? '1' : String(FORECAST_DAYS),
    timezone: 'UTC',
  })
  if (pastDays > 0) params.set('past_days', String(pastDays))
  const res = await fetch(`${OPEN_METEO}?${params}`)
  if (!res.ok) throw new Error(`weather ${res.status}`)
  const data = await res.json()
  const h = data.hourly
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

async function fetchMarine(loc: Location, pastDays = 0): Promise<MarineHour[] | null> {
  try {
    const params = new URLSearchParams({
      latitude: String(loc.lat),
      longitude: String(loc.lon),
      hourly: 'wave_height,wave_period',
      forecast_days: pastDays > 0 ? '1' : String(FORECAST_DAYS),
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
let tideStationCache: TideStation[] | null = null

async function fetchTideStations(): Promise<TideStation[]> {
  if (tideStationCache) return tideStationCache
  try {
    const res = await fetch(`${DMI_TIDE_STN}?limit=100`)
    const data = await res.json()
    tideStationCache = (data.features || [])
      .filter((f: any) => f.properties?.country === 'DNK')
      .map((f: any) => ({
        id: f.properties.stationId, name: f.properties.name,
        lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
      }))
    return tideStationCache!
  } catch {
    return []
  }
}

async function fetchTides(loc: Location, startMs?: number, endMs?: number): Promise<TideData | null> {
  if (loc.waterType === 'fresh') return null
  try {
    const stations = await fetchTideStations()
    if (!stations.length) return null
    let nearest: (TideStation & { dist: number }) | null = null
    for (const s of stations) {
      const dist = haversine(loc.lat, loc.lon, s.lat, s.lon)
      if (!nearest || dist < nearest.dist) nearest = { ...s, dist }
    }
    if (!nearest || nearest.dist > 120) return null
    const start = new Date(startMs ?? Date.now())
    const end = new Date(endMs ?? start.getTime() + FORECAST_DAYS * 86400000)
    const url = `${DMI_TIDES}?stationId=${nearest.id}&limit=1500&datetime=${start.toISOString()}/${end.toISOString()}`
    const res = await fetch(url)
    const data = await res.json()
    const predictions = (data.features || [])
      .map((f: any) => ({ time: new Date(f.properties.predictionTime).getTime(), value: f.properties.value }))
      .sort((a: any, b: any) => a.time - b.time)
    return { stationName: nearest.name, distKm: Math.round(nearest.dist), predictions }
  } catch {
    return null
  }
}

// ── DMI lightning (last 45 min within ~80 km) ────────────────
export async function fetchLightningStatus(loc: Location): Promise<LightningStatus> {
  try {
    const pad = 0.8
    const bbox = `${loc.lon - pad},${loc.lat - pad},${loc.lon + pad},${loc.lat + pad}`
    const now = new Date()
    const ago = new Date(now.getTime() - 45 * 60000)
    const url = `${DMI_LIGHTNING}?limit=200&bbox=${bbox}&datetime=${ago.toISOString()}/${now.toISOString()}`
    const res = await fetch(url)
    const data = await res.json()
    const strikes = (data.features || []).map((f: any) => ({
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
  } catch {
    return { level: 'clear', closestKm: null }
  }
}

export async function fetchForecast(loc: Location): Promise<Forecast> {
  const [hourly, marine, tides] = await Promise.all([fetchHourly(loc), fetchMarine(loc), fetchTides(loc)])
  return { fetched: Date.now(), hourly, marine, tides }
}

/**
 * Fetch weather covering a specific (recent) past date — used to backtest the
 * bite-score against a logged catch. Open-Meteo keeps ~92 days of past data.
 */
export async function fetchForecastForDate(loc: Location, date: Date): Promise<Forecast | null> {
  const dayMs = 86400000
  const startOfDay = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  const todayStart = (() => { const n = new Date(); return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()) })()
  const daysAgo = Math.round((todayStart - startOfDay) / dayMs)
  if (daysAgo < 0 || daysAgo > 92) return null // future or beyond the past-data window
  const pastDays = Math.min(92, daysAgo + 1)
  const [hourly, marine, tides] = await Promise.all([
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
