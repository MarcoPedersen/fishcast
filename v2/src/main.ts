import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'
import { START_LOCATION } from 'vue-router'
import App from './App.vue'
import router from './router'
import { supabase } from './lib/supabase'
import { authStorage } from './lib/authStorage'
import { useAuthStore } from './stores/auth'
import { useSetupStore } from './stores/setup'
import { useCatchStore } from './stores/catches'
import { useLocalSaveStore } from './stores/localSave'
import { session } from './stores/session'
import { claimChunkReload, isChunkLoadError, mayClaimChunkReload } from './lib/staleChunk'
import { englishLoadFailed, hasEnglish, lang, langReady, shownLang, t } from './lib/i18n'
import { dismissKeyed, showToast, toasts } from './lib/toast'
import { dropOldTileCache } from './lib/osmTiles'
import { storageBlocked } from './lib/safeStorage'
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
router.onError((err, to) => { if (isChunkLoadError(err)) reloadIntoNewBuild(to.fullPath) })

// …and without waiting for a chunk to fail: a new deploy is looked for when
// the app comes back and hourly, and applied when nothing can be lost — see
// swUpdate.ts. An installed PWA resumed from the background used to run the
// old build until a launch after the next one.
// What lives only in this page, across every screen, so that no reload may
// drop it, a move to another screen included: an edit the device couldn't
// save, and a toast with a Fortryd, which holds a spot's undo history
// (lib/undoHistory). The round E browser check lost three such toasts, and
// their histories, at a move to another screen. And a sign-in the device had
// no room for, or may not keep: lib/authStorage holds it in memory, and a
// reload signed the user out without a word.
const pageHolds = () => useLocalSaveStore().atRisk() || toasts.value.some((x) => !!x.action) || authStorage.inMemory
const updater = createUpdater({
  sw: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
  now: () => Date.now(),
  idle: () => nothingToLose(document, router.currentRoute.value.name),
  online: () => navigator.onLine !== false,
  // Nor what lives only in this page (pageHolds): no reload then.
  unsaved: pageHolds,
  // Nor while a password-recovery link waits for its new password: read
  // below, it is gone from the address, and the link may be single-use.
  recovering: () => useAuthStore().recovering,
  reload: reloadIntoNewBuild,
})

// A lazy chunk that failed (the build's preload wrapper). Deferred a tick so
// router.onError, which knows the target route, claims first — and so i18n
// has seen its own import fail. A screen's chunk reloads at once: the user
// is moving to that screen. The English table only costs the screen its
// language (Danish shows meanwhile), so its reload waits for a moment when
// nothing on screen can be lost, and never happens offline (chunkGone); a
// reload over the catch log's form, an open dialog or a Fortryd lost them.
// Any other chunk waits too while an unsaved edit or a recovery link lives
// only in the page: it may be one no tap asked for, such as the spot
// catalogue the coast store loads in the background a few seconds after a
// start, and reloading at once lost them.
/** The toasts that say why the page is still Danish after 🇬🇧. */
const EN_TOAST = 'lang-en'
window.addEventListener('vite:preloadError', (e) => {
  const err = (e as Event & { payload?: unknown }).payload
  setTimeout(() => {
    if (!englishLoadFailed(err)) {
      if (pageHolds() || useAuthStore().recovering) updater.chunkGone(() => true)
      else reloadIntoNewBuild()
      return
    }
    const wanted = () => lang.value === 'en' && !hasEnglish()
    // Danish again (🇩🇰 while it was on its way): no reload to wait for or announce.
    if (!wanted()) return
    const offline = navigator.onLine === false
    // A reload for a chunk loaded this page a minute ago or less, and English
    // failed again: that reload didn't bring it (the new build's own chunk is
    // missing, or the network fails while the browser says it's online), and
    // another won't. Waiting for one reloaded at every move to another screen,
    // once a minute, for as long as that lasted. A later tap on 🇬🇧 tries again.
    if (!offline && !mayClaimChunkReload()) { showToast(() => t('lang_en_failed'), { key: EN_TOAST }); return }
    if (updater.chunkGone(wanted)) return
    // Still Danish after a tap on 🇬🇧: say why, rather than seem to ignore it.
    showToast(() => t(offline ? 'lang_en_offline' : 'lang_en_later'), { key: EN_TOAST })
  }, 0)
})
// English that arrives after all (i18n tries again when the connection is
// back, or on 🇬🇧): the toast saying it couldn't be loaded goes. It stood for
// its 6 s over a page that was English again, and read in English.
watch(shownLang, (l) => { if (l === 'en') dismissKeyed(EN_TOAST) })

// A sign-in kept only in memory (lib/authStorage) ends when the app closes.
// The reloads the app makes wait for it (pageHolds), but nothing said so,
// and the next start was signed out. Said the first time, once per visit.
// It stands until it is closed: a 6 s toast is easy to miss on the page
// that opens after signing in. It goes once it is no longer so: signed out
// (in another tab too, or by a refused token refresh), or kept on the device
// again. It stood on, and told a signed-out user they were logged in.
const LOGIN_MEMORY_TOAST = 'login-memory'
let toldInMemory = false
watch(() => authStorage.inMemory, (held) => {
  if (!held) { dismissKeyed(LOGIN_MEMORY_TOAST); return }
  if (toldInMemory) return
  toldInMemory = true
  const key = storageBlocked() ? 'toast_login_memory_blocked' : 'toast_login_memory_full'
  showToast(() => t(key), { ttl: 0, key: LOGIN_MEMORY_TOAST })
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
