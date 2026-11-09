import { describe, expect, it } from 'vitest'
import { createPinSync } from './pinSync'
import { savedSpotPins } from './setupMapPins'
import { savedSpotPopup } from './mapPopups'
import type { Location } from './types'

const A: Location = { id: 'a', name: 'Spot A', lat: 55.6, lon: 12.6, waterType: 'salt' }
const B: Location = { id: 'b', name: 'Spot B', lat: 56.1, lon: 10.2, waterType: 'salt' }
const C: Location = { id: 'c', name: 'Spot C', lat: 55.2, lon: 11.0, waterType: 'brackish' }
const scores = (o: Record<string, number>) => new Map(Object.entries(o))

/**
 * Leaflet as the setup map uses it. A marker taken off the map closes its
 * popup (bindPopup closes it on 'remove'); setIcon and setPopupContent keep
 * the same, possibly open, popup.
 */
function fakeMap() {
  interface Marker { id: string; icon: string; popup: string; open: boolean; onMap: boolean }
  const made: Marker[] = []
  const pins = createPinSync<Marker>({
    add: (p) => { const m = { id: p.id, icon: p.icon.html, popup: p.popup, open: false, onMap: true }; made.push(m); return m },
    update: (m, p, c) => { if (c.icon) m.icon = p.icon.html; if (c.popup) m.popup = p.popup },
    remove: (m) => { m.onMap = false; m.open = false },
  })
  const marker = (id: string) => made.filter((m) => m.id === id && m.onMap)
  return { pins, made, marker }
}

describe('setup map pins', () => {
  it("shows today's score as a coloured badge, and a plain dot without one", () => {
    const [a, b] = savedSpotPins([A, B], scores({ a: 82 }))
    expect(a).toMatchObject({ id: 'a', lat: A.lat, lon: A.lon, popup: savedSpotPopup(A, 82) })
    expect(a.icon.size).toBe(26)
    expect(a.icon.html).toContain('>82<')
    expect(a.icon.html).toContain('#22c55e') // 80+ is green
    expect(savedSpotPins([A], scores({ a: 50 }))[0].icon.html).toContain('#f59e0b')
    expect(b).toMatchObject({ id: 'b', popup: savedSpotPopup(B, undefined) })
    expect(b.icon.size).toBe(16)
    expect(b.icon.html).toContain('#38bdf8')
  })

  // Every forecast, lightning reading or coast result moves the scores. The map
  // cleared and re-added every marker on each one, closing the popup the user
  // was reading.
  it('a score change keeps the marker and its open popup, and updates both in place', () => {
    const map = fakeMap()
    map.pins.sync(savedSpotPins([A, B], scores({ a: 72, b: 60 })))
    const [a] = map.marker('a')
    a.open = true
    map.pins.sync(savedSpotPins([A, B], scores({ a: 15, b: 60 }))) // a storm capped spot A
    expect(map.marker('a')).toEqual([a])
    expect(a.open).toBe(true)
    expect(a.icon).toContain('>15<')
    expect(a.popup).toBe(savedSpotPopup(A, 15))
    expect(map.made).toHaveLength(2)
  })

  it('a spot added or removed adds or removes only its own marker', () => {
    const map = fakeMap()
    map.pins.sync(savedSpotPins([A, B], scores({ a: 72, b: 60 })))
    const [a] = map.marker('a')
    a.open = true
    map.pins.sync(savedSpotPins([A, B, C], scores({ a: 72, b: 60 })))
    expect(map.marker('c')).toHaveLength(1)
    map.pins.sync(savedSpotPins([A, C], scores({ a: 72 })))
    expect(map.marker('b')).toEqual([])
    expect(map.marker('a')).toEqual([a])
    expect(a.open).toBe(true)
    expect(map.made).toHaveLength(3)
  })

  it('a rename updates the popup of the same marker', () => {
    const map = fakeMap()
    map.pins.sync(savedSpotPins([A], scores({ a: 72 })))
    const [a] = map.marker('a')
    map.pins.sync(savedSpotPins([{ ...A, name: 'Molen' }], scores({ a: 72 })))
    expect(map.marker('a')).toEqual([a])
    expect(a.popup).toContain('Molen')
  })
})
