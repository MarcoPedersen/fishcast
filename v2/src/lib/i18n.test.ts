import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// Load Vue once up front, with no `document`: runtime-dom probes it at import,
// and the stub below is far too small for that.
import 'vue'

// i18n reads the saved language at import time, so each test imports a fresh
// copy after setting up localStorage and a minimal `document`.
let loaded: typeof import('./i18n') | undefined
async function load(saved: string | null) {
  if (saved) localStorage.setItem('fc2-lang', saved)
  else localStorage.removeItem('fc2-lang')
  vi.resetModules()
  loaded = await import('./i18n')
  return loaded
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
  // A switch to English sets the real English table on its way: let it land
  // within the test, not later in a test that stands in for it.
  afterEach(async () => {
    loaded!.lang.value = 'en'
    await loaded!.langReady()
  })

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

/**
 * The English table is a chunk of its own (strings.en.ts): it was ~27% of
 * the main chunk, ~14 KB gz that a Danish user downloaded and parsed on every
 * first visit and after every deploy for nothing. Here the chunk is a
 * stand-in each test lets arrive (or fail) when it says so.
 */
describe('the English table, fetched only for English', () => {
  type Pending = { arrive: () => void; fail: (e: Error) => void }
  let fetches: Pending[]
  beforeEach(() => {
    fetches = []
    vi.doMock('./strings.en', () => new Promise((resolve, reject) => {
      fetches.push({ arrive: () => resolve({ STRINGS_EN: { close: 'Close' } }), fail: reject })
    }))
  })
  afterEach(() => { vi.doUnmock('./strings.en') })
  // Long enough for a dynamic import to reach the mock and settle.
  const settle = () => new Promise((r) => setTimeout(r, 20))

  it('is not fetched for Danish', async () => {
    const i18n = await load('da')
    await settle()
    expect(fetches).toHaveLength(0)
    expect(i18n.t('close')).toBe('Luk')
  })

  it("is fetched on setLang('en'); t() reads Danish until it is in, then English", async () => {
    const i18n = await load('da')
    i18n.setLang('en')
    expect(i18n.lang.value).toBe('en')
    expect(i18n.t('close')).toBe('Luk')
    await settle()
    expect(fetches).toHaveLength(1)
    expect(i18n.t('close')).toBe('Luk')
    fetches[0].arrive()
    await vi.waitFor(() => expect(i18n.t('close')).toBe('Close'))
    expect(i18n.t('back')).toBe('← Tilbage') // a key this stand-in lacks: Danish, as before
  })

  it('is fetched on a direct write to lang too (the setup store adopting an account’s setup)', async () => {
    const i18n = await load('da')
    i18n.lang.value = 'en'
    await settle()
    expect(fetches).toHaveLength(1)
    expect(i18n.t('close')).toBe('Luk')
    fetches[0].arrive()
    await vi.waitFor(() => expect(i18n.t('close')).toBe('Close'))
  })

  it('is fetched at startup for a saved English, and langReady waits for it', async () => {
    const i18n = await load('en')
    expect(i18n.t('close')).toBe('Luk')
    let ready: boolean | undefined
    void i18n.langReady().then((ok) => { ready = ok })
    await settle()
    expect(fetches).toHaveLength(1)
    expect(ready).toBeUndefined()
    fetches[0].arrive()
    await vi.waitFor(() => expect(ready).toBe(true))
    expect(i18n.t('close')).toBe('Close')
  })

  it('langReady gives up at its time limit with Danish on screen, and English follows when it lands', async () => {
    const i18n = await load('en')
    await expect(i18n.langReady(30)).resolves.toBe(false)
    expect(i18n.t('close')).toBe('Luk')
    fetches[0].arrive()
    await vi.waitFor(() => expect(i18n.t('close')).toBe('Close'))
    await expect(i18n.langReady(30)).resolves.toBe(true)
  })

  it('langReady is ready at once for Danish', async () => {
    const i18n = await load('da')
    await expect(i18n.langReady(30)).resolves.toBe(true)
    expect(fetches).toHaveLength(0)
  })

  // After a deploy the old build's chunks are gone (staleChunk.ts). The
  // build's preload wrapper reports that as vite:preloadError, and main.ts
  // reloads into the new build once a minute at most; here the table must
  // just stay Danish without an unhandled rejection, and try again later.
  it('a chunk that fails leaves Danish, rejects nothing, and the next switch tries again', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (e: unknown) => { unhandled.push(e) }
    const proc = (globalThis as any).process
    proc.on('unhandledRejection', onUnhandled)
    try {
      const i18n = await load('da')
      i18n.setLang('en')
      await settle()
      fetches[0].fail(new Error('Failed to fetch dynamically imported module: https://example.test/assets/strings.en-x.js'))
      await settle()
      expect(i18n.t('close')).toBe('Luk')
      await expect(i18n.langReady(30)).resolves.toBe(false) // the retry it starts is still pending
      expect(unhandled).toEqual([])
      i18n.setLang('en') // the user taps 🇬🇧 again: lang is already 'en'
      await settle()
      expect(fetches.length).toBeGreaterThanOrEqual(2)
      for (const f of fetches.slice(1)) f.arrive()
      await vi.waitFor(() => expect(i18n.t('close')).toBe('Close'))
      expect(unhandled).toEqual([])
    } finally {
      proc.off('unhandledRejection', onUnhandled)
    }
  })

  it('a computed that calls t() re-evaluates when the table arrives', async () => {
    const { computed, watch } = await import('vue')
    const i18n = await load('da')
    const label = computed(() => i18n.t('close'))
    const seen: string[] = []
    const stop = watch(label, (v) => { seen.push(v) }, { flush: 'sync' })
    i18n.setLang('en')
    expect(label.value).toBe('Luk')
    await settle()
    fetches[0].arrive()
    await vi.waitFor(() => expect(seen).toEqual(['Close']))
    i18n.setLang('da')
    expect(seen).toEqual(['Close', 'Luk'])
    i18n.setLang('en') // in already: at once, with nothing fetched again
    expect(seen).toEqual(['Close', 'Luk', 'Close'])
    expect(fetches).toHaveLength(1)
    stop()
  })
})

