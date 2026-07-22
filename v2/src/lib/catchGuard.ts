/**
 * Regulation guards for logged catches — flags an undersized fish or one caught
 * in a closed season, using the ported DK_REGULATIONS data. Guidance only
 * (regulations change; the app always says "verify on lfst.dk").
 */
import { DK_REGULATIONS } from './regulations'
import { SPECIES_PREFS } from './species'
import { t } from './i18n'

function regFor(speciesId: string): any | null {
  if (!speciesId) return null
  const byId = DK_REGULATIONS.species.find((s: any) => s.id === speciesId)
  if (byId) return byId
  // Fall back to matching English name (regulation ids and SPECIES_PREFS keys
  // don't always align, e.g. "roedspætte" vs "rødspætte").
  const en = SPECIES_PREFS[speciesId]?.nameEn?.toLowerCase()
  return en ? (DK_REGULATIONS.species.find((s: any) => s.nameEn?.toLowerCase() === en) ?? null) : null
}

/**
 * Warnings (localised) for a catch; empty when nothing is flagged.
 * `released === true` suppresses the undersize note — an undersized fish that
 * was put back is the right call, not something to scold.
 */
export function catchWarnings(
  speciesId: string, lengthCm: number | undefined, dateISO: string, released?: boolean,
): string[] {
  const reg = regFor(speciesId)
  if (!reg) return []
  const out: string[] = []

  const minCm = DK_REGULATIONS.getPrimarySize(reg)
  if (released !== true && minCm != null && lengthCm != null && lengthCm > 0 && lengthCm < minCm) {
    out.push(t('guard_undersize').replace('{len}', String(lengthCm)).replace('{min}', String(minCm)))
  }

  const [y, m, d] = dateISO.split('-').map(Number)
  if (y) {
    const date = new Date(y, (m || 1) - 1, d || 1)
    if (!DK_REGULATIONS.isInSeason(reg, date)) out.push(t('guard_closed'))
  }
  return out
}
