// @vitest-environment vue-dom
/**
 * The Vejr & Bølger tab's safety box, as mounted: the real tab and stores on
 * the in-memory DOM, the network mocked. The box read the wind and waves
 * only. With DMI reporting a strike 6 km from the spot it said "✅ Båd:
 * Ideelt for lille båd", while the dashboard's tag for the same spot said
 * "⚡ 6 km — fisk ikke!". Nor did it say when lightning could not be checked,
 * which in a storm (DMI answering 429) is the likeliest state of all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'

vi.mock('@/lib/weather', async (orig) => {
  const real = await orig<typeof import('@/lib/weather')>()
  return { ...real, fetchForecast: vi.fn(), fetchForecasts: vi.fn(), fetchLightningStatus: vi.fn() }
})
vi.mock('@/lib/coastClient', () => ({ deriveCoast: vi.fn(() => new Promise(() => {})), terminate: vi.fn() }))

import { fetchLightningStatus, forecastKey, type FetchedForecast } from '@/lib/weather'
import { langReady, setLang } from '@/lib/i18n'
import { STRINGS } from '@/test/strings'
import type { HourData, LightningStatus, Location, MarineHour } from '@/lib/types'
import { useSetupStore } from '@/stores/setup'
import { useForecastStore } from '@/stores/forecast'
import ConditionsTab from './ConditionsTab.vue'

// Saturday 14 November 2026, 10:00 in Denmark.
const NOW = Date.UTC(2026, 10, 14, 9)
const H = 3600_000
// Hornbæk: a public place on the coast. Sand, so the calm day is "ideal" to wade.
const LOC: Location = { id: 'L0', name: 'Hornbæk', lat: 56.09027, lon: 12.45693, waterType: 'salt', bottomType: 'sand' }

/** A calm day: light wind, small waves. */
function calm(loc: Location): FetchedForecast {
  const hourly: HourData[] = []
  const marine: MarineHour[] = []
  for (let h = -24; h <= 48; h++) {
    const time = NOW + h * H
    hourly.push({ time, temp: 8, windMs: 2, windDir: 250, gustMs: 3, cloud: 50, precipPct: 0, pressure: 1015 })
    marine.push({ time, waveM: 0.1, wavePeriod: 4, sstC: 9 })
  }
  return { fetched: NOW, fetchedFor: forecastKey(loc), hourly, marine, tides: null }
}

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined

/** The tab for Hornbæk on a calm day, with this lightning reading. */
async function open(lightning?: LightningStatus): Promise<{ root: FakeNode; fc: ReturnType<typeof useForecastStore> }> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useSetupStore().locations = [{ ...LOC }]
  const fc = useForecastStore()
  fc.forecasts = { [LOC.id]: calm(LOC) }
  if (lightning) fc.lightning = { [LOC.id]: lightning }
  view = mount(ConditionsTab, (app) => { app.use(pinia); app.config.warnHandler = () => {} })
  await nextTick()
  return { root: view.root, fc }
}
const recs = (root: FakeNode) => root.byClass('rec').map((r) => r.textContent)
const lines = (root: FakeNode) => root.byClass('lgt').map((r) => r.textContent)

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  restoreDocument = installDocument()
  vi.stubGlobal('navigator', { onLine: true })
  localStorage.clear()
})
afterEach(() => {
  view?.unmount()
  view = undefined
  setLang('da')
  vi.unstubAllGlobals()
  vi.useRealTimers()
  restoreDocument()
})

