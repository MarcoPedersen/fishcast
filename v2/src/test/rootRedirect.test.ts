import { describe, it, expect } from 'vitest'
import page from '../../../index.html?raw'

/**
 * The repo root's index.html: what https://…/fishcast/ serves since v1 was
 * retired — a page that sends everyone on to ./v2/. v1's share links point
 * there with the payload in the hash (#setup=… / #share=…), and both its
 * redirects, the meta refresh and location.replace('./v2/'), dropped it: the
 * shared spots looked lost, though v2 can read them.
 *
 * Its inline scripts run here against a stand-in document, in order, as one
 * script — top-level `var`s are globals shared by a page's classic scripts.
 */
function open(hash: string) {
  const metas: { httpEquiv?: string; content?: string }[] = []
  const replaced: string[] = []
  const link = { href: './v2/' }
  const document = {
    createElement: () => ({}),
    head: { appendChild: (el: { httpEquiv?: string; content?: string }) => { metas.push(el) } },
    querySelector: () => link,
  }
  const location = { hash, replace: (url: string) => { replaced.push(url) } }
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])
  // No service worker and no caches here: the v1 clean-up has nothing to await.
  new Function('document', 'location', 'navigator', 'window', scripts.join(';\n'))(document, location, {}, {})
  const refresh = metas.find((m) => m.httpEquiv === 'refresh')?.content
  return { refresh, replaced, link: link.href }
}

describe('the root redirect page', () => {
  const SETUP = '#setup=eyJ2IjoxLCJsb2NzIjpbXX0+/a='
  const WINDOW = '#share=eyJuIjoiTW9sZW4ifQ=='

  it('forwards a v1 setup link’s hash to v2, by refresh, by script and by link', () => {
    expect(open(SETUP)).toEqual({ refresh: '0; url=./v2/' + SETUP, replaced: ['./v2/' + SETUP], link: './v2/' + SETUP })
  })

  it('forwards a v1 window link’s hash', () => {
    expect(open(WINDOW).replaced).toEqual(['./v2/' + WINDOW])
  })

  it('sends everything else to ./v2/ as before, without its hash', () => {
    for (const hash of ['', '#', '#/dashboard', '#access_token=abc&type=recovery']) {
      expect(open(hash)).toEqual({ refresh: '0; url=./v2/', replaced: ['./v2/'], link: './v2/' })
    }
  })

  it('still redirects with scripts off', () => {
    expect(page).toMatch(/<noscript><meta http-equiv="refresh" content="0; url=.\/v2\/" \/><\/noscript>/)
  })
})
