import { describe, expect, it } from 'vitest'
import { computed, effectScope, nextTick, ref } from 'vue'
import { useHeldWhileLoading } from './holdWhileLoading'

/**
 * The dashboard's list while a refresh runs. Forecasts arrive a few spots at
 * a time and the list is score-sorted, so rendering it live made the cards
 * reorder several times mid-refresh.
 */
function setup(initial: number[], loadingAtStart = false) {
  const input = ref(initial)
  const loading = ref(loadingAtStart)
  let evals = 0
  const scope = effectScope()
  // Stands in for the scored list: each evaluation is a full scoring pass.
  const live = computed(() => { evals++; return [...input.value] })
  const shown = scope.run(() => useHeldWhileLoading(() => live.value, () => loading.value))!
  return { input, loading, shown, evals: () => evals, stop: () => scope.stop() }
}

describe('useHeldWhileLoading', () => {
  it('follows the live list while nothing loads', async () => {
    const s = setup([1, 2])
    expect(s.shown.value).toEqual([1, 2])
    s.input.value = [3, 1, 2]
    await nextTick()
    expect(s.shown.value).toEqual([3, 1, 2])
    s.stop()
  })

  it('holds the list on screen while loading, and takes the new one in one step when it ends', async () => {
    const s = setup([1, 2])
    expect(s.shown.value).toEqual([1, 2])
    s.loading.value = true
    await nextTick()
    for (const next of [[2, 1], [5, 2, 1], [5, 1, 2]]) {
      s.input.value = next
      await nextTick()
      expect(s.shown.value).toEqual([1, 2])
    }
    s.loading.value = false
    await nextTick()
    expect(s.shown.value).toEqual([5, 1, 2])
    // ...and the next refresh holds that one.
    s.loading.value = true
    s.input.value = [9]
    await nextTick()
    expect(s.shown.value).toEqual([5, 1, 2])
    s.stop()
  })

  it('with nothing on screen yet (the first load) shows the list as it fills', async () => {
    const s = setup([], true)
    expect(s.shown.value).toEqual([])
    s.input.value = [4]
    await nextTick()
    expect(s.shown.value).toEqual([4])
    s.input.value = [4, 7]
    await nextTick()
    expect(s.shown.value).toEqual([4, 7])
    s.loading.value = false
    await nextTick()
    expect(s.shown.value).toEqual([4, 7])
    s.loading.value = true // a later refresh holds what the first load ended on
    s.input.value = [1]
    await nextTick()
    expect(s.shown.value).toEqual([4, 7])
    s.stop()
  })

  // Each forecast landing during a refresh scored every window (~100 ms on 18
  // spots) for a list nobody saw: the held one was on screen.
  it('does not compute the live list while the held one is on screen', async () => {
    const s = setup([1, 2])
    void s.shown.value
    s.loading.value = true
    await nextTick()
    void s.shown.value
    const before = s.evals()
    for (let i = 3; i <= 7; i++) {
      s.input.value = [i, 1, 2]
      await nextTick()
      void s.shown.value
    }
    expect(s.evals()).toBe(before)
    s.loading.value = false
    await nextTick()
    expect(s.shown.value).toEqual([7, 1, 2])
    expect(s.evals()).toBe(before + 1)
    s.stop()
  })
})
