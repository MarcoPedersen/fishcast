import { describe, it, expect } from 'vitest'
import { clearWaterGuess, markWaterGuessed, waterGuessed } from './waterGuess'
import { STRINGS } from './strings'

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
    expect(v).toMatch(/function setWater\(l: Location, w: WaterType\) \{\s+l\.waterType = w/)
  })

  it('the map sheet says so beside the water type, and the spot it saves keeps saying so', () => {
    const v = src('/src/views/MapView.vue')
    expect(v).toMatch(/v-if="pending\.guessed"[^>]*>\(\{\{ t\('wt_guessed'\) \}\}\)/)
    expect(v).toMatch(/markWaterGuessed\(/)
  })
})
