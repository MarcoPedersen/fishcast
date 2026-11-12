/**
 * A cue that a sideways-scrolling strip has more than it shows.
 *
 * On a phone the topbar nav (App.vue) and the dashboard's tab bar
 * (DashboardView.vue) scroll sideways with their scrollbars hidden, and
 * nothing said so: at 375 px Find pladser and Fangstlog sat off-screen, and
 * the 4th tab, "Vejr & Bølger", wholly beyond the edge. The strip now fades
 * out at an edge with more beyond it (style.css .edge-fade-start/-end, a
 * mask), only while it overflows that way; and the page or tab in use is
 * scrolled clear of the fade. Where everything fits (the desktop) nothing
 * changes.
 */
import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

/** How wide the fade is; style.css uses the same 40px. */
export const EDGE_FADE_PX = 40

/**
 * Which edges have content beyond them. scrollWidth is rounded and
 * scrollLeft is not, so a remainder under a pixel counts as none.
 */
export function overflowEdges(scrollLeft: number, scrollWidth: number, clientWidth: number) {
  return {
    start: scrollLeft >= 1,
    end: scrollLeft + clientWidth < scrollWidth - 1,
  }
}

/**
 * The scrollLeft that shows an item whole and clear of the fade, moving the
 * strip as little as possible, within the strip's range. Positions are in
 * the strip's content coordinates (0 = its scrolled-out start).
 */
export function revealScrollLeft(o: {
  scrollLeft: number; clientWidth: number; scrollWidth: number; itemLeft: number; itemWidth: number
}): number {
  const max = Math.max(0, o.scrollWidth - o.clientWidth)
  let left = o.scrollLeft
  if (o.itemLeft - EDGE_FADE_PX < left) left = o.itemLeft - EDGE_FADE_PX
  else if (o.itemLeft + o.itemWidth + EDGE_FADE_PX > left + o.clientWidth) left = o.itemLeft + o.itemWidth + EDGE_FADE_PX - o.clientWidth
  return Math.min(max, Math.max(0, Math.round(left)))
}

/**
 * The item a "more this way" cue brings into view: the first that runs on
 * past the strip's visible end (dir 1), or the last that starts before its
 * visible start (dir -1); -1 when every item shows whole that way. Positions
 * are in the strip's content coordinates; as in overflowEdges, an overhang
 * under a pixel counts as none.
 */
export function hiddenItem(dir: 1 | -1, items: { left: number; width: number }[], scrollLeft: number, clientWidth: number): number {
  if (dir > 0) return items.findIndex((it) => it.left + it.width > scrollLeft + clientWidth + 1)
  for (let i = items.length - 1; i >= 0; i--) if (items[i].left < scrollLeft - 1) return i
  return -1
}

/**
 * Keeps `el`'s fade classes in step with its scroll position and size: on
 * scroll, and when it or a child changes size (a label in the other language,
 * a badge) or comes into being. Both arrive after layout, so reading the
 * sizes forces none. `reveal(item)` scrolls the strip itself — never the
 * page — so `item` is in view clear of the fade; an item focused from the
 * keyboard is revealed the same way. `start`/`end` say whether there is more
 * before or after, for a cue beside the strip, and `step(dir)` is that cue's
 * tap: the strip moves about one item that way.
 */
export function useEdgeFade(el: Ref<HTMLElement | null>) {
  const start = ref(false)
  const end = ref(false)
  let resize: ResizeObserver | undefined
  let mutate: MutationObserver | undefined

  function measure() {
    const e = el.value
    if (!e) return
    // A strip that doesn't scroll (the wrapping desktop nav) never fades, even
    // if something such as a badge pokes out past its edge.
    const scrolls = getComputedStyle(e).overflowX !== 'visible'
    const o = overflowEdges(e.scrollLeft, e.scrollWidth, e.clientWidth)
    start.value = scrolls && o.start
    end.value = scrolls && o.end
  }
  // Observing a box reports its size once at the start, so a child that comes
  // (the setup's four nav buttons) is measured with the rest.
  function observeAll(e: HTMLElement) {
    if (!resize) return
    resize.disconnect()
    resize.observe(e)
    for (const child of Array.from(e.children)) resize.observe(child)
  }

  // Tabbing along the strip, the focused item is brought clear of the fade:
  // the browser's own focus scroll stops it at the edge, under the fade.
  // Keyboard focus only (:focus-visible): a tap opens a page that is revealed
  // anyway, and moving the strip under a finger could move what it taps.
  function onFocus(ev: Event) {
    const t = ev.target as Element | null
    let keyboard = false
    try { keyboard = !!t?.matches(':focus-visible') } catch { /* no :focus-visible: the browser's own scroll */ }
    if (keyboard && t !== el.value) reveal(t)
  }

  onMounted(() => {
    const e = el.value
    if (!e) return
    e.addEventListener('scroll', measure, { passive: true })
    e.addEventListener('focusin', onFocus)
    if (typeof ResizeObserver !== 'undefined') {
      resize = new ResizeObserver(measure)
      observeAll(e)
    } else measure()
    if (typeof MutationObserver !== 'undefined') {
      mutate = new MutationObserver(() => observeAll(e))
      mutate.observe(e, { childList: true })
    }
  })
  onBeforeUnmount(() => {
    el.value?.removeEventListener('scroll', measure)
    el.value?.removeEventListener('focusin', onFocus)
    resize?.disconnect()
    mutate?.disconnect()
  })

  /** Where `item` sits in the strip's content coordinates; `box` is the strip's own. */
  function place(e: HTMLElement, box: DOMRect, item: Element) {
    const it = item.getBoundingClientRect()
    return { left: it.left - box.left - e.clientLeft + e.scrollLeft, width: it.width }
  }

  /** Scrolls the strip itself to `left`, smoothly unless motion is reduced; not for under a pixel. */
  function scrollStrip(e: HTMLElement, left: number) {
    if (Math.abs(left - e.scrollLeft) < 1) return
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    e.scrollTo({ left, behavior: still ? 'auto' : 'smooth' })
  }

  function reveal(item: Element | null | undefined) {
    const e = el.value
    if (!e || !item || e.scrollWidth <= e.clientWidth) return
    const at = place(e, e.getBoundingClientRect(), item)
    scrollStrip(e, revealScrollLeft({
      scrollLeft: e.scrollLeft, clientWidth: e.clientWidth, scrollWidth: e.scrollWidth,
      itemLeft: at.left, itemWidth: at.width,
    }))
  }

  // A cue's tap: the next item hidden that way comes into view, clear of the
  // fade, as when it is chosen. The fade and the cues follow the scroll.
  // With no item hidden that way (only the strip's own padding), to the end.
  function step(dir: 1 | -1) {
    const e = el.value
    if (!e) return
    const box = e.getBoundingClientRect()
    const items = Array.from(e.children)
    const i = hiddenItem(dir, items.map((c) => place(e, box, c)), e.scrollLeft, e.clientWidth)
    if (i >= 0) reveal(items[i])
    else scrollStrip(e, dir > 0 ? Math.max(0, e.scrollWidth - e.clientWidth) : 0)
  }

  const fadeClass = computed(() => ({ 'edge-fade-start': start.value, 'edge-fade-end': end.value }))
  return { fadeClass, start, end, reveal, step }
}
