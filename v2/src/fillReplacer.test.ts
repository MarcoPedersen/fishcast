import { describe, expect, it } from 'vitest'

// fill() puts a value into a {key} slot with String.replace. With a string
// there, "$&" or "$'" in the value reads as a replace pattern, so a spot's
// name came out mangled. Every view's fill passes the value through a function.
const sources = import.meta.glob<string>(['/src/**/*.vue'], { query: '?raw', import: 'default', eager: true })

describe('fill in the views', () => {
  it('puts the value in through a function', () => {
    const bad = Object.keys(sources).filter((p) => /\.replace\(`\{\$\{k\}\}`, String\(v\)\)/.test(sources[p]))
    expect(bad).toEqual([])
  })

  it('is found in the model check panel too', () => {
    expect(sources['/src/components/ModelCheckPanel.vue']).toContain('const fill = ')
  })
})
