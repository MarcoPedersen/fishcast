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

  /**
   * The coast override (onshore spec §1.2) is the user's own choice, synced.
   * Only a wrong TYPE is dropped, as for the other fields. An object or a
   * string this version can't read is kept as it is: it may come from a newer
   * version, and deleting it here would push the deletion over that device's
   * choice on the next edit (critique suggestion 4). The scorer and the UI
   * treat anything but 'none' or a valid override as automatic.
   */
  it('keeps a coast override and drops a coast of the wrong type', () => {
    const one = (coast: unknown) => normalizeLocations([{ id: 'a', name: 'A', lat: 55, lon: 12, coast }])[0]
    const valid = { facing: 270, spread: 180, exposure: 'open' }
    expect(one(valid).coast).toEqual(valid)
    expect(one('none').coast).toBe('none')
    expect(one('auto').coast).toBe('auto')
    expect(one({ facing: 400, spread: 180, exposure: 'open' }).coast).toEqual({ facing: 400, spread: 180, exposure: 'open' })
    for (const bad of [[270, 180, 'open'], 90, true, null]) {
      const l = one(bad)
      expect(l).toBeDefined() // the location is kept
      expect('coast' in l).toBe(false)
    }
    expect('coast' in one(undefined)).toBe(false)
  })

  it('treats anything but an array as empty', () => {
    expect(normalizeLocations({ 0: 'x' })).toEqual([])
    expect(normalizeAvailability(undefined)).toEqual([])
    expect(normalizeSpecies(['torsk', 3, null])).toEqual(['torsk'])
    expect(normalizeEntries([{ id: 'c' }, 'x'])).toEqual([{ id: 'c' }])
  })
})
