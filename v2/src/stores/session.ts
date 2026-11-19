import { t } from '@/lib/i18n'
import { disableNotifications } from '@/lib/notifications'
import { accountIs, forgetAccountData } from '@/lib/forgetOnLogout'
import { clearToasts } from '@/lib/toast'
import { useAuthStore } from './auth'
import { useSetupStore } from './setup'
import { useCatchStore } from './catches'
import { useForecastStore } from './forecast'
import { useCoastStore } from './coast'

/** How often a window that stays visible re-pulls both documents. */
export const RESYNC_EVERY_MS = 5 * 60_000

/** The documents another tab's save or wipe is reloaded from (onStorage). */
const SHARED_KEYS = ['fc2-setup', 'fc2-catches', 'fc2-coast']

/** What the device holds under `key`; null: nothing, or nothing can be read (site data blocked). */
function stored(key: string): string | null {
  try { return globalThis.localStorage.getItem(key) } catch { return null }
}

/**
 * Which account the setup + catch stores hold, and the one place that
 * (re)hydrates them: main.ts at boot and on every identity change, AuthView
 * before it routes, and the focus / reconnect / other-tab listeners.
 */
export function createSession() {
  // undefined = never hydrated; a signed-out start hydrates for null.
  let hydratedFor: string | null | undefined
  let current: Promise<void> | null = null
  let generation = 0

  /**
   * Load the account's state and only then arm sync — also on the password-
   * recovery path (the recovery token is a valid session): pulling nothing
   * while leaving sync armed would let the first edit afterwards overwrite the
   * account. A failed pull still arms it: pushes wait for a successful pull
   * on their own (see setup.ts), so the session's edits aren't stranded.
   */
  function hydrate(userId: string | null): Promise<void> {
    const setup = useSetupStore()
    const catches = useCatchStore()
    const gen = ++generation
    const was = hydratedFor
    hydratedFor = userId
    setup.pauseSync()
    catches.pauseSync()
    const run = (async () => {
      if (was && userId !== was) {
        try { leave() } catch { /* as kept */ }
      }
      logOnScreen(userId)
      try {
        await Promise.all([setup.pullRemote(), catches.pullRemote()])
      } catch { /* a pull that throws is a failed pull — it used to skip markReady for the whole session */ }
      // Superseded: the identity changed mid-pull, and the newer hydration
      // arms sync once ITS pulls are done.
      if (gen !== generation) return
      setup.markReady() // from here on, local edits sync to Supabase
      catches.markReady()

      // After hydration: give custom locations the species data they need to earn
      // the spot-relevance bonus (otherwise they score below an official spot in
      // the same place). Runs after markReady so the result syncs.
      setup.enrichMissingSpecies()
    })()
    current = run
    run.then(() => { if (current === run) current = null })
    return run
  }

  /**
   * Whose catch log the page holds, as the work begun for it goes by
   * (lib/forgetOnLogout): the account signed in; signed out, the one the log
   * on the device belongs to (null: a guest's). Out of an account without a
   * logout here, that work keeps nothing once the log is no longer the
   * account's: another tab's logout took it, or another account's took its
   * place. A token refresh the server refused leaves it, and the work for
   * it goes on.
   */
  function logOnScreen(signedIn: string | null) {
    accountIs(signedIn ?? useCatchStore().account)
  }

  /**
   * Hydrate for this identity unless that's already done or under way. Signing
   * in used to pull twice — main.ts's watcher and AuthView each ran one — and
   * the later adopt landed after sync was armed, so it was pushed back as an edit.
   */
  function hydrateFor(userId: string | null): Promise<void> {
    if (userId === hydratedFor) return current ?? Promise.resolve()
    return hydrate(userId)
  }

  /**
   * Out of the account the stores hold, and not by this page's logout
   * (which wiped both): signed out in another tab, or by a token refresh the
   * server refused. Or, back from the back/forward cache on a device that
   * keeps nothing, straight into the account another tab signed in to
   * meanwhile: the page never showed signed out, and an account with no
   * rows yet leaves another account's document as it is. The page keeps
   * what the device holds, as a page opened now would show it. A logout
   * elsewhere removed the documents there, and the storage listener (or,
   * back from the back/forward cache, the replay in listen) reloaded that.
   * A document the device holds no copy of (site data blocked, or its save
   * refused) lives only in this page: no storage event tells it of that
   * logout, and it showed the account's spots and catches to whoever used
   * the page next. It goes, unless it holds an edit no account has: that is
   * its only copy, and signing in to the account again sends it.
   */
  function leave() {
    const setup = useSetupStore()
    const catches = useCatchStore()
    // Asked, not flushed: signed out a flush sends nothing, and in another
    // account it would pull that account's row first.
    if (!setup.unsynced() && stored('fc2-setup') === null) {
      setup.clear()
      // The coasts derived at those spots' coordinates, unless the device keeps them.
      if (stored('fc2-coast') === null) useCoastStore().clear()
    }
    if (!catches.unsynced() && stored('fc2-catches') === null) catches.clear()
  }

  /**
   * Re-pull both documents. Pulls used to run only at page load and sign-in,
   * so a tab or phone PWA left open for days pushed its stale copy wholesale
   * over edits another device had made since. A pull already gives the right
   * answer — adopt a row another device moved on, push this device's unsynced
   * edits, or merge the two — and it also retries a hydration pull that failed.
   */
  function resync(): Promise<void> {
    const auth = useAuthStore()
    // Only for the account the stores hold, and not mid-hydration (which pulls anyway).
    if (!auth.user || current || hydratedFor !== auth.user.id) return Promise.resolve()
    return Promise.all([useSetupStore().pullRemote({ quiet: true }), useCatchStore().pullRemote()]).then(() => {}, () => {})
  }

  /** Another tab saved or wiped a document: reload it instead of overwriting it. */
  function onStorage(e: { key: string | null }) {
    if (e.key === 'fc2-setup') useSetupStore().reloadLocal()
    else if (e.key === 'fc2-catches') {
      useCatchStore().reloadLocal()
      logOnScreen(useAuthStore().user?.id ?? null)
    } else if (e.key === 'fc2-coast') useCoastStore().reloadLocal()
  }

  /** Wire the re-pull and other-tab triggers; returns the undo. */
  function listen(win: EventTarget, doc: EventTarget & { visibilityState: string }): () => void {
    /** From a pagehide into the back/forward cache until the page is back: what the device held of each document then. */
    let away: Map<string, string | null> | null = null
    /** Back from the cache, the read of the session the re-pull waits for. */
    let returning: Promise<void> | null = null
    const onVisible = () => {
      if (doc.visibilityState !== 'visible') return
      if (away) { back(); return }
      if (returning) return // it re-pulls once the session is read
      // Offline a pull can only fail (and toast); 'online' covers coming back.
      if (globalThis.navigator?.onLine !== false) resync()
    }
    /**
     * A page in the back/forward cache hears nothing: not another tab's save
     * or wipe (its storage events), nor a sign-out there. Back, it showed the
     * signed-out account's spots and catches, and stayed signed in when the
     * session was on the device (auth-js says nothing then). So the documents
     * the device holds now are reloaded where they changed, as their storage
     * events would have, and the session is read again before the re-pull:
     * signed out meanwhile, the page pulls nothing. Shown first, then
     * pageshow (HTML: reactivate a Document); either starts it, once.
     * Nothing changed: nothing reloads, and it re-pulls once, as at any
     * return.
     */
    function back() {
      if (!away) return
      const was = away
      away = null
      for (const [key, value] of was) if (stored(key) !== value) onStorage({ key })
      const read = useAuthStore().recheck()
      returning = read
      void read.then(() => {
        if (returning === read) returning = null
        onVisible()
      })
    }
    const onPageHide = (e: Event) => {
      if ((e as Event & { persisted?: boolean }).persisted) away = new Map(SHARED_KEYS.map((key) => [key, stored(key)]))
    }
    const onPageShow = (e: Event) => { if ((e as Event & { persisted?: boolean }).persisted) back() }
    const onOnline = () => { resync() }
    const onStorageEvent = (e: Event) => onStorage(e as StorageEvent)
    doc.addEventListener('visibilitychange', onVisible)
    win.addEventListener('pagehide', onPageHide)
    win.addEventListener('pageshow', onPageShow)
    win.addEventListener('online', onOnline)
    win.addEventListener('storage', onStorageEvent)
    // A window that stays visible — a desktop browser never minimised, a lock
    // screen the browser doesn't report as hidden — fires neither of those,
    // and under last-write-wins its next edit pushed its days-old copy over
    // the phone's work. The merge keeps both now, but such a window should
    // still show the phone's work, and an edit built on the current row needs
    // no merge at all. Re-pull when the window regains focus, and every few
    // minutes while it's visible.
    win.addEventListener('focus', onVisible)
    const timer = setInterval(onVisible, RESYNC_EVERY_MS)
    return () => {
      doc.removeEventListener('visibilitychange', onVisible)
      win.removeEventListener('pagehide', onPageHide)
      win.removeEventListener('pageshow', onPageShow)
      win.removeEventListener('online', onOnline)
      win.removeEventListener('storage', onStorageEvent)
      win.removeEventListener('focus', onVisible)
      clearInterval(timer)
    }
  }

  /**
   * Log out without destroying what only this device holds. Logout wipes both
   * documents, and used to do so at once: an edit still waiting in its push
   * debounce, or one whose push had failed offline, was erased — even when
   * signOut itself had failed and the next start signed straight back in.
   * Push first; if something still couldn't be sent, ask; if signing out
   * fails, keep everything.
   */
  async function logout(confirm: (message: string) => Promise<boolean>): Promise<'done' | 'cancelled' | 'failed'> {
    const setup = useSetupStore()
    const catches = useCatchStore()
    const synced = await Promise.all([setup.flush(), catches.flush()])
    if (synced.includes(false) && !(await confirm(t('auth_logout_unsynced')))) return 'cancelled'
    if (!(await useAuthStore().signOut())) return 'failed'
    // Wipe this account's data locally so the next user on this device doesn't
    // inherit it (and can't accidentally push it into their own account).
    setup.clear()
    catches.clear()
    // ...and the device caches built from it: the weather is keyed by the old
    // account's location ids and holds its spots' tide-station data (plus the
    // map compare's official-spot cache), and reminders stayed switched on for
    // whoever signed in next. Only on 'done' — a failed or cancelled logout
    // keeps the account, so it keeps these too.
    useForecastStore().clearWeather()
    // The derived coasts are keyed by the old account's spot coordinates.
    useCoastStore().clear()
    // What the catch log keeps outside the stores: the bite-scores (scored at
    // its spots, for its entries) and the unsaved form, which a form still
    // open may not put back.
    forgetAccountData()
    disableNotifications()
    // …and what's on screen: a sticky "offline — Prøv igen" outlived it, and
    // its Retry fetched the old account's spots back into fc2-forecasts.
    clearToasts()
    return 'done'
  }

  return { hydrate, hydrateFor, resync, onStorage, listen, logout }
}

export const session = createSession()
