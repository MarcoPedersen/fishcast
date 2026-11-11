/*
 * What a tap on a FishCast reminder does: bring an open FishCast window
 * forward, or open FishCast at the dashboard.
 *
 * Reminders are shown through the service worker (src/lib/notifications.ts),
 * and the worker vite-plugin-pwa generates has no notificationclick handler,
 * so a tap did nothing. The generated worker loads this file with
 * importScripts (vite.config.ts, workbox.importScripts). It is a classic
 * worker script, copied to dist/ as is: no imports, no exports. The test
 * (src/lib/swNotify.test.ts) runs it against a fake `self`.
 */
const fishcastReminderTap = {
  /**
   * The page a tap opens: the one the reminder names (data.url), if it is
   * inside FishCast's scope, else the dashboard.
   */
  target(data, scope) {
    const home = scope + '#/dashboard'
    if (!data || typeof data.url !== 'string') return home
    try {
      const url = new URL(data.url, scope).href
      return url.startsWith(scope) ? url : home
    } catch (e) {
      return home
    }
  },

  /**
   * Which open window to bring forward: FishCast's own only (the old app
   * shares the origin, at /fishcast/), the one in use first, then a visible
   * one; none when FishCast is not open. `url` is where to open it then.
   */
  plan(windows, data, scope) {
    const ours = windows.filter((w) => typeof w.url === 'string' && w.url.startsWith(scope))
    const focus = ours.find((w) => w.focused) || ours.find((w) => w.visibilityState === 'visible') || ours[0]
    return { focus, url: this.target(data, scope) }
  },

  async handle(sw, data) {
    const scope = sw.registration.scope
    // Uncontrolled too: a window opened before this worker took over is still FishCast.
    const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const p = this.plan(windows, data, scope)
    if (p.focus) {
      try {
        await p.focus.focus()
        return
      } catch (e) {
        // Closed meanwhile, or the browser refused: open one instead.
      }
    }
    await sw.clients.openWindow(p.url)
  },
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(fishcastReminderTap.handle(self, event.notification.data))
})
