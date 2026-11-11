import { describe, it, expect } from 'vitest'

/**
 * "UGENS BEDSTE" exists to say where and when, on one line cut off with an
 * ellipsis. At 375 px the line was 265 px in a 218 px box: "Fornæs Fyr · Lør
 * 14. Nov · 05…", the start time lost and a longer place name took the day
 * too. On a narrow screen the day and time get a line of their own; a wide
 * screen keeps the one line.
 */
const dash = Object.values(import.meta.glob<string>('/src/views/DashboardView.vue', {
  query: '?raw', import: 'default', eager: true,
}))[0] ?? ''
const style = dash.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1].replace(/\/\*[\s\S]*?\*\//g, '') ?? ''

/** The body of the `@media (max-width: 640px)` block, braces matched. */
function narrow(): string {
  const at = style.indexOf('@media (max-width: 640px)')
  if (at < 0) return ''
  const open = style.indexOf('{', at)
  let depth = 1, j = open + 1
  while (depth && j < style.length) { if (style[j] === '{') depth++; else if (style[j] === '}') depth--; j++ }
  return style.slice(open + 1, j - 1)
}
const rule = (css: string, sel: string) =>
  [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1].split(',').map((s) => s.trim()).includes(sel)).map((m) => m[2]).join(';')

describe('the top pick on a phone', () => {
  it('keeps the place apart from the day and time', () => {
    const detail = dash.match(/<span class="tp-detail">[\s\S]*?<\/span><\/span>\s*<\/span>/)?.[0] ?? ''
    expect(detail).toMatch(/<span\s+class="tp-where">\{\{ topPick\.location\.name \}\}<\/span>/)
    expect(detail).toMatch(/<span\s+class="tp-sep"> · <\/span>/)
    expect(detail).toMatch(/<span\s+class="tp-when">\{\{ fmtDate\(topPick\.date\) \}\} · \{\{ topPick\.from \}\}–\{\{ topPick\.to \}\}/)
  })

  it('puts the day and time on a line of their own, uncut', () => {
    const css = narrow()
    expect(rule(css, '.tp-detail')).toMatch(/flex-direction:\s*column/)
    expect(rule(css, '.tp-detail')).toMatch(/white-space:\s*normal/)
    expect(rule(css, '.tp-sep')).toMatch(/display:\s*none/)
    expect(rule(css, '.tp-where')).toMatch(/text-overflow:\s*ellipsis/)
    expect(rule(css, '.tp-when')).not.toMatch(/ellipsis|overflow:\s*hidden/)
  })

  it('leaves the one line on a wide screen as it was', () => {
    const wide = style.replace(narrow(), '')
    expect(rule(wide, '.tp-detail')).toMatch(/white-space:\s*nowrap; overflow:\s*hidden; text-overflow:\s*ellipsis/)
    expect(rule(wide, '.tp-sep')).toBe('')
  })
})
