// @vitest-environment vue-dom
/**
 * Målarter, mounted, as a screen reader and a keyboard meet it. A species
 * card was a div with tabindex, aria-label and aria-pressed but no role:
 * aria-pressed is not allowed on a div with no role, so a screen reader may
 * not hear a toggle at all. And the card held a real button, the ⚠️ / ⛔, so
 * role="button" on the card would have hidden that one: a button's contents
 * are presentational (axe nested-interactive). The toggle is now a button of
 * its own holding the card's text, and the ⚠️ sits beside it in the card.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router, type RouterHistory } from 'vue-router'
// @ts-ignore — no @types/node in this project; vitest runs in Node.
import { readFileSync } from 'node:fs'
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'
import { STRINGS } from '@/test/strings'
import { SPECIES_PREFS } from '@/lib/species'
import { DK_SPOTS, locationFromSpot } from '@/lib/spots'
import { useSetupStore } from '@/stores/setup'
import SpeciesView from './SpeciesView.vue'

const da = STRINGS.da
const SPECIES = Object.values(SPECIES_PREFS)
const warned = (id: string) => { const s = SPECIES_PREFS[id]; return !!(s.restricted || s.venom || s.banned) }

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined

beforeEach(() => {
  restoreDocument = installDocument()
  // What the warning's dialog (lib/useModal) touches as it opens.
  Object.assign(document, { body: { style: {} } })
  vi.stubGlobal('window', { innerWidth: 1024 })
})
afterEach(() => {
  view?.unmount()
  view = undefined
  vi.unstubAllGlobals()
  vi.useRealTimers()
  restoreDocument()
})

async function open(selected: string[] = []): Promise<FakeNode> {
  const pinia = createPinia()
  setActivePinia(pinia)
  useSetupStore().targetSpecies = [...selected]
  const page = { render: () => null }
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/setup/species', name: 'species', component: page },
    { path: '/setup/locations', name: 'locations', component: page },
    { path: '/dashboard', name: 'dashboard', component: page },
  ] })
  await router.push('/setup/species')
  view = mount(SpeciesView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
  await nextTick()
  return view.root
}

/** Each species' card, in the order the page lists them. */
const cards = (root: FakeNode) => root.byClass('card sp')
const cardOf = (root: FakeNode, id: string) => cards(root)[SPECIES.findIndex((s) => s.id === id)]
/** A card's toggle: its first element. */
const toggleOf = (card: FakeNode) => card.elements[0]
const pressed = (b: FakeNode) => b.attrs['aria-pressed']
/** What can take the focus or a click inside `n`, `n` itself left out. */
const interactive = (n: FakeNode) => n.findAll((x) => x !== n && (['button', 'a', 'input', 'select', 'textarea'].includes(x.tag) || x.attrs.tabindex != null))
/** The dialog a warning opens, if one is open. */
const dialog = (root: FakeNode) => root.findAll((n) => n.attrs.role === 'dialog')[0]

