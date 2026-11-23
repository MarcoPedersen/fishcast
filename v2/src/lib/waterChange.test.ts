/**
 * The map's turn to fresh (lib/waterChange useMapFreshTurn) runs once per
 * setup store, however many components ask for it: App.vue and Lokationer
 * both do. App.test.ts runs it mounted, with Lokationer open and not.
 */
import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive } from 'vue'
import { useMapFreshTurn, type WaterSetup } from './waterChange'
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
})
