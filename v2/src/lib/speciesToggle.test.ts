import { describe, it, expect } from 'vitest'
import { toggleTarget } from './speciesToggle'
import { SPECIES_PREFS } from './species'

describe('toggleTarget', () => {
  it('selects and deselects an ordinary species', () => {
    expect(toggleTarget([], 'havørred')).toEqual({ selected: ['havørred'], blocked: false })
    expect(toggleTarget(['havørred', 'sild'], 'havørred')).toEqual({ selected: ['sild'], blocked: false })
  })

  it('refuses to select a banned species, and says so', () => {
    expect(SPECIES_PREFS.torsk.banned).toBe(true) // otherwise the test proves nothing
    expect(toggleTarget(['sild'], 'torsk')).toEqual({ selected: ['sild'], blocked: true })
  })

  it('lets a banned species that is already selected be removed', () => {
    // A shared setup can carry torsk in; every click used to re-open the ban
    // notice and leave it selected, with "Reset choices" (which also wipes
    // every time window) the only way out.
    expect(toggleTarget(['torsk', 'sild'], 'torsk')).toEqual({ selected: ['sild'], blocked: false })
  })
})
