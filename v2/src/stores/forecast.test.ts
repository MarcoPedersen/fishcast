import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { computed, isReactive, watch } from 'vue'
import type { Forecast, LightningStatus, Location } from '@/lib/types'

// The store's network layer is stubbed per test; forecastKey stays real so the
// "what was this fetched for" checks run against the actual key.
vi.mock('@/lib/weather', async (orig) => {
  const real = await orig<typeof import('@/lib/weather')>()
  return { ...real, fetchForecast: vi.fn(), fetchForecasts: vi.fn(), fetchLightningStatus: vi.fn() }
})
vi.mock('@/lib/toast', () => ({ showToast: vi.fn(), dismissToast: vi.fn() }))
vi.mock('@/lib/officialCache', () => ({ clearOfficialForecasts: vi.fn() }))

import { fetchForecast, fetchForecasts, fetchLightningStatus, forecastKey } from '@/lib/weather'
import { STRINGS } from '@/test/strings'
import { langReady, setLang } from '@/lib/i18n'
import { dismissToast, showToast } from '@/lib/toast'
import { clearOfficialForecasts } from '@/lib/officialCache'
import { useForecastStore } from './forecast'

const LS_KEY = 'fc2-forecasts'
const H = 3600_000
const T0 = Date.UTC(2026, 5, 15, 12)

const loc = (id: string, waterType: Location['waterType'] = 'salt', lat = 56, lon = 12): Location =>
  ({ id, name: id, lat, lon, waterType })
const forecastFor = (l: Location, fetched = Date.now()): Forecast =>
  ({ fetched, fetchedFor: forecastKey(l), hourly: [], marine: null, tides: null })

const mFetchForecasts = vi.mocked(fetchForecasts)
const mFetchForecast = vi.mocked(fetchForecast)
const mLightning = vi.mocked(fetchLightningStatus)
const mToast = vi.mocked(showToast)

/** The locations each fetchForecasts call asked for, by id. */
const batchedIds = () => mFetchForecasts.mock.calls.map(([locs]) => locs.map((l) => l.id))

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  localStorage.clear()
  vi.clearAllMocks()
  mFetchForecasts.mockImplementation(async (locs) => locs.map((l) => forecastFor(l)))
  mFetchForecast.mockImplementation(async (l) => forecastFor(l))
  mLightning.mockResolvedValue({ level: 'clear', closestKm: null })
  setActivePinia(createPinia())
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('forecast cache (localStorage)', () => {
  const seed = (entries: Record<string, Forecast>) => localStorage.setItem(LS_KEY, JSON.stringify(entries))

  // An evening forecast is still the best thing available at a signal-less
  // dawn spot. Dropping everything over 3 h on load gave 18 "data missing"
  // cards there; the refetch rule (isFresh) is what should stay at 3 h.
  it('keeps entries up to 48 h old for offline starts, and still refetches anything over 3 h', async () => {
    const a = loc('a'), b = loc('b'), c = loc('c')
    seed({ a: forecastFor(a, T0 - 4 * H), b: forecastFor(b, T0 - 1 * H), c: forecastFor(c, T0 - 49 * H) })
    const fc = useForecastStore()
    expect(Object.keys(fc.forecasts).sort()).toEqual(['a', 'b'])
    await fc.fetchAll([a, b, c])
    expect(batchedIds()).toEqual([['a', 'c']])
  })

  it('treats a corrupt cache as empty', () => {
    localStorage.setItem(LS_KEY, '{not json')
    expect(useForecastStore().forecasts).toEqual({})
  })

  it('writes fetched forecasts back after the debounce', async () => {
    const fc = useForecastStore()
    await fc.fetchAll([loc('a')])
    await vi.advanceTimersByTimeAsync(1000)
    expect(Object.keys(JSON.parse(localStorage.getItem(LS_KEY)!))).toEqual(['a'])
  })
})

// A forecast is data, never edited in place: it is only ever replaced whole.
// Held deeply reactive, every read of its ~200 hours and ~1,200 tide points
// went through a Vue proxy, so scoring 18 spots took ~2.7 s inside the
// dashboard's computed instead of ~50 ms — twice per load (the dashboard and
// the reminder scheduler), freezing the app for ~5 s on the owner's setup.
describe('forecasts are held raw, the map stays reactive', () => {
  it('a cached forecast is not wrapped in a reactive proxy', () => {
    const a = loc('a')
    localStorage.setItem(LS_KEY, JSON.stringify({ a: forecastFor(a, T0 - H) }))
    const fc = useForecastStore()
    expect(isReactive(fc.forecasts)).toBe(true)
    expect(isReactive(fc.forecasts.a)).toBe(false)
  })

  it('a fetched forecast is not wrapped either', async () => {
    const fc = useForecastStore()
    await fc.fetchAll([loc('a')])
    expect(isReactive(fc.forecasts.a)).toBe(false)
  })

  it("replacing a spot's forecast still notifies watchers", async () => {
    const a = loc('a')
    const fc = useForecastStore()
    await fc.fetchAll([a])
    const seen: number[] = []
    watch(() => fc.forecasts.a, (f) => { if (f) seen.push(f.fetched) })
    mFetchForecasts.mockImplementation(async (locs) => locs.map((l) => forecastFor(l, Date.now() + 1)))
    await fc.fetchAll([a], { force: true })
    await vi.advanceTimersByTimeAsync(0)
    expect(seen).toEqual([T0 + 1])
  })
})

describe('clearWeather', () => {
  // "🗑 Ryd vejrdata" emptied this store, but the map compare keeps its own
  // module-level cache of official-spot forecasts, which outlived the wipe and
  // kept serving the old weather for up to 3 h.
  it('also forgets the official-spot forecasts the map compare cached', async () => {
    const fc = useForecastStore()
    await fc.fetchAll([loc('a')])
    await vi.advanceTimersByTimeAsync(1000)
    fc.clearWeather()
    expect(fc.forecasts).toEqual({})
    expect(localStorage.getItem(LS_KEY)).toBeNull()
    expect(clearOfficialForecasts).toHaveBeenCalledOnce()
  })
})

