import { computed, ref, shallowRef, watch } from 'vue'
import { STRINGS_DA } from './strings'
import type { Lang } from './types'
import type { SpeciesPref } from './species'
import { readStored, writeStored } from './safeStorage'

// Through safeStorage: this runs while the module loads, and every module
// imports this one — with site data blocked, a bare localStorage read threw
// here and the app never mounted (a blank page).
const stored = readStored('fc2-lang')
export const lang = ref<Lang>(stored === 'en' || stored === 'da' ? stored : 'da')

// English is a chunk of its own (strings.en.ts): it was ~27% of the main
// chunk, ~14 KB gz that a Danish user downloaded and parsed for nothing. It
// is fetched when the language is English; until it is in, or when it can't
// load, t() reads Danish — as it always has for a key English lacks.
const english = shallowRef<Record<string, string> | null>(null)
let fetching: Promise<boolean> | null = null
// The error the last fetch failed with: see englishLoadFailed.
let failure: unknown

/**
 * Fetch the English table. True once t() reads it; false when the chunk
 * failed (Danish stays, and the next switch to English, or the connection
 * coming back, tries again). Never rejects. After a deploy an old build's
 * chunks are gone: the build's preload wrapper then fires vite:preloadError,
 * and main.ts has the page reload into the new build — once nothing on
 * screen can be lost (swUpdate.ts chunkGone).
 */
function fetchEnglish(): Promise<boolean> {
  if (english.value) return Promise.resolve(true)
  fetching ??= import('./strings.en').then(
    (m) => { english.value = m.STRINGS_EN; return true },
    (e: unknown) => { failure = e; fetching = null; return false },
  )
  return fetching
}

/**
 * True when `err` is the error the English table last failed to load with —
 * the payload of the vite:preloadError the build's preload wrapper fires for
 * it, so main.ts can tell it from a screen's missing chunk. By identity, not
 * by message: Safari's ("Importing a module script failed.") names no file.
 * The error a loader wrapped counts too (it keeps it as `cause`, as Vitest's
 * module mocks do).
 */
export function englishLoadFailed(err: unknown): boolean {
  if (err === undefined || failure === undefined) return false
  return err === failure || err === (failure as { cause?: unknown } | null)?.cause
}

/** The English table is in (t() reads it while the language is English). */
export function hasEnglish(): boolean {
  return !!english.value
}

// Offline, with no service worker holding the chunk, it can't come: try
// again when the connection does. (No window in the node tests.)
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { if (lang.value === 'en') void fetchEnglish() })
}

/**
 * The table t() reads now: English once it is in, Danish until then and for
 * Danish. Text built outside a render and kept (a map layer's popups) is
 * built again when this changes, not only when `lang` does — the English
 * table lands after the switch.
 */
export const shownStrings = computed(() => (lang.value === 'en' && english.value) || STRINGS_DA)

// Keep <html lang> on the UI language — index.html said "en" while the UI
// defaults to Danish, so screen readers read Danish with English pronunciation.
// index.html now ships "da" (the default) for the moment before this runs.
// A watch rather than a line in setLang: the setup store also writes
// lang.value directly when it adopts an account's setup — and English is
// fetched here for the same reason, and at startup for a saved English.
// (No document in the node tests, which import this module too.)
watch(lang, (l) => {
  if (typeof document !== 'undefined') document.documentElement.lang = l
  if (l === 'en') void fetchEnglish()
}, { immediate: true, flush: 'sync' })

export function setLang(l: Lang) {
  lang.value = l
  writeStored('fc2-lang', l)
  // Already English after a failed fetch, the watch above doesn't run: a
  // second tap on 🇬🇧 is what tries again.
  if (l === 'en') void fetchEnglish()
}

/**
 * Resolves true once t() reads the language set — at once for Danish — or
 * false when the English chunk failed or `ms` ran out first, with Danish on
 * screen until English lands. Never rejects. main.ts waits on it before the
 * first render, so an English user doesn't see the app in Danish first.
 */
export function langReady(ms = Infinity): Promise<boolean> {
  if (lang.value !== 'en' || english.value) return Promise.resolve(true)
  const fetched = fetchEnglish()
  if (ms === Infinity) return fetched
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms)
    void fetched.then((ok) => { clearTimeout(timer); resolve(ok) })
  })
}

/** Translate a key using the current language (reactive, also to the English table arriving). */
export function t(key: string): string {
  return shownStrings.value[key] ?? STRINGS_DA[key] ?? key
}

export function spName(sp: SpeciesPref | undefined): string {
  if (!sp) return ''
  return lang.value === 'en' && sp.nameEn ? sp.nameEn : sp.name
}

export function spTip(sp: SpeciesPref | undefined): string {
  if (!sp) return ''
  return lang.value === 'en' && sp.tipEn ? sp.tipEn : sp.tip
}

export function spWarning(sp: SpeciesPref | undefined): string {
  if (!sp) return ''
  return (lang.value === 'en' && sp.warningTextEn ? sp.warningTextEn : sp.warningText) ?? ''
}
