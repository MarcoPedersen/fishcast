import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import type { User } from '@supabase/supabase-js'
import { useCatchStore } from './catches'
import { useSetupStore } from './setup'
import { useAuthStore } from './auth'
import { refusedKey, useLocalSaveStore } from './localSave'
import { clearToasts, dismissToast, toasts } from '@/lib/toast'
import { langReady, setLang } from '@/lib/i18n'
import { fakeDb } from '@/test/fakeSupabase'
import { fakeQuota } from '@/test/fakeQuota'
import { STRINGS } from '@/test/strings'

/**
 * A save on the device that the storage refuses (full, or site data
 * blocked). It used to be silent: a guest's edit showed on screen, the stored
 * log kept the old version, and a reload lost the edit without a word. Now the
 * user is told once per failure streak, in words that are true for them.
 */

const JUNK = '__junk'
const CATCH = { date: '2026-09-30', speciesId: 'torsk', locationName: 'Hornbæk' }
const HORNBAEK = { id: 'h', name: 'Hornbæk', lat: 56.09027, lon: 12.45693 }
const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? 'null')
const shown = () => toasts.value.map((t) => [t.type, t.message])
const da = (key: string) => '⚠️ ' + STRINGS.da[key]
/** Fill the storage with someone else's data, leaving `room` characters free. */
function fill(room: number) {
  let used = 0
  for (let i = 0; i < localStorage.length; i++) used += localStorage.getItem(localStorage.key(i)!)!.length
  localStorage.setItem(JUNK, 'j'.repeat(1000))
  fakeQuota(used + 1000 + room)
}

beforeEach(() => {
  localStorage.clear()
  fakeDb.reset()
  clearToasts()
  setActivePinia(createPinia())
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  clearToasts()
  localStorage.clear()
})

