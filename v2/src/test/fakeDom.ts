/**
 * An in-memory DOM for mounting a real component in the node tests: just
 * enough of an element for Vue's renderer, v-model and the views' own calls
 * (scrollIntoView). No layout and no stylesheet: a test reads the tree (tags,
 * classes, attributes, text) and fires events at it.
 *
 * The component must be compiled for the client, to a render function: a
 * test file that mounts one starts with `// @vitest-environment vue-dom`
 * (vueDomEnv.ts).
 */
import { createRenderer, type App, type Component } from 'vue'

export interface FakeEvent {
  type: string
  target: FakeNode
  currentTarget: FakeNode
  stopPropagation(): void
  preventDefault(): void
}
type Listener = (e: FakeEvent) => void

export class FakeNode {
  readonly tag: string
  children: FakeNode[] = []
  parent: FakeNode | null = null
  /** A text or comment node's text. */
  text = ''
  /** Attributes and other props as the renderer set them, class and scope ids included. */
  attrs: Record<string, unknown> = {}
  /** An input's, textarea's or select's live value: v-model reads and writes it. */
  value: unknown = ''
  type = ''
  // What v-model's select directive walks and sets.
  options: FakeNode[] = []
  selectedIndex = -1
  multiple = false
  selected = false
  composing = false
  private listeners = new Map<string, Listener[]>()

  constructor(tag: string) { this.tag = tag }

  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn])
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn))
  }
  /** Fires `type` at this node only: nothing in the views relies on bubbling. */
  dispatch(type: string) {
    const e: FakeEvent = { type, target: this, currentTarget: this, stopPropagation() {}, preventDefault() {} }
    for (const fn of this.listeners.get(type) ?? []) fn(e)
  }
  click() { this.dispatch('click') }
  /** Types `value` into an input or textarea, as one input event. */
  input(value: string) {
    this.value = value
    this.dispatch('input')
  }
  scrollIntoView() {}
  getRootNode(): FakeNode {
    let n: FakeNode = this
    while (n.parent) n = n.parent
    return n
  }

  /** The element children, without text and comment nodes (a v-for's anchors are empty texts). */
  get elements(): FakeNode[] { return this.children.filter((c) => !c.tag.startsWith('#')) }
  get classes(): string[] { return String(this.attrs.class ?? '').split(/\s+/).filter(Boolean) }
  hasClass(c: string) { return this.classes.includes(c) }
  /** The text inside, whitespace collapsed, as a reader sees it. */
  get textContent(): string {
    const parts: string[] = []
    const walk = (n: FakeNode) => {
      if (n.tag === '#text') parts.push(n.text)
      else if (n.tag !== '#comment') n.children.forEach(walk)
    }
    walk(this)
    return parts.join('').replace(/\s+/g, ' ').trim()
  }
  /** This node and every node below it that matches, in document order. */
  findAll(pred: (n: FakeNode) => boolean): FakeNode[] {
    const out: FakeNode[] = []
    const walk = (n: FakeNode) => { if (pred(n)) out.push(n); n.children.forEach(walk) }
    walk(this)
    return out
  }
  /** The elements carrying every one of the space-separated classes. */
  byClass(classes: string): FakeNode[] {
    const want = classes.split(/\s+/).filter(Boolean)
    return this.findAll((n) => want.every((c) => n.hasClass(c)))
  }
  byTag(tag: string): FakeNode[] { return this.findAll((n) => n.tag === tag) }
}

function detach(n: FakeNode) {
  const p = n.parent
  if (!p) return
  p.children.splice(p.children.indexOf(n), 1)
  p.options = p.options.filter((o) => o !== n)
  n.parent = null
}

const { createApp } = createRenderer<FakeNode, FakeNode>({
  createElement: (tag) => new FakeNode(tag),
  createText: (text) => Object.assign(new FakeNode('#text'), { text }),
  createComment: (text) => Object.assign(new FakeNode('#comment'), { text }),
  setText: (n, text) => { n.text = text },
  setElementText: (el, text) => {
    for (const c of [...el.children]) detach(c)
    if (text) {
      const t = Object.assign(new FakeNode('#text'), { text })
      t.parent = el
      el.children.push(t)
    }
  },
  insert: (child, parent, anchor) => {
    detach(child)
    child.parent = parent
    const i = anchor ? parent.children.indexOf(anchor) : -1
    if (i >= 0) parent.children.splice(i, 0, child)
    else parent.children.push(child)
    if (parent.tag === 'select' && child.tag === 'option') parent.options = parent.children.filter((c) => c.tag === 'option')
  },
  remove: detach,
  parentNode: (n) => n.parent,
  nextSibling: (n) => {
    const s = n.parent?.children
    return s ? s[s.indexOf(n) + 1] ?? null : null
  },
  querySelector: () => null,
  setScopeId: (el, id) => { el.attrs[id] = '' },
  patchProp: (el, key, prev, next) => {
    if (/^on[A-Z]/.test(key)) {
      // One listener per prop, replaced on each patch, as the DOM renderer's invoker does.
      const type = key.slice(2).toLowerCase()
      for (const fn of [prev].flat()) if (typeof fn === 'function') el.removeEventListener(type, fn as Listener)
      for (const fn of [next].flat()) if (typeof fn === 'function') el.addEventListener(type, fn as Listener)
      return
    }
    if (key === 'value') el.value = next
    if (key === 'type') el.type = String(next ?? '')
    if (next == null) delete el.attrs[key]
    else el.attrs[key] = next
  },
})

/**
 * Mounts `component` on a fresh root. `setup` runs on the app first, for
 * plugins (Pinia, a router) and config.
 */
export function mount(component: Component, setup: (app: App<FakeNode>) => void = () => {}) {
  const root = new FakeNode('#root')
  const app = createApp(component)
  setup(app)
  app.mount(root)
  return { app, root, unmount: () => app.unmount() }
}

/**
 * The few `document` members the mounted views and v-model touch (the clock's
 * visibility listener, the focused element, <html lang>), and the two classes
 * v-model tests an element's root against. Returns the undo.
 */
export function installDocument(): () => void {
  const g = globalThis as Record<string, unknown>
  const stubs: Record<string, unknown> = {
    document: {
      hidden: false, visibilityState: 'visible', activeElement: null, documentElement: { lang: '' },
      addEventListener() {}, removeEventListener() {},
    },
    Document: class {},
    ShadowRoot: class {},
  }
  const before = Object.keys(stubs).map((k) => [k, k in g, g[k]] as const)
  Object.assign(g, stubs)
  return () => { for (const [k, had, v] of before) { if (had) g[k] = v; else delete g[k] } }
}
