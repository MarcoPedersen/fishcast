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
// Every error a fetch failed with, and the error each wrapped: see
// englishLoadFailed. Every one, not the last: main.ts asks a tick after each
// failure, and a second can come within that tick. (Weak: errors only.)
const failures = new WeakSet<object>()
const isObject = (x: unknown): x is object => typeof x === 'object' && x !== null
function remember(e: unknown) {
  if (!isObject(e)) return
  failures.add(e)
  const cause = (e as { cause?: unknown }).cause
  if (isObject(cause)) failures.add(cause)
}

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
    (e: unknown) => { remember(e); fetching = null; return false },
  )
  return fetching
}

/**
 * True when `err` is an error the English table failed to load with — the
 * payload of the vite:preloadError the build's preload wrapper fires for it,
 * so main.ts can tell it from a screen's missing chunk. By identity, not by
 * message: Safari's ("Importing a module script failed.") names no file. The
 * error a loader wrapped counts too (it keeps it as `cause`, as Vitest's
 * module mocks do).
 */
export function englishLoadFailed(err: unknown): boolean {
  return isObject(err) && failures.has(err)
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
 * The language on screen: English once its table is in; Danish until then,
 * for Danish, and while the English chunk can't load. `lang` is the language
 * picked. Everything else that depends on the language follows this one —
 * <html lang>, species names, wind directions, number formats, the place
 * names asked of a geocoder — or a Danish screen named its species in
 * English and told screen readers it was English.
 */
export const shownLang = computed<Lang>(() => (lang.value === 'en' && english.value ? 'en' : 'da'))

/**
 * The table t() reads now: English once it is in, Danish until then and for
 * Danish. Text built outside a render and kept (a map layer's popups) is
 * built again when this changes, not only when `lang` does — the English
 * table lands after the switch.
 */
export const shownStrings = computed(() => (shownLang.value === 'en' && english.value) || STRINGS_DA)

// Keep <html lang> on the language shown — index.html said "en" while the UI
// defaults to Danish, so screen readers read Danish with English pronunciation.
// index.html now ships "da" (the default) for the moment before this runs.
// (No document in the node tests, which import this module too.)
watch(shownLang, (l) => {
  if (typeof document !== 'undefined') document.documentElement.lang = l
}, { immediate: true, flush: 'sync' })

// Fetch English when it is picked. A watch rather than a line in setLang: the
// setup store also writes lang.value directly when it adopts an account's
// setup. Immediate: a saved English is fetched at startup.
watch(lang, (l) => { if (l === 'en') void fetchEnglish() }, { immediate: true, flush: 'sync' })

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

/**
 * The day of the month as the language shown writes it: "9." in Danish, "9"
 * in English. The full stop is Danish. Dates built from t()'s day and month
 * names wrote it in English too: "Mon 9. Nov" on the dashboard, "Mon 9." in
 * a map pin's popup and "Sun 8. Nov 2026" on a catch's card.
 */
export function dayOfMonth(day: number): string {
  return shownLang.value === 'en' ? `${day}` : `${day}.`
}

/**
 * A number as the language shown writes it: a decimal comma in Danish
 * ("2,5 kg"), a point in English. The Danish screens wrote "2.5 kg". With
 * `digits` it has that many decimals, as toFixed; without, the decimals it
 * has (a logged 0.75 kg). No thousands are grouped, as before: Danish groups
 * them with a full stop, and "1.015 hPa" would read as a decimal. Only for
 * text on screen: a value stored, sent or used as a key keeps toFixed.
 * A value that rounds to zero has no sign: toFixed wrote -0.3 °C as "-0".
 */
export function fmtNum(x: number, digits?: number): string {
  let s = digits == null ? String(x) : x.toFixed(digits)
  if (/^-0(\.0+)?$/.test(s)) s = s.slice(1)
  return shownLang.value === 'en' ? s : s.replace('.', ',')
}

// A species' name, tip and warning in the language shown, as the text around them.
export function spName(sp: SpeciesPref | undefined): string {
  if (!sp) return ''
  return shownLang.value === 'en' && sp.nameEn ? sp.nameEn : sp.name
}

export function spTip(sp: SpeciesPref | undefined): string {
  if (!sp) return ''
  return shownLang.value === 'en' && sp.tipEn ? sp.tipEn : sp.tip
}

export function spWarning(sp: SpeciesPref | undefined): string {
  if (!sp) return ''
  return (shownLang.value === 'en' && sp.warningTextEn ? sp.warningTextEn : sp.warningText) ?? ''
}
