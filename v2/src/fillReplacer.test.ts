import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'

// fill() puts a value into a {key} slot with String.replace. With a string
// there, "$&" or "$'" in the value reads as a replace pattern, so a spot's
// name came out mangled. Every view's fill passes the value through a function.
const root = new URL('./', import.meta.url)
const vueFiles = (readdirSync(root, { recursive: true }) as string[])
  .map((p) => p.replace(/\\/g, '/'))
  .filter((p) => p.endsWith('.vue'))

describe('fill in the views', () => {
  it('puts the value in through a function', () => {
    const bad = vueFiles.filter((p) => /\.replace\(`\{\$\{k\}\}`, String\(v\)\)/.test(readFileSync(new URL(p, root), 'utf8')))
    expect(bad).toEqual([])
  })

  it('is found in the model check panel too', () => {
    expect(vueFiles).toContain('components/ModelCheckPanel.vue')
  })
})
