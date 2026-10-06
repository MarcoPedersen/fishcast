import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Load Vue once up front, with no `document`: runtime-dom probes it at import,
// and the stub below is far too small for that.
import 'vue'

// i18n reads the saved language at import time, so each test imports a fresh
// copy after setting up localStorage and a minimal `document`.
async function load(saved: string | null) {
  if (saved) localStorage.setItem('fc2-lang', saved)
  else localStorage.removeItem('fc2-lang')
  vi.resetModules()
  return import('./i18n')
}

let doc: { documentElement: { lang: string } }
beforeEach(() => {
  // index.html ships lang="en" while the UI defaults to Danish
  doc = { documentElement: { lang: 'en' } }
  vi.stubGlobal('document', doc)
})
afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.removeItem('fc2-lang')
})

/**
 * Regression: <html lang> stayed "en" whatever the UI language, so NVDA and
 * TalkBack read the Danish UI with English pronunciation rules.
 */
describe('<html lang> follows the UI language', () => {
  it('is set at startup — Danish by default', async () => {
    await load(null)
    expect(doc.documentElement.lang).toBe('da')
  })

  it('is set at startup from the saved language', async () => {
    doc.documentElement.lang = 'da'
    await load('en')
    expect(doc.documentElement.lang).toBe('en')
  })

  it('follows setLang', async () => {
    const i18n = await load('da')
    i18n.setLang('en')
    expect(doc.documentElement.lang).toBe('en')
    i18n.setLang('da')
    expect(doc.documentElement.lang).toBe('da')
  })

  it('follows a direct write (the setup store adopting an account setup)', async () => {
    const i18n = await load('da')
    doc.documentElement.lang = 'da'
    i18n.lang.value = 'en'
    expect(doc.documentElement.lang).toBe('en')
  })

  it('does not need a document (node tests import i18n too)', async () => {
    vi.unstubAllGlobals()
    await expect(load('da')).resolves.toBeDefined()
  })
})
