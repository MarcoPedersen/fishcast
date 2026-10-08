import { ref, watch } from 'vue'
import { STRINGS } from './strings'
import type { Lang } from './types'
import type { SpeciesPref } from './species'

export const lang = ref<Lang>((localStorage.getItem('fc2-lang') as Lang) || 'da')

// Keep <html lang> on the UI language — index.html says "en" while the UI
// defaults to Danish, so screen readers read Danish with English pronunciation.
// A watch rather than a line in setLang: the setup store also writes
// lang.value directly when it adopts an account's setup. (No document in the
// node tests, which import this module too.)
watch(lang, (l) => {
  if (typeof document !== 'undefined') document.documentElement.lang = l
}, { immediate: true, flush: 'sync' })

export function setLang(l: Lang) {
  lang.value = l
  localStorage.setItem('fc2-lang', l)
}

/** Translate a key using the current language (reactive). */
export function t(key: string): string {
  return STRINGS[lang.value]?.[key] ?? STRINGS.da[key] ?? key
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
