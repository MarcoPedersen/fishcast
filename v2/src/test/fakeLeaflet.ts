/**
 * A Leaflet stand-in for mounting the map views in the node tests:
 * `vi.mock('leaflet', () => import('@/test/fakeLeaflet'))`. It draws nothing
 * and keeps what a view asks of it: each marker's position, icon markup,
 * popup and click handlers, and the layer it is on. Leaflet's popup rule is
 * kept: taking a marker off its layer closes its popup, while setIcon and
 * setPopupContent leave it open.
 */
type Handler = (e: unknown) => void

/** Every marker and circle marker made since the last resetLeaflet, in order. */
export const created: FakeMarker[] = []
/** Every layer group made since the last resetLeaflet, in order. */
export const layers: FakeLayer[] = []
/** Every map made since the last resetLeaflet, in order. */
export const maps: FakeMap[] = []

class Evented {
  private handlers = new Map<string, Handler[]>()
  on(type: string, fn: Handler) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn])
    return this
  }
  off(type: string, fn?: Handler) {
    this.handlers.set(type, fn ? (this.handlers.get(type) ?? []).filter((f) => f !== fn) : [])
    return this
  }
  /** Calls the handlers for `type`, as a user's tap would. */
  fire(type: string, e: unknown = {}) {
    for (const fn of this.handlers.get(type) ?? []) fn(e)
    return this
  }
}

export class FakeMarker extends Evented {
  layer: FakeLayer | null = null
  onMap: FakeMap | null = null
  popup: string | null = null
  popupOpen = false
  iconHtml = ''
  constructor(public latlng: [number, number], opts: { icon?: { options: { html?: string } } } = {}) {
    super()
    this.iconHtml = opts.icon?.options.html ?? ''
    created.push(this)
  }
  bindPopup(content: string) { this.popup = content; return this }
  setPopupContent(content: string) { this.popup = content; return this }
  setIcon(icon: { options: { html?: string } }) { this.iconHtml = icon.options.html ?? ''; return this }
  setLatLng(ll: [number, number]) { this.latlng = ll; return this }
  addTo(target: FakeLayer | FakeMap) {
    if (target instanceof FakeLayer) target.addLayer(this)
    else this.onMap = target
    return this
  }
  openPopup() { if (this.layer || this.onMap) this.popupOpen = true; return this }
  remove() {
    this.layer?.removeLayer(this)
    this.onMap = null
    this.popupOpen = false
    return this
  }
}

export class FakeLayer {
  readonly markers = new Set<FakeMarker>()
  addTo() { return this }
  addLayer(m: FakeMarker) { this.markers.add(m); m.layer = this; return this }
  removeLayer(m: FakeMarker) {
    if (this.markers.delete(m)) { m.layer = null; m.popupOpen = false }
    return this
  }
  clearLayers() { for (const m of [...this.markers]) this.removeLayer(m); return this }
}

export class FakeMap extends Evented {
  constructor() { super(); maps.push(this) }
  setView() { return this }
  invalidateSize() { return this }
  fitBounds() { return this }
  remove() {}
}

/** The markers on any layer at this position. */
export function markersAt(lat: number, lon: number): FakeMarker[] {
  return created.filter((m) => m.layer && m.latlng[0] === lat && m.latlng[1] === lon)
}

export function resetLeaflet() {
  created.length = 0
  layers.length = 0
  maps.length = 0
}

const L = {
  map: () => new FakeMap(),
  tileLayer: () => ({ addTo() { return this } }),
  layerGroup: () => { const l = new FakeLayer(); layers.push(l); return l },
  divIcon: (options: { html?: string }) => ({ options }),
  marker: (ll: [number, number], opts?: { icon?: { options: { html?: string } } }) => new FakeMarker(ll, opts),
  circleMarker: (ll: [number, number]) => new FakeMarker(ll),
  latLngBounds: () => ({ pad() { return this } }),
}
export default L
