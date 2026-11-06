/**
 * A minimal Mapbox Vector Tile ENCODER for tests: varint/zigzag, layers,
 * string tags, polygon rings and lines. Lets the decoder and the fetch layer
 * be tested on hand-made tiles, with no third-party map data in the repo.
 */
export interface TestFeature { type: 2 | 3; rings?: [number, number][][]; lines?: [number, number][][]; props?: Record<string, string> }
export interface TestLayer { name: string; extent?: number; features: TestFeature[] }

const varint = (n: number, out: number[]) => { while (n > 127) { out.push((n & 127) | 128); n = Math.floor(n / 128) } out.push(n) }
const key = (f: number, w: number, out: number[]) => varint(f * 8 + w, out)
const bytes = (f: number, b: number[], out: number[]) => { key(f, 2, out); varint(b.length, out); out.push(...b) }
const str = (s: string) => [...new TextEncoder().encode(s)]
const zig = (n: number) => (n < 0 ? -2 * n - 1 : 2 * n)

function geom(parts: [number, number][][], closed: boolean): number[] {
  const out: number[] = []
  let cx = 0, cy = 0
  for (const p of parts) {
    // A closed ring repeats its first point last; MVT drops it for ClosePath.
    const pts = closed && p.length > 1 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1] ? p.slice(0, -1) : p
    out.push(1 | (1 << 3), zig(pts[0][0] - cx), zig(pts[0][1] - cy))
    ;[cx, cy] = pts[0]
    out.push(2 | ((pts.length - 1) << 3))
    for (const [x, y] of pts.slice(1)) { out.push(zig(x - cx), zig(y - cy)); cx = x; cy = y }
    if (closed) out.push(7 | (1 << 3))
  }
  return out
}

export function encodeTile(layers: TestLayer[]): Uint8Array {
  const out: number[] = []
  for (const L of layers) {
    const keys: string[] = [], vals: string[] = []
    const lay: number[] = []
    key(15, 0, lay); varint(2, lay)
    bytes(1, str(L.name), lay)
    for (const f of L.features) {
      const fb: number[] = []
      const tags: number[] = []
      for (const [k, v] of Object.entries(f.props ?? {})) {
        if (!keys.includes(k)) keys.push(k)
        if (!vals.includes(v)) vals.push(v)
        tags.push(keys.indexOf(k), vals.indexOf(v))
      }
      if (tags.length) { const t: number[] = []; for (const x of tags) varint(x, t); bytes(2, t, fb) }
      key(3, 0, fb); varint(f.type, fb)
      const g: number[] = []
      for (const v of geom(f.type === 3 ? f.rings ?? [] : f.lines ?? [], f.type === 3)) varint(v, g)
      bytes(4, g, fb)
      bytes(2, fb, lay)
    }
    for (const k of keys) bytes(3, str(k), lay)
    for (const v of vals) { const vb: number[] = []; bytes(1, str(v), vb); bytes(4, vb, lay) }
    key(5, 0, lay); varint(L.extent ?? 4096, lay)
    bytes(3, lay, out)
  }
  return Uint8Array.from(out)
}
