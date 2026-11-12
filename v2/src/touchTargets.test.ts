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
const views = import.meta.glob<string>(['/src/views/AvailabilityView.vue', '/src/views/LocationsView.vue', '/src/views/DashboardView.vue', '/src/App.vue'], {
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
/** The value given to `prop` in these declarations (the last one wins), or undefined. */
const val = (body: string, prop: string) =>
  [...body.matchAll(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`, 'g'))].pop()?.[1].trim()
/** A length in px: '-11px' → -11, '0' → 0; anything else NaN. */
const len = (v: string | undefined) => (v?.trim() === '0' ? 0 : Number(v?.trim().match(/^(-?[\d.]+)px$/)?.[1] ?? NaN))
/** [top, right, bottom, left] of a box shorthand such as margin or inset. */
function sides(v: string | undefined): number[] {
  const [t, r = t, b = t, l = r] = (v ?? '').split(/\s+/).filter(Boolean).map(len)
  return [t, r, b, l]
}

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

  // The deployed app (Supabase configured) also puts "Log ind" / "Log ud" in
  // the header's right-hand row. At 375 px a 40 px minimum WIDTH on DK, GB,
  // the bell and share (35-37 px wide on their own) made that row 16 px wider,
  // too wide to sit beside the logo: it dropped to a row of its own and the
  // topbar grew from 86 to 144 px, not 119. A finger needs the height there;
  // the row keeps the buttons' own widths, as before.
  it('keeps the header row beside the logo: its buttons get the height, not a minimum width', () => {
    expect(decls(blocks(styleOf('/src/App.vue'), coarse), '.topbar-right .btn')).toMatch(/(^|[;\s])min-width:\s*auto/)
  })

  // The desktop look stays as it was: no minimum outside the touch query.
  it('leaves a mouse with the compact sizes', () => {
    expect(decls(blocks(globalCss, null), '.btn')).not.toMatch(/min-(height|width)/)
    expect(decls(blocks(styleOf('/src/views/AvailabilityView.vue'), null), '.day')).not.toMatch(/min-height/)
    expect(decls(blocks(styleOf('/src/views/LocationsView.vue'), null), '.wt')).not.toMatch(/min-height/)
  })
})

/**
 * The dashboard on a phone (375 px, pointer: coarse): the horizon and density
 * toggles ("1 dag / 3 dage / 7 dage", "Simpel / Fuld") were 24 px tall, a
 * window card's 🔗 and 📅 18 px, its 💡 circle 20 px and the expandable
 * "🎯 2/4 målart(er) aktive her ▾" tag 21 px. The toggles grow, as the
 * refresh button beside them already did. The card's icons and tag keep
 * their look and their rows; only what a finger can hit grows, and never
 * over the control next to it.
 */
describe('the dashboard on a touch screen', () => {
  const coarse = blocks(styleOf('/src/views/DashboardView.vue'), '(pointer: coarse)')
  const base = blocks(styleOf('/src/views/DashboardView.vue'), null)

  it('the horizon and density toggles are at least 40 px tall', () => {
    expect(px(decls(coarse, '.dbtn'), 'min-height')).toBeGreaterThanOrEqual(40)
  })

  // On a phone the card's icons have a line of their own under the date, as
  // tall as the 20 px 💡 circle; a 40 px box would double it.
  it('the 🔗 and 📅 are 40 px boxes, held to the title row\'s 20 px by a negative margin', () => {
    const b = decls(coarse, '.share-win')
    expect(px(b, 'min-width')).toBeGreaterThanOrEqual(40)
    expect(px(b, 'min-height')).toBeGreaterThanOrEqual(40)
    const [top, , bottom] = sides(val(b, 'margin'))
    expect(px(b, 'min-height') + top + bottom).toBeLessThanOrEqual(20)
  })

  it('the 💡 keeps its 20 px circle and gets a 40 px hit area from an invisible ::after', () => {
    expect(decls(coarse, '.tips-btn')).not.toMatch(/(^|[;\s])(min-)?(width|height|padding):/)
    expect(val(decls(coarse, '.tips-btn'), 'position')).toBe('relative')
    const after = decls(coarse, '.tips-btn::after')
    expect(after).toMatch(/content:\s*''/)
    expect(val(after, 'position')).toBe('absolute')
    // An absolute box is placed from the padding edge: the circle less its 1 px border.
    const inner = px(decls(base, '.tips-btn'), 'width') - 2
    const [t, r, b, l] = sides(val(after, 'inset'))
    expect(inner - l - r).toBeGreaterThanOrEqual(40)
    expect(inner - t - b).toBeGreaterThanOrEqual(40)
  })

  // The 🔗 comes right after the 💡: the 💡's hit area must end where the 🔗's box begins.
  it('leaves room beside the 💡, so its hit area does not cover the 🔗', () => {
    const reach = -sides(val(decls(coarse, '.tips-btn::after'), 'inset'))[1] - 1 // past its 1 px border
    const gap = len(val(decls(coarse, '.title-right'), 'gap') ?? val(decls(base, '.title-right'), 'gap'))
    expect(gap + px(decls(coarse, '.lure-mini'), 'margin-right')).toBeGreaterThanOrEqual(reach)
  })

  // 21 px: 0.7rem text, 2 px padding, a 1 px border; the ::after is placed
  // from the 19 px padding box. It is the window's last tag (scoring.ts), so
  // above it lies at most a row of tags, 6 px up, and below it the trend
  // bars, 10 px down: it reaches into those gaps and no further.
  it('the 🎯 tag is 36 px tall to a finger, reaching only into the gaps above and below it', () => {
    expect(val(decls(coarse, '.tag-open'), 'position')).toBe('relative')
    const after = decls(coarse, '.tag-open::after')
    expect(after).toMatch(/content:\s*''/)
    const [t, r, b, l] = sides(val(after, 'inset'))
    expect(19 - t - b).toBeGreaterThanOrEqual(36)
    expect(-t - 1).toBeLessThanOrEqual(len(val(decls(base, '.tags'), 'gap')))
    expect(-b - 1).toBeLessThan(px(decls(base, '.trend'), 'margin-top'))
    expect([r, l]).toEqual([0, 0]) // tags sit side by side: nothing sideways
  })

  it('leaves a mouse with the compact sizes', () => {
    for (const s of ['.dbtn', '.share-win', '.tips-btn', '.tag-open']) expect(decls(base, s), s).not.toMatch(/min-(height|width)/)
    for (const s of ['.tips-btn::after', '.tag-open::after']) expect(decls(base, s), s).toBe('')
  })
})

/**
 * Tidsvinduer's fishing-method buttons were 28 px tall, beside day buttons
 * that already grew to 40.
 */
describe('Tidsvinduer on a touch screen', () => {
  it('a fishing-method button is at least 40 px tall', () => {
    expect(px(decls(blocks(styleOf('/src/views/AvailabilityView.vue'), '(pointer: coarse)'), '.mbtn'), 'min-height')).toBeGreaterThanOrEqual(40)
  })

  it('leaves a mouse with the compact size', () => {
    expect(decls(blocks(styleOf('/src/views/AvailabilityView.vue'), null), '.mbtn')).not.toMatch(/min-height/)
  })
})

/**
 * The spot list on a phone: a spot card's ▲ and ▼ were 14x12 px each,
 * stacked in a 24 px column, its ☆ 27x26, and a species chip in the
 * picker 26 px tall.
 */
describe('the spot list on a touch screen', () => {
  const coarse = blocks(styleOf('/src/views/LocationsView.vue'), '(pointer: coarse)')
  const base = blocks(styleOf('/src/views/LocationsView.vue'), null)

  it('a species chip is at least 36 px tall', () => {
    expect(px(decls(coarse, '.sp-chip'), 'min-height')).toBeGreaterThanOrEqual(36)
  })

  it('the ☆ is a 40 px box', () => {
    expect(px(decls(coarse, '.star'), 'min-width')).toBeGreaterThanOrEqual(40)
    expect(px(decls(coarse, '.star'), 'min-height')).toBeGreaterThanOrEqual(40)
  })

  it('▲ and ▼ are 40 px boxes side by side', () => {
    expect(val(decls(coarse, '.movers'), 'flex-direction')).toBe('row')
    expect(len(val(decls(coarse, '.movers'), 'gap'))).toBe(0)
    expect(px(decls(coarse, '.mv'), 'min-width')).toBeGreaterThanOrEqual(40)
    expect(px(decls(coarse, '.mv'), 'min-height')).toBeGreaterThanOrEqual(40)
  })

  // On a phone two 40 px squares side by side take the name's room, and
  // stacked they would make the card's top row 80 px tall. The column is 40:
  // ▲ its top half, ▼ its bottom half, 40 px wide. Each reaches on outward by
  // an invisible ::after, ▲ up into the card's padding and ▼ down into the
  // empty left of the icon-button row, for 40x40 to a finger; the two meet in
  // the middle and do not overlap. (Wider, the card's top is one row and the
  // water-type pills lie under ▼: there they stay side by side, as above.)
  it('on a phone ▲ and ▼ stay stacked, each with a 40x40 hit area, ▲ reaching up and ▼ down', () => {
    const phone = blocks(styleOf('/src/views/LocationsView.vue'), '(pointer: coarse) and (max-width: 640px)')
    expect(val(decls(phone, '.movers'), 'flex-direction')).toBe('column')
    const mv = decls(coarse, '.mv') + ';' + decls(phone, '.mv')
    expect(px(mv, 'min-width')).toBeGreaterThanOrEqual(40)
    expect(val(mv, 'position')).toBe('relative')
    expect(decls(phone, '.mv::after')).toMatch(/content:\s*''/)
    const half = len(val(mv, 'min-height'))
    const up = decls(phone, '.mv::after') + ';' + decls(phone, '.mv:first-child::after')
    const down = decls(phone, '.mv::after') + ';' + decls(phone, '.mv:last-child::after')
    expect(half - len(val(up, 'top'))).toBeGreaterThanOrEqual(40)
    expect(len(val(up, 'bottom'))).toBe(0)
    expect(half - len(val(down, 'bottom'))).toBeGreaterThanOrEqual(40)
    expect(len(val(down, 'top'))).toBe(0)
    // ▲ spills past the card's 16 px padding and 1 px border, but not across
    // the 8 px between two cards.
    expect(-len(val(up, 'top'))).toBeLessThan(16 + 1 + 8)
  })

  it('leaves a mouse with the compact sizes', () => {
    for (const s of ['.sp-chip', '.star', '.mv', '.movers']) expect(decls(base, s), s).not.toMatch(/min-(height|width)|flex-direction:\s*row/)
    for (const s of ['.mv::after', '.mv:first-child::after', '.mv:last-child::after']) expect(decls(base, s), s).toBe('')
  })
})
