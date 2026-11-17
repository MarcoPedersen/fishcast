/**
 * A finger on the maps' pins. The official spots' dots on the setup map are
 * 13.5 px across, your spots' pins 14 to 30 px. A tap that just missed one
 * landed on the map: on the setup map it started a new spot there, on the
 * dashboard map it did nothing. On a touch screen a tap that hits no pin is
 * a tap on the nearest pin within 20 px of it, so each pin is a 40 px target,
 * as the app's other controls are (touchTargets.test), and looks as before.
 *
 * Why not a larger area on each pin: an area is hit by stacking order, not by
 * distance. Leaflet stacks markers by latitude, so the area of a pin to the
 * south would cover a pin just north of it, that pin itself included. A
 * canvas renderer's `tolerance` gives a tap to the last dot drawn within
 * reach (Canvas._onClick in Leaflet 1.9.4). Where the setup map opens, 36 of
 * the 57 official spots have another within 20 px. Here the nearest pin
 * wins, and a tap on a pin itself still goes to that pin.
 *
 * A mouse clicks what it points at, so it keeps the old behaviour.
 */

/** Half the 40 px target a finger needs. */
export const PIN_REACH_PX = 20

export interface ScreenPoint { x: number; y: number }

/**
 * The pin nearest `tap` within PIN_REACH_PX, by the map's own projection; the
 * first of pins as near, so list the ones drawn on top first. Null if none is.
 */
export function pinInReach<T>(
  tap: ScreenPoint,
  pins: { lat: number; lon: number; pin: T }[],
  toScreen: (lat: number, lon: number) => ScreenPoint,
): T | null {
  let best: { pin: T; d: number } | null = null
  for (const p of pins) {
    const at = toScreen(p.lat, p.lon)
    const d = Math.hypot(at.x - tap.x, at.y - tap.y)
    if (d <= PIN_REACH_PX && (!best || d < best.d)) best = { pin: p.pin, d }
  }
  return best ? best.pin : null
}

/** Whether the screen's pointer is a finger: the CSS's (pointer: coarse), which sizes the app's controls. */
export function coarsePointer(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}
