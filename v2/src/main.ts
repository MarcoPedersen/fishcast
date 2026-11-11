import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'
import { START_LOCATION } from 'vue-router'
import App from './App.vue'
import router from './router'
import { supabase } from './lib/supabase'
import { useAuthStore } from './stores/auth'
import { useSetupStore } from './stores/setup'
import { useCatchStore } from './stores/catches'
import { session } from './stores/session'
import { claimChunkReload, isChunkLoadError } from './lib/staleChunk'
import { langReady } from './lib/i18n'
import { dropOldTileCache } from './lib/osmTiles'
import { createUpdater, nothingToLose } from './lib/swUpdate'
import './style.css'

const app = createApp(App)
app.use(createPinia())

// After a deploy the old build's lazy chunks are gone (see staleChunk.ts), and
// a tap on a screen not loaded yet did nothing. Reload into the new build.
function reloadIntoNewBuild(path?: string): boolean {
  if (!claimChunkReload()) return false
  // Land on the screen the user was opening, not the one they were leaving.
  if (path) history.replaceState(null, '', router.resolve(path).href)
  location.reload()
  return true
}
// Deferred a tick so router.onError, which knows the target route, claims first.
window.addEventListener('vite:preloadError', () => { setTimeout(() => reloadIntoNewBuild(), 0) })
router.onError((err, to) => { if (isChunkLoadError(err)) reloadIntoNewBuild(to.fullPath) })

// …and without waiting for a chunk to fail: a new deploy is looked for when
// the app comes back and hourly, and applied when nothing can be lost — see
// swUpdate.ts. An installed PWA resumed from the background used to run the
// old build until a launch after the next one.
const updater = createUpdater({
  sw: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
  now: () => Date.now(),
  idle: () => nothingToLose(document, router.currentRoute.value.name),
  reload: reloadIntoNewBuild,
})
// Another screen only (not a query change within one): the screen being left
// takes its page state with it anyway. The navigation is held, not refused,
// while the page reloads into its target: refused, a Back press would make
// the router step forward through history again, racing the reload.
router.beforeEach((to, from) =>
  from !== START_LOCATION && to.name !== from.name && updater.leaving(to.fullPath) ? new Promise<never>(() => {}) : true)
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') updater.resumed() })
window.addEventListener('focus', () => updater.focused())
for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => updater.touch(), { capture: true, passive: true })
setInterval(() => { if (document.visibilityState === 'visible') updater.tick() }, 5 * 60_000)

// Load local state BEFORE the router's initial navigation runs its guards
const setup = useSetupStore()
setup.loadLocal()
const catches = useCatchStore()
catches.loadLocal()
const auth = useAuthStore()

// The English strings are a chunk of their own (lib/i18n.ts), on their way
// since i18n loaded. For a user who picked English the first render waits
// for them, so the app doesn't appear in Danish and then flip — but no
// longer than this: a slow or failed fetch shows Danish, and the screen
// turns English when the table lands. (Precached, it takes milliseconds.)
const LANG_WAIT_MS = 1000

async function bootstrap() {
  // Handle a Supabase password-recovery token in the URL fragment BEFORE the
  // hash router initialises (otherwise the catch-all route clears it first).
  const h = window.location.hash
  if (supabase && h.includes('access_token') && h.includes('type=recovery')) {
    // Strip leading "#" and any "/" the hash router prepended, then parse params
    const p = new URLSearchParams(h.replace(/^#\/?/, ''))
    const access_token = p.get('access_token')
    const refresh_token = p.get('refresh_token') ?? ''
    if (access_token) {
      try { await supabase.auth.setSession({ access_token, refresh_token }) } catch { /* token invalid/expired */ }
      auth.recovering = true
      window.location.hash = '#/auth'
    }
  }

  // A resumed or refocused tab or PWA, one left open and visible, and a
  // returning connection re-pull; another tab's save is reloaded — instead of
  // a stale in-memory copy overwriting newer data. Before the wait below:
  // the stores are loaded, and a save another tab made while this one waited
  // for English went unheard, so this tab's first edit wrote over it.
  session.listen(window, document)

  await langReady(LANG_WAIT_MS)
  app.use(router)
  app.mount('#app')

  // Signing in mid-session is NOT a page load, and this used to be the only
  // place that pulled — so after logging in you saw an empty profile with sync
  // already armed, and the next edit pushed that blank over your real rows.
  // Re-hydrate whenever the signed-in identity changes. Registered before
  // auth.init(): when the boot hydration threw, it was never registered at all.
  watch(() => auth.user?.id ?? null, (id) => { session.hydrateFor(id) })

  await auth.init()
  await session.hydrateFor(auth.user?.id ?? null)
}

bootstrap()

// The map tiles' old cache: opaque copies at ~7–9 MB of quota each (lib/osmTiles.ts).
void dropOldTileCache()
