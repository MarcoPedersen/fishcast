import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { usePlaceSearch, locationFromSearch, SEARCH_DEBOUNCE_MS } from './placeSearch'
import type { GeoResult } from './weather'

vi.mock('./weather', () => ({ geocode: vi.fn() })) // never the network

const place = (name: string, lat = 56, lon = 10): GeoResult => ({ name, admin1: '', lat, lon, country: 'DK' })

/** A geocoder whose answers the test releases by hand, in any order. */
function manualGeocoder() {
  const calls: { q: string; answer: (r: GeoResult[]) => void; fail: (e: Error) => void }[] = []
  const fn = vi.fn((q: string) => new Promise<GeoResult[]>((answer, fail) => { calls.push({ q, answer, fail }) }))
  return { fn, calls }
}

async function type(s: ReturnType<typeof usePlaceSearch>, text: string) {
  s.query.value = text
  s.onInput()
  await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
}

describe('place search ordering', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('ignores an older query answering after a newer one', async () => {
    const g = manualGeocoder()
    const s = usePlaceSearch(g.fn)
    await type(s, 'Hund')
    await type(s, 'Hundested')
    expect(g.calls.map((c) => c.q)).toEqual(['Hund', 'Hundested'])
    g.calls[1].answer([place('Hundested')])
    g.calls[0].answer([place('Hundige'), place('Hundborg')]) // the slow one lands last
    await vi.advanceTimersByTimeAsync(0)
    expect(s.results.value.map((r) => r.name)).toEqual(['Hundested'])
  })

  it('a pick cancels the pending search — no "no places found" under the emptied box', async () => {
    const g = manualGeocoder()
    const s = usePlaceSearch(g.fn)
    s.query.value = 'Køge'
    s.onInput()
    s.reset() // add() picked a result within the debounce
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS * 2)
    expect(g.fn).not.toHaveBeenCalled()
    expect(s.searched.value).toBe(false)
    expect(s.busy.value).toBe(false)
  })

  it('a pick also discards a search already in flight', async () => {
    const g = manualGeocoder()
    const s = usePlaceSearch(g.fn)
    await type(s, 'Køge')
    s.reset()
    g.calls[0].answer([place('Køge')])
    await vi.advanceTimersByTimeAsync(0)
    expect(s.results.value).toEqual([])
    expect(s.searched.value).toBe(false)
  })

  it('a failed request says so instead of "no places found"', async () => {
    const g = manualGeocoder()
    const s = usePlaceSearch(g.fn)
    await type(s, 'Hundested')
    g.calls[0].fail(new TypeError('Failed to fetch')) // offline on the phone
    await vi.advanceTimersByTimeAsync(0)
    expect(s.failed.value).toBe(true)
    expect(s.searched.value).toBe(false)
    expect(s.busy.value).toBe(false)
  })

  it('a genuine empty answer is "no places found"', async () => {
    const g = manualGeocoder()
    const s = usePlaceSearch(g.fn)
    await type(s, 'Xyzzy')
    g.calls[0].answer([])
    await vi.advanceTimersByTimeAsync(0)
    expect(s.searched.value).toBe(true)
    expect(s.failed.value).toBe(false)
  })

  it('clearing the box drops the in-flight answer', async () => {
    const g = manualGeocoder()
    const s = usePlaceSearch(g.fn)
    await type(s, 'Køge')
    s.query.value = ''
    s.onInput()
    g.calls[0].answer([place('Køge')])
    await vi.advanceTimersByTimeAsync(0)
    expect(s.results.value).toEqual([])
  })
})

describe('locationFromSearch', () => {
  it('infers water and bottom type like the map does, instead of leaving them blank', () => {
    // Silkeborg, beside Langsø: blank used to mean "brackish" and sea tides.
    const loc = locationFromSearch({ name: 'Silkeborg', admin1: 'Midtjylland', lat: 56.17, lon: 9.55, country: 'DK' })
    expect(loc).toMatchObject({ name: 'Silkeborg, Midtjylland', lat: 56.17, lon: 9.55, waterType: 'fresh' })
    expect(loc.bottomType).toEqual(expect.any(String))
  })

  it('omits the region when there is none', () => {
    expect(locationFromSearch(place('Hundested', 55.96, 11.85)).name).toBe('Hundested')
  })
})
