import { describe, it, expect } from 'vitest'
import { renameLocation } from './renameLocation'
import { findCatchLocation } from './catchScore'
import type { CatchEntry, Location } from './types'

const loc = (id: string, name: string): Location => ({ id, name, lat: 55.7, lon: 11.1 })
const fish = (id: string, locationName: string): CatchEntry =>
  ({ id, date: '2026-09-01', speciesId: 'havorred', locationName })

describe('renameLocation', () => {
  it('keeps the old name when the draft is empty or blank', () => {
    const a = loc('a', 'Strandvejen, Kalundborg')
    expect(renameLocation(a, '   ', [a], [])).toBe(false)
    expect(a.name).toBe('Strandvejen, Kalundborg')
  })

  it('trims the new name', () => {
    const a = loc('a', 'Molen')
    renameLocation(a, '  Kalundborg slæbested  ', [a], [])
    expect(a.name).toBe('Kalundborg slæbested')
  })

  it('moves the catches logged under the old name, so they stay linked', () => {
    const a = loc('a', 'Strandvejen, Kalundborg')
    const catches = [fish('1', 'Strandvejen, Kalundborg'), fish('2', ' strandvejen, kalundborg'), fish('3', 'Dragør mole')]
    renameLocation(a, 'Kalundborg slæbested', [a], catches)
    expect(catches.map((c) => c.locationName)).toEqual(['Kalundborg slæbested', 'Kalundborg slæbested', 'Dragør mole'])
    expect(catches.slice(0, 2).every((c) => findCatchLocation(c, [a]) === a)).toBe(true)
  })

  it('mutates the entries in place (the catch store watcher persists and syncs them)', () => {
    const a = loc('a', 'Molen')
    const entry = fish('1', 'Molen')
    const catches = [entry]
    renameLocation(a, 'Nordmolen', [a], catches)
    expect(catches[0]).toBe(entry)
    expect(entry.locationName).toBe('Nordmolen')
  })

  it('leaves the catches alone while another spot still carries the old name', () => {
    const a = loc('a', 'Molen')
    const b = loc('b', 'Molen')
    const catches = [fish('1', 'Molen')]
    renameLocation(b, 'Nordmolen', [a, b], catches)
    expect(catches[0].locationName).toBe('Molen') // still resolves, to the other "Molen"
  })

  it('does not adopt catches with no location when the old name was empty', () => {
    const a = loc('a', '') // saved by the old live-edit input
    const catches = [fish('1', '')]
    renameLocation(a, 'Molen', [a], catches)
    expect(a.name).toBe('Molen')
    expect(catches[0].locationName).toBe('')
  })

  it('an unchanged name changes nothing', () => {
    const a = loc('a', 'Molen')
    const catches = [fish('1', 'Molen')]
    expect(renameLocation(a, 'Molen ', [a], catches)).toBe(false)
    expect(catches[0].locationName).toBe('Molen')
  })
})
