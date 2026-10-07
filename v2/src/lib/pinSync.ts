/**
 * Keeps a map's pins in step with what should be shown, touching only what
 * changed. The dashboard map used to clearLayers() and fitBounds() on every
 * windows change — and the windows change each time a lightning reading
 * lands (up to one per saved spot after a refresh). Each one closed the popup
 * you had open and snapped the map back out of your zoom.
 *
 * Map-library agnostic (the caller supplies add/update/remove), so the node
 * tests can cover it without a DOM.
 */

export interface PinSpec {
  /** Stable key — the location id. */
  id: string
  lat: number
  lon: number
  /** Marker markup and size; a change swaps the icon. */
  icon: { html: string; size: number }
  /** Popup markup; a change replaces the content of the same (possibly open) popup. */
  popup: string
}

export interface PinChange { moved: boolean; icon: boolean; popup: boolean }

export interface PinOps<M> {
  add(p: PinSpec): M
  update(marker: M, p: PinSpec, changed: PinChange): void
  remove(marker: M): void
}

export function createPinSync<M>(ops: PinOps<M>) {
  const live = new Map<string, { marker: M; spec: PinSpec }>()
  let boundsKey = ''

  return {
    /**
     * Reconcile the pins with `specs`. Returns true when the set of pin
     * positions changed (a spot added, removed or moved, compare toggled) —
     * the only time the map should refit its bounds.
     */
    sync(specs: PinSpec[]): boolean {
      const want = new Set(specs.map((s) => s.id))
      for (const [id, e] of live) {
        if (!want.has(id)) { ops.remove(e.marker); live.delete(id) }
      }
      for (const s of specs) {
        const e = live.get(s.id)
        if (!e) { live.set(s.id, { marker: ops.add(s), spec: s }); continue }
        const changed: PinChange = {
          moved: e.spec.lat !== s.lat || e.spec.lon !== s.lon,
          icon: e.spec.icon.html !== s.icon.html || e.spec.icon.size !== s.icon.size,
          popup: e.spec.popup !== s.popup,
        }
        if (changed.moved || changed.icon || changed.popup) ops.update(e.marker, s, changed)
        e.spec = s
      }
      const key = specs.map((s) => `${s.lat},${s.lon}`).sort().join('|')
      const refit = key !== boundsKey
      boundsKey = key
      return refit
    },
    /** Forget every pin (the map was torn down). */
    clear() { live.clear(); boundsKey = '' },
  }
}
