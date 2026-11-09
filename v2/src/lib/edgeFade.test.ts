import { describe, it, expect } from 'vitest'
// @ts-ignore — no @types/node in this project; vitest runs in Node. (A `?raw`
// import of a .css file comes back empty under vitest, which skips CSS.)
import { readFileSync } from 'node:fs'
import { EDGE_FADE_PX, overflowEdges, revealScrollLeft } from './edgeFade'

/**
 * On a phone the topbar nav and the dashboard tabs are strips that scroll
 * sideways with their scrollbars hidden, and nothing said so: at 375 px the
 * nav is 622 px of buttons in 343 (Find pladser and Fangstlog off-screen),
 * and the tab bar 462 in 343, its 4th tab "Vejr & Bølger" wholly beyond the
 * edge. Now a strip fades out at an edge with more beyond it, and the tab or
 * page in use is scrolled clear of the fade.
 */
describe('which edges have more beyond them', () => {
  it('none when everything fits', () => {
    expect(overflowEdges(0, 343, 343)).toEqual({ start: false, end: false })
  })

  it('the end only, at the start of a strip that overflows', () => {
    expect(overflowEdges(0, 462, 343)).toEqual({ start: false, end: true })
  })

  it('both, in the middle', () => {
    expect(overflowEdges(60, 462, 343)).toEqual({ start: true, end: true })
  })

  it('the start only, scrolled to the end', () => {
    expect(overflowEdges(119, 462, 343)).toEqual({ start: true, end: false })
  })

  // scrollWidth is rounded and scrollLeft is not: a strip that only just fits
  // must not fade, nor one scrolled to its end with a fraction to spare.
  it('ignores a sub-pixel remainder', () => {
    expect(overflowEdges(0, 344, 343)).toEqual({ start: false, end: false })
    expect(overflowEdges(118.6, 462, 343)).toEqual({ start: true, end: false })
    expect(overflowEdges(0.4, 462, 343)).toEqual({ start: false, end: true })
  })
})

describe('scrolling the tab in use into view', () => {
  const at375 = { scrollLeft: 0, clientWidth: 343, scrollWidth: 462 }

  // "Vejr & Bølger" at 339–462 of the 462 px tab bar: all the way to the end.
  it('brings a tab beyond the end clear of the fade, as far as the strip goes', () => {
    expect(revealScrollLeft({ ...at375, itemLeft: 339, itemWidth: 123 })).toBe(119)
  })

  it('stops a tab short of the fade, not at the very edge', () => {
    // A 100 px tab at 300–400: its end 400 + the fade must be in view.
    expect(revealScrollLeft({ scrollLeft: 0, clientWidth: 343, scrollWidth: 800, itemLeft: 300, itemWidth: 100 }))
      .toBe(400 + EDGE_FADE_PX - 343)
  })

  it('brings a tab before the start back, clear of the fade', () => {
    expect(revealScrollLeft({ scrollLeft: 300, clientWidth: 343, scrollWidth: 800, itemLeft: 280, itemWidth: 90 }))
      .toBe(280 - EDGE_FADE_PX)
    expect(revealScrollLeft({ scrollLeft: 119, clientWidth: 343, scrollWidth: 462, itemLeft: 0, itemWidth: 124 })).toBe(0)
  })

  it('leaves the strip where it is when the tab is already clear', () => {
    expect(revealScrollLeft({ ...at375, itemLeft: 128, itemWidth: 71 })).toBe(0)
    expect(revealScrollLeft({ scrollLeft: 50, clientWidth: 343, scrollWidth: 800, itemLeft: 150, itemWidth: 80 })).toBe(50)
  })
})

describe('where the cue is used', () => {
  const sources = import.meta.glob<string>(['/src/App.vue', '/src/views/DashboardView.vue'], {
    query: '?raw', import: 'default', eager: true,
  })
  const css: string = readFileSync(new URL('../style.css', import.meta.url), 'utf8')

  it('the topbar nav and the dashboard tab bar fade where they overflow', () => {
    expect(sources['/src/App.vue']).toMatch(/<nav ref="navEl" class="actions" :class="navFade">/)
    expect(sources['/src/views/DashboardView.vue']).toMatch(/<div ref="tabbarEl" class="tabbar" :class="tabbarFade" role="tablist">/)
  })

  // The tabs carry no border, and the 3rd tab's text ends ~20 px before the
  // edge: the fade alone hardly showed. A chevron says "more" outright, beside
  // the bar (inside it the mask would hide it), only while there is more.
  it('the tab bar also shows a chevron on a side with more tabs beyond it', () => {
    const dash = sources['/src/views/DashboardView.vue']
    expect(dash).toMatch(/<span v-if="tabsBefore" class="more-cue start" aria-hidden="true">‹<\/span>/)
    expect(dash).toMatch(/<span v-if="tabsAfter" class="more-cue end" aria-hidden="true">›<\/span>/)
  })

  it('the page in use and the tab in use are scrolled into view', () => {
    expect(sources['/src/App.vue']).toMatch(/revealNav\(/)
    expect(sources['/src/App.vue']).toMatch(/aria-current/)
    expect(sources['/src/views/DashboardView.vue']).toMatch(/revealTab\(/)
  })

  it('the fade is a mask, so it works over any background', () => {
    for (const cls of ['.edge-fade-start', '.edge-fade-end']) {
      const rule = css.match(new RegExp(`${cls.replace('.', '\\.')}\\s*\\{[^}]*\\}`))?.[0] ?? ''
      expect(rule, cls).toMatch(/-webkit-mask-image:/)
      expect(rule, cls).toMatch(/[^-]mask-image:/)
    }
  })
})
