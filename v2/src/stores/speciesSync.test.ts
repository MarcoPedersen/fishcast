import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import type { User } from '@supabase/supabase-js'
import { fakeDb } from '@/test/fakeSupabase'
import { speciesFromNearby } from '@/lib/geo'
import { useAuthStore } from './auth'
import { useSetupStore } from './setup'

/**
 * A species list emptied on one device, then a start on another, through the
 * account's row (the in-memory Supabase fake). The other device's refill
 * took the emptied list for one never filled (enrichMissingSpecies), filled
 * it from the official spots nearby and pushed that back: cleared on the
 * phone, a pin in mid-Arresø had the lake's fish again on every device.
 */

const A = 'user-a'
const T = Date.parse('2026-09-01T00:00:00.000Z')
const ARRESO = { id: 'arr', name: 'Arresø', lat: 55.97, lon: 12.1, waterType: 'fresh' as const }
const AVAIL = { id: 'av', days: [1], from: '06:00', to: '10:00', methods: ['shore'] }
const rowSpecies = () => fakeDb.row('setups', A)?.setup.locations[0].species

/** One app start on a storage of its own, signed in: pull, arm sync, then the start's refill (session.ts). */
async function start() {
  localStorage.clear()
  setActivePinia(createPinia())
  useAuthStore().user = { id: A } as User
  fakeDb.session = { user: { id: A } }
  const setup = useSetupStore()
  setup.loadLocal()
  setup.pauseSync()
  await setup.pullRemote()
  setup.markReady()
  await setup.enrichMissingSpecies()
  return setup
}
/** Let the watcher run, the push debounce fire, and the push settle. */
async function settle() {
  await nextTick()
  await vi.advanceTimersByTimeAsync(2000)
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(T)
  fakeDb.reset()
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  localStorage.clear()
})

describe('a species list emptied on one device', () => {
  it('stays empty on the account and on the next device to start', async () => {
    fakeDb.seed('setups', {
      user_id: A, updated_at: new Date(T).toISOString(),
      setup: { locations: [{ ...ARRESO, species: speciesFromNearby(ARRESO.lat, ARRESO.lon, 'fresh') }], targetSpecies: [], availability: [AVAIL], lang: 'da' },
    })
    const phone = await start()
    phone.locations[0].species = [] // the last species tapped off
    await settle()
    await phone.enrichMissingSpecies()
    await settle()
    expect(rowSpecies()).toEqual([])
    phone.$dispose()

    const desktop = await start()
    desktop.locations[0].note = 'any edit runs the refill'
    await settle()
    expect(desktop.locations[0].species).toEqual([])
    expect(rowSpecies()).toEqual([])
    desktop.$dispose()
  })
})