/** The app's own sources, for the checks below. */
const sources = import.meta.glob<string>(
  ['/src/**/*.{ts,vue}', '!/src/**/*.test.ts', '!/src/test/**', '!/src/test-setup.ts'],
  { query: '?raw', import: 'default', eager: true },
)

describe('the English table stays out of the main chunk', () => {
  // The split is only real while nothing in the app imports strings.en.ts
  // statically: one such import and the bundler puts it back in the main
  // chunk, with every test still green. Tests may import it (test/strings.ts).
  it('is reached only by i18n.ts, and only through import()', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(50)
    const importers = Object.entries(sources).filter(([, src]) => /strings\.en['"]/.test(src)).map(([path]) => path)
    expect(importers).toEqual(['/src/lib/i18n.ts'])
    const i18n = sources['/src/lib/i18n.ts']
    expect(i18n.match(/strings\.en['"]/g)).toHaveLength(1)
    expect(i18n).toMatch(/\bimport\('\.\/strings\.en'\)/)
  })
})

/**
 * Text built outside a render and kept — a Leaflet layer's popups, built
 * from strings — is built again when the language changes. A watch on
 * `lang` alone does that at the switch, before the English table is in, and
 * then never again: the setup map's official-spot popups stayed Danish for a
 * user who had just picked English. Such a watch follows shownStrings too.
 */
describe('text built outside a render', () => {
  it('is rebuilt when the English table lands, not only when lang changes', () => {
    const langOnly = /\bwatch\(\s*(?:lang\s*,|\(\)\s*=>\s*lang\.value\s*,)/
    const found = Object.entries(sources).filter(([path, src]) => path !== '/src/lib/i18n.ts' && langOnly.test(src)).map(([path]) => path)
    expect(found).toEqual([])
    // The pattern does find the old form.
    expect(langOnly.test('watch(lang, renderSpotLayer)')).toBe(true)
    expect(langOnly.test('watch([lang, shownStrings], renderSpotLayer)')).toBe(false)
  })

  describe('shownStrings', () => {
    let fetches: (() => void)[]
    beforeEach(() => {
      fetches = []
      vi.doMock('./strings.en', () => new Promise((resolve) => { fetches.push(() => resolve({ STRINGS_EN: { close: 'Close' } })) }))
    })
    afterEach(() => { vi.doUnmock('./strings.en') })

    it('changes when the English table lands, so a watch on [lang, shownStrings] runs again then', async () => {
      const { watch } = await import('vue')
      const i18n = await load('da')
      const built: string[] = []
      const stop = watch([i18n.lang, i18n.shownStrings], () => { built.push(i18n.t('close')) }, { flush: 'sync' })
      i18n.setLang('en')
      expect(built).toEqual(['Luk']) // the switch: English still on its way
      await vi.waitFor(() => expect(fetches).toHaveLength(1))
      fetches[0]()
      await vi.waitFor(() => expect(built).toEqual(['Luk', 'Close']))
      i18n.setLang('da')
      expect(built).toEqual(['Luk', 'Close', 'Luk'])
      stop()
    })
  })
})
