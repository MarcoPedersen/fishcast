import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

/**
 * Regression — with site data blocked (Chrome's "don't allow sites to save
 * data", Firefox with cookies off, some in-app browsers), merely reading
 * `window.localStorage` throws a SecurityError. i18n.ts read it while the
 * module loaded, and App.vue, every store and the router import i18n, so
 * createApp never ran: a blank page, with no message. The stores already
 * guarded their own reads and writes; one module-scope read defeated them.
 */
const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!
function blockStorage() {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      const e = new Error("Failed to read the 'localStorage' property from 'Window': Access is denied for this document.")
      e.name = 'SecurityError'
      throw e
    },
  })
}

beforeEach(() => {
  blockStorage()
  vi.resetModules()
})
afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', real)
  vi.resetModules()
})

describe('with site storage blocked', () => {
  it('loads every module the app shell imports at start', async () => {
    const failed: string[] = []
    for (const mod of ['@/lib/i18n', '@/lib/notifications', '@/lib/safeStorage', '@/stores/setup', '@/stores/catches', '@/stores/forecast', '@/stores/coast', '@/stores/session']) {
      try { await import(/* @vite-ignore */ mod) } catch (e) { failed.push(`${mod}: ${(e as Error).name}`) }
    }
    expect(failed).toEqual([])
  })

  it('starts in Danish, and still switches language for the session', async () => {
    const { lang, setLang, t } = await import('@/lib/i18n')
    expect(lang.value).toBe('da')
    expect(() => setLang('en')).not.toThrow()
    expect(lang.value).toBe('en')
    expect(t('close')).toBe('Close')
  })

  it('keeps a preference for the session instead of throwing', async () => {
    const { readStored, writeStored, removeStored } = await import('@/lib/safeStorage')
    expect(readStored('fc2-dash-density')).toBeNull()
    expect(writeStored('fc2-dash-density', 'simple')).toBe(false) // not remembered across visits…
    expect(readStored('fc2-dash-density')).toBe('simple') // …but for this one
    expect(() => removeStored('fc2-dash-density')).not.toThrow()
    expect(readStored('fc2-dash-density')).toBeNull()
  })

  it('answers the reminder checks instead of throwing', async () => {
    const { notifsEnabled, disableNotifications } = await import('@/lib/notifications')
    expect(notifsEnabled()).toBe(false)
    expect(() => disableNotifications()).not.toThrow()
  })

  it('loads, edits and wipes both synced documents (the sign-out path) without throwing', async () => {
    const { useSetupStore } = await import('@/stores/setup')
    const { useCatchStore } = await import('@/stores/catches')
    setActivePinia(createPinia())
    const setup = useSetupStore()
    const catches = useCatchStore()
    setup.loadLocal()
    catches.loadLocal()
    setup.reloadLocal()
    catches.add({ date: '2026-11-01', speciesId: 'torsk', locationName: 'Spot' })
    setup.targetSpecies = ['torsk']
    await Promise.resolve()
    expect(() => { setup.clear(); catches.clear() }).not.toThrow()
    expect(catches.entries).toEqual([])
  })
})

/** The dashboard reads its two display preferences while it sets up: through the guard too. */
describe('storage reads in components', () => {
  const sources = import.meta.glob<string>(['/src/views/DashboardView.vue', '/src/lib/i18n.ts', '/src/lib/notifications.ts'], {
    query: '?raw', import: 'default', eager: true,
  })

  it('go through safeStorage, never localStorage directly', () => {
    expect(Object.keys(sources)).toHaveLength(3)
    expect(Object.entries(sources).filter(([, src]) => /\blocalStorage\./.test(src)).map(([path]) => path)).toEqual([])
  })
})
