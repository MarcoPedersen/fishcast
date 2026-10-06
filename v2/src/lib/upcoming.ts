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
