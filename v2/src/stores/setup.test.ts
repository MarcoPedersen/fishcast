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
