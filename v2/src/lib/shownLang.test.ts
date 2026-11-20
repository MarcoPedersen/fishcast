// @vitest-environment vue-dom
/**
 * Review (round E): when the English table fails to load (offline, or gone
 * after a deploy), the language picked stays English while the screen shows
 * Danish (lib/i18n.ts). What else depends on the language followed the pick:
 * a Danish screen named its species in English, gave the wind as "NE" next
 * to Danish text, named the waters of a catch's warning in English, and asked
 * the geocoders for English place names. Each follows the language shown
 * now, and turns English when the table lands.
 *
 * The English chunk fails for this whole file until the last test lets it in.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { h, nextTick } from 'vue'
import { installDocument, mount } from '@/test/fakeDom'

const chunk = vi.hoisted(() => ({ ok: false }))
vi.mock('@/lib/strings.en', async (orig) => {
  if (!chunk.ok) throw new Error('Failed to fetch dynamically imported module: https://example.test/assets/strings.en-x.js')
  return orig()
})

import { dayOfMonth, fmtNum, lang, langReady, setLang, spName, spTip, spWarning } from '@/lib/i18n'
import { SPECIES_PREFS } from '@/lib/species'
import { DK_REGULATIONS } from '@/lib/regulations'
import { DK_SPOTS, locationFromSpot } from '@/lib/spots'
import { catchWarnings } from '@/lib/catchGuard'
import { SEARCH_DEBOUNCE_MS, usePlaceSearch } from '@/lib/placeSearch'
import { reverseGeocode } from '@/lib/geo'
import SeasonsTab from '@/components/SeasonsTab.vue'
import CoastPicker from '@/components/CoastPicker.vue'

const TROUT = SPECIES_PREFS['havørred']
const HORNBAEK = { lat: 56.09027, lon: 12.45693 }
const SPOT = { id: 'L0', ...locationFromSpot(DK_SPOTS[0]) }

let restoreDocument: () => void
beforeAll(async () => {
  restoreDocument = installDocument()
  setLang('en')
  expect(await langReady()).toBe(false) // the chunk failed: Danish on screen
  expect(lang.value).toBe('en') // still the language picked
})
afterAll(() => {
  setLang('da')
  restoreDocument()
})

/** The species names the Seasons tab shows. */
function seasonNames(): string[] {
  const view = mount(SeasonsTab)
  const names = view.root.byClass('sp-head').map((x) => x.byTag('strong')[0]?.textContent ?? '')
  view.unmount()
  return names
}
/** The 16 direction buttons of the coast picker for a catalogue spot, N first. */
function coastDirs(): string[] {
  const view = mount({ render: () => h(CoastPicker, { loc: SPOT }) })
  const dirs = view.root.byClass('cp-dir').map((b) => b.textContent)
  view.unmount()
  return dirs
}
/** The language the place search asks the geocoder for. */
async function searchLang(): Promise<string> {
  vi.useFakeTimers()
  try {
    const search = vi.fn(async (_q: string, _lang: string) => [])
    const s = usePlaceSearch(search)
    s.query.value = 'Hornbæk'
    s.onInput()
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS)
    expect(search).toHaveBeenCalledTimes(1)
    return search.mock.calls[0][1]
  } finally {
    vi.useRealTimers()
  }
}
/** The language a dropped pin's name is asked of Nominatim in. */
async function pinNameLang(): Promise<string | null> {
  const urls: string[] = []
  vi.stubGlobal('fetch', async (url: string) => { urls.push(url); return { json: async () => ({ address: {} }) } })
  try {
    await reverseGeocode(HORNBAEK.lat, HORNBAEK.lon)
  } finally {
    vi.unstubAllGlobals()
  }
  return new URL(urls[0]).searchParams.get('accept-language')
}
/** A bright sea trout kept from the coast at Hornbæk in December: the colour rule names its water. */
const troutWarning = () => catchWarnings('havørred', 55, '2026-12-20', false, 'salt', HORNBAEK).join(' ')

describe('English picked, its table failed: all of it follows the Danish on screen', () => {
  it('the species names, tips and warnings', () => {
    expect(spName(TROUT)).toBe(TROUT.name)
    expect(spTip(TROUT)).toBe(TROUT.tip)
    expect(spWarning(TROUT)).toBe(TROUT.warningText)
  })

  it('the Seasons tab names its species in Danish', () => {
    const names = seasonNames()
    expect(names.length).toBeGreaterThan(5)
    const danish = new Set(DK_REGULATIONS.species.map((s: { name: string }) => s.name))
    expect(names.filter((n) => !danish.has(n))).toEqual([])
  })

  it('the coast picker gives the directions in Danish', () => {
    expect(coastDirs()).toEqual(['N', 'NNØ', 'NØ', 'ØNØ', 'Ø', 'ØSØ', 'SØ', 'SSØ', 'S', 'SSV', 'SV', 'VSV', 'V', 'VNV', 'NV', 'NNV'])
  })

  it("a catch's warning names the water in Danish", () => {
    const w = troutWarning()
    expect(w).toContain('Saltvand')
    expect(w).not.toContain('Saltwater')
  })

  it('the place search and a dropped pin ask for Danish place names', async () => {
    expect(await searchLang()).toBe('da')
    expect(await pinNameLang()).toBe('da')
  })

  it("a date's day of the month keeps the Danish full stop", () => {
    expect(dayOfMonth(9)).toBe('9.')
  })

  it('a decimal keeps the Danish comma', () => {
    expect(fmtNum(2.5)).toBe('2,5')
    expect(fmtNum(4, 1)).toBe('4,0')
  })
})

describe('the table lands', () => {
  it('and all of it turns English', async () => {
    chunk.ok = true
    setLang('en') // a tap on 🇬🇧 tries again
    expect(await langReady()).toBe(true)
    await nextTick()
    expect(spName(TROUT)).toBe(TROUT.nameEn)
    expect(spTip(TROUT)).toBe(TROUT.tipEn)
    const english = new Set(DK_REGULATIONS.species.map((s: { nameEn: string }) => s.nameEn))
    expect(seasonNames().filter((n) => !english.has(n))).toEqual([])
    expect(coastDirs()[2]).toBe('NE')
    expect(troutWarning()).toContain('Saltwater')
    expect(await searchLang()).toBe('en')
    expect(await pinNameLang()).toBe('en')
    expect(dayOfMonth(9)).toBe('9')
    expect(fmtNum(2.5)).toBe('2.5')
  })
})
