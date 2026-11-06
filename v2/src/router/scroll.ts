/**
 * Where a page opens. Without this the router kept the document's scroll
 * offset from one page to the next: "Vis fiskeforhold →", at the foot of the
 * long species list, landed on the dashboard scrolled to the moon card and
 * the footer — the first thing a new user saw of their forecast.
 */
import type { RouterScrollBehavior } from 'vue-router'

/** A new page at the top; back and forward where it was; a query change on the same page (a share link cleared) where it is. */
export const scrollBehavior: RouterScrollBehavior = (to, from, saved) => {
  if (saved) return saved
  if (to.path === from.path) return false
  return { top: 0 }
}
