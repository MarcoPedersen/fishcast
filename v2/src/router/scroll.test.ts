import { describe, it, expect, vi, afterEach } from 'vitest'
// Evaluated here, in node, before the browser stubs below: only the router's own setup sees them.
import 'vue-router'
import '@/stores/setup'
import type { RouteLocationNormalized } from 'vue-router'
import { scrollBehavior } from './scroll'

const at = (path: string, query: Record<string, string> = {}) => ({ path, query, hash: '' }) as unknown as RouteLocationNormalized

/**
 * The router had no scrollBehavior, so a new page opened at the old one's
 * scroll offset: "Vis fiskeforhold →", at the foot of the long species list,
 * landed on the dashboard at scrollY 518 — the moon card and the footer, the
 * first thing a new user saw of their forecast.
 */
describe('scrollBehavior', () => {
  it('opens a new page at the top', () => {
    expect(scrollBehavior(at('/dashboard'), at('/setup/species'), null)).toEqual({ top: 0 })
  })

  it('back and forward return to where the page was', () => {
    const saved = { left: 0, top: 518 }
    expect(scrollBehavior(at('/dashboard'), at('/setup/species'), saved)).toBe(saved)
  })

  it('leaves the scroll alone when only the query changes', () => {
    expect(scrollBehavior(at('/', {}), at('/', { setup: 'x' }), null)).toBe(false)
  })
})

describe('the app router', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('uses it', async () => {
    // Just enough of a browser for createWebHashHistory.
    const location = { host: 'localhost', pathname: '/', search: '', hash: '', protocol: 'http:' }
    const history = { state: { position: 0 }, scrollRestoration: 'auto', replaceState() {}, pushState() {} }
    const events = { addEventListener() {}, removeEventListener() {} }
    vi.stubGlobal('location', location)
    vi.stubGlobal('history', history)
    vi.stubGlobal('document', { ...events, visibilityState: 'visible' })
    vi.stubGlobal('window', { ...events, location, history })
    const router = (await import('./index')).default
    expect(router.options.scrollBehavior).toBe(scrollBehavior)
  })
})