describe('the safety box and lightning', () => {
  it('a calm day with no lightning: yes to every method, and no lightning line', async () => {
    const { root } = await open()
    expect(recs(root).every((r) => r.startsWith('✅'))).toBe(true)
    expect(lines(root)).toEqual([])
  })

  it('a strike 6 km away: the line the dashboard shows, and no to every method', async () => {
    const { root } = await open({ level: 'danger', closestKm: 6 })
    expect(lines(root)).toEqual([`⚡ 6 km — ${STRINGS.da.lgt_danger}`])
    expect(recs(root)).toEqual([
      `🚫 ${STRINGS.da.sm_boat}: ${STRINGS.da.rec_lightning_no}`,
      `🚫 ${STRINGS.da.sm_shore}: ${STRINGS.da.rec_lightning_no}`,
      `🚫 ${STRINGS.da.sm_wader}: ${STRINGS.da.rec_lightning_no}`,
    ])
  })

  it('a strike 18 km away: take care with every method', async () => {
    const { root } = await open({ level: 'warning', closestKm: 18 })
    expect(lines(root)).toEqual([`⚡ 18 km — ${STRINGS.da.lgt_warning}`])
    expect(recs(root).every((r) => r.startsWith('⚠️') && r.endsWith(STRINGS.da.rec_lightning_caution))).toBe(true)
  })

  it('a strike 40 km away: the line says keep watch, and the verdicts stand', async () => {
    const { root } = await open({ level: 'caution', closestKm: 40 })
    expect(lines(root)).toEqual([`⚡ 40 km — ${STRINGS.da.lgt_caution}`])
    expect(recs(root).every((r) => r.startsWith('✅'))).toBe(true)
  })

  it('in English once English is shown', async () => {
    const { root } = await open({ level: 'danger', closestKm: 6 })
    setLang('en')
    expect(await langReady()).toBe(true)
    await nextTick()
    expect(lines(root)).toEqual([`⚡ 6 km — ${STRINGS.en.lgt_danger}`])
    expect(recs(root)[0]).toBe(`🚫 ${STRINGS.en.sm_boat}: ${STRINGS.en.rec_lightning_no}`)
  })

  // As the dashboard's "⚡ lyn ikke tjekket" tag: unknown, not clear.
  it('a lightning check that failed says so, and the verdicts stand', async () => {
    vi.mocked(fetchLightningStatus).mockRejectedValue(new Error('lightning 429'))
    const { root, fc } = await open()
    await fc.refreshLightning([{ ...LOC }])
    await nextTick()
    expect(lines(root)).toEqual([`⚡ ${STRINGS.da.lgt_unchecked}`])
    expect(recs(root).every((r) => r.startsWith('✅'))).toBe(true)
  })
})

/**
 * Round L's sweep: an hour with no temperature, wind or pressure printed the
 * unit with nothing before it ("Temperatur°C", "Vind m/s –", "Vindstød m/s",
 * "Lufttryk hPa"). A missing reading reads "–", as the wind direction does.
 */
describe('a reading missing at this hour', () => {
  /** The four readings' cells, label and value. */
  const cells = (root: FakeNode) => root.byClass('cell').slice(0, 4)
    .map((c) => [c.byClass('k')[0].textContent, c.byClass('v')[0].textContent.replace(/\s+/g, ' ').trim()])

  it('reads "–", with no unit', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useSetupStore().locations = [{ ...LOC }]
    const fc = useForecastStore()
    const f = calm(LOC)
    fc.forecasts = {
      [LOC.id]: { ...f, hourly: f.hourly.map((h) => ({ ...h, temp: null, windMs: null, windDir: null, gustMs: null, pressure: null })) },
    }
    view = mount(ConditionsTab, (app) => { app.use(pinia); app.config.warnHandler = () => {} })
    await nextTick()
    expect(cells(view.root)).toEqual([
      [`🌡️ ${STRINGS.da.cond_temp}`, '–'],
      [`💨 ${STRINGS.da.cond_wind}`, '–'],
      [`🌬️ ${STRINGS.da.cond_gust}`, '–'],
      [`🧭 ${STRINGS.da.cond_pressure}`, '–'],
    ])
  })

  it('a reading there is keeps its unit', async () => {
    const { root } = await open()
    expect(cells(root)).toEqual([
      [`🌡️ ${STRINGS.da.cond_temp}`, '8°C'],
      [`💨 ${STRINGS.da.cond_wind}`, '2,0 m/s VSV'],
      [`🌬️ ${STRINGS.da.cond_gust}`, '3,0 m/s'],
      [`🧭 ${STRINGS.da.cond_pressure}`, '1015 hPa →'],
    ])
  })
})

/**
 * The Danish tab wrote its decimals with a full stop: "2.0 m/s", "0.25 m",
 * "9.4 °C". Each reading is written as the language shown writes it, and
 * written again when the language changes with the tab open.
 */