describe('isFresh — what a forecast was fetched for', () => {
  // A spot detected as fresh water is fetched without tides. Correcting it to
  // salt left it tide-less for up to 3 h (and salt→fresh kept the tide points).
  it('refetches a young forecast once the spot is switched from fresh to salt', async () => {
    const lake = loc('a', 'fresh')
    const fc = useForecastStore()
    await fc.fetchAll([lake])
    const nowSalt = { ...lake, waterType: 'salt' as const }
    expect(fc.isFresh(nowSalt)).toBe(false)
    await fc.fetchAll([nowSalt])
    expect(batchedIds()).toEqual([['a'], ['a']])
  })

  it('refetches when the spot has moved', async () => {
    const fc = useForecastStore()
    await fc.fetchAll([loc('a')])
    await fc.fetchAll([loc('a', 'salt', 56.2, 12)])
    expect(batchedIds()).toHaveLength(2)
  })

  it('does not refetch a young forecast for an unchanged spot', async () => {
    const fc = useForecastStore()
    await fc.fetchAll([loc('a', 'brackish')])
    await fc.fetchAll([loc('a', 'brackish')])
    expect(batchedIds()).toHaveLength(1)
  })

  // A DMI blip at app open: the weather landed but the tides didn't. Counted
  // as fresh for 3 h, every coastal spot went without its tide factor for the
  // whole planning session.
  it('retries a forecast whose tide request failed after 15 min, not 3 h', async () => {
    const a = loc('a')
    mFetchForecasts.mockImplementationOnce(async (locs) => locs.map((l) => ({ ...forecastFor(l), tidesFailed: true })))
    const fc = useForecastStore()
    await fc.fetchAll([a])
    vi.setSystemTime(T0 + 10 * 60_000)
    expect(fc.isFresh(a)).toBe(true)
    await fc.fetchAll([a])
    expect(batchedIds()).toHaveLength(1)
    vi.setSystemTime(T0 + 16 * 60_000)
    expect(fc.isFresh(a)).toBe(false)
    await fc.fetchAll([a])
    expect(batchedIds()).toHaveLength(2)
    expect(fc.isFresh(a)).toBe(true) // that one got its tides: 3 h again
  })

  // The same for the marine request: a 503 or a timeout during "Update all"
  // was held as a good forecast without waves for 3 h, across reloads too.
  it('retries a forecast whose marine request failed after 15 min, not 3 h', async () => {
    const a = loc('a')
    mFetchForecasts.mockImplementationOnce(async (locs) => locs.map((l) => ({ ...forecastFor(l), marineFailed: true })))
    const fc = useForecastStore()
    await fc.fetchAll([a])
    vi.setSystemTime(T0 + 10 * 60_000)
    expect(fc.isFresh(a)).toBe(true)
    vi.setSystemTime(T0 + 16 * 60_000)
    expect(fc.isFresh(a)).toBe(false)
    await fc.fetchAll([a])
    expect(batchedIds()).toHaveLength(2)
    expect(fc.isFresh(a)).toBe(true)
  })

  // A forecast asks DMI for tides up to 03:00 after the 7th day of the day it
  // was fetched (weather.ts tideSpan). Fetched at 23:30, after midnight the
  // list's new 7th day had no tides: its coastal windows lost up to 12 points
  // with nothing changed, while the 3 h rule still called the forecast fresh.
  it('a forecast fetched before local midnight is not fresh after it', async () => {
    vi.setSystemTime(new Date(2026, 10, 6, 23, 30))
    const a = loc('a')
    const fc = useForecastStore()
    await fc.fetchAll([a])
    vi.setSystemTime(new Date(2026, 10, 6, 23, 59))
    expect(fc.isFresh(a)).toBe(true)
    vi.setSystemTime(new Date(2026, 10, 7, 0, 30))
    expect(fc.isFresh(a)).toBe(false)
    await fc.fetchAll([a])
    expect(batchedIds()).toHaveLength(2)
    expect(fc.isFresh(a)).toBe(true)
  })

  /**
   * Integration: Open-Meteo counts its days from the UTC date (weather.ts
   * OPEN_METEO_DAYS), which turns at 01:00/02:00 here. The midnight refetch
   * ran before it, so its last hour was 00:00 after the 7th day, and that
   * day's 22:00–06:00 window (scored over every hour since refine/windows)
   * had 3 of its 8 hours — 43 instead of 51 — while the 3 h rule called the
   * forecast fresh until 03:05.
   */
  it('a forecast fetched before the UTC date turns is not fresh after it', async () => {
    vi.setSystemTime(new Date(2026, 10, 7, 0, 5)) // 23:05 UTC on 6 Nov
    const a = loc('a')
    const fc = useForecastStore()
    await fc.fetchAll([a])
    vi.setSystemTime(new Date(2026, 10, 7, 0, 55))
    expect(fc.isFresh(a)).toBe(true)
    vi.setSystemTime(new Date(2026, 10, 7, 1, 5)) // 00:05 UTC on 7 Nov
    expect(fc.isFresh(a)).toBe(false)
    // A tab left open refetches at that moment, as at local midnight.
    const app = Object.values(import.meta.glob<string>('/src/App.vue', { query: '?raw', import: 'default', eager: true }))[0]
    expect(app).toMatch(/watch\(\[today, utcDay\], \(\) => \{ if \(!document\.hidden\) refreshOnResume\('toast_refreshing_stale'\) \}\)/)
  })

  it('also after a reload, from the cached copy', async () => {
    const a = loc('a')
    localStorage.setItem(LS_KEY, JSON.stringify({ a: { ...forecastFor(a, T0 - 20 * 60_000), tidesFailed: true } }))
    const fc = useForecastStore()
    await fc.fetchAll([a])
    expect(batchedIds()).toEqual([['a']])
  })

  it('refetches a cached entry from before the key existed', async () => {
    const a = loc('a')
    const { fetchedFor: _, ...old } = forecastFor(a, T0 - H)
    localStorage.setItem(LS_KEY, JSON.stringify({ a: old }))
    const fc = useForecastStore()
    await fc.fetchAll([a])
    expect(batchedIds()).toEqual([['a']])
  })

  // A lake forecast cached half an hour before the update still held the sea
  // waves the old marineRows gave it: boat 'Bliv i land' and '🌊 Høj sø' on its
  // windows until the next refetch, up to 3 h later. Its key (version 2) must
  // stop matching.
  it('refetches a forecast cached before lakes stopped taking sea waves', async () => {
    const lake = loc('a', 'fresh')
    const marine = [{ time: T0, waveM: 1.5, wavePeriod: 5, sstC: null }]
    localStorage.setItem(LS_KEY, JSON.stringify({
      a: { ...forecastFor(lake, T0 - 30 * 60_000), fetchedFor: '56,12,fresh,v2', marine },
    }))
    const fc = useForecastStore()
    expect(fc.isFresh(lake)).toBe(false)
    await fc.fetchAll([lake])
    expect(batchedIds()).toEqual([['a']])
  })
})

describe('fetchAll — older answers', () => {
  // After a network failure the service worker can answer with a cached batch,
  // which keeps its real (older) fetch time. It must not replace a newer
  // forecast this device already holds.
  it('keeps a newer forecast over an older copy for the same spot', async () => {
    const a = loc('a'), b = loc('b')
    localStorage.setItem(LS_KEY, JSON.stringify({ a: forecastFor(a, T0 - 3.5 * H) }))
    mFetchForecasts.mockImplementationOnce(async (locs) => locs.map((l) => forecastFor(l, T0 - 5 * H)))
    const fc = useForecastStore()
    await fc.fetchAll([a, b])
    expect(fc.forecasts.a.fetched).toBe(T0 - 3.5 * H)
    expect(fc.forecasts.b.fetched).toBe(T0 - 5 * H)
    expect(fc.status).toEqual({ a: 'ok', b: 'ok' })
  })

  // Tide predictions are astronomical: hours-old ones still hold for the hours
  // they cover. A refetch whose tide request failed must not throw them away.
  it('a refetch whose tides failed keeps the tides the spot already had', async () => {
    const a = loc('a')
    const tides = { stationName: 'Hornbæk', distKm: 4, predictions: [{ time: T0, value: 10 }] }
    localStorage.setItem(LS_KEY, JSON.stringify({ a: { ...forecastFor(a, T0 - 4 * H), tides } }))
    mFetchForecasts.mockImplementationOnce(async (locs) => locs.map((l) => ({ ...forecastFor(l), tidesFailed: true })))
    const fc = useForecastStore()
    await fc.fetchAll([a])
    expect(fc.forecasts.a.fetched).toBe(T0)
    expect(fc.forecasts.a.tides).toEqual(tides)
    expect(fc.isFresh(a)).toBe(true)
    vi.setSystemTime(T0 + 16 * 60_000)
    expect(fc.isFresh(a)).toBe(false) // still retried, to extend them
  })

  // Wave forecasts from a few hours back still describe the coming days far
  // better than nothing: a marine blip on a refetch must not wipe them.
  it('a refetch whose marine request failed keeps the waves the spot already had', async () => {
    const a = loc('a')
    const marine = [{ time: T0, waveM: 1.8, wavePeriod: 6, sstC: 14 }]
    localStorage.setItem(LS_KEY, JSON.stringify({ a: { ...forecastFor(a, T0 - 4 * H), marine } }))
    mFetchForecasts.mockImplementationOnce(async (locs) => locs.map((l) => ({ ...forecastFor(l), marineFailed: true })))
    const fc = useForecastStore()
    await fc.fetchAll([a])
    expect(fc.forecasts.a.fetched).toBe(T0)
    expect(fc.forecasts.a.marine).toEqual(marine)
    expect(fc.wavesNotLoaded(a)).toBe(false) // scored with those
    vi.setSystemTime(T0 + 16 * 60_000)
    expect(fc.isFresh(a)).toBe(false) // still retried
  })

  // With nothing from before to keep (first load, after 'Ryd vejrdata', a spot
  // added during the outage), a sea spot's windows scored with no wave row: 35
  // instead of 7 in a 1.8 m swell, and nothing on the card said the waves were
  // missing. The dashboard tags its windows while this holds.
  it('a sea spot whose marine request failed with no waves from before has its waves not loaded', async () => {
    const a = loc('a')
    mFetchForecasts.mockImplementationOnce(async (locs) =>
      locs.map((l) => ({ ...forecastFor(l), marine: null, marineFailed: true })))
    const fc = useForecastStore()
    await fc.fetchAll([a])
    expect(fc.wavesNotLoaded(a)).toBe(true)
    vi.setSystemTime(T0 + 16 * 60_000)
    const marine = [{ time: T0, waveM: 1.8, wavePeriod: 6, sstC: 14 }]
    mFetchForecasts.mockImplementationOnce(async (locs) => locs.map((l) => ({ ...forecastFor(l), marine })))
    await fc.fetchAll([a])
    expect(fc.wavesNotLoaded(a)).toBe(false) // the retry brought them
  })

  /**
   * Integration: the marine request also brings the sea temperature, and
   * without it every visitor (makrel, hornfisk, fjæsing) counts as present
   * whatever the water — the fjæsing gate below ~10 °C included. A January
   * coast window scored 41 with its 3.6 °C and 50 without, and the tag said
   * only that it was scored without waves.
   */
  it('…and the tag says the sea temperature is missing too', () => {
    expect(STRINGS.da.waves_not_loaded).toMatch(/havtemperatur/)
    expect(STRINGS.da.waves_not_loaded_hint).toMatch(/uden bølger og havtemperatur/)
    expect(STRINGS.en.waves_not_loaded).toMatch(/sea temperature/)
    expect(STRINGS.en.waves_not_loaded_hint).toMatch(/without waves or sea temperature/)
  })

  it('…never for a lake, a spot with no forecast, or a marine answer that merely has no waves', async () => {
    const lake = loc('l', 'fresh'), sea = loc('s')
    mFetchForecasts.mockImplementationOnce(async (locs) => locs.map((l) => forecastFor(l)))
    const fc = useForecastStore()
    expect(fc.wavesNotLoaded(sea)).toBe(false)
    await fc.fetchAll([lake, sea])
    expect(fc.wavesNotLoaded(lake)).toBe(false)
    expect(fc.wavesNotLoaded(sea)).toBe(false)
  })

  it('…but not tides fetched for the spot before it moved', async () => {
    const tides = { stationName: 'Hornbæk', distKm: 4, predictions: [{ time: T0, value: 10 }] }
    localStorage.setItem(LS_KEY, JSON.stringify({ a: { ...forecastFor(loc('a'), T0 - 4 * H), tides } }))
    mFetchForecasts.mockImplementationOnce(async (locs) => locs.map((l) => ({ ...forecastFor(l), tidesFailed: true })))
    const fc = useForecastStore()
    await fc.fetchAll([loc('a', 'salt', 56.5, 11)])
    expect(fc.forecasts.a.tides).toBeNull()
  })

  it('still takes an older answer that was fetched for the spot as it is now', async () => {
    const lake = loc('a', 'fresh')
    localStorage.setItem(LS_KEY, JSON.stringify({ a: forecastFor(lake, T0 - 1 * H) }))
    const nowSalt = loc('a', 'salt')
    mFetchForecasts.mockImplementationOnce(async (locs) => locs.map((l) => forecastFor(l, T0 - 2 * H)))
    const fc = useForecastStore()
    await fc.fetchAll([nowSalt])
    expect(fc.forecasts.a.fetchedFor).toBe(forecastKey(nowSalt))
  })
})

