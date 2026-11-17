/**
 * A Leaflet stand-in for mounting the map views in the node tests:
 * `vi.mock('leaflet', () => import('@/test/fakeLeaflet'))`. It draws nothing
 * and keeps what a view asks of it: each marker's position, icon markup,
 * popup and click handlers, and the layer it is on. Leaflet's popup rule is
 * kept: taking a marker off its layer closes its popup, while setIcon and
 * setPopupContent leave it open.
 *
 * A tap goes where Leaflet sends it (`tap` on a marker or on the map), and
 * the map places a point on a 400 x 400 px screen as Leaflet's Web Mercator
 * does, at the zoom and centre set with setView.
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

type MarkerOptions = { icon?: { options: { html?: string } }; bubblingMouseEvents?: boolean; [k: string]: unknown }

export class FakeMarker extends Evented {
  layer: FakeLayer | null = null
  onMap: FakeMap | null = null
  popup: string | null = null
  popupOpen = false
  iconHtml = ''
  constructor(
    public latlng: [number, number],
    readonly options: MarkerOptions = {},
    /** A divIcon marker, or a circle marker (a path). */
    readonly kind: 'marker' | 'circle' = 'marker',
  ) {
    super()
    this.iconHtml = options.icon?.options.html ?? ''
    created.push(this)
  }
  getLatLng() { return { lat: this.latlng[0], lng: this.latlng[1] } }
  /** The map it is on, itself or through its layer. */
  get map(): FakeMap | null { return this.onMap ?? this.layer?.map ?? null }
  /**
   * A tap on the pin itself, as Leaflet hands it on (Map._fireDOMEvent): the
   * open popup closes first ('preclick'), then a bound popup opens, which
   * stops the tap there, and the pin's own click handlers run. Otherwise a
   * marker keeps the tap and a circle marker passes it on to the map, at its
   * own position: bubblingMouseEvents is false for a marker, true for a path.
   */
  tap() {
    const map = this.map
    map?.closePopup()
    const e = { latlng: this.getLatLng(), containerPoint: map?.latLngToContainerPoint(this.latlng) }
    const stopped = this.popup != null
    if (stopped) this.openPopup()
    this.fire('click', e)
    if (!stopped && (this.options.bubblingMouseEvents ?? this.kind === 'circle')) map?.fire('click', e)
    return this
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
  /** Opens its bound popup, closing the one open on its map: one at a time, as Leaflet's autoClose. */
  openPopup() {
    const map = this.map
    if (map && this.popup != null) { map.closePopup(); this.popupOpen = true }
    return this
  }
  remove() {
    this.layer?.removeLayer(this)
    this.onMap = null
    this.popupOpen = false
    return this
  }
}

export class FakeLayer {
  readonly markers = new Set<FakeMarker>()
  map: FakeMap | null = null
  addTo(map?: FakeMap) { this.map = map ?? null; return this }
  addLayer(m: FakeMarker) { this.markers.add(m); m.layer = this; return this }
  removeLayer(m: FakeMarker) {
    if (this.markers.delete(m)) { m.layer = null; m.popupOpen = false }
    return this
  }
  clearLayers() { for (const m of [...this.markers]) this.removeLayer(m); return this }
}

type LatLngLike = [number, number] | { lat: number; lng: number }
type Point = { x: number; y: number }
const SIZE = 400

/** Web Mercator in pixels at zoom `z`, as Leaflet's EPSG3857 with 256 px tiles. */
function project(lat: number, lon: number, z: number): Point {
  const scale = 256 * 2 ** z, sin = Math.sin((lat * Math.PI) / 180)
  return { x: (scale * (lon + 180)) / 360, y: scale * (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) }
}

export class FakeMap extends Evented {
  center: [number, number] = [0, 0]
  zoom = 0
  constructor() { super(); maps.push(this) }
  setView(center: [number, number], zoom: number) { this.center = center; this.zoom = zoom; return this }
  invalidateSize() { return this }
  fitBounds() { return this }
  remove() {}
  /** Where a point is on the 400 x 400 px screen, its top left corner 0, 0. */
  latLngToContainerPoint(ll: LatLngLike): Point {
    const [lat, lon] = Array.isArray(ll) ? ll : [ll.lat, ll.lng]
    const p = project(lat, lon, this.zoom), c = project(this.center[0], this.center[1], this.zoom)
    return { x: p.x - c.x + SIZE / 2, y: p.y - c.y + SIZE / 2 }
  }
  containerPointToLatLng(p: Point): { lat: number; lng: number } {
    const scale = 256 * 2 ** this.zoom, c = project(this.center[0], this.center[1], this.zoom)
    const x = p.x - SIZE / 2 + c.x, y = p.y - SIZE / 2 + c.y
    const lat = ((2 * Math.atan(Math.exp(Math.PI * (1 - (2 * y) / scale))) - Math.PI / 2) * 180) / Math.PI
    return { lat, lng: (x / scale) * 360 - 180 }
  }
  /** Closes the popup open on this map. */
  closePopup() {
    for (const m of created) if (m.map === this) m.popupOpen = false
    return this
  }
  /**
   * A tap on the map at this screen point, on no pin, as Leaflet hands it on:
   * the open popup closes ('preclick', closePopupOnClick), then 'click' with
   * the point and its position.
   */
  tap(at: Point) {
    this.closePopup()
    return this.fire('click', { latlng: this.containerPointToLatLng(at), containerPoint: at })
  }
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
  marker: (ll: [number, number], opts?: MarkerOptions) => new FakeMarker(ll, opts),
  circleMarker: (ll: [number, number], opts?: MarkerOptions) => new FakeMarker(ll, opts, 'circle'),
  latLngBounds: () => ({ pad() { return this } }),
}
export default L
