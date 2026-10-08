import { onScopeDispose, ref, type Ref } from 'vue'

/**
 * The local calendar day `offset` days on from the instant `ms`, in the app's
 * day encoding: UTC midnight of the LOCAL date parts — what ScoredWindow.date
 * holds. Deriving it from the UTC date instead put yesterday under "I dag" for
 * the first hour or two after midnight in Denmark.
 */
export function localDayUTC(ms: number, offset = 0): number {
  const n = new Date(ms)
  return Date.UTC(n.getFullYear(), n.getMonth(), n.getDate() + offset)
}

/**
 * `Date.now()` as a ref that ticks every `everyMs`, for computeds that depend
 * on the time — a bare `new Date()` inside a computed freezes at whenever it
 * first ran, so a tab left open kept showing the morning's conditions. Also
 * re-read the moment the page is visible again: background tabs throttle
 * timers, and a phone woken in the morning would otherwise show last night's
 * "now" until the next tick. Stops with the calling component.
 */
export function useNow(everyMs = 60_000): Ref<number> {
  const now = ref(Date.now())
  const tick = () => { now.value = Date.now() }
  const timer = setInterval(tick, everyMs)
  const onVisible = () => { if (!document.hidden) tick() }
  document.addEventListener('visibilitychange', onVisible)
  onScopeDispose(() => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisible)
  })
  return now
}