describe('a species card to a screen reader', () => {
  it('its toggle is a button, pressed or not, holding the emoji, the name and the tip', async () => {
    const root = await open(['torsk', 'aborre'])
    expect(cards(root)).toHaveLength(SPECIES.length)
    for (const [i, sp] of SPECIES.entries()) {
      const b = toggleOf(cards(root)[i])
      expect(b.tag, sp.id).toBe('button')
      expect(b.attrs.type, sp.id).toBe('button')
      expect(pressed(b), sp.id).toBe(['torsk', 'aborre'].includes(sp.id))
      expect(b.attrs['aria-label'], sp.id).toBe(sp.name)
      expect(b.textContent, sp.id).toContain(sp.emoji)
      expect(b.textContent, sp.id).toContain(sp.name)
      expect(b.textContent, sp.id).toContain(sp.tip.replace(/\s+/g, ' ').trim())
    }
  })

  it('the card around it is no control: no role, name, state or tab stop of its own', async () => {
    const root = await open(['torsk'])
    for (const c of cards(root)) {
      for (const a of ['role', 'tabindex', 'aria-label', 'aria-pressed']) expect(c.attrs[a], a).toBeUndefined()
    }
  })

  it('the ⚠️ / ⛔ is beside the toggle, not in it, and after it: Tab reaches the toggle, then the ⚠️', async () => {
    const root = await open()
    for (const sp of SPECIES) {
      const c = cardOf(root, sp.id)
      const b = toggleOf(c)
      expect(interactive(b).map((n) => n.tag), sp.id).toEqual([])
      expect(c.elements.map((e) => e.hasClass('warn')), sp.id).toEqual(warned(sp.id) ? [false, true] : [false])
      // In the page's order, which Tab follows: the toggle, then the ⚠️.
      const stops = interactive(c)
      expect(stops.length, sp.id).toBe(warned(sp.id) ? 2 : 1)
      expect(stops[0], sp.id).toBe(b)
      if (warned(sp.id)) expect(stops[1], sp.id).toBe(c.elements[1])
    }
    const w = cardOf(root, 'stenbider').elements[1]
    expect(w.textContent).toBe('⛔')
    expect(w.attrs['aria-label']).toBe(`${SPECIES_PREFS.stenbider.name} — ${da.warn_hint}`)
    expect(cardOf(root, 'havørred').elements[1].textContent).toBe('⚠️')
  })

  // The tip is the card's text, so the name alone names the toggle; what
  // else the card says is its description.
  it('says the tip, and a species closed today, as the toggle\'s description', async () => {
    vi.useFakeTimers({ now: new Date(2026, 3, 15, 12), toFake: ['Date'] }) // pike is closed in April
    const root = await open()
    const b = toggleOf(cardOf(root, 'gedde'))
    const closed = b.byClass('closed-now')[0]
    expect(closed.textContent).toBe(`🚫 ${da.season_closed_now}`)
    const tip = b.byClass('tip')[0]
    expect(String(b.attrs['aria-describedby']).split(' ')).toEqual([closed.attrs.id, tip.attrs.id])
    const open2 = toggleOf(cardOf(root, 'aborre'))
    expect(open2.byClass('closed-now')).toEqual([])
    expect(open2.attrs['aria-describedby']).toBe(open2.byClass('tip')[0].attrs.id)
    const ids = root.findAll((n) => n.attrs.id != null).map((n) => n.attrs.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('a species card to a tap and a keyboard', () => {
  it('a tap on the toggle picks the species, and another lets it go; aria-pressed follows', async () => {
    const root = await open()
    const setup = useSetupStore()
    toggleOf(cardOf(root, 'aborre')).click()
    await nextTick()
    expect(setup.targetSpecies).toEqual(['aborre'])
    expect(pressed(toggleOf(cardOf(root, 'aborre')))).toBe(true)
    expect(cardOf(root, 'aborre').hasClass('selected')).toBe(true)
    toggleOf(cardOf(root, 'aborre')).click()
    await nextTick()
    expect(setup.targetSpecies).toEqual([])
    expect(pressed(toggleOf(cardOf(root, 'aborre')))).toBe(false)
  })

  // A button turns Enter (as it goes down) and Space (as it comes up) into
  // a click of its own. A key handler on it as well picked a species and
  // let it go again on one press.
  it('Enter and Space pick once, as a button\'s own click', async () => {
    const root = await open()
    const setup = useSetupStore()
    const press = (key: string) => {
      const b = toggleOf(cardOf(root, 'aborre'))
      b.dispatch('keydown', { key })
      b.dispatch('keyup', { key })
      b.click() // what the browser does for a button
    }
    press('Enter')
    await nextTick()
    expect(setup.targetSpecies).toEqual(['aborre'])
    press(' ')
    await nextTick()
    expect(setup.targetSpecies).toEqual([])
  })

  it('the ⚠️ opens its warning and leaves the pick alone', async () => {
    const root = await open(['havørred'])
    cardOf(root, 'havørred').elements[1].click()
    await nextTick()
    expect(dialog(root)?.attrs['aria-label']).toBe(SPECIES_PREFS['havørred'].name)
    expect(useSetupStore().targetSpecies).toEqual(['havørred'])
  })

  it('a banned species: a tap on its card is refused, with its notice', async () => {
    const root = await open()
    toggleOf(cardOf(root, 'stenbider')).click()
    await nextTick()
    expect(useSetupStore().targetSpecies).toEqual([])
    expect(dialog(root)?.attrs['aria-label']).toBe(SPECIES_PREFS.stenbider.name)
  })
})

/**
 * The round T sweep: "Vis fiskeforhold →" went to the dashboard unchecked.
 * Find pladser opens Målarter before any setup (its "Skift arter"), and the
 * dashboard sends a visit with no setup back to the welcome page: Find
 * pladser, Skift arter, Vis fiskeforhold, and the user stood on Velkommen
 * with no word. With no setup yet the button starts one, as Find pladser's
 * own button has since round T; with a setup it shows the fishing as before.
 */
describe('the way on from Målarter', () => {
  let router: Router
  /** Målarter, and the dashboard as the app's router guards it: no setup, back to the welcome page. */
  async function openGuarded(prepare: (s: ReturnType<typeof useSetupStore>) => void): Promise<FakeNode> {
    const pinia = createPinia()
    setActivePinia(pinia)
    prepare(useSetupStore())
    const page = { render: () => null }
    router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/', name: 'welcome', component: page },
      { path: '/finder', name: 'finder', component: page },
      { path: '/setup/availability', name: 'availability', component: page },
      { path: '/setup/locations', name: 'locations', component: page },
      { path: '/setup/species', name: 'species', component: page },
      { path: '/dashboard', name: 'dashboard', component: page, beforeEnter: () => (useSetupStore().hasSetup() ? true : { name: 'welcome' }) },
    ] })
    await router.push('/finder')
    await router.push('/setup/species')
    view = mount(SpeciesView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
    await nextTick()
    return view.root
  }
  const onward = (root: FakeNode) => root.byClass('nav')[0].byClass('btn primary')[0]
  /** The navigation a click starts, done. */
  const settle = () => new Promise((r) => setTimeout(r, 0))
  const spot = { id: 'l1', ...locationFromSpot(DK_SPOTS[0]) }

  it('with no setup yet (spots from Find pladser, no time windows), starts the setup', async () => {
    const root = await openGuarded((s) => { s.locations = [spot] })
    expect(onward(root).textContent).toBe(da.setup_start)
    toggleOf(cardOf(root, 'aborre')).click()
    await nextTick()
    onward(root).click()
    await settle()
    expect(router.currentRoute.value.name).toBe('availability')
    expect(useSetupStore().targetSpecies).toEqual(['aborre'])
  })

  it('with nothing set up at all, the same', async () => {
    const root = await openGuarded(() => {})
    onward(root).click()
    await settle()
    expect(router.currentRoute.value.name).toBe('availability')
  })

  // Round W: with time windows made and no spot yet, "Start opsætning" sent
  // the visit back to step 1, Tidsvinduer. The step missing is a spot, on
  // Lokationer, where the setup map's way on leads too since round V.
  it('with time windows but no spot yet, goes on to Lokationer, the step missing', async () => {
    const root = await openGuarded((s) => { s.availability = [{ id: 'a1', days: [6], from: '06:00', to: '10:00', methods: ['shore'] }] })
    expect(onward(root).textContent).toBe(da.setup_continue)
    onward(root).click()
    await settle()
    expect(router.currentRoute.value.name).toBe('locations')
    expect(useSetupStore().availability).toHaveLength(1)
  })

  it('with a setup, shows the fishing on the dashboard', async () => {
    const root = await openGuarded((s) => {
      s.locations = [spot]
      s.availability = [{ id: 'a1', days: [6], from: '06:00', to: '10:00', methods: ['shore'] }]
    })
    expect(onward(root).textContent).toBe(da.sp_show)
    onward(root).click()
    await settle()
    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  // Signed in on a new phone, the setup comes with the first pull, maybe
  // while this page is open (or another tab adds the last window). A button
  // that decided when the page opened kept starting a setup that was there.
  it('follows a setup that arrives while it is open', async () => {
    const root = await openGuarded((s) => { s.locations = [spot] })
    expect(onward(root).textContent).toBe(da.setup_start)
    useSetupStore().availability = [{ id: 'a1', days: [6], from: '06:00', to: '10:00', methods: ['shore'] }]
    await nextTick()
    expect(onward(root).textContent).toBe(da.sp_show)
    onward(root).click()
    await settle()
    expect(router.currentRoute.value.name).toBe('dashboard')
  })
})

/**
 * A memory history that keeps the page before in its state, as the app's
 * web history does (vue-router's buildState `back`): a push records the page
 * left, a replace keeps what the entry had, and the first page has none. The
 * plain memory history keeps no `back`, so every visit would look like one
 * opened on this page.
 */
function appHistory(): RouterHistory {
  const h = createMemoryHistory()
  const { push, replace } = h
  h.push = (to, data) => push.call(h, to, { ...data, back: h.location })
  h.replace = (to, data) => replace.call(h, to, { ...data, back: h.state.back ?? null })
  return h
}

/**
 * Round V: opened from Find pladser before any setup, both of Målarter's
 * buttons led into the setup ("Tilbage" to Lokationer, the main one to
 * Tidsvinduer), and nothing on the page led back to Find pladser. With no
 * setup, "Tilbage" now goes back where the user came from, or to Find
 * pladser when the app was opened on this page. With a setup it still goes
 * to Lokationer, the step before this one.
 *
 * Round W: with a setup, "Skift arter" on Find pladser opens this page
 * too, and "Tilbage" went to Lokationer: the way back to Find pladser was
 * lost. Come from Find pladser, "Tilbage" now steps back to it, setup or
 * not; from anywhere else, with a setup, it goes to Lokationer.
 */
describe('Tilbage from Målarter', () => {
  let router: Router
  /** Målarter, after the pages in `from` (none: the app opened here). */
  async function openFrom(from: string[], prepare: (s: ReturnType<typeof useSetupStore>) => void = () => {}): Promise<FakeNode> {
    const pinia = createPinia()
    setActivePinia(pinia)
    prepare(useSetupStore())
    const page = { render: () => null }
    router = createRouter({ history: appHistory(), routes: [
      { path: '/', name: 'welcome', component: page },
      { path: '/finder', name: 'finder', component: page },
      { path: '/setup/availability', name: 'availability', component: page },
      { path: '/setup/locations', name: 'locations', component: page },
      { path: '/setup/species', name: 'species', component: page },
      { path: '/dashboard', name: 'dashboard', component: page },
    ] })
    for (const path of [...from, '/setup/species']) await router.push(path)
    view = mount(SpeciesView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
    await nextTick()
    return view.root
  }
  const backButton = (root: FakeNode) => root.byClass('nav')[0].byClass('btn ghost')[0]
  /** The navigation a click starts, done. */
  const settle = () => new Promise((r) => setTimeout(r, 0))
  const spot = { id: 'l1', ...locationFromSpot(DK_SPOTS[0]) }
  const window1 = { id: 'a1', days: [6], from: '06:00', to: '10:00', methods: ['shore' as const] }

  it('with no setup, opened from Find pladser, goes back to it: a step back, the species picked kept', async () => {
    const root = await openFrom(['/finder'])
    expect(backButton(root).textContent).toBe(da.back)
    toggleOf(cardOf(root, 'aborre')).click()
    await nextTick()
    const back = vi.spyOn(router, 'back')
    backButton(root).click()
    await settle()
    expect(router.currentRoute.value.name).toBe('finder')
    expect(back).toHaveBeenCalledTimes(1)
    expect(useSetupStore().targetSpecies).toEqual(['aborre'])
  })

  it('with no setup, goes back to whichever page it came from', async () => {
    const root = await openFrom(['/finder', '/'])
    backButton(root).click()
    await settle()
    expect(router.currentRoute.value.name).toBe('welcome')
  })

  it('with no setup, opened on this page with nothing before it, goes to Find pladser', async () => {
    const root = await openFrom([])
    const back = vi.spyOn(router, 'back')
    backButton(root).click()
    await settle()
    expect(router.currentRoute.value.name).toBe('finder')
    expect(back).not.toHaveBeenCalled()
  })

  it('a spot but no windows is no setup either: back to Find pladser', async () => {
    const root = await openFrom(['/finder'], (s) => { s.locations = [spot] })
    backButton(root).click()
    await settle()
    expect(router.currentRoute.value.name).toBe('finder')
  })

  const fullSetup = (s: ReturnType<typeof useSetupStore>) => {
    s.locations = [spot]
    s.availability = [window1]
  }

  it('with a setup, opened from Find pladser, steps back to it, its search kept in the link', async () => {
    const root = await openFrom(['/finder?mode=nearby'], fullSetup)
    const back = vi.spyOn(router, 'back')
    backButton(root).click()
    await settle()
    expect(back).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.fullPath).toBe('/finder?mode=nearby')
  })

  // The page before this one counts, not Find pladser further back.
  it('with a setup, from any other page, goes to Lokationer, the step before this one', async () => {
    for (const from of [['/finder', '/dashboard'], ['/setup/locations'], ['/']]) {
      const root = await openFrom(from, fullSetup)
      const back = vi.spyOn(router, 'back')
      backButton(root).click()
      await settle()
      expect(router.currentRoute.value.name, from.join(' → ')).toBe('locations')
      expect(back, from.join(' → ')).not.toHaveBeenCalled()
      view?.unmount()
      view = undefined
    }
  })

  it('with a setup, opened on this page with nothing before it, goes to Lokationer', async () => {
    const root = await openFrom([], fullSetup)
    backButton(root).click()
    await settle()
    expect(router.currentRoute.value.name).toBe('locations')
  })
})

/**
 * The look is kept: the toggle fills the card, with the card's own padding,
 * so a tap anywhere on the card still picks. The ⚠️ is held over the
 * toggle's top right corner, where it stood in the card's top row: at the
 * padding's edge, as tall as the emoji's line. touchTargets.test.ts grows it
 * to 40 px on a touch screen from there, into that padding.
 */
describe('the card keeps its look', () => {
  // Not new URL(…, import.meta.url) in one: the client transform this file
  // runs under turns that into a page's asset URL.
  const here = import.meta.url
  const source: string = readFileSync(new URL('./SpeciesView.vue', here), 'utf8')
  const globalCss: string = readFileSync(new URL('../style.css', here), 'utf8')
  const rules = (css: string) => [...css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{([^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
    .matchAll(/([^{}]+)\{([^}]*)\}/g)]
  /** The declarations a selector is given outside @media, joined. */
  const decls = (css: string, sel: string) => rules(css).filter((m) => m[1].split(',').map((s) => s.trim()).includes(sel)).map((m) => m[2]).join(';')
  const val = (body: string, prop: string) => [...body.matchAll(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`, 'g'))].pop()?.[1].trim()
  const style = source.match(/<style[^>]*>([\s\S]*?)<\/style>/)?.[1] ?? ''

  it('the toggle fills the card and carries its padding', () => {
    expect(val(decls(style, '.sp'), 'padding')).toBe('0')
    expect(val(decls(style, '.sp'), 'display')).toBe('flex')
    expect(val(decls(style, '.pick'), 'flex')).toBe('1')
    expect(val(decls(style, '.pick'), 'padding')).toBe(val(decls(globalCss, '.card'), 'padding'))
    expect(val(decls(style, '.pick'), 'text-align')).toBe('left')
  })

  it('the ⚠️ stands at the padding\'s top right, as tall as the emoji\'s line', () => {
    const w = decls(style, '.warn')
    const pad = val(decls(style, '.pick'), 'padding')
    expect(val(decls(style, '.sp'), 'position')).toBe('relative')
    expect(val(w, 'position')).toBe('absolute')
    expect(val(w, 'top')).toBe(pad)
    expect(val(w, 'right')).toBe(pad)
    expect(val(w, 'height')).toBe(val(decls(style, '.emoji'), 'line-height'))
  })
})
