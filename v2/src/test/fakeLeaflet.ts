/**
 * A Leaflet stand-in for mounting the map views in the node tests:
 * `vi.mock('leaflet', () => import('@/test/fakeLeaflet'))`. It draws nothing
 * and keeps what a view asks of it: each marker's position, icon (markup
 * and anchors), popup and click handlers, and the layer it is on. Leaflet's
 * popup rule is kept: taking a marker off its layer closes its popup, while
 * setIcon and setPopupContent leave it open. Each map also holds the
 * buttons Leaflet names itself, as elements: its zoom buttons, and the
 * close button of a popup it opens; and the start of its credit line.
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

/** An icon as divIcon makes it: the options it was given. */
type FakeIcon = { options: { html?: string; [k: string]: unknown } }
type MarkerOptions = { icon?: FakeIcon; bubblingMouseEvents?: boolean; [k: string]: unknown }

export class FakeMarker extends Evented {
  layer: FakeLayer | null = null
  onMap: FakeMap | null = null
  popup: string | null = null
  popupOpen = false
  iconHtml = ''
  /** Its icon, as made or as setIcon last swapped it. */
  icon: FakeIcon | null = null
  /**
   * Where its popup pointed when last placed, as Leaflet places it: by the
   * icon's popupAnchor ([0, 0] unless set) as it opens, or as its content is
   * set while it is open (Popup.update). setIcon alone does not move it.
   */
  popupAt: unknown = null
  constructor(
    public latlng: [number, number],
    readonly options: MarkerOptions = {},
    /** A divIcon marker, or a circle marker (a path). */
    readonly kind: 'marker' | 'circle' = 'marker',
  ) {
    super()
    this.icon = options.icon ?? null
    this.iconHtml = options.icon?.options.html ?? ''
    created.push(this)
  }
  getLatLng() { return { lat: this.latlng[0], lng: this.latlng[1] } }
  /** The map it is on, itself or through its layer. */
  get map(): FakeMap | null { return this.onMap ?? this.layer?.map ?? null }
  /**
   * A tap on the pin itself, as Leaflet hands it on (Map._fireDOMEvent).
   * First 'preclick', on which the map closes the open popup; unless that is
   * this marker's own, which stops the 'preclick' at the marker (Popup.onAdd).
   * Then a bound popup toggles: a marker's open one closes, else it opens,
   * which stops the tap there (a path's opens again: Layer._openPopup). The
   * pin's own click handlers run. Otherwise a marker keeps the tap and a
   * circle marker passes it on to the map, at its own position:
   * bubblingMouseEvents is false for a marker, true for a path.
   */
  tap() {
    const map = this.map
    const e = { latlng: this.getLatLng(), containerPoint: map?.latLngToContainerPoint(this.latlng) }
    const toggles = this.popupOpen && this.kind === 'marker'
    if (!toggles) { map?.fire('preclick', e); map?.closePopup() }
    const stopped = this.popup != null
    if (stopped) { if (toggles) this.shutPopup(); else this.openPopup() }
    this.fire('click', e)
    if (!stopped && (this.options.bubblingMouseEvents ?? this.kind === 'circle')) map?.fire('click', e)
    return this
  }
  bindPopup(content: string) { this.popup = content; return this }
  setPopupContent(content: string) {
    this.popup = content
    if (this.popupOpen) this.placePopup()
    return this
  }
  setIcon(icon: FakeIcon) { this.icon = icon; this.iconHtml = icon.options.html ?? ''; return this }
  private placePopup() { this.popupAt = this.icon?.options.popupAnchor ?? [0, 0] }
  setLatLng(ll: [number, number]) { this.latlng = ll; return this }
  addTo(target: FakeLayer | FakeMap) {
    if (target instanceof FakeLayer) target.addLayer(this)
    else this.onMap = target
    return this
  }
  isPopupOpen() { return this.popupOpen }
  /** Its popup's frame: laid out the first time it opens, and kept, as Leaflet does. */
  frame: FakePopup | null = null
  /**
   * Opens its bound popup, closing the one open on its map: one at a time, as
   * Leaflet's autoClose. Its frame goes in through the map, which fires popupopen.
   */
  openPopup() {
    const map = this.map
    if (map && this.popup != null) {
      map.closePopup()
      this.popupOpen = true
      this.placePopup()
      map.openPopup((this.frame ??= new FakePopup()))
    }
    return this
  }
  /** Its popup closes: its frame leaves the map, which fires popupclose. */
  shutPopup(map = this.map) {
    if (!this.popupOpen) return
    this.popupOpen = false
    if (this.frame) map?.dropFrame(this.frame)
  }
  remove() {
    this.shutPopup()
    this.layer?.removeLayer(this)
    this.onMap = null
    return this
  }
}

