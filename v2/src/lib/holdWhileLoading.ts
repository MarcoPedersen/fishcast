import { computed, shallowRef, watch, type ComputedRef } from 'vue'

/**
 * `live`, except while `loading` with a list already on screen: then that
 * list, until loading ends and the new one comes in in a single step. The
 * dashboard's forecasts arrive a few spots at a time and its list is
 * score-sorted, so rendering it live made the cards reorder several times
 * mid-refresh. With nothing on screen yet (the first load) the live list
 * shows as it fills.
 *
 * `live` is only read when it can be shown. Watched together with `loading`
 * it was computed on every input write during a refresh — a full scoring
 * pass each time a straggler's forecast or lightning landed — while the held
 * list was the one on screen.
 */
export function useHeldWhileLoading<T>(live: () => T[], loading: () => boolean): ComputedRef<T[]> {
  const held = shallowRef<T[]>([])
  watch(() => (loading() ? null : live()), (list) => { if (list) held.value = list }, { immediate: true })
  return computed(() => (loading() && held.value.length ? held.value : live()))
}
