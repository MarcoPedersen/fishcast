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
 * - with no base at all (a document from before this existed) nothing is ever
 *   dropped: a union, local copy first for the same id.
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
 * One value: only remote changed it → remote; otherwise local (unchanged,
 * changed only here, or changed on both sides — the local edit is the newer,
 * unpushed one). Nested arrays/objects are compared and taken whole.
 */
export function mergeValue<T>(base: T | undefined, local: T | undefined, remote: T | undefined): T | undefined {
  return jsonEqual(local, base) && !jsonEqual(remote, base) ? remote : local
}

/**
 * One item, field by field. With no base (both sides added the same id) every
 * field counts as added, so the result is a union with local values first.
 * Fields this version doesn't know pass through like any other.
 */
export function mergeRecord(base: Rec | undefined, local: Rec, remote: Rec): Rec {
  const out: Rec = {}
  for (const k of [...Object.keys(local), ...Object.keys(remote).filter((k) => !(k in local))]) {
    const v = mergeValue(base?.[k], local[k], remote[k])
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

/** A collection keyed by `id`: locations, availability windows, catch entries. */
export function mergeById<T>(base: readonly T[], local: readonly T[], remote: readonly T[]): T[] {
  const baseBy = new Map(keysOf(base).map((k, i) => [k, base[i]] as const))
  const remoteKeys = keysOf(remote)
  const remoteBy = new Map(remoteKeys.map((k, i) => [k, remote[i]] as const))
  const localKeys = keysOf(local)
  const inLocal = new Set(localKeys)
  const out: T[] = []
  // Local order first: locations are in the order the user built them.
  local.forEach((l, i) => {
    const k = localKeys[i]
    const b = baseBy.get(k)
    if (remoteBy.has(k)) {
      const r = remoteBy.get(k)
      out.push((isRec(l) && isRec(r) ? mergeRecord(isRec(b) ? b : undefined, l, r) : mergeValue(b, l, r)) as T)
    } else if (!baseBy.has(k) || !jsonEqual(l, b)) {
      out.push(l) // added here — or edited here while deleted there, and the edit wins
    } // else: deleted there, untouched here → gone
  })
  // Then what only the remote has, in its order.
  remote.forEach((r, i) => {
    const k = remoteKeys[i]
    if (inLocal.has(k)) return
    if (!baseBy.has(k) || !jsonEqual(r, baseBy.get(k))) out.push(r) // added there, or edited there while deleted here
  })
  return out
}

/**
 * No base to tell a deletion from an addition: keep everything. Resurrecting
 * an item deleted on one device is the accepted cost; losing one is not. The
 * same id keeps the local copy, since that is the one holding the unpushed edit.
 */
export function unionById<T>(local: readonly T[], remote: readonly T[]): T[] {
  const inLocal = new Set(keysOf(local))
  const remoteKeys = keysOf(remote)
  return [...local, ...remote.filter((_, i) => !inLocal.has(remoteKeys[i]))]
}

/** Catch entries: three-way against the base, or a union when there is none. */
export function mergeList<T>(base: readonly T[] | null, local: readonly T[], remote: readonly T[]): T[] {
  return base ? mergeById(base, local, remote) : unionById(local, remote)
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
 * collections and sets are unioned, and scalars keep the local value where
 * there is one. Members this version doesn't know are merged as scalars, so
 * a newer app version's fields survive an older one's push.
 */
export function mergeDoc(base: Rec | null, local: Rec, remote: Rec, shape: DocShape): Rec {
  const out: Rec = {}
  for (const k of [...Object.keys(local), ...Object.keys(remote).filter((k) => !(k in local))]) {
    const l = local[k]
    const r = remote[k]
    let v: unknown
    if (shape.collections.includes(k)) v = base ? mergeById(arr(base[k]), arr(l), arr(r)) : unionById(arr(l), arr(r))
    else if (shape.sets.includes(k)) v = base ? mergeSet(strs(base[k]), strs(l), strs(r)) : unionSet(strs(l), strs(r))
    else v = base ? mergeValue(base[k], l, r) : l !== undefined ? l : r
    if (v !== undefined) out[k] = v
  }
  return out
}
