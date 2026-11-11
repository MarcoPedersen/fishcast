import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { computed, effectScope, markRaw, nextTick, watch } from 'vue'
import type { Availability, Forecast, LightningStatus, Location } from '@/lib/types'

// Every pass is counted; each one runs the real scorer.
vi.mock('@/lib/scoring', async (orig) => {
  const real = await orig<typeof import('@/lib/scoring')>()
  return { ...real, getScoredWindows: vi.fn(real.getScoredWindows) }
})
vi.mock('@/lib/coastClient', () => ({ deriveCoast: vi.fn(), terminate: vi.fn() }))
// The English table is a chunk of its own (lib/i18n.ts): here it arrives when a test says so.
// (So the test reads it through vi.importActual, not test/strings: that import would wait here too.)
const english = vi.hoisted(() => {
  let arrive!: () => void
  const arrived = new Promise<void>((r) => { arrive = r })
  return { arrived, arrive }
})
vi.mock('@/lib/strings.en', async (orig) => { await english.arrived; return orig() })

import { getScoredWindows } from '@/lib/scoring'
import { COAST_ALGO_VERSION, coordKey, type CoastAuto } from '@/lib/coast'
import { windowKey } from '@/lib/upcoming'
import { lang, langReady } from '@/lib/i18n'
import { STRINGS_DA } from '@/lib/strings'
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
  vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {}, documentElement: { lang: 'da' } })
  localStorage.clear()
  passes.mockClear()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  lang.value = 'da'
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

  // App.vue re-arms the reminders from a watcher on this list. An edit that
  // moves a spot's coast (its water type, its pin, a coast picked by hand, a
  // spot added or removed) changes the coasts as well as the spot, and the
  // held coasts followed in a watcher of their own. After a coast run that
  // one ran second: the list was scored with the old coasts, then again with
  // the new ones, and the reminders were armed twice.
  it('scores an edit that moves a coast once, with the new coast, for a watcher like the reminders', async () => {
    const { setup, coast, scored, scope } = start()
    coast.entries = { [coordKey(A)]: autoCoast(270) }
    await nextTick()
    const armed: unknown[] = []
    scope.run(() => watch(() => scored.windows, (ws) => { armed.push(ws) }))
    expect(passes.mock.calls.map((c) => c[5]!.a)).toEqual([expect.objectContaining({ mode: 'auto', facing: 270 })])
    coast.deriving = true // a coast run, here with nothing landing
    await nextTick()
    coast.deriving = false
    await nextTick()
    passes.mockClear()
    armed.length = 0
    setup.locations[0].waterType = 'fresh' // a fresh spot has no coast
    await nextTick()
    expect(passes.mock.calls.map((c) => c[5]!.a)).toEqual([null])
    expect(armed).toHaveLength(1)
    passes.mockClear()
    setup.locations[1].lat += 0.01 // B moved, so its coast is unknown until the queue runs
    await nextTick()
    expect(passes).toHaveBeenCalledTimes(1)
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

  // The dashboard and the setup map read "today" from here. With a clock of
  // their own, started when the view opened, their minute tick fell at
  // another second than this list's: when the view's day turned first, the
  // dashboard showed the new week with its 7th day empty and that day's
  // cards missing until this list caught up (10 s in the probe, up to 60 s).
  it("names the day its list is scored for, turning in the same tick as the list", () => {
    vi.setSystemTime(new Date(2026, 10, 9, 23, 58, 20).getTime())
    const { scored, scope } = start()
    const list = scope.run(() => computed(() => scored.windows))!
    const DAY = 86_400_000
    const lastDay = () => Math.max(...list.value.map((w) => w.date.getTime()))
    const seen = new Set<number>()
    for (let s = 0; s < 150; s++) { // 23:58:20 to 00:00:50, a second at a time
      expect(lastDay()).toBe(scored.today + 6 * DAY)
      seen.add(scored.today)
      vi.advanceTimersByTime(1000)
    }
    expect([...seen]).toEqual([Date.UTC(2026, 10, 9), Date.UTC(2026, 10, 10)])
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

// Scoring names each breakdown row and tag with t() as it scores, and the
// list holds what it built. The English table now arrives after the switch
// (lib/i18n.ts), so the list must be built again when it lands — or a user
// who picked English read the score modal and the cards' tags in Danish.
describe('the scored windows in the language picked', () => {
  it('turn English when the English table arrives, not before', async () => {
    const real = (await vi.importActual<typeof import('@/lib/scoring')>('@/lib/scoring')).getScoredWindows
    const STRINGS = { da: STRINGS_DA, en: (await vi.importActual<typeof import('@/lib/strings.en')>('@/lib/strings.en')).STRINGS_EN }
    const { setup, fc, coast, scored, scope } = start()
    const list = scope.run(() => computed(() => scored.windows))!
    const rows = () => list.value.flatMap((w) => w.breakdown ?? [])
    const inDa = () => rows().filter((b) => b.factor !== STRINGS.da[b.key ?? '']).map((b) => b.key)
    const inEn = () => rows().filter((b) => b.factor !== STRINGS.en[b.key ?? '']).map((b) => b.key)
    expect(rows().length).toBeGreaterThan(50)
    expect(rows().some((b) => STRINGS.da[b.key ?? ''] !== STRINGS.en[b.key ?? ''])).toBe(true) // the check can tell them apart
    expect(inDa()).toEqual([])
    const danish = json(list.value)

    lang.value = 'en'
    expect(inDa()).toEqual([]) // still on its way: Danish, as for a key English lacks
    vi.useRealTimers() // the chunk loads through the module runner, which runs on real timers
    english.arrive()
    expect(await langReady()).toBe(true)
    expect(inEn()).toEqual([])
    expect(json(list.value)).not.toBe(danish) // the tags too: the whole list was built again…
    expect(json(list.value)).toBe(json(real(setup.locations, setup.availability, fc.forecasts, setup.targetSpecies, fc.lightning, coast.shoreById)))
    scope.stop()
  })
})
