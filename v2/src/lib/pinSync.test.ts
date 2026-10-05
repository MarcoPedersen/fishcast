import { describe, it, expect } from 'vitest'
import { createPinSync, type PinSpec } from './pinSync'

/** A fake map layer that records what the sync asked of it. */
function fakeLayer() {
  const log: string[] = []
  let n = 0
  const sync = createPinSync<{ n: number; id: string }>({
    add: (p) => { log.push(`add ${p.id}`); return { n: ++n, id: p.id } },
    update: (m, p, c) => {
      log.push(`update ${p.id}${c.moved ? ' moved' : ''}${c.icon ? ' icon' : ''}${c.popup ? ' popup' : ''}`)
      expect(m.id).toBe(p.id) // the marker that was created for this id, not a new one
    },
    remove: (m) => { log.push(`remove ${m.id}`) },
  })
  return { sync, log }
}

const pin = (id: string, score: number, lat = 55.5): PinSpec => ({
  id, lat, lon: 12.0, icon: { html: `<div>${score}</div>`, size: 30 }, popup: `<strong>${id}</strong> ${score}`,
})

describe('createPinSync', () => {
  it('adds every pin on the first sync and asks for a fit', () => {
    const { sync, log } = fakeLayer()
    expect(sync.sync([pin('a', 50), pin('b', 60, 55.6)])).toBe(true)
    expect(log).toEqual(['add a', 'add b'])
  })

  it('a score change updates the pin in place — no re-add, no refit', () => {
    // The map used to clear every marker and refit on each windows change, so
    // a lightning reading landing closed the popup you had open and snapped
    // the map back out of your zoom.
    const { sync, log } = fakeLayer()
    sync.sync([pin('a', 50), pin('b', 60, 55.6)])
    log.length = 0
    expect(sync.sync([pin('a', 15), pin('b', 60, 55.6)])).toBe(false)
    expect(log).toEqual(['update a icon popup'])
  })

  it('does nothing at all when nothing changed', () => {
    const { sync, log } = fakeLayer()
    sync.sync([pin('a', 50)])
    log.length = 0
    expect(sync.sync([pin('a', 50)])).toBe(false)
    expect(log).toEqual([])
  })

  it('refits when the set of pins changes: added, removed or moved', () => {
    const { sync, log } = fakeLayer()
    sync.sync([pin('a', 50)])
    log.length = 0
    expect(sync.sync([pin('a', 50), pin('off-x', 70, 55.7)])).toBe(true)
    expect(sync.sync([pin('a', 50)])).toBe(true)
    expect(sync.sync([pin('a', 50, 55.9)])).toBe(true)
    expect(log).toEqual(['add off-x', 'remove off-x', 'update a moved'])
  })

  it('does not refit for a reordering of the same pins', () => {
    const { sync } = fakeLayer()
    sync.sync([pin('a', 50), pin('b', 60, 55.6)])
    expect(sync.sync([pin('b', 60, 55.6), pin('a', 50)])).toBe(false)
  })

  it('starts over after clear()', () => {
    const { sync, log } = fakeLayer()
    sync.sync([pin('a', 50)])
    sync.clear()
    log.length = 0
    expect(sync.sync([pin('a', 50)])).toBe(true)
    expect(log).toEqual(['add a'])
  })
})
