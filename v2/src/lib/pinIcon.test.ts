import { describe, expect, it } from 'vitest'
// @ts-ignore — no @types/node in this project; vitest runs in Node.
import { readFileSync } from 'node:fs'
import { pinIconOptions } from './pinIcon'
import { savedSpotPins } from './setupMapPins'
import type { Location } from './types'

/** The pins the maps draw: 14 and 30 px on the dashboard map (MapTab), 16 and 26 on the setup map (setupMapPins). */
const SIZES = [14, 16, 26, 30]

describe("a pin's icon", () => {
  it('sits centred on its spot, and its popup points at the middle of its top edge', () => {
    for (const size of SIZES) {
      expect(pinIconOptions({ html: '<i></i>', size }), `${size} px`).toEqual({
        className: '', html: '<i></i>', iconSize: [size, size], iconAnchor: [size / 2, size / 2], popupAnchor: [0, -size / 2],
      })
    }
  })

  it("the setup map's pins are the sizes listed here", () => {
    const loc = { id: 'L1', name: 'Hornbæk', lat: 56.09027, lon: 12.45693 } as Location
    expect(savedSpotPins([loc], new Map()).map((p) => p.icon.size)).toEqual([16])
    expect(savedSpotPins([loc], new Map([['L1', 72]])).map((p) => p.icon.size)).toEqual([26])
  })
})

/**
 * Round H's browser check: a popup's tip covered the top of the pin it
 * points at, 4 to 5 px of the setup map's 16 px dot. A tap there landed on
 * the popup, which kept it open, while a tap on the rest of the pin closed
 * it. Where Leaflet 1.9.4 puts the tip, worked out from its own source and
 * sheet and the app's: an upgrade, or a rule in the app's CSS, that moves
 * it fails here. Screen y grows downwards; 0 is the pin's spot.
 */
describe("where Leaflet puts a pin's popup", () => {
  const src: string = readFileSync(new URL('../../node_modules/leaflet/dist/leaflet-src.js', import.meta.url), 'utf8')
  const leafletCss: string = readFileSync(new URL('../../node_modules/leaflet/dist/leaflet.css', import.meta.url), 'utf8')
  const appCss: string = readFileSync(new URL('../style.css', import.meta.url), 'utf8')

  /** The declarations of every rule in `css` whose selector list names `selector` itself, in order. */
  function rules(css: string, selector: string): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [, sel, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!sel.split(',').map((s) => s.trim()).includes(selector)) continue
      for (const d of body.split(';')) {
        const c = d.indexOf(':')
        if (c > 0) out[d.slice(0, c).trim()] = d.slice(c + 1).trim()
      }
    }
    return out
  }
  const px = (v: string | undefined) => {
    expect(v).toMatch(/^-?\d+(\.\d+)?px$/)
    return parseFloat(v!)
  }

  it('Leaflet opens a pin\'s popup at its spot, moved by the icon\'s popupAnchor, and puts the popup\'s bottom 7 px below that point', () => {
    // A tap on a pin opens its popup at the pin's spot, not where the finger landed (Map._fireDOMEvent).
    expect(src).toContain('data.latlng = isMarker ? target.getLatLng() : this.layerPointToLatLng(data.layerPoint);')
    // The icon's top left corner is its anchor away from the spot (Icon._setIconStyles).
    expect(src).toContain("img.style.marginTop  = (-anchor.y) + 'px';")
    // The popup's point is the spot moved by the icon's popupAnchor (Marker._getPopupAnchor, Popup._getAnchor).
    expect(src).toMatch(/_getPopupAnchor: function \(\) \{\s+return this\.options\.icon\.options\.popupAnchor;/)
    expect(src).toContain('return toPoint(this._source && this._source._getPopupAnchor ? this._source._getPopupAnchor() : [0, 0]);')
    // Its bottom edge goes the popup's offset below that point (DivOverlay._updatePosition), [0, 7] for a popup.
    expect(src).toMatch(/setPosition\(this\._container, pos\.add\(anchor\)\);[\s\S]{0,120}var bottom = this\._containerBottom = -offset\.y,/)
    expect(src).toContain('offset: [0, 7],')
  })

  it('the tip ends 3.5 px above the popup\'s point, and nothing below the tip takes a tap', () => {
    const popup = rules(leafletCss, '.leaflet-popup')
    const wrapper = rules(leafletCss, '.leaflet-popup-content-wrapper')
    const box = rules(leafletCss, '.leaflet-popup-tip-container')
    const tip = rules(leafletCss, '.leaflet-popup-tip')
    // The popup's own box ends where its text's box does; the tip's box hangs below it.
    expect(wrapper['margin'] ?? wrapper['margin-bottom']).toBeUndefined()
    expect([popup.position, box.position]).toEqual(['absolute', 'absolute'])
    // The tip's box takes no tap and clips the tip, which takes one: a square turned 45°.
    expect([box['pointer-events'], box.overflow, tip['pointer-events'], tip.transform]).toEqual(['none', 'hidden', 'auto', 'rotate(45deg)'])
    expect(tip.width).toBe(tip.height)
    // The app sizes every box by its border (style.css), Leaflet's tip with it: 17 px across, padding inside.
    expect(rules(appCss, '*')['box-sizing']).toBe('border-box')
    expect(tip['box-sizing']).toBeUndefined()
    // ...and leaves the popup's margins and tip as Leaflet draws them.
    expect(appCss).not.toMatch(/\.leaflet-popup-tip|\.leaflet-popup\s*[,{]/)

    const popupBottom = 7 - px(popup['margin-bottom']) // -13
    const tipTop = popupBottom + px(box['margin-top']) + px(tip.margin.split(/\s+/)[0]) // -24
    const side = px(tip.width)
    const tipEnd = tipTop + side / 2 + side / Math.SQRT2
    expect(tipEnd).toBeCloseTo(-3.48, 2)
    expect(popupBottom).toBeLessThan(tipEnd)
  })

  it('so the tip ends just above the pin, for every pin size, and the popup lies wholly above it', () => {
    const TIP_END = -3.48 // the test above
    for (const size of SIZES) {
      const o = pinIconOptions({ html: '', size })
      const pinTop = -o.iconAnchor[1]
      const tipEnd = o.popupAnchor[1] + TIP_END
      expect(tipEnd, `${size} px`).toBeLessThan(pinTop)
      expect(pinTop - tipEnd, `${size} px`).toBeLessThan(4)
      // Centred on the pin, across.
      expect(o.popupAnchor[0], `${size} px`).toBe(0)
      expect(o.iconAnchor[0] * 2, `${size} px`).toBe(o.iconSize[0])
    }
  })
})
