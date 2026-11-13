import { describe, it, expect } from 'vitest'

/**
 * Which layer is on top. A toast with a Fortryd stays until it is used or
 * closed, at the bottom of the screen, and its stack sat above the dialogs:
 * over the setup map's add sheet it covered "+ Tilføj lokation", its Fortryd
 * right on top of the button, so a tap there undid a move instead of adding
 * the spot. A dialog that asks for the user's answer is above the toasts; the
 * confirm dialog, which may be opened from inside one, above them all.
 */
const sources = import.meta.glob<string>([
  '/src/components/Toasts.vue', '/src/components/ConfirmDialog.vue',
  '/src/views/MapView.vue', '/src/views/DashboardView.vue', '/src/views/SpeciesView.vue',
], { query: '?raw', import: 'default', eager: true })
const styleOf = (path: string) => (sources[path] ?? '').match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? ''
/** The z-index given to `selector` in a component's style. */
function z(path: string, selector: string): number {
  // A body holds no brace: a rule inside an @media block is read on its own.
  const rule = [...styleOf(path).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .find((m) => m[1].split(',').map((s) => s.trim()).includes(selector))
  return Number(rule?.[2].match(/z-index:\s*(\d+)/)?.[1] ?? NaN)
}

describe('layers', () => {
  const toasts = z('/src/components/Toasts.vue', '.toasts')
  const confirm = z('/src/components/ConfirmDialog.vue', '.overlay')

  it('reads the toasts\' and the confirm dialog\'s layers', () => {
    expect(toasts).toBeGreaterThan(0)
    expect(confirm).toBeGreaterThan(toasts)
  })

  it.each([
    ['/src/views/MapView.vue', '.sheet'], // a new spot's add sheet
    ['/src/views/DashboardView.vue', '.overlay'], // a window's score breakdown
    ['/src/views/SpeciesView.vue', '.overlay'], // a species' warning
  ])('%s %s is above the toasts and below the confirm dialog', (path, selector) => {
    expect(z(path, selector)).toBeGreaterThan(toasts)
    expect(z(path, selector)).toBeLessThan(confirm)
  })
})
