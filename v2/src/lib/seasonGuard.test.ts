import { describe, it, expect } from 'vitest'
import { windowSeasonFlags } from './seasonGuard'
import type { Location, ScoredWindow } from './types'

// Window dates are UTC midnight of the local calendar day (scoring.ts).
const win = (loc: Location, y: number, m: number, d: number, from = '18:00', to = '21:00') =>
  ({ location: loc, date: new Date(Date.UTC(y, m - 1, d)), from, to, score: 70, noData: false, tags: [] }) as unknown as ScoredWindow
const flags = (w: ScoredWindow, targets: string[]) =>
  windowSeasonFlags(w, targets).map((f) => `${f.id}:${f.level}`)

const ARRESO: Location = { id: 'a', name: 'Arresø', lat: 56.0002, lon: 12.0858, waterType: 'fresh' }
const FORNAES: Location = { id: 'f', name: 'Fornæs Fyr', lat: 56.4441, lon: 10.959, waterType: 'brackish' }
const DRAGOR: Location = { id: 'd', name: 'Dragør Havn', lat: 55.5931, lon: 12.672, waterType: 'brackish' }

/**
 * The dashboard scored a pike target at Arresø "70 Godt" on 12 Apr 2026, inside
 * the freshwater pike closure (15 Mar – 30 Apr), with nothing on the card. The
 * score stays as it is; the card says the fish is protected that day.
 */
describe('windowSeasonFlags', () => {
  it('flags a pike target at a lake in April', () => {
    expect(flags(win(ARRESO, 2026, 4, 12), ['gedde'])).toEqual(['gedde:closed'])
    expect(flags(win(ARRESO, 2026, 6, 12), ['gedde'])).toEqual([])
  })

  it('flags only the targets that are closed', () => {
    expect(flags(win(ARRESO, 2026, 4, 12), ['gedde', 'aborre', 'brasen'])).toEqual(['gedde:closed'])
  })

  /**
   * The scorer rates every target at every location, so the rules of the
   * location's water decide, not where the species "usually" lives. A sea
   * trout target at a river location scored 47 "Middel" on 10 Jan 2026 with no
   * flag, though fresh water is closed 16 Nov – end of February (lfst
   * freshwater list: "Havørred 16. november - 28. (29.) februar").
   */
  it('flags a sea trout target in fresh water in its freshwater closure', () => {
    const RIVER: Location = { id: 'r', name: 'Å', lat: 56.3552, lon: 9.5847, waterType: 'fresh' }
    expect(flags(win(RIVER, 2026, 2, 10), ['havørred'])).toEqual(['havørred:closed'])
    expect(flags(win(RIVER, 2026, 1, 10), ['havørred'])).toEqual(['havørred:closed'])
    expect(flags(win(ARRESO, 2026, 12, 20), ['havørred'])).toEqual(['havørred:closed'])
    expect(flags(win(RIVER, 2026, 3, 10), ['havørred'])).toEqual([])
  })

  it('takes both rule sets at a location of both waters', () => {
    // 'both' is a valid water type (share links, saved locations); it matched
    // no species' water, so every flag was dropped there.
    const BOTH: Location = { ...ARRESO, waterType: 'both' }
    expect(flags(win(BOTH, 2026, 4, 12), ['gedde'])).toEqual(['gedde:closed'])
  })

  it('hedges the coastal sea trout rule (only fish in spawning colours)', () => {
    expect(flags(win(FORNAES, 2026, 12, 20), ['havørred'])).toEqual(['havørred:maybe'])
    expect(flags(win(FORNAES, 2026, 7, 1), ['havørred'])).toEqual([])
  })

  it('flags cod in the Baltic, not in the Kattegat', () => {
    expect(flags(win(DRAGOR, 2026, 11, 10), ['torsk'])).toEqual(['torsk:closed'])
    expect(flags(win(FORNAES, 2026, 11, 10), ['torsk'])).toEqual([])
  })

  it('checks the next day too for an overnight window', () => {
    // Salmon in fresh water close 16 Nov: a 15 Nov 22:00 – 02:00 window runs into it.
    const RIVER: Location = { id: 'r', name: 'Å', lat: 56.3552, lon: 9.5847, waterType: 'fresh' }
    expect(flags(win(RIVER, 2026, 11, 14, '22:00', '02:00'), ['laks'])).toEqual([])
    expect(flags(win(RIVER, 2026, 11, 15, '22:00', '02:00'), ['laks'])).toEqual(['laks:closed'])
    expect(flags(win(RIVER, 2026, 11, 15, '18:00', '21:00'), ['laks'])).toEqual([])
  })

  /**
   * Integration: a window is scored on the hours [from, to) (scoring.ts
   * windowHours), so one ending at 00:00 has no hour on the next day. Every
   * overnight window still took the next day's rules: the last open evening
   * before a closure (sea trout and salmon in a river on 15 Nov, pike at a
   * lake on 14 Mar) read "🚫 Fredningstid".
   */
  it('checks the days the window is scored on: one ending at midnight stays on its own day', () => {
    const RIVER: Location = { id: 'r', name: 'Å', lat: 56.3552, lon: 9.5847, waterType: 'fresh' }
    expect(flags(win(RIVER, 2026, 11, 15, '18:00', '00:00'), ['havørred', 'laks'])).toEqual([])
    expect(flags(win(ARRESO, 2026, 3, 14, '18:00', '00:00'), ['gedde'])).toEqual([])
    // Half an hour past midnight is an hour on the next day.
    expect(flags(win(RIVER, 2026, 11, 15, '18:00', '00:30'), ['havørred'])).toEqual(['havørred:closed'])
  })

  /**
   * A pin the app can't classify is typed brackish, inland ones included
   * (geo.ts). Brackish took the saltwater rules only, so a pike target at
   * such a pin on 20 Mar carried no flag. The freshwater closures are a
   * maybe there; the saltwater ones still close for certain.
   */
  it('hedges the freshwater closures at a brackish location', () => {
    const PIN: Location = { id: 'p', name: 'Pin', lat: 56.17, lon: 9.55, waterType: 'brackish' }
    expect(flags(win(PIN, 2026, 3, 20), ['gedde'])).toEqual(['gedde:maybe'])
    expect(flags(win(PIN, 2026, 5, 10), ['sandart'])).toEqual(['sandart:maybe'])
    expect(flags(win(PIN, 2026, 4, 10), ['gedde'])).toEqual(['gedde:closed'])     // salt 1 Apr – 15 May
    // A coastal spot in February: a maybe (the streams are closed), not "closed".
    expect(flags(win(FORNAES, 2026, 2, 10), ['havørred'])).toEqual(['havørred:maybe'])
  })
})
