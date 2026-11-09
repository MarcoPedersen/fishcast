import { describe, it, expect } from 'vitest'
// @ts-ignore — no @types/node in this project; vitest runs in Node. (A `?raw`
// import of a .css file comes back empty under vitest, which skips CSS.)
import { readFileSync } from 'node:fs'

/**
 * On a phone the header buttons and the DK/GB toggles (.btn.sm) were 24 px
 * tall, the Tidsvinduer day buttons 29 px, the spot cards' icon buttons 26 px
 * and the water-type pills 22 px: well under the ~44 px a finger needs. They
 * grow on touch screens only (pointer: coarse); a mouse keeps the compact look.
 */
const globalCss: string = readFileSync(new URL('./style.css', import.meta.url), 'utf8')
const views = import.meta.glob<string>(['/src/views/AvailabilityView.vue', '/src/views/LocationsView.vue'], {
  query: '?raw', import: 'default', eager: true,
})
const styleOf = (path: string) => (views[path] ?? '').match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? ''

/** Each `@media <query>` block's body, braces matched; `null` = the rules outside any @media. */
function blocks(css: string, query: string | null): string[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const inside: string[] = []
  let outside = ''
  let i = 0
  while (i < src.length) {
    const at = src.indexOf('@media', i)
    if (at < 0) { outside += src.slice(i); break }
    outside += src.slice(i, at)
    const open = src.indexOf('{', at)
    let depth = 1, j = open + 1
    while (depth && j < src.length) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++ }
    if (query !== null && src.slice(at + 6, open).trim() === query) inside.push(src.slice(open + 1, j - 1))
    i = j
  }
  return query === null ? [outside] : inside
}

/** The declarations given to `selector` (alone or in a selector list) in these rule bodies. */
function decls(bodies: string[], selector: string): string {
  return bodies.flatMap((b) => [...b.matchAll(/([^{}]+)\{([^}]*)\}/g)])
    .filter((m) => m[1].split(',').map((s) => s.trim()).includes(selector))
    .map((m) => m[2]).join(';')
}
const px = (body: string, prop: string) => Number(body.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*(\\d+)px`))?.[1] ?? 0)

describe('touch targets on a touch screen', () => {
  const coarse = '(pointer: coarse)'

  it('every .btn (header buttons, DK/GB, spot-card icons) is at least 40 px tall', () => {
    expect(px(decls(blocks(globalCss, coarse), '.btn'), 'min-height')).toBeGreaterThanOrEqual(40)
  })

  it('a day button in Tidsvinduer is at least 40 px tall', () => {
    expect(px(decls(blocks(styleOf('/src/views/AvailabilityView.vue'), coarse), '.day'), 'min-height')).toBeGreaterThanOrEqual(40)
  })

  it('a water-type pill on a spot card is at least 32 px tall', () => {
    expect(px(decls(blocks(styleOf('/src/views/LocationsView.vue'), coarse), '.wt'), 'min-height')).toBeGreaterThanOrEqual(32)
  })

  // The desktop look stays as it was: no minimum outside the touch query.
  it('leaves a mouse with the compact sizes', () => {
    expect(decls(blocks(globalCss, null), '.btn')).not.toMatch(/min-(height|width)/)
    expect(decls(blocks(styleOf('/src/views/AvailabilityView.vue'), null), '.day')).not.toMatch(/min-height/)
    expect(decls(blocks(styleOf('/src/views/LocationsView.vue'), null), '.wt')).not.toMatch(/min-height/)
  })
})
