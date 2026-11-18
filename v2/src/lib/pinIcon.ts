/**
 * A pin's icon on both maps (MapView, MapTab), as L.divIcon's options.
 *
 * The pin sits centred on its spot. Its popup points at the middle of the
 * pin's top edge. Leaflet points a popup at the icon's popupAnchor, [0, 0]
 * unless set: the pin's centre. The popup's tip then ended 3.5 px above the
 * centre and covered the top of the pin, 4.5 px of the setup map's 16 px
 * dot and 11.5 px of a 30 px badge. A tap there landed on the popup, which
 * kept it open, while a tap on the rest of the pin closed it. Pointed at
 * the top edge, the tip ends 3.5 px above the pin, whatever its size, and
 * the whole pin takes the tap (pinIcon.test works it out from Leaflet's CSS).
 */
import type { PinSpec } from './pinSync'

type Px = [number, number]

export function pinIconOptions(icon: PinSpec['icon']): {
  className: string; html: string; iconSize: Px; iconAnchor: Px; popupAnchor: Px
} {
  const half = icon.size / 2
  return { className: '', html: icon.html, iconSize: [icon.size, icon.size], iconAnchor: [half, half], popupAnchor: [0, -half] }
}
