/**
 * A change of a spot's water type: the species and bottom type that go with
 * it, its toast and its Fortryd (lib/undoHistory). Lokationer's water-type
 * buttons make it, and so does the map's turn to fresh (useMapFreshTurn).
 * That turn ran in Lokationer only, so a guessed pin added on the setup map
 * and taken to the dashboard was scored as a sea spot. Here it runs for the
 * whole app, wherever the coast lookup lands.
 */
import { effectScope, onScopeDispose, watchEffect } from 'vue'
import { spName, t } from '@/lib/i18n'
import { SPECIES_PREFS } from '@/lib/species'
import { changeWaterType } from '@/lib/locationSpecies'
import { showToast } from '@/lib/toast'
import { addStep, undoStep } from '@/lib/undoHistory'
import { bottomLookupFor, speciesBackFor, speciesLookupFor } from '@/lib/geo'
import {
  bottomGuessed, bottomPicked, clearWaterGuess, guessFollowsMap, markBottomGuessed, restoreWaterGuess, setBottomPicked,
  waterGuessOf,
} from '@/lib/waterGuess'
import type { CoastAuto } from '@/lib/coast'
import type { Location, WaterType } from '@/lib/types'

/** The setup store, as far as a change of water type reads it. */
export interface WaterSetup { locations: Location[] }
/** The coast store, as far as the map's turn reads it. */
export interface WaterCoast { autoFor(loc: { lat: number; lon: number }): CoastAuto | undefined }

const fill = (s: string, params: Record<string, string | number>) =>
  Object.entries(params).reduce((out, [k, val]) => out.replace(`{${k}}`, String(val)), s)

/** setWater and showStep for the spots of `setup`. */
export function waterChanges(setup: WaterSetup, coast: WaterCoast) {
  /**
   * The lookup a change of water type runs for the spot's species
   * (changeWaterType). A list never filled is filled as the refill fills one
   * (stores/setup.ts enrichMissingSpecies, geo.ts speciesBackFor): a copy of
   * an official spot with its own species that live in the new water, a
   * custom spot with what the official spots nearby give it, and none at all
   * when not one of them counts. With the custom spots' lookup alone, a copy
   * of Grærup Strand saved as Ferskvand, which the refill could not fill,
   * kept none when set to Saltvand, though its own are four flatfish. A list
   * filled or emptied is judged as before (speciesLookupFor): an official
   * spot's are its own, so an official spot's emptied list stays empty.
   */
  function speciesLookupOf(l: Location) {
    if (l.species !== undefined) return speciesLookupFor(l)
    return (waterType: WaterType | undefined) =>
      speciesBackFor({ lat: l.lat, lon: l.lon, spotSlug: l.spotSlug, waterType })?.species ?? []
  }
  /**
   * The user's own pick of water type: no longer a guess. Or the map's, for a
   * guess the coast lookup contradicts (guessFollowsMap): still a guess, and a
   * toast says so. Species that don't fit the new water go with it, named in
   * a toast that can undo the change: left on, the picker hid them while they
   * still counted. Species picked by hand take the open months of the new
   * water (changeWaterType), quietly: a river's sea trout is closed in December.
   * A custom spot whose species are none, or still the lookup's for the old
   * water, takes the lookup's for the new one: a lake pin guessed brackish had
   * none, since a sea spot takes no lake's species. The toast names all it took
   * off, as not listed nearby for that water (`relooked`), and the species the
   * app knows it put on: a change that only puts species on gets its toast,
   * and its undo, too. An official spot's are its own, saved from the map
   * without a slug too (speciesLookupFor). A list never filled is filled as
   * the refill fills it (speciesLookupOf).
   * A custom spot's bottom type that is still the guess for the old water
   * becomes the guess for the new (bottomLookupFor): the map's turn to fresh
   * left a lake pin with the sea's stone and its slip warning. One the user
   * picked (setBottom) stays, the guess itself too (a tap on the active pill),
   * for this visit (waterGuess.ts bottomPicked).
   * Undone, the card is as it was, its guess too: a type that was a guess is
   * marked as one again, and one the user had picked stays theirs. The same
   * for the bottom type: a guess put back is shown as one, even if the user
   * picked a bottom type while the toast was up. Fortryd steps back one change
   * at a time, newest first, each with its own toast (lib/undoHistory). A
   * "Hent arter" is a step in the same history (fetchSpecies).
   */
  function setWater(l: Location, w: WaterType, by: 'user' | 'map' = 'user') {
    const before = { waterType: l.waterType, species: l.species, bottomType: l.bottomType }
    const bottomGuessBefore = bottomGuessed(l.id)
    const bottomPickedBefore = bottomPicked(l.id)
    const guessBefore = waterGuessOf(l.id)
    l.waterType = w
    if (by === 'user') clearWaterGuess(l.id)
    const bottom = bottomLookupFor(l)
    if (bottom && !bottomPickedBefore && l.bottomType === bottom(before.waterType)) l.bottomType = bottom(w)
    const { species, dropped, added = [], relooked } = changeWaterType(l.species, w, before.waterType, speciesLookupOf(l))
    if (species !== l.species) l.species = species
    // Built when read: the toast stays until it is used or closed, and a
    // language switch meanwhile re-renders it (lib/toast).
    // The species sentences name no spot, and each spot keeps a toast of its
    // own: two can read the same, so the toast leads with the spot's name. The
    // map's turn to fresh names it in its own sentence. By the name the list
    // shows now: a sync puts a fresh copy in its place, renamed there maybe.
    const name = () => setup.locations.find((x) => x.id === l.id)?.name ?? l.name
    const sentences = () => {
      const names = dropped.map((id) => spName(SPECIES_PREFS[id])).join(', ')
      return [
        by === 'map' ? fill(t('wt_map_fresh'), { name: name() }) : '',
        dropped.length ? fill(t(relooked ? 'loc_species_dropped_nearby' : 'loc_species_dropped'), { names }) : '',
        added.length ? fill(t('loc_species_added'), { names: added.map((id) => spName(SPECIES_PREFS[id])).join(', ') }) : '',
      ].filter(Boolean).join(' ')
    }
    // A change with nothing to say raises no toast and adds no step: the
    // spot's toast, if one stands, goes on saying what it said, and its
    // Fortryd puts back the spot as it was before the change it names, the
    // silent one undone with it, as a species or bottom type picked while it
    // stands is. A step of its own would need a toast that says nothing.
    // Under a "Hent arter" toast the silent change stays: that Fortryd takes
    // off only what the tap put on (fetchSpecies). The Fortryd of a change of
    // water type below the tap still undoes it.
    if (!sentences()) return
    const said = () => (by === 'map' ? sentences() : `${name()}: ${sentences()}`)
    // The map's turn undone is the user's "no" to fresh, and only that: salt or
    // brackish is still the app's guess, so the card still says so, but the map
    // can't turn it again (waterGuess.ts 'mapUndone'). A user's pick undone puts
    // back the guess it ended, unless the map would turn that guess fresh at
    // once (the lookup found the lake while the toast was up): then Fortryd
    // would seem to do nothing, so it comes back as the map's turn undone.
    // Each change is a step in the spot's undo history (lib/undoHistory): its
    // toast takes the older one's place, and its Fortryd undoes this change
    // only, which is what its sentence names, then brings back the older one.
    addStep(`water:${l.id}`, {
      said,
      undo: () => {
        // The spot as the list holds it now: a sync from another tab or
        // device puts a fresh copy in its place, and Fortryd changed the old
        // one, no longer shown. Deleted there, nothing is left to undo. A sync
        // keeps the steps: another tab's save replaces every spot's copy,
        // changed or not.
        const cur = setup.locations.find((x) => x.id === l.id)
        if (!cur) return false
        putBack(cur, before)
        restoreWaterGuess(l.id, by === 'map' ? 'mapUndone' : guessBefore)
        if (guessFollowsMap(cur, coast.autoFor(cur))) restoreWaterGuess(l.id, 'mapUndone')
        if (bottomGuessBefore) markBottomGuessed(l.id)
        setBottomPicked(l.id, bottomPickedBefore)
        // The list goes back as it was before this change. A "Hent arter"
        // since is a step above this one, so its own Fortryd came first: what
        // it put on is off by now. A species picked by hand since goes with
        // the rest, as one picked while this change's toast stands does.
        return true
      },
    })
    showStep(l.id, said)
  }
  /**
   * Puts the fields of `before` back on the spot as they were. One the spot
   * did not have goes again: assigned, it stayed on the spot as undefined, a
   * field of the spot all the same, likely the bottom type of null the round
   * E browser check read. The saved copy dropped it either way.
   */
  function putBack(l: Location, before: Pick<Location, 'waterType' | 'species' | 'bottomType'>) {
    const spot = l as unknown as Record<string, unknown>
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete spot[k]
      else spot[k] = v
    }
  }
  /**
   * The toast of a spot's latest change: of water type, or a "Hent arter"
   * (fetchSpecies). One toast per spot: two spots never share one, however
   * alike their sentences read (lib/toast key). Its Fortryd undoes that
   * change, then shows the toast of the change before it, if any, with that
   * one's own sentence and Fortryd.
   */
  function showStep(id: string, said: () => string) {
    showToast(said, {
      key: `water:${id}`,
      action: {
        label: () => t('undo'),
        run: () => {
          const prev = undoStep(`water:${id}`)
          if (prev) showStep(id, prev.said)
        },
      },
    })
  }
  return { setWater, showStep }
}

