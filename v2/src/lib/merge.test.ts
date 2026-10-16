import { describe, it, expect } from 'vitest'
import { jsonEqual, mergeValue, mergeRecord, mergeById, unionById, mergeSet, unionSet, mergeDoc, mergeList } from './merge'

/**
 * The three-way merge behind sync. Both stores used to push the WHOLE local
 * document whenever its edit stamp was newer: a phone that logged one catch
 * offline on a Saturday-morning copy pushed its 6 entries over the desktop's
 * 8, and c6–c8 were gone from every device. These cases pin what a merge of
 * base (the copy both sides started from), local and remote may and may not do.
 */

const item = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> & { id: string } => ({ id, name: 'Spot ' + id, ...over })

describe('jsonEqual', () => {
  it('compares the JSON a value serialises to', () => {
    expect(jsonEqual({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true) // key order is irrelevant
    expect(jsonEqual({ a: 1, x: undefined }, { a: 1 })).toBe(true) // undefined members are dropped by JSON
    expect(jsonEqual([undefined], [null])).toBe(true) // …and become null inside arrays
    expect(jsonEqual([1, 2], [2, 1])).toBe(false) // array order is not
    expect(jsonEqual({ a: null }, {})).toBe(false) // null is a value
    expect(jsonEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false)
    expect(jsonEqual(1, '1')).toBe(false)
    expect(jsonEqual(undefined, undefined)).toBe(true)
    expect(jsonEqual({}, [])).toBe(false)
  })
})

describe('mergeValue (one field)', () => {
  it('takes the side that changed it', () => {
    expect(mergeValue('b', 'b', 'r')).toBe('r') // only remote changed
    expect(mergeValue('b', 'l', 'b')).toBe('l') // only local changed
    expect(mergeValue('b', 'b', 'b')).toBe('b')
  })

  it('keeps the local value when both changed it differently (the newer, unpushed edit)', () => {
    expect(mergeValue('b', 'l', 'r')).toBe('l')
    expect(mergeValue('b', 'same', 'same')).toBe('same')
  })

  it('treats a missing field as a value like any other', () => {
    expect(mergeValue(undefined, undefined, 'r')).toBe('r') // added remotely
    expect(mergeValue('b', undefined, 'b')).toBeUndefined() // cleared locally
    expect(mergeValue('b', 'b', undefined)).toBeUndefined() // cleared remotely
  })

  it('compares nested values deeply, as one value', () => {
    const species = [{ nameEn: 'Cod', months: [1, 2] }]
    expect(mergeValue(species, [{ nameEn: 'Cod', months: [1, 2] }], [{ nameEn: 'Cod', months: [3] }])).toEqual([{ nameEn: 'Cod', months: [3] }])
  })
})

describe('mergeRecord (one item, per field)', () => {
  it('combines edits to different fields', () => {
    const base = item('a', { fav: false })
    expect(mergeRecord(base, { ...base, fav: true }, { ...base, name: 'Molen' })).toEqual(item('a', { fav: true, name: 'Molen' }))
  })

  it('lets the local edit win a same-field conflict, and keeps the remote edit of another field', () => {
    const base = item('a', { note: 'x', fav: false })
    expect(mergeRecord(base, { ...base, note: 'local' }, { ...base, note: 'remote', fav: true }))
      .toEqual(item('a', { note: 'local', fav: true }))
  })

  it('drops a field cleared on one side and untouched on the other', () => {
    const base = item('a', { note: 'x' })
    const { note: _, ...cleared } = base
    expect(mergeRecord(base, cleared, base)).toEqual(item('a'))
    expect(mergeRecord(base, base, cleared)).toEqual(item('a'))
  })

  it('unions the fields of an item both sides added (no base), local first', () => {
    expect(mergeRecord(undefined, { id: 'a', x: 1, y: 'l' }, { id: 'a', y: 'r', z: 3 })).toEqual({ id: 'a', x: 1, y: 'l', z: 3 })
  })

  it('round-trips fields it does not know (forward compatibility)', () => {
    const base = item('a', { future: { deep: [1] } })
    expect(mergeRecord(base, { ...base, fav: true }, base)).toEqual(item('a', { future: { deep: [1] }, fav: true }))
    expect(mergeRecord(base, base, { ...base, other: 'new' })).toEqual(item('a', { future: { deep: [1] }, other: 'new' }))
  })
})

describe('mergeById (a keyed collection)', () => {
  const ids = (xs: { id?: unknown }[]) => xs.map((x) => x.id)

  it('keeps additions from both sides: local order, then remote additions in remote order', () => {
    const base = [item('a'), item('b')]
    expect(ids(mergeById(base, [...base, item('l1')], [...base, item('r1'), item('r2')]))).toEqual(['a', 'b', 'l1', 'r1', 'r2'])
  })

  /**
   * The order of the spots is the user's own edit (LocationsView drags them),
   * but the merge always laid the result out in local order: the desktop
   * dragged Spot 3 to the top, the phone starred Spot 1 offline, and the
   * phone's merge pushed [1, 2, 3] back — the drag undone on both devices.
   */
  it("keeps the other side's reorder when this side only edited", () => {
    const base = [item('a'), item('b'), item('c')]
    const dragged = [item('c'), item('a'), item('b')]
    expect(mergeById(base, [item('a', { fav: true }), item('b'), item('c')], dragged)).toEqual([item('c'), item('a', { fav: true }), item('b')])
    // Additions from either side come along; this side's go after the other's order.
    expect(ids(mergeById(base, [...base, item('l')], [...dragged, item('r')]))).toEqual(['c', 'a', 'b', 'r', 'l'])
    // A deletion here doesn't count as a reorder here.
    expect(ids(mergeById(base, [item('a'), item('c')], dragged))).toEqual(['c', 'a'])
  })

  it("keeps this side's order when both sides reordered, or only this side did", () => {
    const base = [item('a'), item('b'), item('c')]
    expect(ids(mergeById(base, [item('b'), item('a'), item('c')], [item('c'), item('a'), item('b')]))).toEqual(['b', 'a', 'c'])
    expect(ids(mergeById(base, [item('b'), item('a'), item('c')], [...base, item('r')]))).toEqual(['b', 'a', 'c', 'r'])
  })

  it('deletes what one side deleted and the other left untouched', () => {
    const base = [item('a'), item('b'), item('c')]
    expect(ids(mergeById(base, [item('a'), item('c')], base))).toEqual(['a', 'c']) // deleted here
    expect(ids(mergeById(base, base, [item('a'), item('b')]))).toEqual(['a', 'b']) // deleted there
    expect(ids(mergeById(base, [item('b'), item('c')], [item('a'), item('b')]))).toEqual(['b']) // one each
  })

  it('keeps an item deleted on one side but edited on the other — never loses an edit', () => {
    const base = [item('a'), item('b')]
    // Edited here, deleted there.
    expect(mergeById(base, [item('a', { note: 'edited' }), item('b')], [item('b')])).toEqual([item('a', { note: 'edited' }), item('b')])
    // Deleted here, edited there.
    expect(mergeById(base, [item('b')], [item('a', { note: 'edited' }), item('b')])).toEqual([item('b'), item('a', { note: 'edited' })])
  })

  it('drops an item both sides deleted', () => {
    const base = [item('a'), item('b')]
    expect(ids(mergeById(base, [item('b')], [item('b')]))).toEqual(['b'])
  })

  it('merges an item edited on both sides field by field', () => {
    const base = [item('a', { fav: false })]
    expect(mergeById(base, [item('a', { fav: true })], [item('a', { fav: false, name: 'Molen' })])).toEqual([item('a', { fav: true, name: 'Molen' })])
  })

  it('merges an id both sides added as one item, fields unioned', () => {
    expect(mergeById([], [{ id: 'n', x: 1 }], [{ id: 'n', y: 2 }])).toEqual([{ id: 'n', x: 1, y: 2 }])
  })

  it('keeps every copy of a duplicated id, matched by occurrence', () => {
    const base = [item('a'), item('a', { name: 'twin' })]
    expect(mergeById(base, base, [...base, item('a', { name: 'third' })])).toHaveLength(3)
    expect(mergeById([], [item('d'), item('d', { n: 2 })], [])).toHaveLength(2)
  })

  it('keys items with no usable id by their content', () => {
    const odd = { name: 'no id' }
    expect(mergeById([odd], [odd], [odd])).toEqual([odd])
    expect(mergeById([], [odd], [{ name: 'no id' }])).toEqual([odd])
    expect(mergeById([odd], [], [odd])).toEqual([]) // deleted here, untouched there
  })

  it('handles empty sides', () => {
    expect(mergeById([], [], [])).toEqual([])
    expect(ids(mergeById([], [], [item('r')]))).toEqual(['r'])
    expect(ids(mergeById([item('a')], [], []))).toEqual([])
  })

  it('does not mutate its inputs', () => {
    const base = [item('a', { fav: false })]
    const local = [item('a', { fav: true })]
    const remote = [item('a', { fav: false, name: 'x' })]
    const snap = JSON.stringify([base, local, remote])
    mergeById(base, local, remote)
    expect(JSON.stringify([base, local, remote])).toBe(snap)
  })
})

describe('unionById (no base: a legacy document)', () => {
  it('never drops an item from either side; the same id keeps the local copy', () => {
    const merged = unionById([item('a', { note: 'local' }), item('l')], [item('r'), item('a', { note: 'remote' })])
    expect(merged).toEqual([item('a', { note: 'local' }), item('l'), item('r')])
  })

  /**
   * With no base nothing tells which side edited an item both hold. Always
   * keeping the local copy reverted every edit the other device had made to
   * a shared item — the desktop's rename of Spot 1, under a phone whose only
   * unsynced edit was an older star on Spot 2 — where the previous version
   * (last write wins) would have kept it. Now the side with the newer edit
   * wins a field both hold, and a field only one side holds is kept.
   */
  it('takes the preferred side where both hold a field, and keeps what only one side holds', () => {
    const local = [item('a', { name: 'Spot 1' }), item('b', { fav: true }), item('l')]
    const remote = [item('a', { name: 'Nordmolen' }), item('b'), item('r')]
    expect(unionById(local, remote, { prefer: 'remote' })).toEqual([item('a', { name: 'Nordmolen' }), item('b', { fav: true }), item('r'), item('l')])
    expect(unionById(local, remote, { prefer: 'local' })).toEqual([item('a', { name: 'Spot 1' }), item('b', { fav: true }), item('l'), item('r')])
    expect(unionById([item('a')], [item('a', { weightKg: 2.4 })])).toEqual([item('a', { weightKg: 2.4 })])
  })

  it('takes grouped fields whole from one side', () => {
    const PLACE = [['locationName', 'locationId']]
    expect(unionById([{ id: 'c', locationName: 'Havnen' }], [{ id: 'c', locationName: 'Spot 2', locationId: 'l2' }], { prefer: 'local', groups: PLACE }))
      .toEqual([{ id: 'c', locationName: 'Havnen' }])
  })
})

describe('mergeSet (target species)', () => {
  it('adds what either side added', () => {
    expect(mergeSet(['torsk'], ['torsk', 'sild'], ['torsk', 'hornfisk'])).toEqual(['torsk', 'sild', 'hornfisk'])
  })

  it('removes what one side removed and the other kept', () => {
    expect(mergeSet(['torsk', 'sild'], ['torsk'], ['torsk', 'sild'])).toEqual(['torsk'])
    expect(mergeSet(['torsk', 'sild'], ['torsk', 'sild'], ['sild'])).toEqual(['sild'])
  })

  it('keeps what both still have, once', () => {
    expect(mergeSet([], ['a', 'a'], ['a'])).toEqual(['a'])
  })

  it('union, with no base, keeps everything once', () => {
    expect(unionSet(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c'])
  })
})

describe('mergeList (catch entries)', () => {
  it('merges three-way with a base, and unions without one', () => {
    const base = [item('c1'), item('c2')]
    expect(mergeList(base, [item('c1')], [...base, item('c3')]).map((x) => x.id)).toEqual(['c1', 'c3'])
    expect(mergeList(null, [item('c1')], [...base, item('c3')]).map((x) => x.id)).toEqual(['c1', 'c2', 'c3'])
  })

  /**
   * A catch's name and link are one choice: its place. Merged as two fields,
   * the desktop picking saved "Spot 2" while the phone typed "Havnen" came out
   * as { Havnen, l2 } — shown and scored at Spot 2, though the phone's edit
   * was the one that won.
   */
  it('takes fields grouped as one value from one side', () => {
    const PLACE = [['locationName', 'locationId']]
    const base = [{ id: 'c1', locationName: 'Bro', notes: 'x' }]
    const local = [{ id: 'c1', locationName: 'Havnen', notes: 'x' }]
    const remote = [{ id: 'c1', locationName: 'Spot 2', locationId: 'l2', notes: 'big one' }]
    expect(mergeList(base, local, remote, { groups: PLACE })).toEqual([{ id: 'c1', locationName: 'Havnen', notes: 'big one' }])
    // Only the remote side moved it: the whole place comes from there.
    expect(mergeList(base, [{ id: 'c1', locationName: 'Bro', notes: 'edited' }], remote, { groups: PLACE }))
      .toEqual([{ id: 'c1', locationName: 'Spot 2', locationId: 'l2', notes: 'edited' }])
    // A link changed here, a name changed there: still one side's place.
    const linked = [{ id: 'c1', locationName: 'Spot 1', locationId: 'l1' }]
    expect(mergeList(linked, [{ id: 'c1', locationName: 'Spot 1', locationId: 'l3' }], [{ id: 'c1', locationName: 'Nordmolen', locationId: 'l1' }], { groups: PLACE }))
      .toEqual([{ id: 'c1', locationName: 'Spot 1', locationId: 'l3' }])
  })
})

describe('mergeDoc (a whole setup document)', () => {
  const SHAPE = { collections: ['locations', 'availability'], sets: ['targetSpecies'] }
  const doc = (over: Record<string, unknown> = {}) => ({
    locations: [item('a'), item('b')], targetSpecies: ['torsk'], availability: [{ id: 'w', days: [1] }], lang: 'da', ...over,
  })

  it('merges every part by its own rule', () => {
    const base = doc()
    const local = doc({ locations: [item('a', { fav: true }), item('b')], lang: 'en' })
    const remote = doc({ locations: [item('a'), item('b'), item('c')], targetSpecies: ['torsk', 'sild'], availability: [] })
    expect(mergeDoc(base, local, remote, SHAPE)).toEqual({
      locations: [item('a', { fav: true }), item('b'), item('c')],
      targetSpecies: ['torsk', 'sild'],
      availability: [],
      lang: 'en',
    })
  })

  it('keeps the local scalar when both changed it, the remote one when only it did', () => {
    expect(mergeDoc(doc(), doc({ lang: 'en' }), doc({ lang: 'xx' }), SHAPE).lang).toBe('en')
    expect(mergeDoc(doc(), doc(), doc({ lang: 'en' }), SHAPE).lang).toBe('en')
  })

  it('round-trips document fields it does not know', () => {
    const base = doc({ future: { a: 1 } })
    expect(mergeDoc(base, base, doc({ future: { a: 1 }, newer: true }), SHAPE)).toEqual(doc({ future: { a: 1 }, newer: true }))
  })

  it('without a base, unions collections and sets and keeps local scalars', () => {
    const merged = mergeDoc(null, doc({ locations: [item('a')], lang: 'en' }), doc({ locations: [item('b')], targetSpecies: ['sild'], extra: 1 }), SHAPE)
    expect(merged).toEqual({
      locations: [item('a'), item('b')],
      targetSpecies: ['torsk', 'sild'],
      availability: [{ id: 'w', days: [1] }],
      lang: 'en',
      extra: 1,
    })
  })

  it('without a base, takes the remote scalars and copies when the remote side is preferred', () => {
    const merged = mergeDoc(null, doc({ locations: [item('a', { fav: true })], lang: 'da' }), doc({ locations: [item('a', { name: 'Molen' })], lang: 'en' }), SHAPE, { prefer: 'remote' })
    expect(merged.locations).toEqual([item('a', { name: 'Molen', fav: true })])
    expect(merged.lang).toBe('en')
  })

  it('treats a collection missing on one side as empty', () => {
    const merged = mergeDoc(doc(), doc(), { lang: 'da' }, SHAPE)
    expect(merged.locations).toEqual([])
    expect(merged.targetSpecies).toEqual([])
  })
})

/**
 * Generated histories: from one base, each side adds, deletes and edits at
 * random. Whatever happens, the guarantees the sync rests on must hold —
 * checked over a few hundred seeded runs rather than the handful above.
 */
describe('mergeById — invariants over generated edits', () => {
  type It = { id: string; a?: number; b?: number }
  // Small deterministic PRNG, so a failure reproduces.
  const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
  function evolve(base: It[], rand: () => number, tag: string) {
    const out: It[] = []
    const deleted = new Set<string>()
    const edited = new Set<string>()
    for (const x of base) {
      const r = rand()
      if (r < 0.2) { deleted.add(x.id); continue }
      if (r < 0.5) {
        // 1000+ never equals a base value, so every edit is a real change.
        edited.add(x.id)
        out.push(rand() < 0.5 ? { ...x, a: 1000 + Math.floor(rand() * 1000) } : { ...x, b: 1000 + Math.floor(rand() * 1000) })
        continue
      }
      out.push(x)
    }
    const added: It[] = []
    for (let i = 0; i < Math.floor(rand() * 3); i++) added.push({ id: `${tag}${i}`, a: i })
    return { items: [...out, ...added], deleted, edited, added }
  }
  const byId = (xs: It[]) => new Map(xs.map((x) => [x.id, x]))

  it('keeps every addition and every edit, and only drops untouched deletions', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rand = rng(seed)
      const base: It[] = Array.from({ length: 1 + Math.floor(rand() * 6) }, (_, i) => ({ id: 'b' + i, a: i, b: i }))
      const L = evolve(base, rand, 'l')
      const R = evolve(base, rand, 'r')
      const merged = byId(mergeById(base, L.items, R.items))
      for (const x of [...L.added, ...R.added]) expect(merged.get(x.id), `seed ${seed}: addition ${x.id}`).toEqual(x)
      for (const id of [...L.edited, ...R.edited]) expect(merged.has(id), `seed ${seed}: edit of ${id}`).toBe(true)
      for (const x of base) {
        const gone = (L.deleted.has(x.id) && !R.edited.has(x.id)) || (R.deleted.has(x.id) && !L.edited.has(x.id))
        expect(merged.has(x.id), `seed ${seed}: ${x.id}`).toBe(!gone)
      }
      // Each field ends up as whichever side changed it, local winning a tie.
      const lb = byId(L.items), rb = byId(R.items), bb = byId(base)
      for (const [id, m] of merged) {
        const l = lb.get(id), r = rb.get(id), b = bb.get(id)
        if (!l || !r) continue
        for (const f of ['a', 'b'] as const) {
          const want = b && l[f] === b[f] ? r[f] : l[f]
          expect(m[f], `seed ${seed}: ${id}.${f}`).toBe(want)
        }
      }
    }
  })

  it('returns the other side unchanged when one side made no edits', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const rand = rng(seed)
      const base: It[] = Array.from({ length: 1 + Math.floor(rand() * 6) }, (_, i) => ({ id: 'b' + i, a: i }))
      const X = evolve(base, rand, 'x').items
      expect(mergeById(base, X, base), `seed ${seed}`).toEqual(X)
      const sort = (xs: It[]) => [...xs].sort((p, q) => p.id.localeCompare(q.id))
      expect(sort(mergeById(base, base, X)), `seed ${seed}`).toEqual(sort(X))
      expect(mergeById(base, X, X), `seed ${seed}`).toEqual(X)
    }
  })

  it("keeps a reorder made only on the other side, whatever else either side did", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rand = rng(seed)
      const base: It[] = Array.from({ length: 2 + Math.floor(rand() * 6) }, (_, i) => ({ id: 'b' + i, a: i, b: i }))
      const L = evolve(base, rand, 'l')
      const R = evolve(base, rand, 'r')
      const reordered = [...R.items].reverse()
      const merged = mergeById(base, L.items, reordered)
      // The items all three still hold come out in the other side's new order.
      const inAll = (xs: It[]) => xs.map((x) => x.id).filter((id) => base.some((b) => b.id === id) && L.items.some((l) => l.id === id) && R.items.some((r) => r.id === id))
      expect(inAll(merged), `seed ${seed}`).toEqual(inAll(reordered))
    }
  })
})
