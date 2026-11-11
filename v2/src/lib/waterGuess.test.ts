import { describe, it, expect, vi } from 'vitest'
import { clearWaterGuess, guessFollowsMap, markWaterGuessed, waterGuessed } from './waterGuess'
import { STRINGS } from '@/test/strings'
import type { CoastAuto } from './coast'
import type { Location, WaterType } from './types'

/**
 * A searched place or a tapped pin gets its water type from a guess
 * (geo.ts smartDetectWaterType), and the card showed it as a plain choice:
 * "Ferskvand" at Hornbæk, with nothing saying it might be wrong.
 */
describe('a guessed water type', () => {
  it('is a guess until the user picks one', () => {
    expect(waterGuessed('a')).toBe(false)
    markWaterGuessed('a')
    expect(waterGuessed('a')).toBe(true)
    expect(waterGuessed('b')).toBe(false)
    clearWaterGuess('a')
    expect(waterGuessed('a')).toBe(false)
  })

  it('says so in both languages', () => {
    expect(STRINGS.da.wt_guessed).toMatch(/gættet/)
    expect(STRINGS.en.wt_guessed).toMatch(/guess/)
  })

  /**
   * Integration: a new build now takes over the open page by reloading it
   * (swUpdate.ts, on a return to the app or a screen change). Held in memory,
   * the guess went with it: the "gættet" tag was gone, and a lake pin
   * guessed brackish no longer turned fresh when the map found the lake.
   */
  it('outlives a reload of the page, for this visit', async () => {
    const kept = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => { kept.set(k, v) },
    })
    try {
      vi.resetModules()
      const first = await import('./waterGuess')
      first.markWaterGuessed('r1')
      first.markWaterGuessed('r2')
      first.clearWaterGuess('r2')
      vi.resetModules()
      const reloaded = await import('./waterGuess')
      expect(reloaded.waterGuessed('r1')).toBe(true)
      expect(reloaded.waterGuessed('r2')).toBe(false)
    } finally {
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  })

  it('works with the storage blocked, for the page as it is', async () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => { throw new Error('SecurityError') }, setItem: () => { throw new Error('SecurityError') },
    })
    try {
      vi.resetModules()
      const m = await import('./waterGuess')
      m.markWaterGuessed('b1')
      expect(m.waterGuessed('b1')).toBe(true)
    } finally {
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  })
})

/**
 * A pin in mid-Arresø, 3 km from the lake's official spot, is guessed
 * brackish — offline, a lake spot 3 km off is no sign (Hornbæk's lake is 4 km
 * off). The coast lookup then finds the lake and no sea, and the card asked
 * "salt or brackish, or fresh?" about a guess nobody made. A guess follows the
 * map instead; a type the user picked stays, and the check asks.
 */
describe('a guessed water type follows the map', () => {
  const auto = (water: CoastAuto['water']): CoastAuto => ({
    v: 2, at: 0, src: 'versatiles', water, facing: null, nearFacing: null, spread: 180,
    exposure: null, fetchKm: [], pinToWaterM: 0, issues: [],
  })
  const loc = (id: string, waterType: WaterType): Location => ({ id, name: 'Nordhuse', lat: 55.97, lon: 12.1, waterType })

  it('turns fresh where the map finds a lake or river and no sea', () => {
    markWaterGuessed('lake')
    expect(guessFollowsMap(loc('lake', 'brackish'), auto('inland'))).toBe(true)
    expect(guessFollowsMap(loc('lake', 'salt'), auto('inland'))).toBe(true)
    expect(guessFollowsMap(loc('lake', 'brackish'), auto('sea'))).toBe(false)
    expect(guessFollowsMap(loc('lake', 'brackish'), auto('none'))).toBe(false)
    expect(guessFollowsMap(loc('lake', 'brackish'), undefined)).toBe(false)
    expect(guessFollowsMap(loc('lake', 'fresh'), auto('inland'))).toBe(false)
  })

  it('a type the user picked stays', () => {
    expect(guessFollowsMap(loc('picked', 'brackish'), auto('inland'))).toBe(false)
  })

  it('says so in both languages', () => {
    expect(STRINGS.da.wt_map_fresh).toMatch(/\{name\}/)
    expect(STRINGS.en.wt_map_fresh).toMatch(/\{name\}/)
  })
})

describe('where the guess is shown', () => {
  const sources = import.meta.glob<string>(['/src/views/*.vue'], { query: '?raw', import: 'default', eager: true })
  const src = (path: string) => sources[path] ?? ''

  it('the spot card marks a searched place\'s water type as a guess, and a pick clears it', () => {
    const v = src('/src/views/LocationsView.vue')
    expect(v).toMatch(/markWaterGuessed\(id\)/)
    expect(v).toMatch(/v-if="waterGuessed\(l\.id\)"[^>]*>\{\{ t\('wt_guessed'\) \}\}/)
    expect(v).toMatch(/clearWaterGuess\(l\.id\)/)
    // Every control that sets the water type goes through the one function that clears the guess.
    expect(v.match(/\bl\.waterType = /g)).toHaveLength(1)
    expect(v).toMatch(/function setWater\(l: Location, w: WaterType, by: 'user' \| 'map' = 'user'\) \{[\s\S]*?l\.waterType = w\s+if \(by === 'user'\) clearWaterGuess\(l\.id\)/)
  })

  it('the spot card lets a guess follow the map, says so, and can undo it', () => {
    const v = src('/src/views/LocationsView.vue')
    expect(v).toMatch(/if \(guessFollowsMap\(l, coast\.autoFor\(l\)\)\) setWater\(l, 'fresh', 'map'\)/)
    expect(v).toMatch(/by === 'map' \? fill\(t\('wt_map_fresh'\), \{ name: l\.name \}\)/)
    // Undone, the map's answer is the user's "no": the guess goes, so it can't follow again.
    expect(v).toMatch(/run: \(\) => \{ Object\.assign\(l, before\); clearWaterGuess\(l\.id\) \}/)
  })

  it('the map sheet says so beside the water type, and the spot it saves keeps saying so', () => {
    const v = src('/src/views/MapView.vue')
    expect(v).toMatch(/v-if="pending\.guessed"[^>]*>\(\{\{ t\('wt_guessed'\) \}\}\)/)
    expect(v).toMatch(/markWaterGuessed\(/)
  })
})
