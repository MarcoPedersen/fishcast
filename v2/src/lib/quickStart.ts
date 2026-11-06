/**
 * The welcome screen's "⚡ Hurtig start": three spots and a morning window,
 * then straight to the dashboard. The spots are the nearest ones when the
 * device gives a position; otherwise the country's best right now — and then
 * the user is told so (quickStartNote). Silent, a declined location prompt
 * put Djursland, Als and Fyn on the dashboard under a button that promised
 * "pladser nær dig".
 */
import { t } from './i18n'
import { findLuckySpots, findNearbyRanked, type SpotResult } from './spotfinder'

export const QUICK_START_RADIUS_KM = 60

/** Where the picks came from: near the user, or the country's best for want of a position or of a spot near it. */
export type QuickStartWhere = 'near' | 'no_position' | 'none_near'

type Ctx = Parameters<typeof findLuckySpots>[2]

export function quickStartPicks(
  pos: { lat: number; lon: number } | null, month: number, ctx: Ctx,
): { results: SpotResult[]; where: QuickStartWhere } {
  const near = pos ? findNearbyRanked(pos.lat, pos.lon, QUICK_START_RADIUS_KM, [], month, ctx) : []
  if (near.length) return { results: near.slice(0, 3), where: 'near' }
  return { results: findLuckySpots([], month, ctx).slice(0, 3), where: pos ? 'none_near' : 'no_position' }
}

/** What to tell the user about the picks, or null when they are the spots near them. */
export function quickStartNote(where: QuickStartWhere): string | null {
  if (where === 'no_position') return t('quick_start_no_pos')
  if (where === 'none_near') return t('quick_start_none_near')
  return null
}