describe('fetchAll — overlapping refreshes', () => {
  // A cold start runs App's and the dashboard's fetchAll back to back; a focus
  // refresh can land mid-batch too. Each used to fetch the whole set again.
  it('skips locations whose fetch is already in flight', async () => {
    const d = deferred<(Forecast | null)[]>()
    mFetchForecasts.mockImplementationOnce(() => d.promise)
    const fc = useForecastStore()
    const a = loc('a'), b = loc('b')
    const first = fc.fetchAll([a, b])
    await fc.fetchAll([a, b])
    expect(mFetchForecasts).toHaveBeenCalledTimes(1)
    d.resolve([forecastFor(a), forecastFor(b)])
    await first
    expect(fc.status).toEqual({ a: 'ok', b: 'ok' })
  })

  it('keeps showing progress until the last overlapping batch is done', async () => {
    const da = deferred<(Forecast | null)[]>()
    const db = deferred<(Forecast | null)[]>()
    mFetchForecasts.mockImplementationOnce(() => da.promise).mockImplementationOnce(() => db.promise)
    const fc = useForecastStore()
    const a = loc('a'), b = loc('b')
    const pa = fc.fetchAll([a])
    const pb = fc.fetchAll([b])
    expect(fc.progress).toEqual({ done: 0, total: 2 })
    db.resolve([forecastFor(b)])
    await pb
    expect(fc.progress.total).toBe(2) // a is still loading — the bar must not vanish
    da.resolve([forecastFor(a)])
    await pa
    expect(fc.progress).toEqual({ done: 0, total: 0 })
  })
})

describe('fetchAll — failures', () => {
  // Offline, every location used to run its own three attempts and toast on
  // its own: ~18 s of retries and a screen-high stack of identical toasts.
  it('offline: marks the stale locations failed and says so once, without trying', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const fc = useForecastStore()
    await fc.fetchAll([loc('a'), loc('b'), loc('c')])
    expect(mFetchForecasts).not.toHaveBeenCalled()
    expect(mFetchForecast).not.toHaveBeenCalled()
    expect(fc.status).toEqual({ a: 'error', b: 'error', c: 'error' })
    expect(mToast).toHaveBeenCalledTimes(1)
  })

  it('offline: an older cached forecast stays on screen', async () => {
    const a = loc('a')
    localStorage.setItem(LS_KEY, JSON.stringify({ a: forecastFor(a, T0 - 8 * H) }))
    vi.stubGlobal('navigator', { onLine: false })
    const fc = useForecastStore()
    await fc.fetchAll([a])
    expect(fc.forecasts.a.fetched).toBe(T0 - 8 * H)
  })

  it('a failed batch falls back per location and reports the failures in one toast', async () => {
    mFetchForecasts.mockRejectedValue(new TypeError('Failed to fetch'))
    mFetchForecast.mockRejectedValue(new TypeError('Failed to fetch'))
    const fc = useForecastStore()
    const done = fc.fetchAll([loc('a'), loc('b'), loc('c'), loc('d')])
    await vi.runAllTimersAsync()
    await done
    expect(mFetchForecast).toHaveBeenCalledTimes(4 * 3) // each location still gets its retries
    expect(fc.status).toEqual({ a: 'error', b: 'error', c: 'error', d: 'error' })
    expect(mToast).toHaveBeenCalledTimes(1)
    // …whose Retry covers every failed location in one batch.
    const action = mToast.mock.calls[0][1]?.action
    mFetchForecasts.mockImplementation(async (locs) => locs.map((l) => forecastFor(l)))
    action!.run()
    await vi.runAllTimersAsync()
    expect(batchedIds().at(-1)).toEqual(['a', 'b', 'c', 'd'])
  })

  // The toast stands until its spots load or it is closed. Its text was built
  // once, so after a language switch it, and its Retry, stayed in the old one.
  it('the failure toast and its Retry follow a language switch', async () => {
    mFetchForecasts.mockRejectedValue(new TypeError('Failed to fetch'))
    mFetchForecast.mockRejectedValue(new TypeError('Failed to fetch'))
    const fc = useForecastStore()
    const done = fc.fetchAll([loc('a'), loc('b')])
    await vi.runAllTimersAsync()
    await done
    const [msg, opts] = mToast.mock.calls[0]
    const read = (v: unknown) => (typeof v === 'function' ? v() : v)
    try {
      setLang('da')
      expect(read(msg)).toBe('⚠️ ' + STRINGS.da.toast_fetch_failed_n.replace('{n}', '2'))
      expect(read(opts?.action?.label)).toBe(STRINGS.da.toast_retry)
      setLang('en')
      await langReady()
      expect(read(msg)).toBe('⚠️ ' + STRINGS.en.toast_fetch_failed_n.replace('{n}', '2'))
      expect(read(opts?.action?.label)).toBe(STRINGS.en.toast_retry)
    } finally {
      setLang('da')
    }
  })

  // A batch that waited out its whole deadline means the connection can't
  // deliver. The fallback then sent 3 single requests per spot, each waiting
  // out its own deadline — spots 'loading' and "Update all" disabled for ~9 min.
  it('a timed-out batch fails its spots at once instead of falling back per location', async () => {
    mFetchForecasts.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fc = useForecastStore()
    await fc.fetchAll([loc('a'), loc('b')])
    expect(mFetchForecast).not.toHaveBeenCalled()
    expect(fc.status).toEqual({ a: 'error', b: 'error' })
    expect(fc.progress).toEqual({ done: 0, total: 0 })
    expect(mToast).toHaveBeenCalledTimes(1)
    vi.mocked(console.error).mockRestore()
  })

  it('a single location retried by hand still toasts on its own failure', async () => {
    mFetchForecast.mockRejectedValue(new Error('boom'))
    const fc = useForecastStore()
    const done = fc.fetchFor(loc('a'))
    await vi.runAllTimersAsync()
    expect(await done).toBe(false)
    expect(mToast).toHaveBeenCalledTimes(1)
  })
})

