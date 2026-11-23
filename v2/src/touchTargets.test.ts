import { describe, it, expect } from 'vitest'
// @ts-ignore — no @types/node in this project; vitest runs in Node. (A `?raw`
// import of a .css file comes back empty under vitest, which skips CSS.)
import { readFileSync } from 'node:fs'
import { toastSpace } from '@/lib/toast'

/**
 * On a phone the header buttons and the DK/GB toggles (.btn.sm) were 24 px
 * tall, the Tidsvinduer day buttons 29 px, the spot cards' icon buttons 26 px
 * and the water-type pills 22 px: well under the ~44 px a finger needs. They
 * grow on touch screens only (pointer: coarse); a mouse keeps the compact look.
 */
const globalCss: string = readFileSync(new URL('./style.css', import.meta.url), 'utf8')
const views = import.meta.glob<string>(['/src/views/*.vue', '/src/components/*.vue', '/src/App.vue'], {
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

  // DK, GB, the bell and share were left at their own widths, 35-37 px, so
  // that the header's row fitted beside the logo at 375 px. Now the row has
  // room for them at 40 (worked out below), and nothing in App.vue sets a
  // button a smaller minimum than style.css does.
  it("the header's DK, GB, bell and share are 40 px wide too", () => {
    const app = styleOf('/src/App.vue')
    const rules = [null, coarse, '(max-width: 640px)'].flatMap((q) => blocks(app, q))
      .flatMap((b) => [...b.matchAll(/([^{}]+)\{([^}]*)\}/g)])
      .filter((m) => /\.btn\b/.test(m[1]))
    expect(rules.length).toBeGreaterThan(0)
    for (const [, sel, body] of rules) {
      const w = val(body, 'min-width')
      if (w !== undefined) expect(len(w), sel.trim()).toBeGreaterThanOrEqual(40)
    }
  })

  // The desktop look stays as it was: no minimum outside the touch query.
  it('leaves a mouse with the compact sizes', () => {
    expect(decls(blocks(globalCss, null), '.btn')).not.toMatch(/min-(height|width)/)
    expect(decls(blocks(styleOf('/src/views/AvailabilityView.vue'), null), '.day')).not.toMatch(/min-height/)
    expect(decls(blocks(styleOf('/src/views/LocationsView.vue'), null), '.wt')).not.toMatch(/min-height/)
  })
})

/**
 * The header at 375 px on a touch screen, worked out from the CSS. The logo
 * and the row beside it (DK, GB, Log ind, 🔔, 🔗) must fit on one line
 * between the page's 16 px gutters, 343 px. Else the row takes a line of
 * its own and the header grows from 86 to 144 px (ba8aff6).
 *
 * The text widths are Segoe UI's (Windows), read from the font files at the
 * sizes the CSS gives, and rounded up: "FishCast" in Black at 1.05rem 67.9
 * px, 🎣 21.3, 🇩🇰 13.1, 🇬🇧 12.6, 🔔 15.4, 🔗 17.1, and "Log ind" in Bold at
 * 0.78rem 44.0 (the widest of Log ind, Log in, Log ud and Log out). Worked
 * out like this, the row before the 40 px buttons was 236 px and with them
 * 251, with 237 beside the logo: as measured in the browser then (233 beside
 * the logo, and 251 under it).
 */
