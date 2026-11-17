/**
 * Leaflet's own controls on a map, in the app's language. Leaflet names its
 * zoom buttons "Zoom in" and "Zoom out" (their tooltip, and what a screen
 * reader reads) and a popup's ✕ "Close popup", in English whatever the
 * language. Both maps (MapView, MapTab) put the app's words on them here.
 */
import { watch, type Ref } from 'vue'
import type L from 'leaflet'
import { shownLang, t } from './i18n'

/** Names a button for a screen reader and as a tooltip. */
function name(el: Element | null, text: string) {
  el?.setAttribute('aria-label', text)
  el?.setAttribute('title', text)
}

/** Names Leaflet's buttons in a map: its zoom buttons, and the ✕ of each popup open in it. */
function nameButtons(root: ParentNode) {
  name(root.querySelector('.leaflet-control-zoom-in'), t('map_zoom_in'))
  name(root.querySelector('.leaflet-control-zoom-out'), t('map_zoom_out'))
  root.querySelectorAll('.leaflet-popup-close-button').forEach((b) => name(b, t('close')))
}

/**
 * Called from a map view's setup, with the ref its map goes in. Names the
 * controls once the map is made, and again when the language shown changes
 * (for English a moment after the switch, as its table lands: i18n.ts).
 * Leaflet lays a popup out the first time it opens, in English, and keeps it
 * between openings: so a popup is named each time it opens, in the language
 * shown then. Stops with the view.
 */
export function useLeafletControls(map: Readonly<Ref<L.Map | null>>): void {
  watch([map, shownLang], ([m], _, onCleanup) => {
    if (!m) return
    const rename = () => nameButtons(m.getContainer())
    rename()
    m.on('popupopen', rename)
    onCleanup(() => { m.off('popupopen', rename) })
  }, { immediate: true })
}
