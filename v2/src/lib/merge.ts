/**
 * Three-way merge for the synced documents (the setup, the catch log).
 *
 * Both stores used to push the WHOLE local document whenever its edit stamp
 * was newer than the row's. Nothing said which version of the row the local
 * copy was built on, so "the account changed too" looked exactly like "only
 * I changed": a phone that logged one catch offline on a Saturday-morning copy
 * pushed its 6 entries over the 8 the desktop had saved that evening, and
 * c6–c8 were gone from every device. The stores now keep the version they last
 * agreed with the account on (the base) and merge base, local and remote here.
 *
 * Rules, in one line each:
 * - an item (by id) added on either side is kept;
 * - an item deleted on one side and untouched on the other is deleted;
 * - an item deleted on one side but edited on the other is KEPT (an edit is
 *   never lost to a stale delete);
 * - an item on all three merges field by field: whichever side changed a field
 *   wins it, and when both did, local wins (it is the newer, unpushed edit);
 *   fields that make one choice together (a catch's name + link) as one field;
 * - the order of a collection follows the remote side unless the local side
 *   moved items itself; an item only one side holds keeps its place there;
 * - with no base at all (a document from before this existed) nothing is ever
 *   dropped: a union of the items, and of the fields of an item both hold —
 *   where both hold a field, the side the caller prefers (the newer edit) wins.
 *
 * Pure and side-effect free; inputs are never mutated. Values are plain JSON.
 */

type Rec = Record<string, unknown>

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Equal as JSON: what the row would hold. Key order doesn't matter and an
 * `undefined` member counts as absent (JSON.stringify drops it, and the catch
 * form leaves `time: undefined` on entries) — otherwise an untouched entry
 * would look edited and win against a real remote edit.
 */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((x, i) => jsonEqual(x ?? null, b[i] ?? null))
  }
  if (!isRec(a) || !isRec(b)) return false
  const ka = Object.keys(a).filter((k) => a[k] !== undefined)
  const kb = Object.keys(b).filter((k) => b[k] !== undefined)
  return ka.length === kb.length && ka.every((k) => b[k] !== undefined && jsonEqual(a[k], b[k]))
}

/** Key-sorted JSON, so two copies of an id-less item get the same key. */
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map((x) => stableJson(x ?? null)).join(',') + ']'
  if (isRec(v)) {
    return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort()
      .map((k) => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}'
  }
  return JSON.stringify(v) ?? 'null'
}

/**
 * A short fingerprint of a JSON value, the same for every value jsonEqual
 * calls equal (key order and undefined members don't count — the server's
 * jsonb hands keys back in its own order). Lets a store recognise a document
 * it sent without keeping a copy of it (cyrb53 over the key-sorted JSON).
 */
export function fingerprint(v: unknown): string {
  const s = stableJson(v)
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + '.' + s.length.toString(36)
}

/**
 * One value: only remote changed it → remote; otherwise local (unchanged,
 * changed only here, or changed on both sides — the local edit is the newer,
 * unpushed one). Nested arrays/objects are compared and taken whole.
 */
export function mergeValue<T>(base: T | undefined, local: T | undefined, remote: T | undefined): T | undefined {
  return jsonEqual(local, base) && !jsonEqual(remote, base) ? remote : local
}

/**
 * Fields that hold one choice between them, merged as one value: taken
 * together from whichever side changed any of them (local when both did). A
 * catch's `locationName` + `locationId` are its place; merged apart, the
 * desktop linking saved "Spot 2" while the phone typed "Havnen" gave
 * { Havnen, l2 } — a catch shown and scored at the spot the losing edit chose.
 */
export type FieldGroups = readonly (readonly string[])[]

/**
 * One item, field by field. With no base (both sides added the same id) every
 * field counts as added, so the result is a union with local values first.
 * Fields this version doesn't know pass through like any other.
 */
