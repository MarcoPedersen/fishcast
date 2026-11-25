/**
 * A catch's card at 375 px, read from its CSS (no layout here). A note or a
 * place is the user's own text, and nothing in the card broke a word too
 * long for its line: a link pasted into a note ran on past the card's edge,
 * under the ✎ and 🗑 and off the screen, and the whole log scrolled sideways.
 * The card's text column breaks such a word now; it was already allowed to
 * shrink beside the buttons (min-width: 0), which a break needs in a flex row.
 */
import { describe, expect, it } from 'vitest'

const sources = import.meta.glob<string>('/src/components/CatchEntryCard.vue', { query: '?raw', import: 'default', eager: true })
const css = (sources['/src/components/CatchEntryCard.vue'] ?? '').match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? ''
/** The declarations given to `selector` on its own, outside any @media. */
function decls(selector: string): string {
  const outside = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^{}]*\}/g, '')
  return [...outside.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((m) => m[1].split(',').map((s) => s.trim()).includes(selector))
    .map((m) => m[2]).join(';')
}
const val = (body: string, prop: string) =>
  [...body.matchAll(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`, 'g'))].pop()?.[1].trim()

describe("a catch's card at phone width", () => {
  it('breaks a word too long for its line, in a note or a place, rather than run past the card', () => {
    const main = decls('.entry-main')
    expect(val(main, 'min-width')).toBe('0')
    expect(['break-word', 'anywhere']).toContain(val(main, 'overflow-wrap'))
    // Nothing inside sets it back for the note or the line with the place.
    for (const sel of ['.entry-notes', '.entry-meta']) expect(val(decls(sel), 'overflow-wrap'), sel).toBeUndefined()
  })
})
