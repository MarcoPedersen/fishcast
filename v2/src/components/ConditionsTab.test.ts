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
      [`💨 ${STRINGS.da.cond_wind}`, '2.0 m/s VSV'],
      [`🌬️ ${STRINGS.da.cond_gust}`, '3.0 m/s'],
      [`🧭 ${STRINGS.da.cond_pressure}`, '1015 hPa →'],
    ])
  })
})