describe('refreshOnResume — focus and reconnect', () => {
  // Back online after an offline start: the failed locations had no forecast,
  // and the old "stale" filter only looked at locations that had one — so
  // nothing refetched and the dashboard stayed empty.
  it('refetches locations whose fetch failed while offline', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const fc = useForecastStore()
    const locs = [loc('a'), loc('b')]
    await fc.fetchAll(locs)
    vi.stubGlobal('navigator', { onLine: true })
    await fc.refreshOnResume(locs, { reasonKey: 'toast_back_online' })
    expect(batchedIds()).toEqual([['a', 'b']])
    expect(fc.status).toEqual({ a: 'ok', b: 'ok' })
  })

  it('goes through one batch, not one request set per location', async () => {
    const locs = [loc('a'), loc('b'), loc('c')]
    localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(locs.map((l) => [l.id, forecastFor(l, T0 - 4 * H)]))))
    const fc = useForecastStore()
    await fc.refreshOnResume(locs, { reasonKey: 'toast_refreshing_stale' })
    expect(batchedIds()).toEqual([['a', 'b', 'c']])
    expect(mFetchForecast).not.toHaveBeenCalled()
  })

  it('leaves never-loaded locations alone unless reminders need them', async () => {
    const fc = useForecastStore()
    await fc.refreshOnResume([loc('a')], { reasonKey: 'toast_refreshing_stale' })
    expect(mFetchForecasts).not.toHaveBeenCalled()
    await fc.refreshOnResume([loc('a')], { reasonKey: 'toast_refreshing_stale', all: true })
    expect(batchedIds()).toEqual([['a']])
  })

  // Resuming with weather under 3 h old never re-checked lightning, so a storm
  // that arrived meanwhile showed no ⚡ and today's windows stayed uncapped.
  it('re-checks lightning older than 15 min even when the weather is fresh', async () => {
    const a = loc('a')
    const fc = useForecastStore()
    await fc.fetchAll([a])
    expect(mLightning).toHaveBeenCalledTimes(1)
    vi.setSystemTime(T0 + 16 * 60_000)
    await fc.refreshOnResume([a], { reasonKey: 'toast_refreshing_stale' })
    expect(mFetchForecasts).toHaveBeenCalledTimes(1)
    expect(mLightning).toHaveBeenCalledTimes(2)
  })

  it('only toasts when something actually needs refetching', async () => {
    const fc = useForecastStore()
    await fc.fetchAll([loc('a')])
    mToast.mockClear()
    await fc.refreshOnResume([loc('a')], { reasonKey: 'toast_refreshing_stale' })
    expect(mToast).not.toHaveBeenCalled()
  })
})

