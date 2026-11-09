import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { computed, effectScope, markRaw, nextTick } from 'vue'
import type { Availability, Forecast, LightningStatus, Location } from '@/lib/types'

// Every pass is counted; each one runs the real scorer.
vi.mock('@/lib/scoring', async (orig) => {
  const real = await orig<typeof import('@/lib/scoring')>()
  return { ...real, getScoredWindows: vi.fn(real.getScoredWindows) }
})
vi.mock('@/lib/coastClient', () => ({ deriveCoast: vi.fn(), terminate: vi.fn() }))

import { getScoredWindows } from '@/lib/scoring'
import { COAST_ALGO_VERSION, coordKey, type CoastAuto } from '@/lib/coast'
import { windowKey } from '@/lib/upcoming'
import { useScoredStore } from './scored'
import { useForecastStore } from './forecast'
import { useCoastStore } from './coast'
import { useSetupStore } from './setup'

const passes = vi.mocked(getScoredWindows)
const H = 3600_000
/** Mon 9 Nov 2026 03:00 in Copenhagen (test-setup pins the zone). */
const T0 = new Date(2026, 10, 9, 3, 0).getTime()

const spot = (id: string, lat: number, lon: number): Location => ({ id, name: 'Spot ' + id, lat, lon, waterType: 'salt' })
const A = spot('a', 56.0, 10.6)
const B = spot('b', 55.6, 12.6)
const AVAIL: Availability[] = [
  { id: 's1', days: [0, 1, 2, 3, 4, 5, 6], from: '05:00', to: '09:00', methods: ['shore', 'waders'] },
  { id: 's2', days: [0, 1, 2, 3, 4, 5, 6], from: '22:00', to: '01:00', methods: ['shore'] },
]
/** Hourly weather from yesterday's local midnight for 9 days, varying so windows differ. */
function forecast(seed: number, fetched = Date.now()): Forecast {
  const d = new Date(fetched)
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime()
  const hourly = Array.from({ length: 9 * 24 }, (_, h) => ({
    time: start + h * H, temp: 9 + ((h + seed) % 5), windMs: 2 + ((h * 3 + seed) % 9), windDir: (h * 37 + seed * 50) % 360,
    gustMs: 6 + ((h + seed) % 7), cloud: (h * 13 + seed) % 100, precipPct: (h * 7 + seed) % 80, pressure: 1005 + ((h + seed) % 12),
  }))
  return { fetched, hourly, marine: null, tides: null }
}
const autoCoast = (facing: number): CoastAuto => ({
  v: COAST_ALGO_VERSION, at: Date.now(), src: 'versatiles', water: 'sea', facing, nearFacing: facing, spread: 180,
  exposure: 'open', fetchKm: Array.from({ length: 16 }, (_, k) => (k >= 8 ? 25 : 1)), pinToWaterM: 3, issues: [],
})
const danger: LightningStatus = { level: 'danger', closestKm: 6 }
const clear: LightningStatus = { level: 'clear', closestKm: null }

/** What each scored list hands its view, compared byte for byte. */
const json = (ws: unknown) => JSON.stringify(ws)

