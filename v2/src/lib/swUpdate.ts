/**
 * Bringing an open app onto a new deploy.
 *
 * The service worker auto-updates (vite.config.ts: skipWaiting and
 * clientsClaim), so a new build's worker takes control of an open page as
 * soon as it is found — and the page went on running the old build. It got
 * the new one only when a chunk it hadn't loaded yet was gone (staleChunk.ts),
 * or not at all while the old chunks still sat in the HTTP cache. A cold
 * start after a deploy ran the old build from the old worker's precache, and
 * a PWA resumed from the background never even asked for an update: a
 * regulations change or a scoring fix reached the phone a launch late.
 *
 * Now the app looks for a new build when it comes back to the screen and
 * while it stays there (at most hourly; loading the page checks by itself),
 * and once a new build has taken over, reloads into it when nothing can be
 * lost, never in the middle of an edit:
 *  - at once, when it lands within GRACE_MS of the app being opened or coming
 *    back, before the user has touched anything, with nothing open;
 *  - when the app comes back to the screen, with nothing open;
 *  - else at the next move to another screen, which then loads from the new
 *    build — the old build's chunk for it may be gone anyway.
 */
export const GRACE_MS = 10_000
export const CHECK_EVERY_MS = 60 * 60_000

export interface UpdateHost {
  /** navigator.serviceWorker; absent where there is none (dev, an old browser, plain http). */
  sw?: {
    controller: unknown
    addEventListener(type: 'controllerchange', fn: () => void): void
    getRegistration(): Promise<{ update(): Promise<unknown> } | undefined>
  }
  now(): number
  /** A reload now would lose nothing on screen (nothingToLose). */
  idle(): boolean
  /** The browser has a connection (navigator.onLine); taken as yes when absent. */
  online?(): boolean
  /** Reload into the new build, at `path` when given; false when it can't (one just happened). */
  reload(path?: string): boolean
}

export function createUpdater(host: UpdateHost) {
  // A page no worker controlled is claimed by the first install: that is no new build.
  let controlled = !!host.sw?.controller
  let ready = false
  let openedAt = host.now()
  let touched = false
  // Loading the page made the browser check already.
  let checkedAt = host.now()
  // A chunk the screen can do without failed to load (chunkGone); asked
  // before each reload whether it is still wanted.
  let gone: (() => boolean) | null = null

  /** A reload is due: a new build took over, or a chunk is gone that is still wanted and could now be had. */
  const due = () => ready || (!!gone && host.online?.() !== false && gone())

  function check() {
    if (!host.sw || host.now() - checkedAt < CHECK_EVERY_MS) return
    checkedAt = host.now()
    host.sw.getRegistration()
      .then((r) => r?.update())
      .catch(() => { /* offline, or the worker script is unreachable: the next check */ })
  }

  host.sw?.addEventListener('controllerchange', () => {
    if (!controlled) { controlled = true; return }
    ready = true
    if (host.now() - openedAt < GRACE_MS && !touched && host.idle()) host.reload()
  })

  return {
    /** A new build has taken over this page. */
    get updateReady() { return ready },
    /** The user touched the page: from now on only a screen change or a return reloads. */
    touch() { touched = true },
    /** The app is on screen again. */
    resumed() {
      openedAt = host.now()
      touched = false
      if (due() && host.idle() && host.reload()) return
      check()
    },
    /** The window got focus (a desktop tab or window). */
    focused() { check() },
    /** Hourly while the app is on screen. */
    tick() { check() },
    /** Before a move to another screen: true when the new build loads it instead. */
    leaving(path: string): boolean { return due() && host.reload(path) },
    /**
     * A chunk failed to load that the screen can do without: the English
     * table (Danish shows meanwhile). After a deploy the build it belongs to
     * is gone from the server, and a reload brings the new one. Unlike a
     * screen's chunk, which the move to that screen reloads for at once
     * (main.ts), this waits like a new build: now only when nothing on screen
     * can be lost, else at the next return or move to another screen — and
     * never offline, where without a service worker the reload lands on the
     * browser's offline page. `stillWanted` is asked each time: English that
     * arrived meanwhile, or a switch back to Danish, needs no reload. True
     * when it reloads now.
     */
    chunkGone(stillWanted: () => boolean): boolean {
      gone = stillWanted
      return due() && host.idle() && host.reload()
    },
  }
}

/** Screens whose form lives in the page, not in a dialog: a reload would empty it. */
const FORM_SCREENS = new Set(['catchlog', 'auth'])
const TYPING = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]'

/**
 * True when a reload would lose nothing on screen: no dialog open, no field in
 * use, not a form screen, and no toast offering something (Toasts.vue `.act`:
 * "Fortryd", or "Tilføj" for an older log's catches, which is never offered
 * again).
 */
export function nothingToLose(
  doc: { querySelector(sel: string): unknown; activeElement: { matches(sel: string): boolean } | null },
  route: unknown,
): boolean {
  if (doc.querySelector('[aria-modal="true"]')) return false
  if (doc.querySelector('.toast .act')) return false
  if (doc.activeElement?.matches(TYPING)) return false
  return !FORM_SCREENS.has(String(route))
}