describe('lightning', () => {
  const danger: LightningStatus = { level: 'danger', closestKm: 6 }
  const a = loc('a')

  // Safety: a failed re-check must not lift a danger cap.
  it('a failed re-check keeps the last reading and is retried on the next pass', async () => {
    mLightning.mockResolvedValueOnce(danger)
    const fc = useForecastStore()
    await fc.refreshLightning([a], true)
    expect(fc.lightning.a).toEqual(danger)

    mLightning.mockRejectedValueOnce(new Error('lightning 429'))
    vi.setSystemTime(T0 + 16 * 60_000)
    await fc.refreshLightning([a])
    expect(fc.lightning.a).toEqual(danger)
    expect(fc.lightningCheckedAt.a).toBe(T0)

    // One minute later — well inside the 15 min freshness — it tries again.
    vi.setSystemTime(T0 + 17 * 60_000)
    await fc.refreshLightning([a])
    expect(mLightning).toHaveBeenCalledTimes(3)
    expect(fc.lightning.a).toEqual({ level: 'clear', closestKm: null })
    expect(fc.lightningCheckedAt.a).toBe(T0 + 17 * 60_000)
  })

  // …but a strike reading that can't be re-checked for hours is history, not a
  // forecast: still flagged, no longer capping the whole day.
  it('after 2 h without a successful check a danger becomes an unconfirmed "keep watch"', async () => {
    mLightning.mockResolvedValueOnce(danger)
    const fc = useForecastStore()
    await fc.refreshLightning([a], true)
    mLightning.mockRejectedValue(new TypeError('Failed to fetch'))

    vi.setSystemTime(T0 + 90 * 60_000)
    await fc.refreshLightning([a], true)
    expect(fc.lightning.a).toEqual(danger)

    vi.setSystemTime(T0 + 121 * 60_000)
    await fc.refreshLightning([a], true)
    expect(fc.lightning.a).toEqual({ level: 'caution', closestKm: null })
  })

  // Each response used to be written on its own, so 18 arrivals meant 18
  // rescorings of every window — even for 'clear' → 'clear'.
  it('applies a refresh as one update and skips statuses that did not change', async () => {
    const locs = [loc('a'), loc('b'), loc('c')]
    const fc = useForecastStore()
    let writes = 0
    watch(() => fc.lightning, () => { writes++ }, { deep: true, flush: 'sync' })
    await fc.refreshLightning(locs, true)
    expect(writes).toBe(1)
    await fc.refreshLightning(locs, true)
    expect(writes).toBe(1)
    mLightning.mockResolvedValueOnce(danger)
    await fc.refreshLightning(locs, true)
    expect(writes).toBe(2)
    expect(fc.lightning.a).toEqual(danger)
  })

  // A slow 5-minute poll (up to its 10 s deadline) overlapping "Update all":
  // which answer is newer depends on when each check STARTED, not on which
  // one happened to land first.
  it('an answer from a later check wins even when an earlier, slower one lands in between', async () => {
    const clear: LightningStatus = { level: 'clear', closestKm: null }
    const slow = deferred<LightningStatus>(), later = deferred<LightningStatus>()
    mLightning.mockImplementationOnce(() => slow.promise).mockImplementationOnce(() => later.promise)
    const fc = useForecastStore()
    const p1 = fc.refreshLightning([a], true)
    vi.setSystemTime(T0 + 2_000)
    const p2 = fc.refreshLightning([a], true)
    vi.setSystemTime(T0 + 9_000)
    slow.resolve(danger)
    await p1
    expect(fc.lightning.a).toEqual(danger)
    vi.setSystemTime(T0 + 10_000)
    later.resolve(clear)
    await p2
    expect(fc.lightning.a).toEqual(clear)
  })

  it('…and an earlier check landing last does not overwrite a later one', async () => {
    const slow = deferred<LightningStatus>(), later = deferred<LightningStatus>()
    mLightning.mockImplementationOnce(() => slow.promise).mockImplementationOnce(() => later.promise)
    const fc = useForecastStore()
    const p1 = fc.refreshLightning([a], true)
    vi.setSystemTime(T0 + 2_000)
    const p2 = fc.refreshLightning([a], true)
    later.resolve(danger)
    await p2
    vi.setSystemTime(T0 + 9_000)
    slow.resolve({ level: 'clear', closestKm: null })
    await p1
    expect(fc.lightning.a).toEqual(danger)
  })

  // A check that failed before any reading left nothing behind: no ⚡, no
  // cap, and nothing on screen to tell "couldn't check" from "no lightning"
  // — most likely during a storm, when DMI answers 429.
  describe('lightningUnchecked', () => {
    it('a check that fails before any reading is "not checked", not clear', async () => {
      mLightning.mockRejectedValueOnce(new Error('lightning 429'))
      const fc = useForecastStore()
      await fc.refreshLightning([a], true)
      expect(fc.lightning.a).toBeUndefined()
      expect(fc.lightningUnchecked('a')).toBe(true)
      await fc.refreshLightning([a], true) // the next poll gets through
      expect(fc.lightningUnchecked('a')).toBe(false)
    })

    it('a recent reading still stands when one re-check fails, until it is 30 min old', async () => {
      const fc = useForecastStore()
      await fc.refreshLightning([a], true)
      mLightning.mockRejectedValue(new TypeError('Failed to fetch'))
      vi.setSystemTime(T0 + 16 * 60_000)
      await fc.refreshLightning([a], true)
      expect(fc.lightningUnchecked('a')).toBe(false)
      vi.setSystemTime(T0 + 31 * 60_000)
      await fc.refreshLightning([a], true)
      expect(fc.lightningUnchecked('a')).toBe(true)
    })

    it('a check still running is not counted', async () => {
      const pending = deferred<LightningStatus>()
      mLightning.mockImplementationOnce(() => pending.promise)
      const fc = useForecastStore()
      const p = fc.refreshLightning([a], true)
      expect(fc.lightningUnchecked('a')).toBe(false)
      pending.resolve({ level: 'clear', closestKm: null })
      await p
      expect(fc.lightningUnchecked('a')).toBe(false)
    })

    it('offline, nothing is checked either', async () => {
      vi.stubGlobal('navigator', { onLine: false })
      const fc = useForecastStore()
      await fc.fetchAll([a])
      expect(fc.lightningUnchecked('a')).toBe(true)
    })

    it('the wipe forgets it', async () => {
      mLightning.mockRejectedValueOnce(new Error('lightning 429'))
      const fc = useForecastStore()
      await fc.refreshLightning([a], true)
      fc.clearWeather()
      expect(fc.lightningUnchecked('a')).toBe(false)
    })
  })

  it('does not re-ask within 15 minutes unless forced', async () => {
    const fc = useForecastStore()
    await fc.refreshLightning([a])
    vi.setSystemTime(T0 + 10 * 60_000)
    await fc.refreshLightning([a])
    expect(mLightning).toHaveBeenCalledTimes(1)
    await fc.refreshLightning([a], true)
    expect(mLightning).toHaveBeenCalledTimes(2)
  })

  // The first check after every start answers 'clear' for each spot, and with
  // no reading before that it was a change: every window was rescored (~100 ms
  // for 18 spots, once per scored list) for a result identical to the one on
  // screen. 'clear' scores exactly like no reading (getScoredWindows), so the
  // lists score from scoringLightning, which only holds the other readings.
  describe('scoringLightning — the readings scoring acts on', () => {
    const storm = (level: LightningStatus['level'], closestKm: number | null = 6): LightningStatus => ({ level, closestKm })
    /** A stand-in for a scored list: counts its runs, reads what scoring reads. */
    function scored(fc: ReturnType<typeof useForecastStore>) {
      let runs = 0
      const c = computed(() => { runs++; return { ...fc.scoringLightning } })
      return { read: () => c.value, runs: () => runs }
    }

    it("the first all-clear reading changes nothing scoring reads, so nothing rescores", async () => {
      const locs = [loc('a'), loc('b'), loc('c')]
      const fc = useForecastStore()
      const s = scored(fc)
      const before = fc.scoringLightning
      expect(before).toEqual({})
      s.read()
      await fc.refreshLightning(locs, true)
      // The readings are still recorded: "checked" and the map compare's
      // inheritance (officialCompare.inheritLightning) go by them.
      expect(fc.lightning).toEqual({ a: storm('clear', null), b: storm('clear', null), c: storm('clear', null) })
      expect(fc.scoringLightning).toBe(before)
      expect(s.read()).toEqual({})
      expect(s.runs()).toBe(1)
    })

    it('a storm still rescores: unknown → danger, clear → warning, and back to clear', async () => {
      const fc = useForecastStore()
      const s = scored(fc)
      s.read()
      mLightning.mockResolvedValueOnce(storm('danger'))
      await fc.refreshLightning([a], true) // no reading before: unknown → danger
      expect(s.read()).toEqual({ a: storm('danger') })
      expect(s.runs()).toBe(2)

      const b = loc('b')
      await fc.refreshLightning([b], true) // unknown → clear: nothing to rescore
      expect(s.runs()).toBe(2)
      mLightning.mockResolvedValueOnce(storm('warning', 20))
      await fc.refreshLightning([b], true) // clear → warning
      expect(s.read()).toEqual({ a: storm('danger'), b: storm('warning', 20) })
      expect(s.runs()).toBe(3)

      await fc.refreshLightning([a], true) // danger → clear lifts the cap
      expect(s.read()).toEqual({ b: storm('warning', 20) })
      expect(s.runs()).toBe(4)
    })

    it('a storm that moves or changes level rescores; the same storm again does not', async () => {
      const fc = useForecastStore()
      const s = scored(fc)
      mLightning.mockResolvedValueOnce(storm('warning', 20))
      await fc.refreshLightning([a], true)
      s.read()
      const runs = s.runs()
      mLightning.mockResolvedValueOnce(storm('warning', 20))
      await fc.refreshLightning([a], true)
      expect(s.runs()).toBe(runs)
      mLightning.mockResolvedValueOnce(storm('warning', 12)) // closer: the ⚡ tag names the distance
      await fc.refreshLightning([a], true)
      expect(s.read()).toEqual({ a: storm('warning', 12) })
      mLightning.mockResolvedValueOnce(storm('danger', 5))
      await fc.refreshLightning([a], true)
      expect(s.read()).toEqual({ a: storm('danger', 5) })
      expect(s.runs()).toBe(runs + 2)
    })

    it('a danger that ages into an unconfirmed "keep watch" rescores', async () => {
      mLightning.mockResolvedValueOnce(storm('danger'))
      const fc = useForecastStore()
      await fc.refreshLightning([a], true)
      const s = scored(fc)
      s.read()
      mLightning.mockRejectedValue(new TypeError('Failed to fetch'))
      vi.setSystemTime(T0 + 121 * 60_000)
      await fc.refreshLightning([a], true)
      expect(s.read()).toEqual({ a: storm('caution', null) })
      expect(s.runs()).toBe(2)
    })

    it('"not checked" is unchanged: a failed first check is neither a reading nor clear', async () => {
      mLightning.mockRejectedValueOnce(new Error('lightning 429'))
      const fc = useForecastStore()
      await fc.refreshLightning([a], true)
      expect(fc.lightningUnchecked('a')).toBe(true)
      expect(fc.scoringLightning).toEqual({})
      await fc.refreshLightning([a], true) // gets through: clear
      expect(fc.lightningUnchecked('a')).toBe(false)
      expect(fc.lightning.a).toEqual(storm('clear', null))
    })

    it('the wipe empties it', async () => {
      mLightning.mockResolvedValueOnce(storm('danger'))
      const fc = useForecastStore()
      await fc.refreshLightning([a], true)
      expect(fc.scoringLightning).toEqual({ a: storm('danger') })
      fc.clearWeather()
      expect(fc.scoringLightning).toEqual({})
    })
  })
})

describe('clearWeather — logout while a fetch is in flight', () => {
  // A batch still loading when "Log ud" was pressed landed afterwards and put
  // the old account's spots back into the store and into fc2-forecasts.
  it('drops a batch that lands after the wipe', async () => {
    const d = deferred<(Forecast | null)[]>()
    mFetchForecasts.mockImplementationOnce(() => d.promise)
    const fc = useForecastStore()
    const a = loc('a')
    const done = fc.fetchAll([a])
    fc.clearWeather()
    d.resolve([forecastFor(a)])
    await done
    await vi.advanceTimersByTimeAsync(1000)
    expect(fc.forecasts).toEqual({})
    expect(fc.status).toEqual({})
    expect(localStorage.getItem(LS_KEY)).toBeNull()
    expect(mLightning).not.toHaveBeenCalled()
  })

  it('drops a single-location fetch, and its failure, after the wipe', async () => {
    const d = deferred<Forecast>()
    mFetchForecast.mockImplementationOnce(() => d.promise)
    const fc = useForecastStore()
    const done = fc.fetchFor(loc('a'))
    fc.clearWeather()
    d.resolve(forecastFor(loc('a')))
    await done
    expect(fc.forecasts).toEqual({})
    mFetchForecast.mockRejectedValue(new Error('boom'))
    const failing = fc.fetchFor(loc('b'))
    fc.clearWeather()
    await vi.runAllTimersAsync()
    await failing
    expect(mToast).not.toHaveBeenCalled()
  })

  it('drops a lightning answer that lands after the wipe', async () => {
    const d = deferred<LightningStatus>()
    mLightning.mockImplementationOnce(() => d.promise)
    const fc = useForecastStore()
    const done = fc.refreshLightning([loc('a')], true)
    fc.clearWeather()
    d.resolve({ level: 'danger', closestKm: 6 })
    await done
    expect(fc.lightning).toEqual({})
  })

  it("a failure toast's Retry from before the wipe fetches nothing", async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const fc = useForecastStore()
    await fc.fetchAll([loc('a')])
    const retry = mToast.mock.calls[0][1]!.action!
    vi.stubGlobal('navigator', { onLine: true })
    fc.clearWeather()
    retry.run()
    await vi.runAllTimersAsync()
    expect(mFetchForecasts).not.toHaveBeenCalled()
  })
})

