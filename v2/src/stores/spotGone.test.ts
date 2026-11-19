/**
 * A spot's toasts go with the spot, however it leaves the list. Only 🗑 in
 * the same tab took them down (LocationsView remove). A spot deleted in
 * another tab or on another device left with a sync: another tab's save
 * (reloadLocal) or a pull from the account put a list without it in place,
 * and its toast stayed, shown or waiting for room. Its Fortryd then did
 * nothing, as the spot was gone. The store takes them down, with the
 * spot's undo history, whichever screen is open: here no screen is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { User } from '@supabase/supabase-js'
import { fakeDb } from '@/test/fakeSupabase'
import { clearToasts, showToast, shownToasts, toasts } from '@/lib/toast'
import { addStep, undoStep } from '@/lib/undoHistory'
import type { Location } from '@/lib/types'
import { useAuthStore } from './auth'
import { useSetupStore } from './setup'

const spot = (id: string, name: string, lat: number): Location => ({ id, name, lat, lon: 12.1, waterType: 'brackish' })
const A = spot('a', 'Nordhuse', 55.97)
const B = spot('b', 'Arresø', 55.98)
const C = spot('c', 'Hornbæk', 56.09)
const D = spot('d', 'Gilleleje', 56.12)

/** A spot's toast as the spot card raises it: keyed by the spot, with Fortryd, which stays until used or closed. */
function cardToast(kind: 'water' | 'moved', id: string) {
  showToast(`${id}: ${kind}`, { key: `${kind}:${id}`, action: { label: 'Fortryd', run: () => {} } })
}
const keys = () => toasts.value.map((t) => t.key)

let setup: ReturnType<typeof useSetupStore>

/** What session.ts does on the storage event: reads the other tab's document back in. */
function otherTabSaved(locations: Location[]) {
  localStorage.setItem('fc2-setup', JSON.stringify({ locations, targetSpecies: ['torsk'], availability: [] }))
  setup.reloadLocal()
}

beforeEach(() => {
  localStorage.clear()
  fakeDb.reset()
  setActivePinia(createPinia())
  setup = useSetupStore()
  setup.locations = [A, B, C, D].map((l) => ({ ...l }))
})
afterEach(() => {
  setup.$dispose()
  clearToasts()
})

describe('a spot that leaves the list by a sync takes its toasts with it', () => {
  it('another tab\'s save without the spot: its water and move toasts go, the others\' stay', async () => {
    cardToast('water', 'a')
    cardToast('moved', 'a')
    cardToast('water', 'b')
    otherTabSaved([B, C, D])
    await nextTick()
    expect(keys()).toEqual(['water:b'])
  })

  it('its undo history goes too: a Fortryd for it later puts nothing back', async () => {
    const undo = vi.fn(() => true)
    addStep('water:a', { said: () => 'a', undo })
    cardToast('water', 'a')
    otherTabSaved([B, C, D])
    await nextTick()
    expect(undoStep('water:a')).toBeUndefined()
    expect(undo).not.toHaveBeenCalled()
  })

  it('a toast waiting for room goes too, and leaves the stack as it was', async () => {
    for (const id of ['a', 'b', 'c', 'd']) cardToast('water', id) // over the cap: a's waits
    expect(toasts.value.find((t) => t.key === 'water:a')?.waiting).toBe(true)
    otherTabSaved([B, C, D])
    await nextTick()
    expect(keys()).toEqual(['water:b', 'water:c', 'water:d'])
    expect(shownToasts.value.map((t) => t.key)).toEqual(['water:b', 'water:c', 'water:d'])
  })

  it('a pull from the account whose row has no such spot', async () => {
    const auth = useAuthStore()
    auth.user = { id: 'u1' } as User
    fakeDb.session = { user: { id: 'u1' } }
    fakeDb.seed('setups', { user_id: 'u1', setup: { locations: [B], targetSpecies: [], availability: [] }, updated_at: new Date(Date.now() + 60_000).toISOString() })
    cardToast('water', 'a')
    cardToast('water', 'b')
    await setup.pullRemote()
    await nextTick()
    expect(setup.locations.map((l) => l.id)).toEqual(['b'])
    expect(keys()).toEqual(['water:b'])
    auth.$dispose()
  })

  // A sync puts a fresh copy of every spot in the list, changed or not: those keep theirs.
  it('a spot replaced by a fresh copy keeps its toasts and its steps', async () => {
    const undo = vi.fn(() => true)
    addStep('water:a', { said: () => 'a', undo })
    cardToast('water', 'a')
    cardToast('moved', 'a')
    const before = setup.locations[0]
    otherTabSaved(setup.locations.map((l) => ({ ...l, name: l.name + ' Strand' })))
    await nextTick()
    expect(setup.locations[0]).not.toBe(before)
    expect(keys()).toEqual(['water:a', 'moved:a'])
    undoStep('water:a')
    expect(undo).toHaveBeenCalledTimes(1)
  })

  // Dragged up or down: the same spots, so no toast goes.
  it('a spot moved in the list keeps its toasts', async () => {
    cardToast('water', 'd')
    const [d] = setup.locations.splice(3, 1)
    setup.locations.splice(0, 0, d)
    await nextTick()
    expect(keys()).toEqual(['water:d'])
  })

  // Signed out in another tab: no logout runs in this page (forgetOnLogout),
  // but that tab's logout wipes the document, and the storage event reads
  // the wipe in here (session.ts onStorage). The spots leave with it, and
  // their Fortryd is not left for whoever uses the page next.
  it('another tab\'s logout, which wipes the document: every spot\'s toasts and steps go', async () => {
    const undo = vi.fn(() => true)
    addStep('water:a', { said: () => 'a', undo })
    cardToast('water', 'a')
    cardToast('moved', 'b')
    localStorage.removeItem('fc2-setup')
    setup.reloadLocal()
    await nextTick()
    expect(setup.locations).toEqual([])
    expect(keys()).toEqual([])
    expect(undoStep('water:a')).toBeUndefined()
    expect(undo).not.toHaveBeenCalled()
  })
})