describe('the header at 375 px on a touch screen', () => {
  const TEXT = { logo: 68, fish: 22, dk: 14, gb: 13, bell: 16, share: 18, account: 45 }
  const app = styleOf('/src/App.vue')
  const base = blocks(app, null)
  const phone = blocks(app, '(max-width: 640px)')
  /** `prop` of `selector` at 375 px: the phone block's, else the base's. */
  const at375 = (selector: string, prop: string) => val(decls(phone, selector), prop) ?? val(decls(base, selector), prop)
  /** The space between the items of a flex row: column-gap, else gap, else none. */
  const gapOf = (selector: string) => len(at375(selector, 'column-gap') ?? at375(selector, 'gap') ?? '0')

  it('the logo and the whole row fit on one line, with room to spare', () => {
    const min = px(decls(blocks(globalCss, '(pointer: coarse)'), '.btn'), 'min-width')
    const smPad = sides(val(decls(blocks(globalCss, null), '.btn.sm'), 'padding'))[1]
    /** A .btn.sm: its text, its padding each side, a 1 px border each side; never under the touch minimum. */
    const btn = (text: number, pad = smPad) => Math.max(min, text + 2 * pad + 2)
    // DK and GB, joined: the second's border laid over the first's.
    const lang = btn(TEXT.dk) + gapOf('.lang') + btn(TEXT.gb) + len(val(decls(base, '.lang .btn + .btn'), 'margin-left') ?? '0')
    const account = btn(TEXT.account, sides(at375('.tr-row .acct', 'padding') ?? `0 ${smPad}px`)[1])
    // On a phone the two rows of the right-hand side are one: [DK GB Log ind] [🔔 🔗].
    const row = lang + gapOf('.tr-row') + account + gapOf('.topbar-right') + btn(TEXT.bell) + gapOf('.tr-row') + btn(TEXT.share)
    const logo = TEXT.fish + gapOf('.logo') + TEXT.logo
    expect(min).toBeGreaterThanOrEqual(40)
    expect(logo + gapOf('.topbar') + row).toBeLessThanOrEqual(343 - 4)
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

  // The box reaches 11 px below the title row, over the card's next line
  // (.meta). It is painted above that line only while it has a layer of its
  // own: its resting opacity gave it one, but hovered (opacity 1), and a tap
  // on a phone hovers first, the line took the box's bottom 6–8 px and the
  // tap did nothing. Positioned, it stays on top.
  it('the 🔗 and 📅 boxes stay above the line under them, hovered too', () => {
    expect(val(decls(coarse, '.share-win'), 'position')).toBe('relative')
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

  // A card's trend row: 7 day bars (8 while last night's session still
  // runs), each a 13 px bar in a 15 px column, 5 px apart and only as tall
  // as its bar: 15x18–40 px to a finger, the smallest controls left on the
  // dashboard. At 375 px the card's body is 243 px wide (the page's 16 px
  // sides, the card's 16 px padding and 1 px border, the 52 px score and the
  // 14 px beside it) and the row took 135 px of it. The columns now share
  // the whole row, with no gap, each as tall as the row: 34x40 px with 7
  // bars, 30x40 with 8. Each is its own box, so none covers a neighbour.
  it('the trend bars share the row: each a column of the whole row\'s height, side by side', () => {
    const page = sides(val(decls(blocks(globalCss, null), '.shell'), 'padding'))
    const card = decls(blocks(globalCss, null), '.card')
    const [, padR, , padL] = sides(val(card, 'padding'))
    const border = len(val(card, 'border')?.split(/\s+/)[0])
    const body = 375 - page[1] - page[3] - padL - padR - 2 * border
      - px(decls(base, '.score'), 'width') - len(val(decls(base, '.win'), 'gap'))
    expect(body).toBe(243)

    const row = decls(coarse, '.trend')
    expect(len(val(row, 'gap'))).toBe(0)
    expect(val(row, 'align-items')).toBe('stretch')
    expect(px(decls(base, '.trend'), 'height')).toBeGreaterThanOrEqual(40)
    const col = decls(coarse, '.tcol')
    const [grow, , basis] = (val(col, 'flex') ?? '').split(/\s+/)
    expect(Number(grow)).toBeGreaterThan(0)
    expect(len(basis)).toBe(0)
    expect(len(val(col, 'min-width'))).toBe(0)
    // On a wider touch screen (a tablet) the columns stop at 44 px rather than spread over 600.
    const cap = len(val(col, 'max-width'))
    expect(cap).toBeGreaterThanOrEqual(40)
    const width = (bars: number) => Math.min(cap, body / bars)
    expect(width(7)).toBeGreaterThanOrEqual(34)
    expect(width(8)).toBeGreaterThanOrEqual(30)
  })

  // "Vælg målarter", the link under the window list's header when no
  // target species are picked, was 16 px tall. Its line grows to 40 px.
  it('the link to pick target species is 40 px tall to a finger', () => {
    const b = decls(coarse, '.targets.none a')
    expect(px(b, 'min-height')).toBeGreaterThanOrEqual(40)
    expect(val(b, 'display')).toMatch(/inline-(flex|block)/)
  })

  it('leaves a mouse with the compact sizes', () => {
    for (const s of ['.dbtn', '.share-win', '.tips-btn', '.tag-open', '.targets.none a']) expect(decls(base, s), s).not.toMatch(/min-(height|width)/)
    for (const s of ['.tips-btn::after', '.tag-open::after']) expect(decls(base, s), s).toBe('')
    expect(decls(base, '.tcol')).not.toMatch(/(^|[;\s])(flex|max-width):/)
    expect(val(decls(base, '.trend'), 'gap')).toBe('5px')
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
 * The catch log's form: its toggles (catch or trip, kept or released, the
 * fishing method) were about 34 px tall.
 */
describe('the catch log on a touch screen', () => {
  it('a toggle in the form is at least 40 px tall', () => {
    expect(px(decls(blocks(styleOf('/src/views/CatchLogView.vue'), '(pointer: coarse)'), '.seg-btn'), 'min-height')).toBeGreaterThanOrEqual(40)
  })

  it('leaves a mouse with the compact size', () => {
    expect(decls(blocks(styleOf('/src/views/CatchLogView.vue'), null), '.seg-btn')).not.toMatch(/min-height/)
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

  // The card's text links were 16 px tall, "Ret" 16 px wide too: "Flyt din
  // plads dertil" (a tap 3 px above it did nothing), "Ret" and "Vælg selv"
  // on the coast line, "Mod SSV" / "Mod V" on its check, "Vælg arter" on the
  // species line. Each is a 40 px box; its line grows with it, so the pills
  // and links on the lines around it stay clear. The text keeps its place
  // at the box's left: a short word's extra width lies after it.
  it('every text link on a spot card is 40 px tall and wide to a finger', () => {
    const b = decls(coarse, '.linkbtn')
    expect(px(b, 'min-height')).toBeGreaterThanOrEqual(40)
    expect(px(b, 'min-width')).toBeGreaterThanOrEqual(40)
    expect(val(b, 'display')).toMatch(/inline-(flex|block)/)
    expect(val(b, 'justify-content') ?? 'flex-start').toBe('flex-start')
    expect(decls(base, '.linkbtn')).not.toMatch(/min-(height|width)/)
  })

  // The rename field was 26 px tall, in a top row the ☆ and ▲▼ make 40.
  it('the rename field fills the card\'s 40 px top row', () => {
    expect(px(decls(coarse, '.rename'), 'min-height')).toBeGreaterThanOrEqual(40)
    expect(px(decls(coarse, '.star'), 'min-height')).toBeGreaterThanOrEqual(px(decls(coarse, '.rename'), 'min-height'))
  })

  // "Ingen arter valgt" offers "Vælg arter" and "Hent arter fra pladser i
  // nærheden": text links 16 px tall, the second one changing the spot's
  // species. The line grows, as the move's line does.
  it('the species line\'s links are 40 px tall to a finger', () => {
    const b = decls(coarse, '.sp-missing .linkbtn')
    expect(px(b, 'min-height')).toBeGreaterThanOrEqual(40)
    expect(val(b, 'display')).toMatch(/inline-(flex|block)/)
    expect(decls(base, '.sp-missing .linkbtn')).not.toMatch(/min-height/)
  })

  it('leaves a mouse with the compact sizes', () => {
    for (const s of ['.sp-chip', '.star', '.mv', '.movers', '.rename']) expect(decls(base, s), s).not.toMatch(/min-(height|width)|flex-direction:\s*row/)
    for (const s of ['.mv::after', '.mv:first-child::after', '.mv:last-child::after']) expect(decls(base, s), s).toBe('')
  })
})

/**
 * The toast's Fortryd and ✕ were 64x22 and 23x19 px on a phone: the controls
 * of the water-type undo. An invisible ::after makes each 40 px tall
 * inside the toast's own 10 px padding, so the toast keeps its look and no
 * area reaches a neighbouring toast (8 px apart) or the other button.
 */
describe('the toast on a touch screen', () => {
  const css = styleOf('/src/components/Toasts.vue')
  const coarse = blocks(css, '(pointer: coarse)')
  const base = blocks(css, null)
  const pad = sides(val(decls(base, '.toast'), 'padding'))
  // Measured at 375 px: Fortryd 22 px tall, ✕ 19 by 22.5, a 10 px gap between them.
  const ACT_H = 22, X_H = 19, X_W = 22.5

  it("Fortryd is 40 px tall to a finger, within the toast's padding", () => {
    expect(val(decls(coarse, '.act'), 'position')).toBe('relative')
    const after = decls(coarse, '.act::after')
    expect(after).toMatch(/content:\s*''/)
    const [t, r, b, l] = sides(val(after, 'inset'))
    expect(ACT_H - t - b).toBeGreaterThanOrEqual(40)
    expect(Math.max(-t, -b)).toBeLessThanOrEqual(pad[0])
    expect([r, l]).toEqual([0, 0]) // 64 px wide already: nothing sideways, towards the ✕
  })

  it("✕ is 40 px square to a finger, short of Fortryd and of the toast's edge", () => {
    expect(val(decls(coarse, '.x'), 'position')).toBe('relative')
    const after = decls(coarse, '.x::after')
    expect(after).toMatch(/content:\s*''/)
    const [t, r, b, l] = sides(val(after, 'inset'))
    expect(X_H - t - b).toBeGreaterThanOrEqual(40)
    expect(X_W - l - r).toBeGreaterThanOrEqual(40)
    expect(-l).toBeLessThan(len(val(decls(base, '.toast'), 'gap')))
    expect(-r).toBeLessThanOrEqual(pad[1])
    // centred in a row at least as tall as Fortryd, so it may use the 1.5 px either side
    expect(Math.max(-t, -b)).toBeLessThanOrEqual(pad[0] + (ACT_H - X_H) / 2)
  })

  // Fortryd steps back through a spot's changes, and each step brings back
  // the older sentence in the same toast. Centred, the buttons moved with its
  // length: a second click where Fortryd had been hit the toast's text. The
  // stack is pinned at the bottom, so the toast's bottom edge stays put.
  it('Fortryd and ✕ sit at the toast\'s bottom edge, where a shorter sentence leaves them', () => {
    for (const s of ['.act', '.x']) expect(val(decls(base, s), 'align-self'), s).toBe('flex-end')
  })

  // The line over the stack is a button now (a tap brings a waiting toast
  // forward): one line of text in a 1 px border, so its height follows from
  // the CSS. An invisible ::after makes it 40 px tall, reaching into the 8 px
  // gap to the toast under it and the air the page leaves over the stack
  // (lib/toast toastSpace), no further.
  it('the line over the stack is 40 px tall to a finger, short of the toast under it and the page over it', () => {
    const line = decls(base, '.toasts-waiting') + ';' + decls(coarse, '.toasts-waiting')
    expect(val(decls(coarse, '.toasts-waiting'), 'position')).toBe('relative')
    const after = decls(coarse, '.toasts-waiting::after')
    expect(after).toMatch(/content:\s*''/)
    expect(val(after, 'position')).toBe('absolute')
    const [pt, , pb] = sides(val(line, 'padding'))
    // An absolute box is placed from the padding edge: one line of text and its padding.
    const inner = len(val(line, 'line-height')) + pt + pb
    const [t, r, b, l] = sides(val(after, 'inset'))
    expect(inner - t - b).toBeGreaterThanOrEqual(40)
    const border = len(val(line, 'border')?.split(/\s+/)[0])
    expect(-b - border).toBeLessThan(len(val(decls(base, '.toasts'), 'gap')))
    const air = parseInt(toastSpace(100)) - 100 - len(val(decls(base, '.toasts'), 'bottom'))
    expect(-t - border).toBeLessThan(air)
    expect([r, l]).toEqual([0, 0])
  })

  it('leaves a mouse with the compact toast', () => {
    for (const s of ['.act::after', '.x::after', '.toasts-waiting::after']) expect(decls(base, s), s).toBe('')
  })

  // Round G's browser check: the stack is as wide as a toast (up to 440 px),
  // and a tap in the 8 px gaps between toasts, or beside the narrow "+1 more
  // waiting" line, hit the empty stack and not the page under it. Only what
  // the stack shows takes a tap.
  it('lets a tap through where the stack shows nothing: its gaps, and beside the waiting line', () => {
    expect(val(decls(base, '.toasts'), 'pointer-events')).toBe('none')
    for (const s of ['.toast', '.toasts-waiting']) expect(val(decls(base, s), 'pointer-events'), s).toBe('auto')
  })
})

/**
 * The rest of the app on a phone: what a finger could still only just hit,
 * under ~32 px. Each grows on touch screens only. Where a line or row can
 * grow, it does; where it would push the look about, a 40 px box is held to
 * the row's own height by negative margins and reaches only into the empty
 * padding around it. Left as they are: links inside a sentence (the
 * OpenStreetMap credit, lfst.dk), the drag handle ⠿ (a mouse's: a finger
 * has ▲ and ▼) and the dashboard tabs' ‹ › (28 px wide, held by the page's
 * 16 px margin). The maps' own controls (Leaflet's) follow at the end.
 */
describe('the other screens on a touch screen', () => {
  const coarse = '(pointer: coarse)'
  const css = (path: string) => ({ coarse: blocks(styleOf(path), coarse), base: blocks(styleOf(path), null) })
  const cardPad = sides(val(decls(blocks(globalCss, null), '.card'), 'padding'))

  // The coast picker opens on a spot card. Its ✕ was 23x23 px, in a header
  // row as tall: a 40 px box, held to that row by negative margins, reaching
  // up to the picker's top edge and right to its border, no further. Its
  // spread and exposure chips were 26 px tall, like the species chips were.
  it("the coast picker's ✕ is a 40 px box inside the picker, its chips 36 px tall", () => {
    const { coarse: c, base } = css('/src/components/CoastPicker.vue')
    const x = decls(c, '.cp-x')
    expect(px(x, 'min-width')).toBeGreaterThanOrEqual(40)
    expect(px(x, 'min-height')).toBeGreaterThanOrEqual(40)
    const [t, r, b] = sides(val(x, 'margin'))
    expect(px(x, 'min-height') + t + b).toBeLessThanOrEqual(23)
    const pad = sides(val(decls(base, '.coast-pick'), 'padding'))
    expect(-t).toBeLessThanOrEqual(pad[0] + 1) // its padding, then its 1 px border
    expect(-r).toBeLessThanOrEqual(pad[1])
    expect(px(decls(c, '.cp-chip'), 'min-height')).toBeGreaterThanOrEqual(36)
  })

  // A place search's results (Find pladser's starting point, Lokationer's
  // search) measured 35 px tall in the round J browser check: padding,
  // border and the button font, with no rule for a finger.
  it('a place-search result is at least 40 px tall, in Find pladser and Lokationer', () => {
    for (const path of ['/src/views/SpotFinderView.vue', '/src/views/LocationsView.vue']) {
      const { coarse: c, base } = css(path)
      expect(px(decls(c, '.result'), 'min-height'), path).toBeGreaterThanOrEqual(40)
      expect(px(decls(base, '.result'), 'min-height'), path).toBe(0) // a mouse keeps the compact row
    }
  })

  // A species card's ⚠️ / ⛔ was 16 px wide, so a tap beside it picked the
  // species instead of saying why to take care. A 40 px box in the card's
  // top row, held to the emoji's line (1.4rem: 26 px at the least) by
  // negative margins: it reaches into the card's 16 px padding, up and to
  // the right, and the sign stays where it was.
  it("a species card's ⚠️ is a 40 px box within the card's padding", () => {
    const w = decls(css('/src/views/SpeciesView.vue').coarse, '.warn')
    expect(px(w, 'min-width')).toBeGreaterThanOrEqual(40)
    expect(px(w, 'min-height')).toBeGreaterThanOrEqual(40)
    const [t, r, b] = sides(val(w, 'margin'))
    expect(px(w, 'min-height') + t + b).toBeLessThanOrEqual(26)
    expect(-t).toBeLessThanOrEqual(cardPad[0])
    expect(-r).toBeLessThanOrEqual(cardPad[1])
    // 16 px wide before, against the padding: centred in 40 px, 12 px further right, it stays put.
    expect(px(w, 'min-width') / 2 + r).toBe(16 / 2)
  })

  // A logged catch's "▸ Forhold" was 24 px tall beside its 30 px score. It
  // is 40 px tall, held to the score's row: 5 px into the 8 px above the
  // row (or between its lines) and the 6 px above the conditions it opens.
  it("a catch's ▸ Forhold is 40 px tall, held to its score's row", () => {
    const { coarse: c, base } = css('/src/components/CatchEntryCard.vue')
    const b = decls(c, '.cond-toggle')
    expect(px(b, 'min-height')).toBeGreaterThanOrEqual(40)
    const [t, , bottom] = sides(val(b, 'margin'))
    expect(px(b, 'min-height') + t + bottom).toBeLessThanOrEqual(px(decls(base, '.cscore'), 'height'))
    expect(-t).toBeLessThan(len(val(decls(base, '.score-line'), 'margin-top')))
    expect(-t).toBeLessThan(len(val(decls(base, '.score-line'), 'gap')))
    expect(-bottom).toBeLessThan(len(val(decls(base, '.cond-line'), 'margin-top')))
  })

  // Fangstjournal's model check: its header button was 28 px tall, and its
  // three "▸ …" sections opened from 17 px lines.
  it("the model check's header and its sections open from 40 px rows", () => {
    const c = css('/src/components/ModelCheckPanel.vue').coarse
    expect(px(decls(c, '.mc-toggle'), 'min-height')).toBeGreaterThanOrEqual(40)
    expect(px(decls(c, '.mc-more summary'), 'min-height')).toBeGreaterThanOrEqual(40)
  })

  // Spotfinder: "Skift arter" was 19 px tall, the sort buttons 26 and the
  // saved-spot chips 26.
  it("Spotfinder's link, sort buttons and spot chips grow", () => {
    const c = css('/src/views/SpotFinderView.vue').coarse
    expect(px(decls(c, '.link'), 'min-height')).toBeGreaterThanOrEqual(40)
    expect(val(decls(c, '.link'), 'display')).toMatch(/inline-(flex|block)/)
    expect(px(decls(c, '.sbtn'), 'min-height')).toBeGreaterThanOrEqual(40)
    expect(px(decls(c, '.chip'), 'min-height')).toBeGreaterThanOrEqual(36)
  })

  // The map tab's "Sammenlign med officielle pladser" and the map's "Vis
  // alle pladser" were 19 px tall checkboxes with their labels; the map
  // tab's "Prøv igen" a 16 px link.
  it('the maps\' checkboxes and the map tab\'s retry are 40 px tall', () => {
    const tab = css('/src/components/MapTab.vue').coarse
    expect(px(decls(tab, '.cmp'), 'min-height')).toBeGreaterThanOrEqual(40)
    expect(px(decls(tab, '.linkbtn'), 'min-height')).toBeGreaterThanOrEqual(40)
    expect(val(decls(tab, '.linkbtn'), 'display')).toMatch(/inline-(flex|block)/)
    expect(px(decls(css('/src/views/MapView.vue').coarse, '.toggle'), 'min-height')).toBeGreaterThanOrEqual(40)
  })

  // "Glemt adgangskode?", "Opret konto" and the welcome page's "Log ind /
  // Opret konto" were 17 px tall links.
  it('the sign-in links are 40 px tall', () => {
    for (const [path, sel] of [['/src/views/AuthView.vue', '.linkbtn'], ['/src/views/WelcomeView.vue', '.auth-hint .linkbtn']]) {
      const b = decls(css(path).coarse, sel)
      expect(px(b, 'min-height'), path).toBeGreaterThanOrEqual(40)
      expect(val(b, 'display'), path).toMatch(/inline-(flex|block)/)
    }
  })

  // The 🎣 FishCast logo goes to the front page: 20 px tall, in a header
  // row the 40 px DK / GB buttons already make that tall.
  it('the logo is 40 px tall', () => {
    expect(px(decls(css('/src/App.vue').coarse, '.logo'), 'min-height')).toBeGreaterThanOrEqual(40)
  })

  it('leaves a mouse with the compact sizes', () => {
    const compact: [string, string[]][] = [
      ['/src/components/CoastPicker.vue', ['.cp-x', '.cp-chip']],
      ['/src/views/SpeciesView.vue', ['.warn']],
      ['/src/components/ModelCheckPanel.vue', ['.mc-toggle', '.mc-more summary']],
      ['/src/views/SpotFinderView.vue', ['.link', '.sbtn', '.chip']],
      ['/src/components/MapTab.vue', ['.cmp', '.linkbtn']],
      ['/src/views/MapView.vue', ['.toggle']],
      ['/src/views/AuthView.vue', ['.linkbtn']],
      ['/src/views/WelcomeView.vue', ['.auth-hint .linkbtn']],
      ['/src/App.vue', ['.logo']],
    ]
    for (const [path, sels] of compact) for (const s of sels) expect(decls(css(path).base, s), `${path} ${s}`).not.toMatch(/min-(height|width)/)
    expect(px(decls(css('/src/components/CatchEntryCard.vue').base, '.cond-toggle'), 'min-height')).toBeLessThan(32)
  })
})

/**
 * The maps' own controls, Leaflet's, on a phone: the zoom buttons + and −
 * were 30 px squares and a popup's ✕ 24 px. On the setup map a tap that
 * missed them landed on the map and started a new spot. Leaflet's own sheet
 * comes with each map's lazy chunk, after style.css, so the app's rules must
 * outrank Leaflet's, not merely follow them. These tests run the cascade of
 * both sheets, in either order, over the elements Leaflet draws.
 *
 * Left as it is: the credit in the map's corner ("Leaflet | © OpenStreetMap
 * contributors"), links inside a line of text, as elsewhere in the app. A
 * taller credit would cover more of the map, and a tap on either link opens
 * another site, in a new tab. The popups hold no links or buttons of their
 * own (lib/mapPopups).
 */
describe("the maps' own controls on a touch screen", () => {
  const leafletCss: string = readFileSync(new URL('../node_modules/leaflet/dist/leaflet.css', import.meta.url), 'utf8')

  type Rule = { selectors: string[]; body: string }
  /** A sheet's rules in effect, in its order: those outside any @media and those inside the queries given. */
  function inEffect(css: string, queries: string[]): Rule[] {
    const src = css.replace(/\/\*[\s\S]*?\*\//g, '')
    let flat = '', i = 0
    while (i < src.length) {
      const at = src.indexOf('@media', i)
      if (at < 0) { flat += src.slice(i); break }
      flat += src.slice(i, at)
      const open = src.indexOf('{', at)
      let depth = 1, j = open + 1
      while (depth && j < src.length) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++ }
      if (queries.includes(src.slice(at + 6, open).trim())) flat += src.slice(open + 1, j - 1)
      i = j
    }
    return [...flat.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ selectors: m[1].split(',').map((s) => s.trim()), body: m[2] }))
  }

  /** An element and its ancestors from the map's container, outermost first, each as 'tag.class.class'. */
  type Path = { tag: string; classes: string[] }[]
  const path = (...els: string[]): Path => els.map((e) => { const [tag, ...classes] = e.split('.'); return { tag, classes } })
  /**
   * A compound such as `a.leaflet-bar` or `*`. Ids, attributes, pseudo-classes
   * and `>` match nothing: Leaflet's rules of that kind set only colours,
   * corners and borders on these elements.
   */
  function compound(part: string, el: Path[number]): boolean {
    const m = part.match(/^(\*|[a-z]*)((?:\.[\w-]+)*)$/)
    return !!part && !!m && (!m[1] || m[1] === '*' || m[1] === el.tag) && m[2].split('.').slice(1).every((c) => el.classes.includes(c))
  }
  /** Whether a selector of compounds joined by spaces matches the path's last element. */
  function matches(selector: string, p: Path): boolean {
    const parts = selector.split(/\s+/)
    let i = p.length - 1
    if (!compound(parts.pop()!, p[i])) return false
    for (const part of parts.reverse()) {
      do i--; while (i >= 0 && !compound(part, p[i]))
      if (i < 0) return false
    }
    return true
  }
  /** Such a selector's specificity: a class outweighs any number of tags, and none has an id. */
  const specificity = (selector: string) =>
    (selector.match(/\.[\w-]+/g) ?? []).length * 100 + selector.split(/\s+/).filter((s) => /^[a-z]/.test(s)).length
  /** A rule's declarations, `margin` and `padding` spelled out, `font` as the line height it sets. */
  function declarations(body: string): [string, string][] {
    return body.split(';').flatMap((d): [string, string][] => {
      const c = d.indexOf(':')
      if (c < 0) return []
      const prop = d.slice(0, c).trim(), v = d.slice(c + 1).trim()
      if (prop === 'margin' || prop === 'padding') {
        const [t, r = t, b = t, l = r] = v.split(/\s+/)
        return [[`${prop}-top`, t], [`${prop}-right`, r], [`${prop}-bottom`, b], [`${prop}-left`, l]]
      }
      // `font: 16px/24px Tahoma` sets the line height; a font without a `/` resets it to normal.
      if (prop === 'font') return [['line-height', v.match(/\/\s*([\d.]+[a-z%]*)/)?.[1] ?? 'normal']]
      return [[prop, v]]
    })
  }
  /** What the cascade gives the element: the most specific rule wins, then the later one. */
  function computed(rules: Rule[], p: Path): Record<string, string> {
    const hits = rules.flatMap((r, order) => r.selectors.filter((s) => matches(s, p)).map((s) => ({ weight: specificity(s), order, body: r.body })))
    const out: Record<string, string> = {}
    for (const h of hits.sort((a, b) => a.weight - b.weight || a.order - b.order)) for (const [k, v] of declarations(h.body)) out[k] = v
    return out
  }
  /** Leaflet's sheet after the app's, as the map's chunk loads it, and before: specificity decides, not order. */
  function orders(touch: boolean): Rule[][] {
    const app = inEffect(globalCss, touch ? ['(pointer: coarse)'] : []), leaflet = inEffect(leafletCss, [])
    return [[...app, ...leaflet], [...leaflet, ...app]]
  }

  // Leaflet marks its container leaflet-touch wherever there are pointer
  // events, a desktop's mouse included. The touch query decides, not that class.
  const MAPS = ['div.map.leaflet-container.leaflet-touch', 'div.map.leaflet-container']
  const zoom = (map: string, sign: 'in' | 'out') => path(map, 'div.leaflet-control-container', 'div.leaflet-top.leaflet-left',
    'div.leaflet-control-zoom.leaflet-bar.leaflet-control', `a.leaflet-control-zoom-${sign}`)
  const popup = (map: string, ...inner: string[]) => path(map, 'div.leaflet-pane.leaflet-map-pane',
    'div.leaflet-pane.leaflet-popup-pane', 'div.leaflet-popup.leaflet-zoom-animated', ...inner)
  const CLOSE = 'a.leaflet-popup-close-button', WRAP = 'div.leaflet-popup-content-wrapper', TEXT = 'div.leaflet-popup-content'

  it('the zoom buttons + and − are 40 px squares, the sign centred, one above the other', () => {
    for (const rules of orders(true)) for (const map of MAPS) for (const sign of ['in', 'out'] as const) {
      const s = computed(rules, zoom(map, sign))
      expect(len(s.width), `${map} ${sign}`).toBeGreaterThanOrEqual(40)
      expect(len(s.height), `${map} ${sign}`).toBeGreaterThanOrEqual(40)
      expect(s['line-height'], `${map} ${sign}`).toBe(s.height)
      expect(s.display, `${map} ${sign}`).toBe('block')
    }
  })

  // The ✕ sits in the popup's top right corner, over the text's right
  // margin. That margin grows with it, so the text stops where the ✕ begins:
  // to a finger the popup is 16 px wider, and no word lies under the ✕.
  it("a popup's ✕ is a 40 px box in its corner, clear of the popup's text", () => {
    for (const rules of orders(true)) for (const map of MAPS) {
      const x = computed(rules, popup(map, CLOSE))
      expect(len(x.width), map).toBeGreaterThanOrEqual(40)
      expect(len(x.height), map).toBeGreaterThanOrEqual(40)
      expect(x['line-height'], map).toBe(x.height)
      expect([x.position, len(x.top), len(x.right)], map).toEqual(['absolute', 0, 0])
      const wrap = computed(rules, popup(map, WRAP)), text = computed(rules, popup(map, WRAP, TEXT))
      expect(len(wrap['padding-right']) + len(text['margin-right']), map).toBeGreaterThanOrEqual(len(x.width))
      // A popup of one line (a spot with no score yet), 13 px text at
      // Leaflet's line height, is still as tall as the ✕.
      const oneLine = len(wrap['padding-top']) + len(text['margin-top']) + 13 * Number(text['line-height'])
        + len(text['margin-bottom']) + len(wrap['padding-bottom'])
      expect(oneLine, map).toBeGreaterThanOrEqual(len(x.height))
    }
  })

  it("leaves a mouse with Leaflet's own sizes", () => {
    for (const rules of orders(false)) {
      expect(len(computed(rules, zoom(MAPS[0], 'in')).width)).toBe(30)
      expect(len(computed(rules, zoom(MAPS[1], 'in')).width)).toBe(26)
      expect(len(computed(rules, popup(MAPS[0], CLOSE)).width)).toBe(24)
      expect(len(computed(rules, popup(MAPS[0], WRAP, TEXT))['margin-right'])).toBe(24)
    }
  })
})