describe('failure toasts go once their spots load', () => {
  // The offline error stayed on screen next to fresh data until closed by hand.
  it('dismisses the offline toast once the refetch on reconnect succeeds', async () => {
    mToast.mockReturnValue(7 as any)
    vi.stubGlobal('navigator', { onLine: false })
    const fc = useForecastStore()
    const locs = [loc('a'), loc('b')]
    await fc.fetchAll(locs)
    expect(dismissToast).not.toHaveBeenCalled()
    vi.stubGlobal('navigator', { onLine: true })
    mToast.mockReturnValue(8 as any) // the "back online" info
    await fc.refreshOnResume(locs, { reasonKey: 'toast_back_online' })
    expect(dismissToast).toHaveBeenCalledWith(7)
  })

  // "Opdater alle" offline marks every spot failed and says so, cached
  // weather and all. Back online, the refetch skipped each spot whose
  // weather was under 3 h old: nothing was fetched, and "Du er offline"
  // stood on screen with the connection back, until closed by hand.
  it('a refresh that failed is retried on reconnect, however young the weather, and its toast goes', async () => {
    mToast.mockReturnValue(7 as any)
    const fc = useForecastStore()
    const locs = [loc('a'), loc('b')]
    await fc.fetchAll(locs)
    vi.setSystemTime(T0 + 30 * 60_000)
    vi.stubGlobal('navigator', { onLine: false })
    await fc.fetchAll(locs, { force: true })
    expect(fc.status).toEqual({ a: 'error', b: 'error' })
    vi.stubGlobal('navigator', { onLine: true })
    mToast.mockReturnValue(8 as any) // the "back online" info
    await fc.refreshOnResume(locs, { reasonKey: 'toast_back_online' })
    expect(batchedIds()).toEqual([['a', 'b'], ['a', 'b']])
    expect(fc.status).toEqual({ a: 'ok', b: 'ok' })
    expect(dismissToast).toHaveBeenCalledWith(7)
    // Loaded now: the next focus leaves them alone.
    await fc.refreshOnResume(locs, { reasonKey: 'toast_refreshing_stale' })
    expect(mFetchForecasts).toHaveBeenCalledTimes(2)
  })

  it('keeps it while one of its spots still fails', async () => {
    mToast.mockReturnValue(7 as any)
    vi.stubGlobal('navigator', { onLine: false })
    const fc = useForecastStore()
    await fc.fetchAll([loc('a'), loc('b')])
    vi.stubGlobal('navigator', { onLine: true })
    await fc.fetchAll([loc('a')], { force: true })
    expect(dismissToast).not.toHaveBeenCalledWith(7)
  })

  it('the wipe dismisses it too', async () => {
    mToast.mockReturnValue(7 as any)
    vi.stubGlobal('navigator', { onLine: false })
    const fc = useForecastStore()
    await fc.fetchAll([loc('a')])
    fc.clearWeather()
    expect(dismissToast).toHaveBeenCalledWith(7)
  })
})

/** The failure toasts asked for (the "⟳ refreshing" ones are info). */
const failures = () => mToast.mock.calls.filter(([, o]) => o?.type === 'error')
const text = (v: unknown) => (typeof v === 'function' ? v() : v)

describe('the failure toast: one, and each newer report replaces it in place', () => {
  // Back online, one spot then failed with a 503. Its report raised a toast
  // of its own, and "Du er offline" stood beside it with the connection back:
  // it went only once all of its spots had loaded.
  it('back online, a spot that fails for another reason rewords the offline toast, under the same key', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('navigator', { onLine: false })
    const fc = useForecastStore()
    await fc.fetchAll([loc('a'), loc('b')])
    vi.stubGlobal('navigator', { onLine: true })
    mFetchForecasts.mockImplementation(async (ls) => ls.map((l) => (l.id === 'b' ? null : forecastFor(l))))
    mFetchForecast.mockRejectedValue(new Error('weather 503'))
    const done = fc.refreshOnResume([loc('a'), loc('b')], { reasonKey: 'toast_back_online' })
    await vi.runAllTimersAsync()
    await done
    const [offline, b] = failures()
    expect(failures()).toHaveLength(2)
    expect(text(offline[0])).toBe('📡 ' + STRINGS.da.toast_offline)
    expect(offline[1]?.key).toBeTruthy()
    expect(b[1]?.key).toBe(offline[1]?.key)
    expect(text(b[0])).toBe('⚠️ ' + STRINGS.da.toast_fetch_failed + ' b')
    vi.mocked(console.error).mockRestore()
  })

  // Each report's Retry replaced the one before: a spot added offline under
  // a standing "Du er offline" left a Retry for that spot alone.
  it('a report covers the spots still failing from before, and its Retry fetches every one', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const fc = useForecastStore()
    await fc.fetchAll([loc('a'), loc('b')])
    await fc.fetchAll([loc('c')]) // added offline
    vi.stubGlobal('navigator', { onLine: true })
    failures().at(-1)![1]!.action!.run()
    await vi.runAllTimersAsync()
    expect(batchedIds()).toEqual([['a', 'b', 'c']])
  })

  it('…but not one that has loaded since', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mFetchForecast.mockRejectedValue(new Error('weather 503'))
    const fc = useForecastStore()
    for (const id of ['a', 'b']) {
      const done = fc.fetchFor(loc(id))
      await vi.runAllTimersAsync()
      await done
    }
    expect(text(failures()[1][0])).toBe('⚠️ ' + STRINGS.da.toast_fetch_failed_n.replace('{n}', '2'))
    mFetchForecast.mockImplementation(async (l) => forecastFor(l))
    await fc.fetchFor(loc('a'))
    expect(dismissToast).not.toHaveBeenCalled() // b still fails
    failures()[1][1]!.action!.run()
    await vi.runAllTimersAsync()
    expect(batchedIds()).toEqual([['b']])
    vi.mocked(console.error).mockRestore()
  })
})

