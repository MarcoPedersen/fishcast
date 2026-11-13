import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { useCatchStore } from './catches'
import { clearToasts, toasts } from '@/lib/toast'
import { STRINGS } from '@/test/strings'

// A build with no accounts (Supabase not configured), as some deploys run.
vi.mock('@/lib/supabase', () => ({ supabase: null, supabaseConfigured: false }))

describe('a build without accounts, with site data blocked', () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')!
  beforeEach(() => {
    clearToasts()
    setActivePinia(createPinia())
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('Access is denied for this document.', 'SecurityError') },
    })
  })
  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', real)
    clearToasts()
  })

  // There is nowhere to log in: the way out is allowing the site to save.
  it('tells the guest to allow the site to save data, not to log in', async () => {
    const c = useCatchStore()
    c.add({ date: '2026-09-30', speciesId: 'torsk', locationName: 'Hornbæk' })
    await nextTick()
    expect(toasts.value.map((t) => [t.type, t.message])).toEqual([['error', '⚠️ ' + STRINGS.da.toast_save_blocked]])
  })
})
