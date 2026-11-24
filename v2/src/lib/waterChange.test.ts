/**
 * The map's turn to fresh (lib/waterChange useMapFreshTurn) runs once per
 * setup store, however many components ask for it: App.vue and Lokationer
 * both do. App.test.ts runs it mounted, with Lokationer open and not.
 */
import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive } from 'vue'
import { useMapFreshTurn, type WaterSetup } from './waterChange'
import type { CoastAuto } from './coast'
import type { Location } from './types'

const NORDHUSE: Location = { id: 'wc1', name: 'Nordhuse', lat: 55.97, lon: 12.1, waterType: 'brackish' }

describe('the map turn', () => {
  it('watches once for two callers, and stops when the last one is gone', async () => {
    const setup = reactive<WaterSetup>({ locations: [{ ...NORDHUSE }] })
    const coast = { autoFor: vi.fn(() => undefined) }
    const app = effectScope()
    const list = effectScope()
    app.run(() => useMapFreshTurn(setup, coast))
    list.run(() => useMapFreshTurn(setup, coast))
    expect(coast.autoFor).toHaveBeenCalledTimes(1)

    setup.locations = [{ ...NORDHUSE }]
    await nextTick()
    expect(coast.autoFor).toHaveBeenCalledTimes(2)

    app.stop() // the list still holds it
    setup.locations = [{ ...NORDHUSE }]
    await nextTick()
    expect(coast.autoFor).toHaveBeenCalledTimes(3)

    list.stop()
    setup.locations = [{ ...NORDHUSE }]
    await nextTick()
    expect(coast.autoFor).toHaveBeenCalledTimes(3)
  })

  /**
   * The map turned a guess to fresh here. In another tab the user then
   * picked Brakvand, the type first guessed, and this tab reloaded (a new
   * build takes over an open page that way) with that pick already stored.
   * The guess marks outlive the reload, for the visit, and the turn came
   * again: what told a pick from the guess was held in memory, and went.
   */
  it('leaves a type picked in another tab before this tab reloaded', async () => {
    const kept = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => { kept.set(k, v) },
    })
    const inland = { autoFor: () => ({ water: 'inland' }) as CoastAuto }
    try {
      vi.resetModules()
      let guess = await import('./waterGuess')
      let change = await import('./waterChange')
      guess.markWaterGuessed(NORDHUSE.id)
      const before = reactive<WaterSetup>({ locations: [{ ...NORDHUSE }] })
      const tab = effectScope()
      tab.run(() => change.useMapFreshTurn(before, inland))
      await nextTick()
      expect(before.locations[0].waterType).toBe('fresh')
      tab.stop()

      vi.resetModules()
      guess = await import('./waterGuess')
      change = await import('./waterChange')
      const after = reactive<WaterSetup>({ locations: [{ ...NORDHUSE, waterType: 'brackish' }] })
      const reloaded = effectScope()
      reloaded.run(() => change.useMapFreshTurn(after, inland))
      await nextTick()
      expect(after.locations[0].waterType).toBe('brackish')
      expect(guess.waterGuessed(NORDHUSE.id)).toBe(false) // the user's pick, no longer the app's guess
      reloaded.stop()
    } finally {
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  })
})