describe('a guest whose edit the device refuses', () => {
  it('is told once that the edit is lost when the app closes; the stored log keeps the old note', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const c = useCatchStore()
    c.add({ ...CATCH, notes: 'old' })
    await nextTick()
    fill(5)
    const e = c.entries[0]
    c.update(e.id, { ...e, notes: 'a much longer note' })
    await nextTick()
    expect(c.entries[0].notes).toBe('a much longer note') // on screen…
    expect(stored('fc2-catches').entries[0].notes).toBe('old') // …but not on the device
    expect(shown()).toEqual([['error', da('toast_save_full')]])
    // It stays until closed: told once, it would be easy to miss in 6 s.
    vi.advanceTimersByTime(60_000)
    expect(shown()).toEqual([['error', da('toast_save_full')]])
    // Typing on: every keystroke saves, and is refused — no new toast, and
    // once closed it doesn't come back while the streak lasts.
    dismissToast(toasts.value[0].id)
    for (const n of ['a much longer note!', 'a much longer note!!', 'a much longer note!!!']) {
      c.update(e.id, { ...e, notes: n })
      await nextTick()
    }
    expect(shown()).toEqual([])
  })

  it('a save that fits again ends the streak: the toast goes, and the next refusal says so again', async () => {
    const c = useCatchStore()
    c.add({ ...CATCH, notes: 'keep' })
    c.add({ ...CATCH, notes: 'x'.repeat(200) })
    await nextTick()
    fill(5)
    const keep = c.entries.find((e) => e.notes === 'keep')!
    c.update(keep.id, { ...keep, notes: 'keep this longer note' })
    await nextTick()
    expect(shown()).toEqual([['error', da('toast_save_full')]])
    // Deleting the other catch makes room: the edit is saved with it.
    c.remove(c.entries.find((e) => e.notes!.startsWith('xxx'))!.id)
    await nextTick()
    expect(stored('fc2-catches').entries.map((e: { notes: string }) => e.notes)).toEqual(['keep this longer note'])
    expect(shown()).toEqual([])
    c.update(keep.id, { ...keep, notes: 'y'.repeat(400) })
    await nextTick()
    expect(shown()).toEqual([['error', da('toast_save_full')]])
  })

  it('room made in the other document saves the refused one too', async () => {
    const c = useCatchStore()
    const s = useSetupStore()
    c.add({ ...CATCH, notes: 'x'.repeat(300) })
    await nextTick()
    fill(5)
    s.locations.push(HORNBAEK)
    await nextTick()
    expect(stored('fc2-setup')).toBeNull()
    expect(shown()).toEqual([['error', da('toast_save_full')]])
    c.remove(c.entries[0].id)
    await nextTick()
    expect(stored('fc2-setup').locations.map((l: { id: string }) => l.id)).toEqual(['h'])
    expect(shown()).toEqual([])
  })

  it('a save of the other document that fits does not end the streak while this one is still refused', async () => {
    const c = useCatchStore()
    const s = useSetupStore()
    s.locations.push({ ...HORNBAEK })
    await nextTick()
    fill(5)
    c.add({ ...CATCH, notes: 'too long to fit' })
    await nextTick()
    expect(shown()).toEqual([['error', da('toast_save_full')]])
    s.locations[0].name = 'Hb' // shorter: the spots fit
    await nextTick()
    expect(stored('fc2-setup').locations[0].name).toBe('Hb')
    expect(stored('fc2-catches')).toBeNull()
    expect(shown()).toEqual([['error', da('toast_save_full')]])
  })

  it('the toast follows a language switch', async () => {
    const c = useCatchStore()
    fill(0)
    c.add(CATCH)
    await nextTick()
    expect(shown()).toEqual([['error', da('toast_save_full')]])
    vi.restoreAllMocks() // the language is a preference: let it be stored
    try {
      setLang('en')
      expect(await langReady()).toBe(true)
      expect(shown()).toEqual([['error', '⚠️ ' + STRINGS.en.toast_save_full]])
    } finally {
      setLang('da')
    }
  })

  it('after a sign-out wiped both documents, a refused edit is told again', async () => {
    const c = useCatchStore()
    const s = useSetupStore()
    fill(0)
    c.add(CATCH)
    await nextTick()
    expect(shown()).toHaveLength(1)
    // What session.logout does once signOut has worked.
    s.clear()
    c.clear()
    clearToasts()
    await nextTick()
    c.add(CATCH)
    await nextTick()
    expect(shown()).toEqual([['error', da('toast_save_full')]])
  })

  it('the same after a refused edit of the spots', async () => {
    const c = useCatchStore()
    const s = useSetupStore()
    fill(0)
    s.locations.push({ ...HORNBAEK })
    await nextTick()
    expect(shown()).toHaveLength(1)
    s.clear()
    c.clear()
    clearToasts()
    await nextTick()
    s.locations.push({ ...HORNBAEK })
    await nextTick()
    expect(shown()).toEqual([['error', da('toast_save_full')]])
  })

  // What the updater asks before a reload it makes by itself (lib/swUpdate):
  // that reload would lose an edit that lives only in memory.
  it('atRisk says while the edit lives only in memory, until room is made', async () => {
    const c = useCatchStore()
    const local = useLocalSaveStore()
    c.add({ ...CATCH, notes: 'x'.repeat(200) })
    await nextTick()
    expect(local.atRisk()).toBe(false)
    fill(5)
    c.add(CATCH)
    await nextTick()
    expect(local.atRisk()).toBe(true)
    c.remove(c.entries.find((e) => e.notes)!.id)
    await nextTick()
    expect(local.atRisk()).toBe(false)
  })
})

describe('with site data blocked (every storage access throws)', () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('Access is denied for this document.', 'SecurityError') },
    })
  })
  afterEach(() => { Object.defineProperty(globalThis, 'localStorage', real) })

  // Nothing a guest does survives a reload here, and no save will ever work
  // this visit: one toast, at the first edit, that says why and what helps.
  it('a guest is told once per visit, at the first edit, whichever document it is', async () => {
    const c = useCatchStore()
    const s = useSetupStore()
    c.loadLocal()
    s.loadLocal()
    await nextTick()
    expect(shown()).toEqual([])
    c.add(CATCH)
    await nextTick()
    expect(shown()).toEqual([['error', da('toast_save_blocked_login')]])
    dismissToast(toasts.value[0].id)
    s.locations.push(HORNBAEK)
    s.targetSpecies = ['torsk']
    c.add(CATCH)
    await nextTick()
    expect(shown()).toEqual([])
  })
})

