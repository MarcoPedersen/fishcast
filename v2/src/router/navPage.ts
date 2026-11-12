/**
 * Which topbar button marks a page as the current one (aria-current, and
 * the nav scrolls it into view: App.vue). A page that has no button of its
 * own names the one it belongs to in its route's meta: the setup map
 * (#/setup/map, titled "📍 Lokationer", reached from the spot list) is
 * Lokationer. Without it no button was marked there.
 */
import type { RouteMeta } from 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    /** The topbar entry this page belongs to, when it has none of its own. */
    nav?: string
  }
}

/** `route`: the current route, or one the router resolved. */
export function navPage(route: { name?: unknown; meta: RouteMeta }): string | undefined {
  return route.meta.nav ?? (typeof route.name === 'string' ? route.name : undefined)
}
