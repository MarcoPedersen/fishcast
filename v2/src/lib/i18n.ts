import { ref } from 'vue'
import { STRINGS } from './strings'
import type { Lang } from './types'
import type { SpeciesPref } from './species'

export const lang = ref<Lang>((localStorage.getItem('fc2-lang') as Lang) || 'da')

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