export function mergeRecord<T extends object>(base: T | undefined, local: T, remote: T, groups?: FieldGroups): T
export function mergeRecord(base: Rec | undefined, local: Rec, remote: Rec, groups: FieldGroups = []): Rec {
  const from = new Map<string, Rec>()
  for (const g of groups) {
    const changed = (side: Rec) => g.some((k) => !jsonEqual(side[k], base?.[k]))
    const side = !changed(local) && changed(remote) ? remote : local
    for (const k of g) from.set(k, side)
  }
  const out: Rec = {}
  for (const k of [...Object.keys(local), ...Object.keys(remote).filter((k) => !(k in local))]) {
    const v = from.has(k) ? from.get(k)![k] : mergeValue(base?.[k], local[k], remote[k])
    if (v !== undefined) out[k] = v
  }
  return out
}

/**
 * Identity of each item: its id, numbered by occurrence, so a duplicated id
 * can't make one copy swallow the other. Items with no usable id (never made
 * by the app, but a document is the user's own data) are keyed by content.
 */
function keysOf(items: readonly unknown[]): string[] {
  const seen = new Map<string, number>()
  return items.map((it) => {
    const key = isRec(it) && typeof it.id === 'string' && it.id ? 'id:' + it.id : 'json:' + stableJson(it)
    const n = seen.get(key) ?? 0
    seen.set(key, n + 1)
    return n ? `${key}#${n}` : key
  })
}

const sameKeys = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k, i) => k === b[i])

/** A collection keyed by `id`: locations, availability windows, catch entries. */
export function mergeById<T>(base: readonly T[], local: readonly T[], remote: readonly T[], groups: FieldGroups = []): T[] {
  const baseKeys = keysOf(base)
  const baseBy = new Map(baseKeys.map((k, i) => [k, base[i]] as const))
  const localKeys = keysOf(local)
  const localBy = new Map(localKeys.map((k, i) => [k, local[i]] as const))
  const remoteKeys = keysOf(remote)
  const remoteBy = new Map(remoteKeys.map((k, i) => [k, remote[i]] as const))

  // The order is an edit too — the user drags spots into it. It always
  // followed the local side, so the phone's offline star pushed [1, 2, 3] back
  // over the desktop's drag of Spot 3 to the top (and a spot the desktop added
  // and dragged up landed at the bottom). While this side kept the items all
  // three hold in the base's order, the result follows the remote order;
  // when this side moved them itself, its own. What only the other side
  // holds goes in just before the item that follows it there (at the end if
  // none), so an addition stays where its side put it.
  const inAll = (k: string) => baseBy.has(k) && localBy.has(k) && remoteBy.has(k)
  const order = (keys: string[]) => keys.filter(inAll)
  const remoteFirst = sameKeys(order(localKeys), order(baseKeys))
  const seq = remoteFirst ? [...remoteKeys] : [...localKeys]
  const others = remoteFirst ? localKeys : remoteKeys
  for (let j = others.length - 1, at = seq.length; j >= 0; j--) {
    const i = seq.indexOf(others[j])
    if (i !== -1) at = i
    else seq.splice(at, 0, others[j])
  }

  const out: T[] = []
  for (const k of seq) {
    const b = baseBy.get(k)
    if (localBy.has(k) && remoteBy.has(k)) {
      const l = localBy.get(k) as T
      const r = remoteBy.get(k) as T
      out.push((isRec(l) && isRec(r) ? mergeRecord(isRec(b) ? b : undefined, l, r, groups) : mergeValue(b, l, r)) as T)
      continue
    }
    // On one side only: added there — or edited there while deleted on the
    // other side, and the edit wins. Untouched there and deleted on the
    // other side → gone.
    const only = (localBy.has(k) ? localBy.get(k) : remoteBy.get(k)) as T
    if (!baseBy.has(k) || !jsonEqual(only, b)) out.push(only)
  }
  return out
}

