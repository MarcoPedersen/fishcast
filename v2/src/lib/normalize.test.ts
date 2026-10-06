import { describe, it, expect } from 'vitest'
import { normalizeAvailability, normalizeEntries, normalizeLocations, normalizeSpecies } from './normalize'

describe('normalize — repairing a stored or pulled document', () => {
  it('drops locations without usable coordinates and coerces numeric strings', () => {
    const out = normalizeLocations([
      { id: 'a', name: 'A', lat: 55.6, lon: 12.6, fav: true, note: 'keep me' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C', lat: '55.6', lon: '12' },
      { id: 'd', name: 'D', lat: NaN, lon: 12 },
      'junk', null,
    ])
    expect(out.map((l) => l.id)).toEqual(['a', 'c'])
    expect(out[0]).toMatchObject({ fav: true, note: 'keep me' }) // the user's own fields survive
    expect(out[1].lat).toBe(55.6)
    expect(typeof out[1].lon).toBe('number')
  })

  it('clears an unknown water type or a non-array species list', () => {
    const [l] = normalizeLocations([{ id: 'a', name: 'A', lat: 55, lon: 12, waterType: { x: 1 }, species: 'cod' }])
    expect(l.waterType).toBeUndefined()
    expect(l.species).toBeUndefined()
    expect(normalizeLocations([{ id: 'a', name: 'A', lat: 55, lon: 12, waterType: 'salt' }])[0].waterType).toBe('salt')
  })

  it('repairs an availability row instead of letting it crash the scorer', () => {
    const out = normalizeAvailability([
      { id: 'w', from: '06:00', to: '09:00' }, // no days — getScoredWindows threw on this
      { id: 'v', days: [1, 9, '2', 3], from: 6, to: '10:00', methods: ['boat', 'jetpack'] },
    ])
    expect(out[0]).toMatchObject({ days: [], from: '06:00', to: '09:00', methods: ['shore'] })
    expect(out[1]).toMatchObject({ days: [1, 3], from: '', to: '10:00', methods: ['boat'] })
  })

  it('keeps rows the editor itself can produce mid-edit', () => {
    const row = { id: 'e', days: [], from: '', to: '', methods: [] }
    expect(normalizeAvailability([row])).toEqual([row])
  })

  it('treats anything but an array as empty', () => {
    expect(normalizeLocations({ 0: 'x' })).toEqual([])
    expect(normalizeAvailability(undefined)).toEqual([])
    expect(normalizeSpecies(['torsk', 3, null])).toEqual(['torsk'])
    expect(normalizeEntries([{ id: 'c' }, 'x'])).toEqual([{ id: 'c' }])
  })
})
