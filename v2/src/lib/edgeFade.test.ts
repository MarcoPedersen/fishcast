import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// @ts-ignore — no @types/node in this project; vitest runs in Node. (A `?raw`
// import of a .css file comes back empty under vitest, which skips CSS.)
import { readFileSync } from 'node:fs'
import { createRenderer, ref } from 'vue'
import { EDGE_FADE_PX, overflowEdges, revealScrollLeft, useEdgeFade } from './edgeFade'

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

/**
 * The composable itself, mounted in a component (a renderer with no DOM): the
 * pure functions above were tested, but not what keeps the classes in step,
 * that a strip which doesn't scroll never fades, that reveal() moves the strip
 * alone, or that a view leaving lets go of its strip.
 */
describe('useEdgeFade in a component', () => {
  type Listener = () => void
  interface FakeStrip {
    scrollLeft: number; scrollWidth: number; clientWidth: number; clientLeft: number
    children: unknown[]; overflowX: string; listeners: Record<string, Listener>
    addEventListener(type: string, fn: Listener): void
    removeEventListener(type: string, fn: Listener): void
    getBoundingClientRect(): { left: number; width: number }
    scrollTo: ReturnType<typeof vi.fn>
  }
  /** A strip at x 16, as wide as it shows; overflowX as getComputedStyle reports it. */
  function strip(scrollWidth: number, clientWidth: number, overflowX = 'auto'): FakeStrip {
    const s: FakeStrip = {
      scrollLeft: 0, scrollWidth, clientWidth, clientLeft: 0, children: [], overflowX, listeners: {},
      addEventListener(type, fn) { s.listeners[type] = fn },
      removeEventListener(type, fn) { if (s.listeners[type] === fn) delete s.listeners[type] },
      getBoundingClientRect: () => ({ left: 16, width: s.clientWidth }),
      scrollTo: vi.fn((o: { left: number }) => { s.scrollLeft = o.left }),
    }
    return s
  }
  const item = (left: number, width: number) => ({ getBoundingClientRect: () => ({ left, width }) }) as unknown as Element

  interface FakeObserver { cb: () => void; targets: unknown[]; disconnected: boolean }
  let observers: FakeObserver[] = []
  let reducedMotion = false
  beforeEach(() => {
    observers = []
    reducedMotion = false
    vi.stubGlobal('getComputedStyle', (e: FakeStrip) => ({ overflowX: e.overflowX }))
    vi.stubGlobal('ResizeObserver', class {
      o: FakeObserver
      constructor(cb: () => void) { this.o = { cb, targets: [], disconnected: false }; observers.push(this.o) }
      observe(t: unknown) { this.o.targets.push(t); this.o.disconnected = false }
      disconnect() { this.o.targets = []; this.o.disconnected = true }
    })
    vi.stubGlobal('MutationObserver', class { observe() {} disconnect() {} })
    vi.stubGlobal('window', { matchMedia: () => ({ matches: reducedMotion }) })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  /** Mounts a component that uses the composable on `el`. `resized()` = what a ResizeObserver delivers. */
  function mount(el: FakeStrip) {
    type Host = Record<string, unknown>
    const r = createRenderer<Host, Host>({
      createElement: () => ({}), createText: () => ({}), createComment: () => ({}),
      setText: () => {}, setElementText: () => {}, insert: () => {}, remove: () => {},
      parentNode: () => null, nextSibling: () => null, patchProp: () => {},
    })
    let api!: ReturnType<typeof useEdgeFade>
    const app = r.createApp({ setup() { api = useEdgeFade(ref(el as unknown as HTMLElement)); return () => null } })
    app.mount({})
    const resized = () => observers.forEach((o) => { if (o.targets.length) o.cb() })
    return { api, app, resized }
  }
  const classes = (start: boolean, end: boolean) => ({ 'edge-fade-start': start, 'edge-fade-end': end })

  it('fades the end at the start, both edges in the middle, the start at the end, as the strip scrolls', () => {
    const el = strip(462, 343)
    const { api, resized } = mount(el)
    resized()
    expect(api.fadeClass.value).toEqual(classes(false, true))
    el.scrollLeft = 60; el.listeners.scroll()
    expect(api.fadeClass.value).toEqual(classes(true, true))
    el.scrollLeft = 119; el.listeners.scroll()
    expect(api.fadeClass.value).toEqual(classes(true, false))
  })

  it('follows a change of size: no fade once everything fits', () => {
    const el = strip(462, 343)
    const { api, resized } = mount(el)
    resized()
    el.scrollWidth = el.clientWidth = 728
    resized()
    expect(api.fadeClass.value).toEqual(classes(false, false))
  })

  // The desktop nav wraps instead of scrolling; a badge poking out past its
  // edge makes scrollWidth exceed clientWidth there, and must not fade it.
  it('never fades a strip that does not scroll', () => {
    const el = strip(380, 372, 'visible')
    const { api, resized } = mount(el)
    resized()
    el.listeners.scroll()
    expect(api.fadeClass.value).toEqual(classes(false, false))
  })

  it('reveal() scrolls the strip itself, smoothly unless motion is reduced, and leaves one that fits alone', () => {
    const el = strip(462, 343)
    const { api } = mount(el)
    api.reveal(item(16 + 339, 123)) // "Vejr & Bølger", the 4th tab, at 339–462 of the bar
    expect(el.scrollTo).toHaveBeenCalledWith({ left: 119, behavior: 'smooth' })
    reducedMotion = true
    api.reveal(item(16 - 119, 124)) // back to the 1st tab
    expect(el.scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: 'auto' })

    const fits = strip(343, 343)
    mount(fits).api.reveal(item(16 + 300, 43))
    expect(fits.scrollTo).not.toHaveBeenCalled()
  })

  it('lets go of the strip when the view goes', () => {
    const el = strip(462, 343)
    const { app } = mount(el)
    expect(el.listeners.scroll).toBeTypeOf('function')
    app.unmount()
    expect(el.listeners.scroll).toBeUndefined()
    expect(observers.length).toBeGreaterThan(0)
    expect(observers.every((o) => o.disconnected)).toBe(true)
  })
})
