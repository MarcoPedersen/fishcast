import { describe, it, expect } from 'vitest'
import { renameLocation } from './renameLocation'
import { findCatchLocation } from './catchScore'
import type { CatchEntry, Location } from './types'

const loc = (id: string, name: string): Location => ({ id, name, lat: 55.7, lon: 11.1 })
const fish = (id: string, locationName: string): CatchEntry =>
  ({ id, date: '2026-09-01', speciesId: 'havorred', locationName })
/** A catch log whose re-read changes nothing (a guest, or a log already current). */
const log = (entries: CatchEntry[]) => ({ entries, pullRemote: async () => {} })

describe('renameLocation', () => {
  it('keeps the old name when the draft is empty or blank', async () => {
    const a = loc('a', 'Strandvejen, Kalundborg')
    expect(await renameLocation('a', '   ', { locations: [a] }, log([]))).toBe(false)
    expect(a.name).toBe('Strandvejen, Kalundborg')
  })

  it('trims the new name', async () => {
    const a = loc('a', 'Molen')
    await renameLocation('a', '  Kalundborg slæbested  ', { locations: [a] }, log([]))
    expect(a.name).toBe('Kalundborg slæbested')
  })

  it('moves the catches logged under the old name, so they stay linked', async () => {
    const a = loc('a', 'Strandvejen, Kalundborg')
    const catches = [fish('1', 'Strandvejen, Kalundborg'), fish('2', ' strandvejen, kalundborg'), fish('3', 'Dragør mole')]
    await renameLocation('a', 'Kalundborg slæbested', { locations: [a] }, log(catches))
    expect(catches.map((c) => c.locationName)).toEqual(['Kalundborg slæbested', 'Kalundborg slæbested', 'Dragør mole'])
    expect(catches.slice(0, 2).every((c) => findCatchLocation(c, [a]) === a)).toBe(true)
  })

  it('mutates the entries in place (the catch store watcher persists and syncs them)', async () => {
    const a = loc('a', 'Molen')
    const entry = fish('1', 'Molen')
    const catches = [entry]
    await renameLocation('a', 'Nordmolen', { locations: [a] }, log(catches))
    expect(catches[0]).toBe(entry)
    expect(entry.locationName).toBe('Nordmolen')
  })

  it('leaves the catches alone while another spot still carries the old name', async () => {
    const a = loc('a', 'Molen')
    const b = loc('b', 'Molen')
    const catches = [fish('1', 'Molen')]
    await renameLocation('b', 'Nordmolen', { locations: [a, b] }, log(catches))
    expect(catches[0].locationName).toBe('Molen') // still resolves, to the other "Molen"
  })

  it('does not adopt catches with no location when the old name was empty', async () => {
    const a = loc('a', '') // saved by the old live-edit input
    const catches = [fish('1', '')]
    await renameLocation('a', 'Molen', { locations: [a] }, log(catches))
    expect(a.name).toBe('Molen')
    expect(catches[0].locationName).toBe('')
  })

  it('an unchanged name changes nothing', async () => {
    const a = loc('a', 'Molen')
    const catches = [fish('1', 'Molen')]
    expect(await renameLocation('a', 'Molen ', { locations: [a] }, log(catches))).toBe(false)
    expect(catches[0].locationName).toBe('Molen')
  })

  // ── The catch log is re-read before it is rewritten ─────────

  it('renames the spot at once, and moves the catches of the re-read log', async () => {
    const a = loc('a', 'Molen')
    let release!: () => void
    const store = {
      entries: [fish('1', 'Molen')],
      // The re-read brings in a catch the phone logged meanwhile.
      pullRemote: () => new Promise<void>((r) => { release = () => { store.entries = [fish('3', 'Molen'), fish('1', 'Molen')]; r() } }),
    }
    const done = renameLocation('a', 'Nordmolen', { locations: [a] }, store)
    expect(a.name).toBe('Nordmolen') // the list shows the new name while the log is read
    expect(store.entries[0].locationName).toBe('Molen') // …but no catch is rewritten yet
    release()
    await done
    expect(store.entries.map((c) => c.locationName)).toEqual(['Nordmolen', 'Nordmolen'])
  })

  it('moves the catches to the latest name when the spot was renamed again meanwhile', async () => {
    const a = loc('a', 'Molen')
    const catches = [fish('1', 'Molen')]
    let release!: () => void
    const pending = new Promise<void>((r) => { release = r })
    const store = { entries: catches, pullRemote: () => pending }
    const first = renameLocation('a', 'Nordmolen', { locations: [a] }, store)
    const second = renameLocation('a', 'Havnemolen', { locations: [a] }, store)
    release()
    await Promise.all([first, second])
    expect(a.name).toBe('Havnemolen')
    expect(catches[0].locationName).toBe('Havnemolen')
  })

  it('moves nothing when the spot is gone by the time the log has been read', async () => {
    const a = loc('a', 'Molen')
    const setup = { locations: [a] }
    const catches = [fish('1', 'Molen')]
    const store = { entries: catches, pullRemote: async () => { setup.locations = [] } } // signed out meanwhile
    await renameLocation('a', 'Nordmolen', setup, store)
    expect(catches[0].locationName).toBe('Molen')
  })

  it('still moves the catches when the re-read fails', async () => {
    const a = loc('a', 'Molen')
    const catches = [fish('1', 'Molen')]
    await renameLocation('a', 'Nordmolen', { locations: [a] }, { entries: catches, pullRemote: async () => { throw new Error('offline') } })
    expect(catches[0].locationName).toBe('Nordmolen')
  })

  // ── Catches linked by id ────────────────────────────────────

  it('renames a linked catch whose stored name is out of date', async () => {
    const a = loc('a', 'Nordmolen') // already renamed once, on the phone
    const catches = [{ ...fish('1', 'Molen'), locationId: 'a' }]
    await renameLocation('a', 'Havnemolen', { locations: [a] }, log(catches))
    expect(catches[0].locationName).toBe('Havnemolen')
  })

  it('moves a linked catch even while another spot still carries the old name', async () => {
    const a = loc('a', 'Molen')
    const b = loc('b', 'Molen')
    const catches = [{ ...fish('1', 'Molen'), locationId: 'b' }, { ...fish('2', 'Molen'), locationId: 'a' }, fish('3', 'Molen')]
    await renameLocation('b', 'Nordmolen', { locations: [a, b] }, log(catches))
    expect(catches.map((c) => c.locationName)).toEqual(['Nordmolen', 'Molen', 'Molen'])
    expect(findCatchLocation(catches[0], [a, b])).toBe(b)
    expect(findCatchLocation(catches[1], [a, b])).toBe(a)
  })

  it("does not take another spot's linked catch that happens to carry the old name", async () => {
    const a = loc('a', 'Molen')
    const b = loc('b', 'Havnen')
    const catches = [{ ...fish('1', 'Molen'), locationId: 'b' }]
    await renameLocation('a', 'Nordmolen', { locations: [a, b] }, log(catches))
    expect(catches[0].locationName).toBe('Molen')
    expect(findCatchLocation(catches[0], [a, b])).toBe(b)
  })

  it('treats a catch linked to a deleted spot by its name', async () => {
    const a = loc('a', 'Molen')
    const catches = [{ ...fish('1', 'Molen'), locationId: 'gone' }]
    await renameLocation('a', 'Nordmolen', { locations: [a] }, log(catches))
    expect(catches[0].locationName).toBe('Nordmolen')
  })
})
