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
 * A mouse clicks what it points at, so it keeps the old behaviour. Which
 * pointer made a tap is the tap's own (tapPointers), not the screen's.
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

/**
 * Whether a pin of radius `r` at `at` lies wholly under one of the pins drawn
 * over it (`over`, each with its radius). Then it can't be seen, and a tap
 * beside it meant the pin over it: leave it out of pinInReach.
 */
export function hiddenUnder(at: ScreenPoint, r: number, over: { at: ScreenPoint; r: number }[]): boolean {
  return over.some((o) => Math.hypot(o.at.x - at.x, o.at.y - at.y) + r <= o.r)
}

/** Whether the screen's pointer is a finger: the CSS's (pointer: coarse), which sizes the app's controls. */
export function coarsePointer(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  } catch {
    return false
  }
}

/**
 * Whether each tap on a map gets a finger's reach, by the pointer that made
 * it: a finger or a pen does, a mouse does not. (pointer: coarse) describes
 * only the screen's primary pointer, so a touchscreen laptop's finger got no
 * reach and a phone's mouse got it. It is now the guess only where the tap
 * can't say.
 *
 * The click alone can't say. It names its pointer (a PointerEvent) in
 * Chrome 92 and Firefox 129 on. Safari gave a MouseEvent with no pointerType
 * before 18.2, and since then names a finger's tap 'mouse' (WebKit bug
 * 282988). The pointerup just before the click names the finger in each of
 * them. So the map's element hands its pointerups to `up`, and its click
 * reads the last one first, then its own pointerType, then the screen.
 */
export function tapPointers() {
  let last = ''
  return {
    /** A pointer let go on the map: the map element's pointerup. */
    up(e: { pointerType?: string }) {
      last = e.pointerType ?? ''
    },
    /** Whether this click on the map gets the reach. Forgets the pointer let go, so a click after none reads its own. */
    reach(click?: Event): boolean {
      const own = (click as { pointerType?: unknown } | undefined)?.pointerType
      const type = last || (typeof own === 'string' ? own : '')
      last = ''
      if (type === 'touch' || type === 'pen') return true
      if (type === 'mouse') return false
      return coarsePointer()
    },
  }
}
