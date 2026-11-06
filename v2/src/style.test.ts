import { describe, it, expect } from 'vitest'
// @ts-ignore — no @types/node in this project; vitest runs in Node. (A `?raw`
// import of a .css file comes back empty under vitest, which skips CSS.)
import { readFileSync } from 'node:fs'

const css: string = readFileSync(new URL('./style.css', import.meta.url), 'utf8')
/** The global stylesheet's rules: each selector list split into selectors, with its declarations. */
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)]
  .map((m) => ({ selectors: m[1].split(',').map((s) => s.trim()), body: m[2] }))
const ruleWith = (decl: RegExp) => rules.filter((r) => decl.test(r.body))

/**
 * style.css styled `input, select` only, and nothing set a textarea's colours
 * or font: the Noter boxes in the catch log and the spot note rendered as the
 * browser's white box with black monospace text in the dark app.
 */
describe('form fields in the global stylesheet', () => {
  it('styles textareas as the app\'s other inputs', () => {
    const field = ruleWith(/background:\s*#0a1626/)
    expect(field).toHaveLength(1)
    expect(field[0].selectors).toEqual(expect.arrayContaining(['input', 'select', 'textarea']))
    // A textarea's own font is the browser's monospace.
    expect(field[0].body).toMatch(/font-family:\s*inherit/)
  })

  it('marks a focused textarea as it marks a focused input', () => {
    const focus = ruleWith(/border-color:\s*var\(--primary\)/).flatMap((r) => r.selectors)
    expect(focus).toEqual(expect.arrayContaining(['input:focus', 'textarea:focus']))
  })
})
