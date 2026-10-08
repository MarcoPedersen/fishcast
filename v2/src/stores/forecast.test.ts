import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { watch } from 'vue'
import type { Forecast, LightningStatus, Location } from '@/lib/types'

// The store's network layer is stubbed per test; forecastKey stays real so the
// "what was this fetched for" checks run against the actual key.
vi.mock('@/lib/weather', async (orig) => {
  const real = await orig<typeof import('@/lib/weather')>()
  return { ...real, fetchForecast: vi.fn(), fetchForecasts: vi.fn(), fetchLightningStatus: vi.fn() }
})
vi.mock('@/lib/toast', () => ({ showToast: vi.fn() }))

import { fetchForecast, fetchForecasts, fetchLightningStatus, forecastKey } from '@/lib/weather'
import { showToast } from '@/lib/toast'
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

  it('does not re-ask within 15 minutes unless forced', async () => {
    const fc = useForecastStore()
    await fc.refreshLightning([a])
    vi.setSystemTime(T0 + 10 * 60_000)
    await fc.refreshLightning([a])
    expect(mLightning).toHaveBeenCalledTimes(1)
    await fc.refreshLightning([a], true)
    expect(mLightning).toHaveBeenCalledTimes(2)
  })
})
