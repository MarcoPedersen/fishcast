/**
 * One undo history per key: the spot card's water-type toast, keyed by spot
 * (LocationsView setWater). Newest first, and only as long as its toast
 * stands. LocationsView.test.ts runs it on the mounted card.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { addStep, forgetSpot, undoStep } from './undoHistory'
import { clearToasts, dismissKeyed, showToast, toasts } from './toast'
import { forgetAccountData } from './forgetOnLogout'

let undone: string[] = []
/** A change named `name`: its undo is logged, and finds its spot unless `gone`. */
const step = (name: string, gone = false) => ({ said: () => name, undo: () => { undone.push(name); return !gone } })
/** The key's toast, standing: the view shows it with each step. */
const shown = (key: string) => showToast(key, { key, action: { label: 'Fortryd', run: () => {} } })

afterEach(() => { clearToasts(); undone = [] })

describe('one undo history per key', () => {
  it('undoes the latest change first, and hands back the one before it for its toast', () => {
    addStep('a', step('a1')); shown('a')
    addStep('a', step('a2')); shown('a')
    expect(undoStep('a')?.said()).toBe('a1')
    expect(undone).toEqual(['a2'])
    expect(undoStep('a')).toBeUndefined()
    expect(undone).toEqual(['a2', 'a1'])
    expect(undoStep('a')).toBeUndefined() // nothing left to undo
    expect(undone).toEqual(['a2', 'a1'])
  })

  it('has no fixed depth', () => {
    for (let i = 1; i <= 40; i++) { addStep('a', step(`a${i}`)); shown('a') }
    while (undoStep('a')) { /* each Fortryd brings back the one before */ }
    expect(undone).toHaveLength(40)
    expect(undone.at(-1)).toBe('a1')
  })

  // ✕, 🗑 and logout all take the toast down.
  it('forgets a history whose toast has gone, at the next change; another key\'s stays', () => {
    addStep('a', step('a1')); shown('a')
    addStep('b', step('b1')); shown('b')
    dismissKeyed('a')
    addStep('a', step('a2')); shown('a')
    expect(undoStep('a')).toBeUndefined()
    expect(undone).toEqual(['a2'])
    expect(undoStep('b')).toBeUndefined()
    expect(undone).toEqual(['a2', 'b1'])
  })

  // The stack's cap no longer does: pushed over it by newer toasts, a toast
  // waits for room (lib/toast), and its steps stay with it. They went at the
  // next change on any spot, and the round F browser check lost a Torsk
  // picked by hand that way.
  it('keeps the history of a toast waiting for room over the stack\'s cap', () => {
    addStep('a', step('a1')); shown('a')
    addStep('a', step('a2')); shown('a')
    for (const k of ['b', 'c', 'd']) { addStep(k, step(`${k}1`)); shown(k) }
    expect(toasts.value.find((x) => x.key === 'a')?.waiting).toBe(true)
    addStep('e', step('e1')); shown('e')
    expect(undoStep('a')?.said()).toBe('a1')
    expect(undoStep('a')).toBeUndefined()
    expect(undone).toEqual(['a2', 'a1'])
  })

  it('a change whose spot is gone takes the rest with it', () => {
    addStep('a', step('a1')); shown('a')
    addStep('a', step('a2', true)); shown('a')
    expect(undoStep('a')).toBeUndefined()
    expect(undoStep('a')).toBeUndefined()
    expect(undone).toEqual(['a2'])
  })

  // A spot gone from the list, by any road (stores/setup watches): its
  // toasts go, shown or waiting, and its steps with them, at once.
  it("forgets a spot: its water and move toasts go, and its steps; another spot's stay", () => {
    addStep('water:a', step('a1')); shown('water:a')
    shown('moved:a')
    addStep('water:b', step('b1')); shown('water:b')
    forgetSpot('a')
    expect(toasts.value.map((x) => x.key)).toEqual(['water:b'])
    expect(undoStep('water:a')).toBeUndefined()
    expect(undone).toEqual([])
    expect(undoStep('water:b')).toBeUndefined()
    expect(undone).toEqual(['b1'])
  })

  // The steps hold the account's spots and species: the next user finds none.
  it('logout forgets them all', () => {
    addStep('a', step('a1')); shown('a')
    forgetAccountData()
    expect(undoStep('a')).toBeUndefined()
    expect(undone).toEqual([])
  })
})