function start() {
  setActivePinia(createPinia())
  const setup = useSetupStore()
  setup.locations = [{ ...A }, { ...B }]
  setup.availability = AVAIL.map((a) => ({ ...a }))
  setup.targetSpecies = ['havørred', 'torsk']
  const fc = useForecastStore()
  fc.forecasts.a = markRaw(forecast(1))
  fc.forecasts.b = markRaw(forecast(2))
  const coast = useCoastStore()
  const scope = effectScope()
  const scored = useScoredStore()
  return { setup, fc, coast, scored, scope }
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} })
  localStorage.clear()
  passes.mockClear()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('the scored windows the dashboard, the setup map and the reminders share', () => {
  // With reminders on, App.vue and the open view each scored every spot × day
  // × slot for themselves: every forecast, lightning or coast write cost two
  // full passes (~100 ms each on 18 spots) instead of one.
  it('scores once per change, however many lists read it', async () => {
    const { fc, scored, scope } = start()
    const readers = scope.run(() => [
      computed(() => scored.windows.length), // the dashboard's list
      computed(() => scored.windows.filter((w) => !w.noData).length), // the map's pins
      computed(() => scored.windows.slice(0, 3)), // the reminders
    ])!
    const readAll = () => readers.map((r) => r.value)
    readAll()
    expect(passes).toHaveBeenCalledTimes(1)
    readAll()
    expect(passes).toHaveBeenCalledTimes(1)
    fc.forecasts.b = markRaw(forecast(7))
    readAll()
    expect(passes).toHaveBeenCalledTimes(2)
    fc.lightning = { a: danger }
    readAll()
    expect(passes).toHaveBeenCalledTimes(3)
    fc.lightning = { a: danger, b: clear } // a 'clear' scores like no reading: nothing to redo
    readAll()
    expect(passes).toHaveBeenCalledTimes(3)
    scope.stop()
  })

  it('scores nothing until something reads it', () => {
    const { fc } = start()
    fc.forecasts.a = markRaw(forecast(3))
    fc.lightning = { a: danger }
    expect(passes).not.toHaveBeenCalled()
  })

  it('hands out exactly what scoring the same inputs gives, in the same order', async () => {
    const real = (await vi.importActual<typeof import('@/lib/scoring')>('@/lib/scoring')).getScoredWindows
    const { setup, fc, coast, scored } = start()
    fc.lightning = { a: danger, b: clear }
    const direct = real(setup.locations, setup.availability, fc.forecasts, setup.targetSpecies, fc.lightning, coast.shoreById)
    expect(scored.windows.length).toBeGreaterThan(20)
    expect(scored.windows.some((w) => w.lightning)).toBe(true) // the danger reading made it in
    expect(json(scored.windows)).toBe(json(direct))
  })

  // The dashboard held the coasts while the coast queue ran (useSettledShores):
  // results land every 5 s, and each landing re-sorted the cards and rebuilt
  // the setup map's pins. The shared list holds them for every reader.
  it('takes coasts landing during a coast run in one step when the run ends', async () => {
    const real = (await vi.importActual<typeof import('@/lib/scoring')>('@/lib/scoring')).getScoredWindows
    const { setup, fc, coast, scored, scope } = start()
    const list = scope.run(() => computed(() => scored.windows))!
    const before = json(list.value)
    expect(passes).toHaveBeenCalledTimes(1)
    coast.deriving = true
    coast.entries = { ...coast.entries, [coordKey(A)]: autoCoast(270) }
    await nextTick()
    expect(coast.shoreById.a).toBeTruthy() // landed in the coast store...
    expect(json(list.value)).toBe(before) // ...and held here
    expect(passes).toHaveBeenCalledTimes(1)
    coast.entries = { ...coast.entries, [coordKey(B)]: autoCoast(90) }
    await nextTick()
    expect(passes).toHaveBeenCalledTimes(1)
    coast.deriving = false
    await nextTick()
    const after = json(list.value)
    expect(passes).toHaveBeenCalledTimes(2)
    expect(after).toBe(json(real(setup.locations, setup.availability, fc.forecasts, setup.targetSpecies, fc.lightning, coast.shoreById)))
    expect(after).not.toBe(before) // the coasts did move the scores
    scope.stop()
  })

  it('rolls over at local midnight with no other change', () => {
    vi.setSystemTime(new Date(2026, 10, 9, 23, 59, 30).getTime())
    const { scored, scope } = start()
    const list = scope.run(() => computed(() => scored.windows))!
    const days = () => new Set(list.value.map((w) => w.date.getTime()))
    const monday = Date.UTC(2026, 10, 9)
    expect(days().has(monday)).toBe(true)
    vi.advanceTimersByTime(60_000) // the clock's next tick lands at 00:00:30 on Tuesday
    expect(list.value.length).toBeGreaterThan(0)
    expect(passes).toHaveBeenCalledTimes(2)
    // Monday's 05:00 window is gone; only its overnight one, still running, stays.
    expect(list.value.filter((w) => w.date.getTime() === monday).map((w) => `${w.location.id} ${w.from}`).sort()).toEqual(['a 22:00', 'b 22:00'])
    expect(days().has(Date.UTC(2026, 10, 16))).toBe(true) // and next Monday came in
    scope.stop()
  })

  // notifications.ts reminds 30 min before a slot due by this time tomorrow.
  // At 23:50 that reaches a slot starting at 00:00 the day after tomorrow, so
  // the list the reminders read must not stop at tomorrow.
  it('holds every window a reminder can be due for, up to this time tomorrow', () => {
    vi.setSystemTime(new Date(2026, 10, 9, 23, 50).getTime())
    const { setup, scored } = start()
    setup.availability = [{ id: 'n', days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '02:00', methods: ['shore'] }]
    const now = Date.now()
    const until = new Date(2026, 10, 10, 23, 50).getTime()
    const keys = new Set(scored.windows.map(windowKey))
    const due: string[] = []
    for (let day = 0; day <= 3; day++) {
      const date = new Date(Date.UTC(2026, 10, 9 + day))
      const remindAt = new Date(2026, 10, 9 + day, 0, 0).getTime() - 30 * 60_000
      if (remindAt <= now || remindAt > until) continue
      for (const l of setup.locations) due.push(`${l.id}|${date.getTime()}|00:00-02:00`)
    }
    expect(due).toEqual(['a|' + Date.UTC(2026, 10, 11) + '|00:00-02:00', 'b|' + Date.UTC(2026, 10, 11) + '|00:00-02:00'])
    for (const k of due) expect(keys.has(k)).toBe(true)
  })
})