/**
 * A guessed salt or brackish spot turns fresh once the coast lookup finds a
 * lake or river there and no sea: a pin in mid-Arresø is guessed brackish.
 * One watcher per setup store, however many components ask for it: App.vue
 * and Lokationer both do, and two would turn a spot twice, with two toasts.
 * It stops when the last of them is unmounted.
 */
const turns = new WeakMap<WaterSetup, { users: number; stop: () => void }>()
export function useMapFreshTurn(setup: WaterSetup, coast: WaterCoast) {
  let turn = turns.get(setup)
  if (!turn) {
    const { setWater } = waterChanges(setup, coast)
    // The spots seen fresh here while still a guess: turned by the map, here
    // or in another tab. One that comes back salt or brackish, and not as
    // Fortryd puts it back ('mapUndone'), was picked in another tab or on
    // another device. The guess marks are kept per tab (waterGuess.ts), so
    // this tab's mark goes: left, the map turned the pick back to fresh.
    const freshGuess = new Set<string>()
    const scope = effectScope(true)
    scope.run(() => watchEffect(() => {
      for (const l of setup.locations) {
        if (l.waterType !== 'fresh' && freshGuess.delete(l.id) && waterGuessOf(l.id) === 'guess') clearWaterGuess(l.id)
        if (guessFollowsMap(l, coast.autoFor(l))) setWater(l, 'fresh', 'map')
        if (l.waterType === 'fresh' && waterGuessOf(l.id) === 'guess') freshGuess.add(l.id)
      }
    }))
    turn = { users: 0, stop: () => scope.stop() }
    turns.set(setup, turn)
  }
  const mine = turn
  mine.users++
  onScopeDispose(() => {
    if (--mine.users > 0) return
    mine.stop()
    if (turns.get(setup) === mine) turns.delete(setup)
  })
}