export interface MergeOpts {
  /** Fields merged as one value (a catch's place). */
  groups?: FieldGroups
  /**
   * With no base only: the side whose value wins a field both sides hold —
   * the one with the newer edit, as far as the caller can tell. Default local.
   */
  prefer?: 'local' | 'remote'
}

/**
 * No base to tell a deletion from an addition: keep everything — every item,
 * and every field of an item both sides hold. Resurrecting an item deleted on
 * one device (or a field cleared there) is the accepted cost; losing one is
 * not. Where both hold a field, the preferred side wins. That was always the
 * local copy, whole, which reverted every edit the other device had made to a
 * shared item — the desktop's rename of a spot, under a phone whose only
 * unsynced edit was an older star on another — where last-write-wins (the
 * version before) would have kept it. With the newer side preferred, no item
 * or field comes out worse than last-write-wins would have left it.
 */
export function unionById<T>(local: readonly T[], remote: readonly T[], opts: MergeOpts = {}): T[] {
  const [first, then] = opts.prefer === 'remote' ? [remote, local] : [local, remote]
  const firstKeys = keysOf(first)
  const thenKeys = keysOf(then)
  const thenBy = new Map(thenKeys.map((k, i) => [k, then[i]] as const))
  const inFirst = new Set(firstKeys)
  return [
    ...first.map((x, i) => {
      const y = thenBy.get(firstKeys[i])
      // mergeRecord with no base: every field of either, `x`'s value where both hold one.
      return (isRec(x) && isRec(y) ? mergeRecord(undefined, x, y, opts.groups) : x) as T
    }),
    ...then.filter((_, i) => !inFirst.has(thenKeys[i])),
  ]
}

/** Catch entries: three-way against the base, or a union when there is none. */
export function mergeList<T>(base: readonly T[] | null, local: readonly T[], remote: readonly T[], opts: MergeOpts = {}): T[] {
  return base ? mergeById(base, local, remote, opts.groups) : unionById(local, remote, opts)
}

/** A set (target species): added on either side → in; removed on one side and kept on the other → out. */
export function mergeSet<T extends string | number>(base: readonly T[], local: readonly T[], remote: readonly T[]): T[] {
  const inBase = new Set(base)
  const inLocal = new Set(local)
  const inRemote = new Set(remote)
  const out = new Set<T>()
  for (const x of local) if (!inBase.has(x) || inRemote.has(x)) out.add(x)
  for (const x of remote) if (!inLocal.has(x) && !inBase.has(x)) out.add(x)
  return [...out]
}

export function unionSet<T extends string | number>(local: readonly T[], remote: readonly T[]): T[] {
  return [...new Set([...local, ...remote])]
}

/** Which members of a document are keyed collections and which are sets; everything else is a scalar. */
export interface DocShape { collections: readonly string[]; sets: readonly string[] }

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string')

/**
 * A whole document. `base` null = no common ancestor (a legacy document):
 * collections and sets are unioned, and scalars keep the preferred side's
 * value where there is one (see unionById). Members this version doesn't
 * know are merged as scalars, so a newer app version's fields survive an
 * older one's push.
 */
export function mergeDoc(base: Rec | null, local: Rec, remote: Rec, shape: DocShape, opts: MergeOpts = {}): Rec {
  const out: Rec = {}
  for (const k of [...Object.keys(local), ...Object.keys(remote).filter((k) => !(k in local))]) {
    const l = local[k]
    const r = remote[k]
    const [first, then] = opts.prefer === 'remote' ? [r, l] : [l, r]
    let v: unknown
    if (shape.collections.includes(k)) v = base ? mergeById(arr(base[k]), arr(l), arr(r), opts.groups) : unionById(arr(l), arr(r), opts)
    else if (shape.sets.includes(k)) v = base ? mergeSet(strs(base[k]), strs(l), strs(r)) : unionSet(strs(l), strs(r))
    else v = base ? mergeValue(base[k], l, r) : first !== undefined ? first : then
    if (v !== undefined) out[k] = v
  }
  return out
}
