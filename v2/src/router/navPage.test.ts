import { describe, it, expect, vi, afterEach } from 'vitest'
// Evaluated here, in node, before the browser stubs below: only the router's own setup sees them.
import 'vue-router'
import '@/stores/setup'
import { navPage } from './navPage'

/**
 * The setup map (#/setup/map, page title "📍 Lokationer") is reached from
 * the spot list, but no topbar button had aria-current there, and the nav
 * didn't scroll its page into view: every other page marks its own button.
 * The map now counts as Lokationer.
 */
describe('the topbar entry a page marks as current', () => {
  it('a page of its own marks itself', () => {
    expect(navPage({ name: 'dashboard', meta: {} })).toBe('dashboard')
  })

  it('a page that belongs to another marks that one', () => {
    expect(navPage({ name: 'map', meta: { nav: 'locations' } })).toBe('locations')
  })

  it('none for a route without a name', () => {
    expect(navPage({ name: undefined, meta: {} })).toBeUndefined()
  })
})

describe('in the app router', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('the setup map counts as Lokationer, every other page as itself', async () => {
    // Just enough of a browser for createWebHashHistory.
    const location = { host: 'localhost', pathname: '/', search: '', hash: '', protocol: 'http:' }
    const history = { state: { position: 0 }, scrollRestoration: 'auto', replaceState() {}, pushState() {} }
    const events = { addEventListener() {}, removeEventListener() {} }
    vi.stubGlobal('location', location)
    vi.stubGlobal('history', history)
    vi.stubGlobal('document', { ...events, visibilityState: 'visible' })
    vi.stubGlobal('window', { ...events, location, history })
    const router = (await import('./index')).default
    const of = (name: string) => navPage(router.resolve({ name }))
    expect(of('map')).toBe('locations')
    for (const name of ['welcome', 'auth', 'availability', 'locations', 'finder', 'catchlog', 'species', 'dashboard']) {
      expect(of(name), name).toBe(name)
    }
  })

  // App.vue's here() sets aria-current, and the nav reveals the button that has it.
  it('is what the topbar marks', () => {
    const app = Object.values(import.meta.glob<string>('/src/App.vue', { query: '?raw', import: 'default', eager: true }))[0]
    expect(app).toMatch(/const here = \(name: string\) => \(navPage\(route\) === name \? 'page' : undefined\)/)
  })
})
