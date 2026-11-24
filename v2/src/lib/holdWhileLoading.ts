import { computed, shallowRef, watch, type ComputedRef, type WatchSource } from 'vue'

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
 *
 * `release` is what the user changes (the dashboard's spots, slots, targets
 * and language), watched deep. A change while loading takes the live list at
 * once and holds that one: a spot removed during a refresh kept its cards
 * until the refresh ended, and after a language switch the cards kept their
 * tags and tips in the old language. Left with nothing, the live list shows
 * as it fills, as on the first load.
 */
export function useHeldWhileLoading<T>(live: () => T[], loading: () => boolean, release?: WatchSource): ComputedRef<T[]> {
  const held = shallowRef<T[]>([])
  watch(() => (loading() ? null : live()), (list) => { if (list) held.value = list }, { immediate: true })
  if (release) watch(release, () => { if (loading() && held.value.length) held.value = live() }, { deep: true })
  return computed(() => (loading() && held.value.length ? held.value : live()))
}
