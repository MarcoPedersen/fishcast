/**
 * Popup markup for both maps (the dashboard's MapTab and the setup MapView).
 *
 * Leaflet writes a string popup with innerHTML, and location names are
 * untrusted — a shared link, a Nominatim reverse-geocode or the user supplies
 * them. Every value therefore goes through the escaping html`` tag; these used
 * to be raw template strings, and a name carrying `<img onerror=…>` ran script
 * when its pin was tapped. Keep every popup here so the tests cover them all.
 */
import { html } from './html'
import { t } from './i18n'
import { isOvernight, scoreLabel } from './scoring'
import type { Location, ScoredWindow } from './types'

const MUTED = 'color:#7d93ad'
const SMALL = 'color:#7d93ad;font-size:11px'

/** Dashboard map: one of your saved spots, with its best window in the horizon. */
export function ownSpotPopup(loc: Location, best: ScoredWindow | undefined): string {
  if (!best) {
    return html`<strong>📍 ${loc.name}</strong><br><span style="${MUTED}">${t('map_no_score')}</span>`.value
  }
  // Window dates are UTC midnight of the calendar day, so read the UTC parts.
  const d = best.date
  const when = html`${t('day' + d.getUTCDay())} ${d.getUTCDate()}. · ${best.from}–${best.to}${isOvernight(best.from, best.to) ? ' (+1)' : ''}`
  return html`<strong>📍 ${loc.name}</strong><br><span style="${MUTED}">${best.score} · ${scoreLabel(best.score)}</span><br><span style="${SMALL}">${when}</span>`.value
}

/** Dashboard map: a nearby official spot, scored by the same engine. */
export function officialSpotPopup(w: ScoredWindow, km: number | undefined): string {
  const dist = km != null ? html`<br><span style="${SMALL}">${km} ${t('maptab_km_away')}</span>` : null
  return html`<strong>${w.location.name}</strong> <span style="${SMALL}">(${t('map_official')})</span><br><span style="${MUTED}">${w.score} · ${scoreLabel(w.score)}</span>${dist}`.value
}

/** Setup map: a saved spot, with today's best score when there is one. */
export function savedSpotPopup(loc: Location, scoreToday: number | undefined): string {
  const score = scoreToday != null
    ? html`<br><span style="${MUTED}">${t('map_score_today')}: ${scoreToday} · ${scoreLabel(scoreToday)}</span>`
    : null
  return html`<strong>📍 ${loc.name}</strong>${score}`.value
}

/** Setup map: an official catalogue spot. `active` is the species list, already joined. */
export function catalogueSpotPopup(
  spot: { name: string; region: string }, typeLabel: string, active: string,
): string {
  const species = active ? html`<br><span style="color:#bbf7d0;font-size:11px">${active}</span>` : null
  return html`<strong>${spot.name}</strong><br><span style="${MUTED}">${spot.region} · ${typeLabel}</span>${species}`.value
}
