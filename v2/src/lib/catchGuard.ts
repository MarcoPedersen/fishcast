/**
 * Regulation guards for logged catches — flags an undersized fish or one caught
 * in a closed season, using the ported DK_REGULATIONS data. Guidance only
 * (regulations change; the app always says "verify on lfst.dk").
 */
import { DK_REGULATIONS } from './regulations'
import { SPECIES_PREFS } from './species'
import { lang, t } from './i18n'
import type { WaterType } from './types'

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
 * `waterType` is the catch location's, when it resolves to a saved location:
 * it picks salmon's fresh/salt minimum and rules water-scoped closures in or out.
 */
export function catchWarnings(
  speciesId: string, lengthCm: number | undefined, dateISO: string, released?: boolean,
  waterType?: WaterType,
): string[] {
  const reg = regFor(speciesId)
  if (!reg) return []
  const out: string[] = []

  // Minimums differ by area (mackerel: 30 cm North Sea, 20 cm Kattegat) and the
  // area isn't known, so only a fish short of the most LENIENT minimum is
  // undersized outright; one between the two gets a hedged note naming the range.
  const size = DK_REGULATIONS.sizeRange(reg, waterType)
  if (released !== true && size && lengthCm != null && lengthCm > 0) {
    if (lengthCm < size.min) {
      out.push(t('guard_undersize').replace('{len}', String(lengthCm)).replace('{min}', String(size.min)))
    } else if (lengthCm < size.max) {
      out.push(t('guard_undersize_some').replace('{len}', String(lengthCm))
        .replace('{min}', String(size.min)).replace('{max}', String(size.max)))
    }
  }

  const [y, m, d] = dateISO.split('-').map(Number)
  if (y) {
    const date = new Date(y, (m || 1) - 1, d || 1)
    if (!DK_REGULATIONS.isInSeason(reg, date, waterType)) {
      out.push(t('guard_closed'))
    } else {
      const regional = DK_REGULATIONS.regionalClosuresOn(reg, date, waterType)
      if (regional.length) {
        const where = regional.map((c: any) => (lang.value === 'en' && c.whereEn) || c.where).join(', ')
        out.push(t('guard_closed_regional').replace('{where}', where))
      }
    }
  }
  return out
}
