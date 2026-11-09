/**
 * How the catch log names a species and a fishing method: in the log's form,
 * its stats and each entry's card (components/CatchEntryCard.vue).
 */
import { spName, t } from './i18n'
import { SPECIES_PREFS } from './species'
import type { FishingMethod } from './types'

/** The methods in the form's order, with their emoji. */
export const FISHING_METHODS: { id: FishingMethod; emoji: string }[] = [
  { id: 'shore', emoji: '🎣' }, { id: 'waders', emoji: '🦺' }, { id: 'boat', emoji: '🚢' },
]

export function methodLabel(m: FishingMethod): string {
  const e = FISHING_METHODS.find((o) => o.id === m)?.emoji ?? ''
  return `${e} ${t('method_' + m)}`
}

/** A species with its emoji; '' (not given) and an id this version doesn't know read "Anden / ukendt". */
export function speciesLabel(id: string): string {
  const sp = SPECIES_PREFS[id]
  return sp ? `${sp.emoji} ${spName(sp)}` : `🎣 ${t('log_species_other')}`
}
