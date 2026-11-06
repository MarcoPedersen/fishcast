// Records fixture.json for the model check (model-spec §11.2) — run once:
//   node scripts/model-check/fetch.mjs
// 5 spots × 5 periods of 15 days in 2026 (day 1 is look-back only): the
// Open-Meteo historical-forecast and marine archive with the app's own
// variable lists, plus DMI's tide predictions for each coastal spot's nearest
// station. 2026, not 2025: DMI keeps predictions for the current calendar year
// only, and real predictions beat a synthetic sinusoid (Dragør's range is
// 11 cm, Kalundborg's 37 cm, Rønne's 3 cm). The fixture is committed, so the
// check never depends on these services again.
import fs from 'node:fs'

// Kept in step with weather.ts by hand: a script outside src can't import TS.
const WEATHER_VARS = 'temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,precipitation_probability,surface_pressure,weather_code,shortwave_radiation'
const MARINE_VARS = 'wave_height,wave_period,sea_surface_temperature'
const DMI = 'https://opendataapi.dmi.dk/v2/oceanObs/collections'

// Official spots by slug (the check takes species months and depth from
// DK_SPOTS); Kalundborg is the owner's own pin at the slipway, so custom.
// Tejn snaps its sea cell 13.8 km offshore (the SST snap rule); Arresø is a
// lake ~5 km from the Kattegat, which snaps to the sea beside it (the
// fresh-water rule, gate G6).
const SPOTS = [
  { id: 'dragor', slug: 'dragor-havn', lat: 55.5931, lon: 12.6720, waterType: 'brackish' },
  { id: 'ronne', slug: 'ronne-havn', lat: 55.1010, lon: 14.7070, waterType: 'brackish' },
  { id: 'tejn', slug: 'tejn-havn', lat: 55.2530, lon: 14.8340, waterType: 'brackish' },
  { id: 'kal', name: 'Slæbested (custom)', lat: 55.678, lon: 11.085, waterType: 'salt' },
  { id: 'arreso', slug: 'arreso', lat: 56.0002, lon: 12.0858, waterType: 'fresh' },
]
// Jan / Apr / Jul / Aug / Oct: four seasons, plus August for the
// January-vs-August makrel swing (critique R15).
const PERIODS = [
  ['2026-01-04', '2026-01-18'], ['2026-04-05', '2026-04-19'], ['2026-07-05', '2026-07-19'],
  ['2026-08-16', '2026-08-30'], ['2026-10-01', '2026-10-15'],
]

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url)
    if (res.ok) return res.json()
    if (attempt >= 3) throw new Error(`${res.status} ${url}`)
    await new Promise((r) => setTimeout(r, 2000 * attempt))
  }
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371, d1 = (lat2 - lat1) * Math.PI / 180, d2 = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(d1 / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(d2 / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

// The app's rule (weather.ts nearestStation): nearest Danish station within 120 km.
const stations = (await get(`${DMI}/tidewaterstation/items?limit=1000`)).features
  .filter((f) => f.properties.country === 'DNK')
  .map((f) => ({ id: f.properties.stationId, name: f.properties.name, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }))
for (const s of SPOTS) {
  if (s.waterType === 'fresh') continue
  const best = stations.map((st) => ({ ...st, dist: haversine(s.lat, s.lon, st.lat, st.lon) })).sort((a, b) => a.dist - b.dist)[0]
  if (best && best.dist <= 120) s.station = { id: best.id, name: best.name, distKm: Math.round(best.dist) }
}

const lat = SPOTS.map((s) => s.lat).join(','), lon = SPOTS.map((s) => s.lon).join(',')
const slim = (e) => ({ latitude: e.latitude, longitude: e.longitude, hourly: e.hourly })
const out = { recorded: new Date().toISOString().slice(0, 10), weatherVars: WEATHER_VARS, marineVars: MARINE_VARS, spots: SPOTS, periods: [] }
for (const [start, end] of PERIODS) {
  const wx = await get(`https://historical-forecast-api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${WEATHER_VARS}&wind_speed_unit=ms&timezone=UTC&start_date=${start}&end_date=${end}`)
  const ma = await get(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=${MARINE_VARS}&timezone=UTC&start_date=${start}&end_date=${end}`)
  // Predictions from a day before to a day after the period, as minutes after
  // t0 and values (DMI's grid has the odd duplicate and gap, so times are kept).
  const tides = {}
  const from = new Date(Date.parse(start + 'T00:00:00Z') - 86400000).toISOString()
  const to = new Date(Date.parse(end + 'T00:00:00Z') + 2 * 86400000).toISOString()
  for (const s of SPOTS) {
    if (!s.station || tides[s.station.id]) continue
    const byTime = new Map((await get(`${DMI}/tidewater/items?stationId=${s.station.id}&limit=10000&datetime=${from}/${to}`)).features
      .map((f) => [Date.parse(f.properties.predictionTime), f.properties.value]))
    const feats = [...byTime].sort((a, b) => a[0] - b[0])
    const t0 = feats[0][0]
    tides[s.station.id] = { t0, minutes: feats.map(([t]) => (t - t0) / 60000), values: feats.map(([, v]) => v) }
  }
  const nulls = (arr) => arr.filter((v) => v == null).length
  console.log(start, wx.map((e) => Object.entries(e.hourly).filter(([k]) => k !== 'time').map(([k, v]) => `${k}:${nulls(v)}`).filter((x) => !x.endsWith(':0')).join(' ') || 'wx complete'),
    ma.map((e, i) => `${SPOTS[i].id} cell ${haversine(SPOTS[i].lat, SPOTS[i].lon, e.latitude, e.longitude).toFixed(1)} km, sst nulls ${nulls(e.hourly.sea_surface_temperature)}`),
    Object.entries(tides).map(([id, t]) => `${id}:${t.values.length}`))
  out.periods.push({ start, end, wx: wx.map(slim), ma: ma.map(slim), tides })
}
fs.writeFileSync(new URL('./fixture.json', import.meta.url), JSON.stringify(out))
console.log('stations', SPOTS.map((s) => `${s.id} → ${s.station ? `${s.station.name} (${s.station.distKm} km)` : '—'}`).join(', '))
