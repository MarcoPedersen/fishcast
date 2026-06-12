import type { Forecast, HourData, Location, MarineHour } from './types'

const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast'
const MARINE_API = 'https://marine-api.open-meteo.com/v1/marine'
export const GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search'
export const FORECAST_DAYS = 7

async function fetchHourly(loc: Location): Promise<HourData[]> {
  const params = new URLSearchParams({
    latitude: String(loc.lat),
    longitude: String(loc.lon),
    hourly: 'temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,precipitation_probability,surface_pressure',
    wind_speed_unit: 'ms',
    forecast_days: String(FORECAST_DAYS),
    timezone: 'UTC',
  })
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

async function fetchMarine(loc: Location): Promise<MarineHour[] | null> {
  try {
    const params = new URLSearchParams({
      latitude: String(loc.lat),
      longitude: String(loc.lon),
      hourly: 'wave_height,wave_period',
      forecast_days: String(FORECAST_DAYS),
      timezone: 'UTC',
    })
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

export async function fetchForecast(loc: Location): Promise<Forecast> {
  const [hourly, marine] = await Promise.all([fetchHourly(loc), fetchMarine(loc)])
  return { fetched: Date.now(), hourly, marine }
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
