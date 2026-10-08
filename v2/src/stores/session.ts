import { t } from '@/lib/i18n'
import { disableNotifications } from '@/lib/notifications'
import { useAuthStore } from './auth'
import { useSetupStore } from './setup'
import { useCatchStore } from './catches'
import { useForecastStore } from './forecast'

/** How often a window that stays visible re-pulls both documents. */
export const RESYNC_EVERY_MS = 5 * 60_000

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
    hydratedFor = userId
    setup.pauseSync()
    catches.pauseSync()
    const run = (async () => {
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
   * Hydrate for this identity unless that's already done or under way. Signing
   * in used to pull twice — main.ts's watcher and AuthView each ran one — and
   * the later adopt landed after sync was armed, so it was pushed back as an edit.
   */
  function hydrateFor(userId: string | null): Promise<void> {
    if (userId === hydratedFor) return current ?? Promise.resolve()
    return hydrate(userId)
  }

  /**
   * Re-pull both documents. Pulls used to run only at page load and sign-in,
   * so a tab or phone PWA left open for days pushed its stale copy wholesale
   * over edits another device had made since. reconcile() already gives the
   * right answer — take the newer row, or keep and push this device's newer
   * edits — and it also retries a hydration pull that failed.
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
    else if (e.key === 'fc2-catches') useCatchStore().reloadLocal()
  }

  /** Wire the re-pull and other-tab triggers; returns the undo. */
  function listen(win: EventTarget, doc: EventTarget & { visibilityState: string }): () => void {
    const onVisible = () => {
      // Offline a pull can only fail (and toast); 'online' covers coming back.
      if (doc.visibilityState === 'visible' && globalThis.navigator?.onLine !== false) resync()
    }
    const onOnline = () => { resync() }
    const onStorageEvent = (e: Event) => onStorage(e as StorageEvent)
    doc.addEventListener('visibilitychange', onVisible)
    win.addEventListener('online', onOnline)
    win.addEventListener('storage', onStorageEvent)
    // A window that stays visible — a desktop browser never minimised, a lock
    // screen the browser doesn't report as hidden — fires neither of those,
    // and its next edit pushed its days-old copy over the phone's work.
    // reconcile can't catch that: the edit is the newest stamp, so keep-local
    // wins. Re-pull when the window regains focus, and every few minutes
    // while it's visible, so edits build on the current row.
    win.addEventListener('focus', onVisible)
    const timer = setInterval(onVisible, RESYNC_EVERY_MS)
    return () => {
      doc.removeEventListener('visibilitychange', onVisible)
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
    disableNotifications()
    return 'done'
  }

  return { hydrate, hydrateFor, resync, onStorage, listen, logout }
}

export const session = createSession()
