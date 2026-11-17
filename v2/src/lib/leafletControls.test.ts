import { afterEach, describe, expect, it } from 'vitest'
import { effectScope, nextTick, shallowRef, type EffectScope } from 'vue'
// @ts-ignore — no @types/node in this project; vitest runs in Node.
import { readFileSync } from 'node:fs'
import type L from 'leaflet'
import { FakeMap, FakePopup, type FakeEl } from '@/test/fakeLeaflet'
import { STRINGS } from '@/test/strings'
import { langReady, setLang } from './i18n'
import { LEAFLET_PREFIX } from './osmCredit'
import { useLeafletControls } from './leafletControls'

/**
 * Both maps use Leaflet's own controls, which speak English whatever the
 * app's language: the zoom buttons' "Zoom in" and "Zoom out", and a popup's
 * ✕, "Close popup". The app's words go on them, in the language shown, and
 * again when it changes. Leaflet keeps a popup's frame between openings, so
 * its ✕ is labelled each time it opens. And the credit line's link to
 * Leaflet opens in a new tab (osmCredit.ts).
 */
const DA = STRINGS.da
const EN = STRINGS.en

/** What a screen reader reads, and a hover shows, for a Leaflet button. */
const said = (e: FakeEl) => `${e.getAttribute('aria-label')} | ${e.getAttribute('title')}`
const both = (s: string) => `${s} | ${s}`

let scope: EffectScope | undefined

/** A map as a view sets it up: the composable first, then the map once Leaflet has made it. */
async function setUp(m = new FakeMap()) {
  const map = shallowRef<L.Map | null>(null)
  scope = effectScope()
  scope.run(() => useLeafletControls(map))
  map.value = m as unknown as L.Map
  await nextTick()
  return m
}

async function switchTo(l: 'da' | 'en') {
  setLang(l)
  expect(await langReady()).toBe(true)
  await nextTick()
}

afterEach(async () => {
  scope?.stop()
  scope = undefined
  setLang('da')
  await nextTick()
})

describe("Leaflet's own controls", () => {
  it('the zoom buttons are named in Danish, for a screen reader and as a tooltip', async () => {
    const m = await setUp()
    expect([said(m.zoomIn), said(m.zoomOut)]).toEqual([both(DA.map_zoom_in), both(DA.map_zoom_out)])
    expect(DA.map_zoom_in).not.toBe('Zoom in')
  })

  it("a popup's ✕ is named as it opens, in the language shown then", async () => {
    const m = await setUp()
    const popup = m.openPopup()
    expect(said(popup.closeButton)).toBe(both(DA.close))
    m.closePopup(popup)
    await switchTo('en')
    m.openPopup(popup) // the same frame, labelled in Danish when it was last open
    expect(said(popup.closeButton)).toBe(both(EN.close))
  })

  it('a switch of language renames the zoom buttons and an open popup\'s ✕, and back', async () => {
    const m = await setUp()
    const popup = m.openPopup()
    await switchTo('en')
    expect([said(m.zoomIn), said(m.zoomOut), said(popup.closeButton)]).toEqual([both(EN.map_zoom_in), both(EN.map_zoom_out), both(EN.close)])
    await switchTo('da')
    expect([said(m.zoomIn), said(m.zoomOut), said(popup.closeButton)]).toEqual([both(DA.map_zoom_in), both(DA.map_zoom_out), both(DA.close)])
  })

  it("starts the credit line with Leaflet's credit opening in a new tab, in either language", async () => {
    const m = await setUp()
    expect(m.attributionControl.prefix).toBe(LEAFLET_PREFIX)
    await switchTo('en')
    expect(m.attributionControl.prefix).toBe(LEAFLET_PREFIX)
  })

  it('leaves a map alone once its view is gone', async () => {
    const m = await setUp()
    scope!.stop()
    const popup = m.openPopup()
    expect(said(popup.closeButton)).toBe('Close popup | null')
    await switchTo('en')
    expect(said(m.zoomIn)).toBe(both(DA.map_zoom_in))
  })
})

/**
 * The fake (test/fakeLeaflet) stands in for Leaflet's own markup. These are
 * the lines of Leaflet that build it: the classes the labels are found by,
 * and the English they replace. An upgrade that changes them fails here.
 */
describe('the Leaflet these labels are written for', () => {
  const src: string = readFileSync(new URL('../../node_modules/leaflet/dist/leaflet-src.js', import.meta.url), 'utf8')

  it('names its zoom buttons and a popup\'s ✕ by these classes, in English', () => {
    for (const line of [
      "zoomName = 'leaflet-control-zoom'", "zoomName + '-in'", "zoomName + '-out'",
      "zoomInTitle: 'Zoom in'", "zoomOutTitle: 'Zoom out'", 'link.title = title;', "link.setAttribute('aria-label', title);",
      "var prefix = 'leaflet-popup'", "prefix + '-close-button'", "closeButton.setAttribute('aria-label', 'Close popup');",
    ]) expect(src, line).toContain(line)
  })

  it('has put a popup in the map when the map says it opened', () => {
    expect(src).toContain('this.getPane().appendChild(this._container);') // DivOverlay's onAdd
    expect(src).toMatch(/onAdd: function \(map\) \{\s+DivOverlay\.prototype\.onAdd\.call\(this, map\);(?:\s+\/\/[^\n]*)*\s+map\.fire\('popupopen', \{popup: this\}\);/)
  })
})
