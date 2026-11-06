import { describe, it, expect } from 'vitest'
import { tripPrefill } from './tripPrefill'
import { tripFormIssues } from './catchScore'
import type { Availability, CatchEntry, Location } from './types'

const LOCS: Location[] = [
  { id: 'L1', name: 'Mole', lat: 56.09, lon: 12.46, waterType: 'salt' },
  { id: 'L2', name: 'Strand', lat: 56.0, lon: 12.0, waterType: 'salt' },
]
const NOW = new Date(2026, 10, 6, 11, 51, 10).getTime()
const catchAt = (time: string, locationId = 'L1'): CatchEntry => ({
  id: 'c' + time, date: '2026-11-06', time, speciesId: 'havørred', locationName: LOCS.find((l) => l.id === locationId)!.name, locationId, count: 1,
})
const tripOf = (p: ReturnType<typeof tripPrefill>): CatchEntry => ({
  id: '', outcome: 'empty', date: p.date, from: p.from, to: p.to, speciesId: '', locationName: p.loc,
  locationId: LOCS.find((l) => l.name === p.loc)?.id,
})

/**
 * "∅ Uden fangst" right after logging a catch filled in that catch's spot and
 * the last two hours: a trip that holds the catch. The form opened on "Du har
 * allerede registreret en fangst her i det tidsrum." with Save disabled.
 */
describe('tripPrefill', () => {
  it('leaves the spot empty when the newest entry\'s spot would hold a catch in the span', () => {
    const entries = [catchAt('11:49')]
    const p = tripPrefill([], entries, LOCS, NOW)
    expect(p).toMatchObject({ date: '2026-11-06', from: '09:51', to: '11:51', loc: '' })
    expect(tripFormIssues(tripOf(p), entries, LOCS, NOW)).not.toContain('catch')
  })

  it('leaves it empty when another trip there overlaps the span', () => {
    const trip: CatchEntry = { id: 't1', outcome: 'empty', date: '2026-11-06', from: '09:00', to: '11:00', speciesId: '', locationName: 'Mole', locationId: 'L1', count: 0 }
    const p = tripPrefill([], [trip], LOCS, NOW)
    expect(p.loc).toBe('')
  })

  it('keeps the newest entry\'s spot when the trip it makes can be saved', () => {
    const entries = [catchAt('07:10')] // caught this morning, before the span
    const p = tripPrefill([], entries, LOCS, NOW)
    expect(p.loc).toBe('Mole')
    expect(tripFormIssues(tripOf(p), entries, LOCS, NOW)).toEqual([])
  })

  it('takes the time window just fished, and its only method', () => {
    const av: Availability[] = [{ id: 'a', days: [0, 1, 2, 3, 4, 5, 6], from: '06:00', to: '10:00', methods: ['waders'] }]
    const p = tripPrefill(av, [], LOCS, NOW)
    expect(p).toEqual({ date: '2026-11-06', from: '06:00', to: '10:00', loc: '', method: 'waders' })
  })

  it('leaves the spot out when asked to — after a trip was just saved there', () => {
    expect(tripPrefill([], [catchAt('07:10')], LOCS, NOW, false).loc).toBe('')
  })
})

describe('the catch log', () => {
  const sources = import.meta.glob<string>(['/src/views/CatchLogView.vue'], { query: '?raw', import: 'default', eager: true })
  it('prefills a trip with tripPrefill', () => {
    expect(sources['/src/views/CatchLogView.vue']).toMatch(/const p = tripPrefill\(setup\.availability, log\.sorted, setup\.locations, Date\.now\(\), withSpot\)/)
  })
})
