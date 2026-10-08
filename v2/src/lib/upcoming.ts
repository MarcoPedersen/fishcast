import { computed, type ComputedRef } from 'vue'
import { isOvernight } from './scoring'
import type { ScoredWindow } from './types'

/**
 * Stable identity for a window card. The end time is part of it: the
 * availability editor allows two rows with the same start ("every day
 * 06:00–09:00" and "Sat+Sun 06:00–14:00"), and keyed on the start alone their
 * cards shared one v-for key and one set of open panels / "copied" ticks.
 * Matches the key getScoredWindows de-duplicates on.
 */
export function windowKey(w: ScoredWindow): string {
  return `${w.location.id}|${w.date.getTime()}|${w.from}-${w.to}`
}

const endCache = new WeakMap<ScoredWindow, number>()
/**
 * The instant a window ends. Anchored the way scoreWindow anchors its hours:
 * the date carries the local calendar day in its UTC parts, the time is local
 * wall-clock. An overnight window (end before start) ends the next morning.
 * Cached per window object — scoring hands out fresh objects on every
 * recompute, so an entry can't go stale.
 */
export function windowEndMs(w: ScoredWindow): number {
  let end = endCache.get(w)
  if (end === undefined) {
    const [h, m] = w.to.split(':').map(Number)
    const d = w.date
    end = new Date(
      d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + (isOvernight(w.from, w.to) ? 1 : 0), h || 0, m || 0,
    ).getTime()
    endCache.set(w, end)
  }
  return end
}

/**
 * The local day (app encoding, like `today`) a window is listed under. Its own
 * date — except last night's overnight window, which getScoredWindows hands
 * back (dated yesterday) while it is still running: keyed on its own date it
 * fell before the week strip's first day and outside a "today" day filter, so
 * at 00:30 the one window you could fish right then showed under no day at all.
 */
export function listedDay(w: ScoredWindow, today: number): number {
  const d = w.date.getTime()
  return d < today && isOvernight(w.from, w.to) ? today : d
}

/**
 * Best score per location among the windows listed under `today` (a local day,
 * see clock.ts localDayUTC) — the setup map's pin colours. Feed it windows
 * that haven't ended (useNotEnded); windows without data don't count.
 */
export function bestTodayByLocation(windows: ScoredWindow[], today: number): Map<string, number> {
  const m = new Map<string, number>()
  for (const w of windows) {
    if (w.noData || listedDay(w, today) !== today) continue
    m.set(w.location.id, Math.max(m.get(w.location.id) ?? 0, w.score))
  }
  return m
}

/**
 * The windows that haven't ended yet. Scoring lists every window of today
 * whatever the time, so at 15:00 this morning's 05:00–10:00 session was still
 * the 🏆 top pick and a map pin.
 *
 * Produces a new array only when a window actually ends (or the list itself
 * changes), not on every tick of `now`: the map tab re-renders its pins
 * whenever the array it's handed changes.
 */
export function useNotEnded(windows: () => ScoredWindow[], now: () => number): ComputedRef<ScoredWindow[]> {
  // The latest end that has already passed. A number, so a tick that ends
  // nothing leaves it — and everything computed from it — untouched.
  const passedEnd = computed(() => {
    const n = now()
    let latest = -Infinity
    for (const w of windows()) {
      const end = windowEndMs(w)
      if (end <= n && end > latest) latest = end
    }
    return latest
  })
  return computed(() => {
    const cut = passedEnd.value
    return windows().filter((w) => windowEndMs(w) > cut)
  })
}
