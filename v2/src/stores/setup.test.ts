import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useSetupStore } from './setup'

const LS_KEY = 'fc2-setup'
const read = () => {
  const raw = localStorage.getItem(LS_KEY)
  return raw ? JSON.parse(raw) : null
}

describe('setup store — local persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('stamps updatedAt on a genuine edit once sync is armed', async () => {
    const s = useSetupStore()
    s.markReady()
    s.locations.push({ id: 'a', name: 'A', lat: 56, lon: 10 })
    await nextTick()
    const saved = read()
    expect(saved.locations).toHaveLength(1)
    expect(saved.updatedAt).toBeGreaterThan(0)
  })

  it('does not stamp during hydration (before markReady)', async () => {
    const s = useSetupStore()
    s.locations.push({ id: 'a', name: 'A', lat: 56, lon: 10 })
    await nextTick()
    expect(read().updatedAt).toBe(0)
  })

  /**
   * Regression — the sign-out data-loss bug. clear() empties state, but the deep
   * watcher fires afterwards; it used to stamp a fresh updatedAt onto the wiped
   * state and re-save it. That made the wipe look like the newest edit, so the
   * next login kept the empty local copy and overwrote the account's real data.
   * After clear() the key must simply be gone.
   */
  it('clear() leaves no rewritten state behind (no fresh stamp on a wipe)', async () => {
    const s = useSetupStore()
    s.markReady()
    s.locations.push({ id: 'a', name: 'A', lat: 56, lon: 10 })
    s.availability.push({ id: 'av', days: [1], from: '06:00', to: '10:00', methods: ['shore'] })
    await nextTick()
    expect(read().locations).toHaveLength(1)

    s.clear()
    await nextTick()
    await nextTick() // watcher flush + the clearing-flag release

    expect(localStorage.getItem(LS_KEY)).toBeNull()
    expect(s.locations).toHaveLength(0)
    expect(s.availability).toHaveLength(0)
  })

  it('resumes stamping normally after a clear', async () => {
    const s = useSetupStore()
    s.markReady()
    s.clear()
    await nextTick()
    await nextTick()

    s.locations.push({ id: 'b', name: 'B', lat: 55, lon: 12 })
    await nextTick()
    const saved = read()
    expect(saved.locations).toHaveLength(1)
    expect(saved.updatedAt).toBeGreaterThan(0)
  })
})

describe('setup store — species enrichment', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  // Dragør harbour — an official spot sits well within the 12 km lookup radius,
  // which is what makes the spot-relevance bonus reachable for a custom pin.
  const NEAR_OFFICIAL = { id: 'd1', name: 'Dragør mole', lat: 55.5926, lon: 12.6716 }

  it('fills in species for a location added without them', async () => {
    const s = useSetupStore()
    s.markReady()
    s.locations.push({ ...NEAR_OFFICIAL })
    const changed = await s.enrichMissingSpecies()
    expect(changed).toBe(1)
    expect(s.locations[0].species!.length).toBeGreaterThan(0)
  })

  it('reports nothing changed on a second pass', async () => {
    const s = useSetupStore()
    s.markReady()
    s.locations.push({ ...NEAR_OFFICIAL })
    await s.enrichMissingSpecies()
    expect(await s.enrichMissingSpecies()).toBe(0)
  })

  /**
   * The actual regression: enrichment used to run only at bootstrap, so a spot
   * added from search or the map kept an empty species list for the rest of the
   * session and scored up to 12 points below an official spot in the same place.
   * Adding one must now enrich it without any explicit call.
   */
  it('enriches a location added mid-session, with no explicit call', async () => {
    const s = useSetupStore()
    s.markReady()
    s.locations.push({ ...NEAR_OFFICIAL })
    // watcher → enrichMissingSpecies() → dynamic import → mutation
    for (let i = 0; i < 10 && !s.locations[0].species?.length; i++) {
      await nextTick()
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(s.locations[0].species?.length ?? 0).toBeGreaterThan(0)
  })

  it('leaves a location with no official spot in range empty', async () => {
    const s = useSetupStore()
    s.markReady()
    // Mid-North Sea: nothing within the lookup radius.
    s.locations.push({ id: 'sea', name: 'Open water', lat: 56.5, lon: 3.0 })
    expect(await s.enrichMissingSpecies()).toBe(0)
    expect(s.locations[0].species ?? []).toHaveLength(0)
  })
})