describe('signed in', () => {
  const A = 'user-a'
  /** Signed in and hydrated, as session.hydrate does it; the storage takes nothing more. */
  async function signedIn() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    useAuthStore().user = { id: A } as User
    fakeDb.session = { user: { id: A } }
    fakeDb.seed('catches', { user_id: A, entries: [{ ...CATCH, id: 'c1' }], updated_at: '2026-09-01T00:00:00.000Z' })
    fill(0)
    const c = useCatchStore()
    c.pauseSync()
    await c.pullRemote() // its adopt is refused: nothing only this device holds, so nothing to say
    c.markReady()
    expect(c.entries).toHaveLength(1)
    expect(shown()).toEqual([])
    return c
  }
  async function settle() {
    await nextTick()
    await vi.advanceTimersByTimeAsync(2000)
    for (let i = 0; i < 10; i++) await Promise.resolve()
  }

  it('online: told the edit reaches the account; once it has, the warning comes down', async () => {
    const c = await signedIn()
    c.update('c1', { ...CATCH, notes: 'edited' })
    await nextTick()
    expect(shown()).toEqual([['error', da('toast_save_account')]])
    await settle()
    expect(fakeDb.row('catches', A)!.entries[0].notes).toBe('edited')
    // Its save after the push is refused too, but holds nothing at risk.
    expect(shown()).toEqual([])
  })

  it('atRisk: the edit lives only in memory until the push lands, not after', async () => {
    const c = await signedIn()
    const local = useLocalSaveStore()
    c.update('c1', { ...CATCH, notes: 'edited' })
    await nextTick()
    expect(local.atRisk()).toBe(true)
    await settle()
    expect(local.atRisk()).toBe(false)
  })

  // "Ændringer er gemt lokalt" was untrue here: the device refused them too.
  it('offline: the failed sync says the device has no copy either', async () => {
    const c = await signedIn()
    fakeDb.failWrites = true
    c.update('c1', { ...CATCH, notes: 'edited' })
    await settle()
    expect(shown()).toEqual([['error', da('toast_save_account')], ['error', da('toast_sync_failed_unsaved')]])
  })

  it('the spots too: a failed pull, then a failed push, say the device has no copy either', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    useAuthStore().user = { id: A } as User
    fakeDb.session = { user: { id: A } }
    fill(0)
    const s = useSetupStore()
    s.pauseSync()
    s.targetSpecies = ['torsk'] // an edit while sync is disarmed: refused
    await nextTick()
    fakeDb.failReads = true
    await s.pullRemote()
    expect(shown()).toEqual([['error', da('toast_save_account')], ['error', da('toast_sync_failed_unsaved')]])
    fakeDb.failReads = false
    fakeDb.failWrites = true
    await s.pullRemote() // no row yet: the edit is claimed, and its push fails
    expect(fakeDb.requests.some((r) => r.table === 'setups' && r.outcome === 'offline')).toBe(true)
    expect(shown()).toEqual([['error', da('toast_save_account')], ['error', da('toast_sync_failed_unsaved')]])
  })

  it("a failed sync with the device's copy saved still says it is saved locally", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    useAuthStore().user = { id: A } as User
    fakeDb.session = { user: { id: A } }
    const c = useCatchStore()
    c.pauseSync()
    await c.pullRemote()
    c.markReady()
    fakeDb.failWrites = true
    c.add(CATCH)
    await settle()
    expect(shown()).toEqual([['error', da('toast_sync_failed')]])
  })
})

describe('refusedKey: the words for who the user is and why the device refused', () => {
  it('signed in: the edit reaches the account when online, whatever the cause', () => {
    expect(refusedKey({ account: true, blocked: false, canSignIn: true })).toBe('toast_save_account')
    expect(refusedKey({ account: true, blocked: true, canSignIn: true })).toBe('toast_save_account')
  })
  it('a guest with the storage full: make room (signing in would need room for the session too)', () => {
    expect(refusedKey({ account: false, blocked: false, canSignIn: true })).toBe('toast_save_full')
    expect(refusedKey({ account: false, blocked: false, canSignIn: false })).toBe('toast_save_full')
  })
  it('a guest with site data blocked: allow it, or sign in where this build has accounts', () => {
    expect(refusedKey({ account: false, blocked: true, canSignIn: true })).toBe('toast_save_blocked_login')
    expect(refusedKey({ account: false, blocked: true, canSignIn: false })).toBe('toast_save_blocked')
  })
  it('every one of them is in both languages', () => {
    for (const key of ['toast_save_account', 'toast_save_full', 'toast_save_blocked_login', 'toast_save_blocked', 'toast_sync_failed_unsaved']) {
      expect([key, typeof STRINGS.da[key], typeof STRINGS.en[key]]).toEqual([key, 'string', 'string'])
    }
  })
})
