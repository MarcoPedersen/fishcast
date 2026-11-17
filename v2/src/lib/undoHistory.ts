/**
 * One undo history per key: the spot card's toast, keyed by spot. Its steps
 * are the spot's changes of water type (LocationsView setWater) and its
 * "Hent arter" (fetchSpecies). The toast shows the spot's latest change, and
 * its Fortryd undoes that change; then the toast of the change before it
 * comes back, with its own sentence and Fortryd. So every Fortryd matches
 * its sentence, and they go newest first: none lands on a state the user
 * had already left. With one step per spot, species picked by hand that an
 * earlier change took off could not come back by undo. Nor could they when
 * "Hent arter" raised a toast of its own: with three toasts standing it
 * pushed the oldest off, the spot's own, and the history with it.
 *
 * No fixed depth: a cap would drop the oldest step, the one that puts the
 * spot back as it began. A step is a few fields, and the history grows only
 * by the user's own changes while its toast stands.
 *
 * A history lives as long as its toast. Closed with ✕, closed with its spot
 * (🗑) or at logout, its steps are forgotten, and the next change on the
 * spot starts a new history: a Fortryd must not bring back a toast the user
 * closed. That is checked at the next change, so the toast needs no hook for
 * it. Pushed over the stack's cap by newer toasts, the toast waits out of
 * sight for room (lib/toast), and its steps stay: it is still among the
 * toasts. Pushed off, a fourth spot's change took the oldest spot's whole
 * history with it.
 *
 * Kept here, not in the view: the toast stands over every screen and its
 * Fortryd works there too, so a screen left and opened again finds the
 * steps, and its next change goes on top of them.
 */
import { onForget } from './forgetOnLogout'
import { toasts } from './toast'

export interface UndoStep {
  /** The toast's sentence for the change, built when read. */
  said: () => string
  /** Puts back the spot as it was before the change; false when the spot is gone. */
  undo: () => boolean
}

const histories = new Map<string, UndoStep[]>()
const standing = (key: string) => toasts.value.some((t) => t.key === key)

/** The change just made under `key`: on top of the key's steps while its toast stands, else the first of new ones. */
export function addStep(key: string, step: UndoStep): void {
  for (const k of [...histories.keys()]) if (!standing(k)) histories.delete(k)
  histories.set(key, [...(histories.get(key) ?? []), step])
}

/**
 * Fortryd: undoes the latest change under `key`, and returns the change
 * before it, whose toast comes back, if any. A spot gone takes the rest of
 * its steps with it: nothing is left to put them back on.
 */
export function undoStep(key: string): UndoStep | undefined {
  const steps = histories.get(key) ?? []
  const step = steps.pop()
  if (step?.undo() && steps.length) return steps[steps.length - 1]
  histories.delete(key)
  return undefined
}

// The steps hold the account's spots and species: logout drops them with it.
onForget(() => histories.clear())