describe('a spot that leaves the setup is done for the failure toast', () => {
  // Deleted while "Du er offline" stood, a spot kept its 'error' and its
  // place in the toast, which then never went: it waited for that spot to
  // load. Its Retry fetched the deleted spot back into the weather cache.
  it('the toast goes once the spots still there have loaded', async () => {
    mToast.mockReturnValue(7 as any)
    vi.stubGlobal('navigator', { onLine: false })
    const fc = useForecastStore()
    await fc.fetchAll([loc('a'), loc('b')])
    fc.forgetSpots(['b'])
    expect(fc.status).toEqual({ a: 'error' })
    vi.stubGlobal('navigator', { onLine: true })
    mToast.mockReturnValue(8 as any) // the "back online" info
    await fc.refreshOnResume([loc('a')], { reasonKey: 'toast_back_online' })
    expect(dismissToast).toHaveBeenCalledWith(7)
  })

  // A shared setup imported during an outage: every spot has a new id.
  it('…and at once when every spot it was about has left', async () => {
    mToast.mockReturnValue(7 as any)
    vi.stubGlobal('navigator', { onLine: false })
    const fc = useForecastStore()
    await fc.fetchAll([loc('a'), loc('b')])
    fc.forgetSpots(['a', 'b'])
    expect(dismissToast).toHaveBeenCalledWith(7)
    expect(fc.status).toEqual({})
  })

  // It named the spots as they failed: "2 fiskepladser" stood for the one left.
  it('the toast names the spots still failing: none that has left or loaded since', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mFetchForecast.mockRejectedValue(new Error('weather 503'))
    const fc = useForecastStore()
    for (const id of ['a', 'b', 'c']) {
      const done = fc.fetchFor(loc(id))
      await vi.runAllTimersAsync()
      await done
    }
    const msg = failures().at(-1)![0]
    expect(text(msg)).toBe('⚠️ ' + STRINGS.da.toast_fetch_failed_n.replace('{n}', '3'))
    fc.forgetSpots(['c'])
    expect(text(msg)).toBe('⚠️ ' + STRINGS.da.toast_fetch_failed_n.replace('{n}', '2'))
    mFetchForecast.mockImplementation(async (l) => forecastFor(l))
    await fc.fetchFor(loc('a'))
    expect(text(msg)).toBe('⚠️ ' + STRINGS.da.toast_fetch_failed + ' b')
    vi.mocked(console.error).mockRestore()
  })

  it('its Retry fetches only the spots still there', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const fc = useForecastStore()
    await fc.fetchAll([loc('a'), loc('b')])
    const retry = failures()[0][1]!.action!
    fc.forgetSpots(['b'])
    vi.stubGlobal('navigator', { onLine: true })
    retry.run()
    await vi.runAllTimersAsync()
    expect(batchedIds()).toEqual([['a']])
    expect(Object.keys(fc.forecasts)).toEqual(['a'])
  })

  it('a failure that lands after its spot has left is not reported; one brought back is', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mFetchForecasts.mockImplementation(async (ls) => ls.map(() => null))
    mFetchForecast.mockRejectedValue(new Error('weather 503'))
    const fc = useForecastStore()
    const done = fc.fetchAll([loc('a')])
    await vi.advanceTimersByTimeAsync(0) // the batch has landed; a's own retries are under way
    fc.forgetSpots(['a'])
    await vi.runAllTimersAsync()
    await done
    expect(mToast).not.toHaveBeenCalled()
    const again = fc.fetchAll([loc('a')])
    await vi.runAllTimersAsync()
    await again
    expect(failures()).toHaveLength(1)
    vi.mocked(console.error).mockRestore()
  })

  // Back online, the refresh loaded a, and its only failure was c, deleted
  // while the batch was out. That failure was dropped, as c had left, and
  // nothing else took the toast down: "Du er offline" stood with the
  // connection back and a loaded, and its Retry fetched a again.
  it('a refresh whose only failure is a spot that left mid-fetch takes the toast down once the rest have loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mToast.mockReturnValue(7 as any)
    vi.stubGlobal('navigator', { onLine: false })
    const fc = useForecastStore()
    await fc.fetchAll([loc('a')])
    vi.stubGlobal('navigator', { onLine: true })
    const batch = deferred<(Forecast | null)[]>()
    mFetchForecasts.mockImplementationOnce(() => batch.promise)
    mFetchForecast.mockRejectedValue(new Error('weather 503'))
    const done = fc.fetchAll([loc('a'), loc('c')]) // c is new
    fc.forgetSpots(['c']) // deleted while the batch is out
    batch.resolve([forecastFor(loc('a')), null])
    await vi.runAllTimersAsync()
    await done
    expect(fc.status.a).toBe('ok')
    expect(dismissToast).toHaveBeenCalledWith(7)
    vi.mocked(console.error).mockRestore()
  })

  // Toasts.vue renders the text in an effect: it has to follow the spots
  // as they leave or load, not only when read afresh.
  it('the text on screen follows the spots as they leave and load', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mFetchForecast.mockRejectedValue(new Error('weather 503'))
    const fc = useForecastStore()
    for (const id of ['a', 'b', 'c']) {
      const done = fc.fetchFor(loc(id))
      await vi.runAllTimersAsync()
      await done
    }
    const msg = failures().at(-1)![0]
    const shown = computed(() => text(msg))
    expect(shown.value).toBe('⚠️ ' + STRINGS.da.toast_fetch_failed_n.replace('{n}', '3'))
    fc.forgetSpots(['c'])
    expect(shown.value).toBe('⚠️ ' + STRINGS.da.toast_fetch_failed_n.replace('{n}', '2'))
    mFetchForecast.mockImplementation(async (l) => forecastFor(l))
    await fc.fetchFor(loc('a'))
    expect(shown.value).toBe('⚠️ ' + STRINGS.da.toast_fetch_failed + ' b')
    vi.mocked(console.error).mockRestore()
  })
})

describe('the wipe forgets the failing spots', () => {
  // "Log ud": the next account's first failure counted the old account's
  // spots, and its Retry fetched them into the weather cache.
  it('a failure after it names and fetches only the spots that failed since', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mFetchForecast.mockRejectedValue(new Error('weather 503'))
    const fc = useForecastStore()
    const first = fc.fetchFor(loc('a'))
    await vi.runAllTimersAsync()
    await first
    fc.clearWeather()
    const next = fc.fetchFor(loc('c'))
    await vi.runAllTimersAsync()
    await next
    expect(text(failures().at(-1)![0])).toBe('⚠️ ' + STRINGS.da.toast_fetch_failed + ' c')
    failures().at(-1)![1]!.action!.run()
    await vi.runAllTimersAsync()
    expect(batchedIds()).toEqual([['c']])
    vi.mocked(console.error).mockRestore()
  })

  // "Ryd vejrdata" offline: every spot's weather is gone, and the dashboard
  // opened next has to say why it can't get it back.
  it('offline, a spot told before it is told again', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const fc = useForecastStore()
    await fc.fetchAll([loc('a')])
    fc.clearWeather()
    await fc.fetchAll([loc('a')])
    expect(failures()).toHaveLength(2)
  })
})

describe('offline, a spot is said to be offline once until the connection is back', () => {
  // Round L made a spot whose fetch failed retry on every fetchAll. Offline,
  // each retry reported again: a closed "Du er offline" came back each time
  // the dashboard opened or the tab was shown again.
  it('not again when the dashboard opens or the tab is shown again, closed or standing', async () => {
    const fc = useForecastStore()
    const locs = [loc('a'), loc('b')]
    await fc.fetchAll(locs)
    vi.stubGlobal('navigator', { onLine: false })
    await fc.fetchAll(locs, { force: true }) // "Opdater alle"
    expect(failures()).toHaveLength(1)
    await fc.fetchAll(locs) // the dashboard opened again
    await fc.refreshOnResume(locs, { reasonKey: 'toast_refreshing_stale' }) // the tab shown again
    expect(failures()).toHaveLength(1)
    // Still failed, for the reconnect to retry.
    expect(fc.status).toEqual({ a: 'error', b: 'error' })
  })

  it('a spot moved meanwhile is not said again, and the Retry fetches it where it is now', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const fc = useForecastStore()
    await fc.fetchAll([loc('a')])
    const moved = loc('a', 'salt', 56.2)
    await fc.fetchAll([moved])
    expect(failures()).toHaveLength(1)
    vi.stubGlobal('navigator', { onLine: true })
    failures()[0][1]!.action!.run()
    await vi.runAllTimersAsync()
    expect(mFetchForecasts.mock.calls.at(-1)![0]).toEqual([moved])
    expect(fc.isFresh(moved)).toBe(true)
  })

  it('a spot not said yet is', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const fc = useForecastStore()
    await fc.fetchAll([loc('a')])
    await fc.fetchAll([loc('a'), loc('c')])
    expect(failures()).toHaveLength(2)
  })

  it('"Opdater alle" and Retry, pressed offline, are answered every time', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const fc = useForecastStore()
    await fc.fetchAll([loc('a')], { force: true })
    await fc.fetchAll([loc('a')], { force: true })
    failures()[1][1]!.action!.run()
    expect(failures()).toHaveLength(3)
  })

  it('a reconnect starts afresh', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('navigator', { onLine: false })
    const fc = useForecastStore()
    await fc.fetchAll([loc('a')])
    vi.stubGlobal('navigator', { onLine: true })
    mFetchForecasts.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))
    await fc.refreshOnResume([loc('a')], { reasonKey: 'toast_back_online' })
    vi.stubGlobal('navigator', { onLine: false })
    await fc.fetchAll([loc('a')])
    expect(failures().map(([m]) => text(m))).toEqual([
      '📡 ' + STRINGS.da.toast_offline,
      '⚠️ ' + STRINGS.da.toast_fetch_failed + ' a',
      '📡 ' + STRINGS.da.toast_offline,
    ])
    vi.mocked(console.error).mockRestore()
  })

  // The reconnect found nothing to fetch: "Hent data" had loaded a first.
  // Kept as told, a was not said to be offline in the next outage.
  it('a reconnect with nothing to fetch starts afresh too', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const fc = useForecastStore()
    await fc.fetchAll([loc('a')])
    vi.stubGlobal('navigator', { onLine: true })
    await fc.fetchFor(loc('a')) // "Hent data"
    await fc.refreshOnResume([loc('a')], { reasonKey: 'toast_back_online' })
    vi.setSystemTime(T0 + 4 * H) // a's weather is stale by the next outage
    vi.stubGlobal('navigator', { onLine: false })
    await fc.fetchAll([loc('a')])
    expect(failures()).toHaveLength(2)
  })

  it('a spot that left the setup and comes back is said again', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    const fc = useForecastStore()
    await fc.fetchAll([loc('a')])
    fc.forgetSpots(['a'])
    await fc.fetchAll([loc('a')])
    expect(failures()).toHaveLength(2)
  })
})

