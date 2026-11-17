/**
 * A Leaflet stand-in for mounting the map views in the node tests:
 * `vi.mock('leaflet', () => import('@/test/fakeLeaflet'))`. It draws nothing
 * and keeps what a view asks of it: each marker's position, icon markup,
 * popup and click handlers, and the layer it is on. Leaflet's popup rule is
 * kept: taking a marker off its layer closes its popup, while setIcon and
 * setPopupContent leave it open. Each map also holds the buttons Leaflet
 * names itself, as elements: its zoom buttons, and the close button of a
 * popup it opens.
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
  /** The map's element, with what Leaflet puts in it: the zoom buttons, and a pane for the open popups. */
  readonly container = new FakeEl('leaflet-container')
  readonly zoomIn = new FakeEl('leaflet-control-zoom-in', { role: 'button', title: 'Zoom in', 'aria-label': 'Zoom in' })
  readonly zoomOut = new FakeEl('leaflet-control-zoom-out', { role: 'button', title: 'Zoom out', 'aria-label': 'Zoom out' })
  readonly popupPane = new FakeEl('leaflet-pane leaflet-popup-pane')
  constructor() {
    super()
    maps.push(this)
    const zoom = this.container.append(new FakeEl('leaflet-control-zoom leaflet-bar leaflet-control'))
    zoom.append(this.zoomIn)
    zoom.append(this.zoomOut)
    this.container.append(this.popupPane)
  }
  getContainer() { return this.container }
  setView() { return this }
  invalidateSize() { return this }
  fitBounds() { return this }
  /** Opens a popup as Leaflet does: its frame goes in the popup pane, then the map fires popupopen. */
  openPopup(popup = new FakePopup()) {
    this.popupPane.append(popup.el)
    this.fire('popupopen', { popup })
    return popup
  }
  closePopup(popup: FakePopup) {
    popup.el.remove()
    this.fire('popupclose', { popup })
    return this
  }
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
