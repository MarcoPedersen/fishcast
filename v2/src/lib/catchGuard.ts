/**
 * Regulation guards for logged catches — flags an undersized fish or one caught
 * in a closed season, using the ported DK_REGULATIONS data. Guidance only
 * (regulations change; the app always says "verify on lfst.dk").
 */
import { DK_REGULATIONS } from './regulations'
import { rulePlaceAt } from './ruleArea'
import { isAllYear, type Closure } from './seasons'
import { SPECIES_PREFS } from './species'
import { lang, t } from './i18n'
import type { WaterType } from './types'

/** The regulations row for a SPECIES_PREFS id (also used by seasonGuard.ts). */
export function regulationFor(speciesId: string): any | null {
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
 * `at` is that location's position: it rules area- and region-scoped rules in
 * or out (ruleArea.ts).
 */
export function catchWarnings(
  speciesId: string, lengthCm: number | undefined, dateISO: string, released?: boolean,
  waterType?: WaterType, at?: { lat: number; lon: number },
): string[] {
  const reg = regulationFor(speciesId)
  if (!reg) return []
  const out: string[] = []
  // The catch location's sea area and named waters (Bornholm, the Wadden Sea,
  // the west-coast fjords…), when it resolves to a saved location.
  const place = at ? rulePlaceAt(at.lat, at.lon) : undefined

  const [y, m, d] = dateISO.split('-').map(Number)
  const date = y ? new Date(y, (m || 1) - 1, d || 1) : undefined

  // Minimums differ by area (mackerel: 30 cm North Sea, 20 cm Kattegat, none
  // in the Baltic). Where the area can't be pinned down, only a fish short of
  // the most LENIENT minimum is undersized outright — and only if every water
  // it may come from has one; otherwise it gets a hedged note naming the range.
  const size = DK_REGULATIONS.sizeRange(reg, waterType, place, date)
  if (released !== true && size && lengthCm != null && lengthCm > 0) {
    if (lengthCm < size.min && !size.anyWithout) {
      out.push(t('guard_undersize').replace('{len}', String(lengthCm)).replace('{min}', String(size.min)))
    } else if (lengthCm < size.max) {
      out.push((size.min === size.max ? t('guard_undersize_area') : t('guard_undersize_some'))
        .replace('{len}', String(lengthCm)).replace('{min}', String(size.min)).replace('{max}', String(size.max)))
    }
  }

  if (date) {
    // A species protected all year (stenbider) is no "maybe": say so plainly.
    if (reg.status === 'closed') {
      out.push(t('guard_protected'))
    } else if (!DK_REGULATIONS.isInSeason(reg, date, waterType, place)) {
      out.push(t('guard_closed'))
    } else {
      // With no location, an all-year protection in one named water (sea trout
      // in Ringkøbing Fjord) would be named on every sea trout logged by free
      // text; the ⚠️ rules and the Seasons tab carry it. A location that may
      // lie in that water still gets it.
      const hedged = (DK_REGULATIONS.regionalClosuresOn(reg, date, waterType, place) as Closure[])
        .filter((c) => place || !(c.region && isAllYear(c)))
      const whereOf = (cs: any[]) => cs.map((c: any) => (lang.value === 'en' && c.whereEn) || c.where).join(', ')
      // Only fish in spawning colours are protected (sea trout and salmon on
      // the coast in winter): a released fish is exactly what the rule asks.
      const coloured = hedged.filter((c: any) => c.kind === 'coloured')
      // Catch and release only (sea bass in February–March): likewise.
      const other = hedged.filter((c: any) => c.kind !== 'coloured' && !(c.kind === 'release' && released === true))
      if (coloured.length && released !== true) out.push(t('guard_coloured').replace('{where}', whereOf(coloured)))
      if (other.length) out.push(t('guard_closed_regional').replace('{where}', whereOf(other)))
    }
  }
  return out
}