export class FakeLayer {
  readonly markers = new Set<FakeMarker>()
  map: FakeMap | null = null
  addTo(map?: FakeMap) { this.map = map ?? null; return this }
  addLayer(m: FakeMarker) { this.markers.add(m); m.layer = this; return this }
  removeLayer(m: FakeMarker) {
    if (this.markers.delete(m)) { m.shutPopup(this.map ?? undefined); m.layer = null }
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

/**
 * An element Leaflet builds itself, such as a zoom button or a popup's close
 * button: its classes and attributes, and its children. querySelector finds
 * one by a single `.class`; any other selector throws, so a test can't pass
 * on a selector this fake doesn't understand.
 */
export class FakeEl {
  readonly attrs: Record<string, string>
  readonly children: FakeEl[] = []
  parent: FakeEl | null = null
  constructor(readonly className: string, attrs: Record<string, string> = {}) { this.attrs = { ...attrs } }
  append(child: FakeEl) { child.remove(); child.parent = this; this.children.push(child); return child }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1)
    this.parent = null
  }
  setAttribute(name: string, value: string) { this.attrs[name] = String(value) }
  getAttribute(name: string): string | null { return this.attrs[name] ?? null }
  querySelectorAll(selector: string): FakeEl[] {
    const cls = /^\.([\w-]+)$/.exec(selector)?.[1]
    if (!cls) throw new Error(`fakeLeaflet: no support for the selector ${selector}`)
    const out: FakeEl[] = []
    const walk = (e: FakeEl) => e.children.forEach((c) => { if (c.className.split(' ').includes(cls)) out.push(c); walk(c) })
    walk(this)
    return out
  }
  querySelector(selector: string): FakeEl | null { return this.querySelectorAll(selector)[0] ?? null }
}

/** Leaflet's credit to itself, as leaflet-src.js 1.9.4 writes it (flag left out): a link that opens in the same tab. */
export const LEAFLET_DEFAULT_PREFIX = '<a href="https://leafletjs.com" title="A JavaScript library for interactive maps">Leaflet</a>'

/**
 * A popup as Leaflet lays it out when it first opens: a frame holding the
 * close button, labelled in English. Leaflet keeps the frame, label and all,
 * between openings.
 */
export class FakePopup {
  readonly el = new FakeEl('leaflet-popup')
  readonly closeButton = this.el.append(new FakeEl('leaflet-popup-close-button', { role: 'button', 'aria-label': 'Close popup' }))
}

export class FakeMap extends Evented {
  center: [number, number] = [0, 0]
  zoom = 0
  /** The map's element, with what Leaflet puts in it: the zoom buttons, and a pane for the open popups. */
  readonly container = new FakeEl('leaflet-container')
  readonly zoomIn = new FakeEl('leaflet-control-zoom-in', { role: 'button', title: 'Zoom in', 'aria-label': 'Zoom in' })
  readonly zoomOut = new FakeEl('leaflet-control-zoom-out', { role: 'button', title: 'Zoom out', 'aria-label': 'Zoom out' })
  readonly popupPane = new FakeEl('leaflet-pane leaflet-popup-pane')
  /** The credit line: what it shows before the layers' credits, Leaflet's own link until the app sets one. */
  readonly attributionControl = {
    prefix: LEAFLET_DEFAULT_PREFIX as string | false,
    setPrefix(prefix: string | false) { this.prefix = prefix; return this },
  }
  constructor() {
    super()
    maps.push(this)
    const zoom = this.container.append(new FakeEl('leaflet-control-zoom leaflet-bar leaflet-control'))
    zoom.append(this.zoomIn)
    zoom.append(this.zoomOut)
    this.container.append(this.popupPane)
  }
  getContainer() { return this.container }
  setView(center: [number, number], zoom: number) { this.center = center; this.zoom = zoom; return this }
  invalidateSize() { return this }
  fitBounds() { return this }
  /** Opens a popup as Leaflet does: its frame goes in the popup pane, then the map fires popupopen. */
  openPopup(popup = new FakePopup()) {
    this.popupPane.append(popup.el)
    this.fire('popupopen', { popup })
    return popup
  }
  /**
   * Closes a popup: this one, or with none the pin's popup open on this map.
   * Its frame leaves the popup pane, then the map fires popupclose. A popup
   * opened on the map itself (openPopup above) closes only when named, so a
   * test can keep a frame in the map, as Leaflet does while one fades out.
   */
  closePopup(popup?: FakePopup) {
    for (const m of created) if (m.map === this && (!popup || m.frame === popup)) m.shutPopup(this)
    if (popup) this.dropFrame(popup)
    return this
  }
  /** A popup's frame leaves the map, which fires popupclose. */
  dropFrame(popup: FakePopup) {
    if (!popup.el.parent) return
    popup.el.remove()
    this.fire('popupclose', { popup })
  }
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
  /**
   * A tap on the map at this screen point, on no pin, as Leaflet hands it on:
   * 'preclick', on which the open popup closes (closePopupOnClick), then
   * 'click' with the point and its position. The map's own 'preclick'
   * handlers run before the popup's close, as in Leaflet: a popup adds its
   * handler as it opens, after those a view adds as it makes the map.
   * `originalEvent` is the browser's click, such as its pointerType.
   */
  tap(at: Point, originalEvent?: object) {
    const e = { latlng: this.containerPointToLatLng(at), containerPoint: at, originalEvent }
    this.fire('preclick', e)
    this.closePopup()
    return this.fire('click', e)
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