describe('the readings’ decimals', () => {
  /** A day with a reading in every decimal the tab shows, and a tide. */
  function rough(loc: Location): FetchedForecast {
    const f = calm(loc)
    return {
      ...f,
      hourly: f.hourly.map((h) => ({ ...h, temp: 8.4, windMs: 6.2, gustMs: 9.5 })),
      marine: f.marine!.map((m) => ({ ...m, waveM: 0.25, wavePeriod: 4.5, sstC: 9.4 })),
      // Rising 0.10 m an hour: 0.45 m at the tab's hour.
      tides: { stationName: 'Hornbæk Havn', distKm: 3, predictions: [-1, 0, 1, 2].map((k) => ({ time: NOW + k * H, value: 0.45 + 0.1 * k })) },
    }
  }
  async function openRough(): Promise<FakeNode> {
    const pinia = createPinia()
    setActivePinia(pinia)
    useSetupStore().locations = [{ ...LOC }]
    useForecastStore().forecasts = { [LOC.id]: rough(LOC) }
    view = mount(ConditionsTab, (app) => { app.use(pinia); app.config.warnHandler = () => {} })
    await nextTick()
    return view.root
  }
  /** Every cell's value, the Beaufort line and the wave bars' titles. */
  const shown = (root: FakeNode) => ({
    cells: root.byClass('cell').map((c) => c.byClass('v')[0].textContent.replace(/\s+/g, ' ').trim()),
    beaufort: root.byClass('beaufort')[0].textContent.split(' · ')[0],
    bars: [...new Set(root.byClass('bar').map((b) => String(b.attrs.title)))],
  })
  // The whole numbers stay whole: 8.4 °C in the air is "8°C", as before.
  const inDanish = {
    cells: ['8°C', '6,2 m/s VSV', '9,5 m/s', '1015 hPa →', '50%', '0%', '0,25 m', '4,5 s', '9,4 °C',
      `${STRINGS.da.tide_rising_word} 0,45 m`, 'Hornbæk Havn (3 km)'],
    beaufort: '💨 6,2 m/s',
    bars: ['0,25 m'],
  }

  it('in Danish with a decimal comma', async () => {
    expect(shown(await openRough())).toEqual(inDanish)
  })

  it('in English with a decimal point once English is shown, and in Danish again after a switch back', async () => {
    const root = await openRough()
    setLang('en')
    expect(await langReady()).toBe(true)
    await nextTick()
    expect(shown(root)).toEqual({
      cells: ['8°C', '6.2 m/s WSW', '9.5 m/s', '1015 hPa →', '50%', '0%', '0.25 m', '4.5 s', '9.4 °C',
        `${STRINGS.en.tide_rising_word} 0.45 m`, 'Hornbæk Havn (3 km)'],
      beaufort: '💨 6.2 m/s',
      bars: ['0.25 m'],
    })
    setLang('da')
    await nextTick()
    expect(shown(root)).toEqual(inDanish)
  })
})

/**
 * The tab reads the hour's weather and its verdicts from the cached forecast,
 * kept up to 48 h when a refetch fails. Nothing said how old it was: the
 * Tidsvinduer tab says "1 plads har ældre data", this one said nothing at
 * all. A spot's weather older than the app's refetch age (FRESH_MS, 3 h) says
 * when it was fetched.
 */
describe('the age of a spot’s weather', () => {
  async function openAged(ageMs: number): Promise<FakeNode> {
    const pinia = createPinia()
    setActivePinia(pinia)
    useSetupStore().locations = [{ ...LOC }]
    useForecastStore().forecasts = { [LOC.id]: { ...calm(LOC), fetched: NOW - ageMs } }
    view = mount(ConditionsTab, (app) => { app.use(pinia); app.config.warnHandler = () => {} })
    await nextTick()
    return view.root
  }
  const age = (root: FakeNode) => root.byClass('age').map((a) => a.textContent)
  // After the spot's name: "📍 Hornbæk · Opdateret 3 t. siden".
  const said = (lang: 'da' | 'en', hours: number) =>
    `· ${STRINGS[lang].updated_prefix} ${hours} ${STRINGS[lang].time_hr_ago}`

  it('nothing while it is fresh', async () => {
    expect(age(await openAged(2 * H + 59 * 60_000))).toEqual([])
  })

  it('from 3 h old, how old, and it keeps counting', async () => {
    const root = await openAged(3 * H)
    expect(age(root)).toEqual([said('da', 3)])
    await vi.advanceTimersByTimeAsync(2 * H)
    await nextTick()
    expect(age(root)).toEqual([said('da', 5)])
  })

  it('in English once English is shown', async () => {
    const root = await openAged(20 * H)
    setLang('en')
    expect(await langReady()).toBe(true)
    await nextTick()
    expect(age(root)).toEqual([said('en', 20)])
  })
})