/**
 * Round M's review. Online, a spot whose weather failed is retried by each
 * fetch that comes by itself (the dashboard opened, the tab shown again, the
 * day turning), and each said so again: a closed "Kunne ikke hente vejrdata
 * til X" came back every time. Offline that was said once (above); online
 * too now, until something changes.
 */
describe('online, a failing spot is said once until something changes', () => {
  /** From now on, every fetch of these spots fails: the batch has no weather for them, and their own retries fail. */
  function failing(...ids: string[]) {
    mFetchForecasts.mockImplementation(async (ls) => ls.map((l) => (ids.includes(l.id) ? null : forecastFor(l))))
    mFetchForecast.mockImplementation(async (l) => {
      if (ids.includes(l.id)) throw new Error('weather 503')
      return forecastFor(l)
    })
  }
  /** Lets a fetch run to its end, its spots' own retries included. */
  async function run(p: Promise<unknown>) {
    await vi.runAllTimersAsync()
    await p
  }
  const said = (...ids: string[]) =>
    '⚠️ ' + (ids.length === 1
      ? STRINGS.da.toast_fetch_failed + ' ' + ids[0]
      : STRINGS.da.toast_fetch_failed_n.replace('{n}', String(ids.length)))
  const infos = () => mToast.mock.calls.filter(([, o]) => o?.type === 'info')
  const a = loc('a')
  const b = loc('b')

  beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { vi.mocked(console.error).mockRestore() })

  it('not again when the dashboard opens or the tab is shown again, closed or standing; it is still retried, without a word', async () => {
    failing('a')
    const fc = useForecastStore()
    await run(fc.fetchAll([a, b]))
    expect(failures().map(([m]) => text(m))).toEqual([said('a')])
    await run(fc.fetchAll([a, b])) // the dashboard opened again
    await run(fc.refreshOnResume([a, b], { reasonKey: 'toast_refreshing_stale' })) // the tab shown again
    expect(failures()).toHaveLength(1)
    expect(batchedIds()).toEqual([['a', 'b'], ['a'], ['a']])
    expect(fc.status).toEqual({ a: 'error', b: 'ok' })
    // Nor "⟳ Opdaterer forældede vejrdata…" for a retry that says nothing.
    expect(infos()).toEqual([])
  })

  it('a spot failing for the first time is said, and the toast names every spot still failing', async () => {
    failing('a')
    const fc = useForecastStore()
    await run(fc.fetchAll([a, b]))
    expect(text(failures().at(-1)![0])).toBe(said('a'))
    failing('a', 'b')
    vi.setSystemTime(T0 + 4 * H) // b's weather is stale now
    await run(fc.refreshOnResume([a, b], { reasonKey: 'toast_refreshing_stale' }))
    expect(failures()).toHaveLength(2)
    expect(text(failures().at(-1)![0])).toBe(said('a', 'b'))
    expect(infos()).toHaveLength(1) // b's weather was refreshed
  })

  it('a spot that loads and then fails again is said again', async () => {
    failing('a')
    const fc = useForecastStore()
    await run(fc.fetchAll([a]))
    failing()
    await run(fc.fetchAll([a]))
    expect(fc.status.a).toBe('ok')
    failing('a')
    vi.setSystemTime(T0 + 4 * H)
    await run(fc.fetchAll([a]))
    expect(failures().map(([m]) => text(m))).toEqual([said('a'), said('a')])
  })

  it('"Opdater alle", Retry and "Hent data" are answered every time', async () => {
    failing('a')
    const fc = useForecastStore()
    await run(fc.fetchAll([a]))
    await run(fc.fetchAll([a], { force: true })) // "Opdater alle"
    failures().at(-1)![1]!.action!.run() // Retry
    await vi.runAllTimersAsync()
    await run(fc.fetchFor(a)) // "Hent data"
    expect(failures()).toHaveLength(4)
    await run(fc.fetchAll([a])) // the dashboard opened again
    expect(failures()).toHaveLength(4)
  })

  // Moved, or switched between salt and fresh water, a spot is fetched for
  // another place, and its card still scores the old place's weather. Kept
  // quiet as told, that failure was said nowhere: said once, then as any.
  it('a spot moved, or switched to fresh water, is said again, once; the Retry fetches it as it is now', async () => {
    failing('a')
    const fc = useForecastStore()
    await run(fc.fetchAll([a]))
    const moved = loc('a', 'salt', 56.2)
    await run(fc.fetchAll([moved])) // App.vue fetchNewSpots
    expect(failures()).toHaveLength(2)
    await run(fc.fetchAll([moved])) // the dashboard opened again
    expect(failures()).toHaveLength(2)
    const fresh = loc('a', 'fresh', 56.2)
    await run(fc.refreshOnResume([fresh], { reasonKey: 'toast_refreshing_stale' }))
    expect(failures().map(([m]) => text(m))).toEqual([said('a'), said('a'), said('a')])
    expect(infos()).toHaveLength(1) // a fetch for the new water: not a silent retry
    failing()
    failures().at(-1)![1]!.action!.run()
    await vi.runAllTimersAsync()
    expect(mFetchForecasts.mock.calls.at(-1)![0]).toEqual([fresh])
    expect(fc.isFresh(fresh)).toBe(true)
  })

  // The press is answered by whichever fetch fails the spot: Retry leaves
  // a spot already being fetched to that fetch, and its toast is gone.
  it('Retry pressed while a fetch that came by itself has its spot: that fetch says it', async () => {
    failing('a')
    const fc = useForecastStore()
    await run(fc.fetchAll([a]))
    const batch = deferred<(Forecast | null)[]>()
    mFetchForecasts.mockImplementationOnce(() => batch.promise)
    const auto = fc.fetchAll([a]) // the dashboard opened again: a is loading
    failures()[0][1]!.action!.run()
    batch.resolve([null])
    await run(auto)
    expect(failures()).toHaveLength(2)
  })

  it('the connection back starts afresh: a spot still failing is said again', async () => {
    failing('a')
    const fc = useForecastStore()
    await run(fc.fetchAll([a]))
    fc.backOnline() // App.vue, on 'online'
    await run(fc.refreshOnResume([a], { reasonKey: 'toast_back_online' }))
    expect(failures()).toHaveLength(2)
    expect(infos()).toHaveLength(1)
  })

  it('…and so does an outage seen by a fetch in between', async () => {
    failing('a')
    const fc = useForecastStore()
    await run(fc.fetchAll([a]))
    vi.stubGlobal('navigator', { onLine: false })
    await fc.fetchAll([a])
    vi.stubGlobal('navigator', { onLine: true })
    await run(fc.fetchAll([a]))
    expect(failures().map(([m]) => text(m))).toEqual([said('a'), '📡 ' + STRINGS.da.toast_offline, said('a')])
  })

  it('a spot that left the setup and comes back is said again, and so is one after the wipe', async () => {
    failing('a')
    const fc = useForecastStore()
    await run(fc.fetchAll([a]))
    fc.forgetSpots(['a'])
    await run(fc.fetchAll([a]))
    expect(failures()).toHaveLength(2)
    fc.clearWeather()
    await run(fc.fetchAll([a]))
    expect(failures()).toHaveLength(3)
  })
})
