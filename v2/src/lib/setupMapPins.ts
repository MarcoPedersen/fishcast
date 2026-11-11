/**
 * The setup map's saved-spot pins (MapView), as specs for createPinSync, so
 * a score change updates the markers in place instead of re-creating them.
 */
import { html } from './html'
import { savedSpotPopup } from './mapPopups'
import type { PinSpec } from './pinSync'
import type { Location } from './types'

function scoreHex(s: number): string {
  return s >= 80 ? '#22c55e' : s >= 65 ? '#38bdf8' : s >= 45 ? '#f59e0b' : '#ef4444'
}

/** Today's score as a coloured, numbered badge. */
const scoreBadge = (score: number): PinSpec['icon'] => ({
  html: html`<div style="min-width:26px;height:26px;padding:0 5px;border-radius:13px;background:${scoreHex(score)};color:#07111f;border:2px solid rgba(255,255,255,.9);box-shadow:0 1px 4px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;font-family:system-ui,sans-serif">${score}</div>`.value,
  size: 26,
})
/** No score today (no forecast yet, no window today): a plain dot. */
const NO_SCORE: PinSpec['icon'] = {
  html: '<div style="width:16px;height:16px;border-radius:50%;background:#38bdf8;border:2px solid rgba(255,255,255,.9);box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>',
  size: 16,
}

/** One pin per saved spot; `scores` is today's best per spot (bestTodayByLocation). */
export function savedSpotPins(locations: Location[], scores: Map<string, number>): PinSpec[] {
  return locations.map((loc) => {
    const sc = scores.get(loc.id)
    // Escaped — the name may come from a shared link or Nominatim (see mapPopups).
    return { id: loc.id, lat: loc.lat, lon: loc.lon, icon: sc != null ? scoreBadge(sc) : NO_SCORE, popup: savedSpotPopup(loc, sc) }
  })
}
