import { describe, it, expect } from 'vitest'
import { toggleTarget } from './speciesToggle'
import { SPECIES_PREFS } from './species'

describe('toggleTarget', () => {
  it('selects and deselects an ordinary species', () => {
    expect(toggleTarget([], 'havørred')).toEqual({ selected: ['havørred'], blocked: false })
    expect(toggleTarget(['havørred', 'sild'], 'havørred')).toEqual({ selected: ['sild'], blocked: false })
  })

  it('refuses to select a banned species, and says so', () => {
    expect(SPECIES_PREFS.stenbider.banned).toBe(true) // otherwise the test proves nothing
    expect(toggleTarget(['sild'], 'stenbider')).toEqual({ selected: ['sild'], blocked: true })
  })

  it('lets a banned species that is already selected be removed', () => {
    // A shared setup can carry a banned species in; every click used to
    // re-open the ban notice and leave it selected, with "Reset choices" (which
    // also wipes every time window) the only way out.
    expect(toggleTarget(['stenbider', 'sild'], 'stenbider')).toEqual({ selected: ['sild'], blocked: false })
  })

  /**
   * Cod is banned in the Baltic (ICES 22–32) but legal in the Kattegat,
   * Skagerrak and North Sea (lfst 2026), where several official spots list it.
   * Targeting was blocked everywhere; now it is selected and the ban notice
   * shown, and the dashboard flags Baltic spots.
   */
  it('selects cod but shows its notice', () => {
    expect(toggleTarget(['sild'], 'torsk')).toEqual({ selected: ['sild', 'torsk'], blocked: false, notice: true })
    expect(toggleTarget(['sild', 'torsk'], 'torsk')).toEqual({ selected: ['sild'], blocked: false })
  })
})
