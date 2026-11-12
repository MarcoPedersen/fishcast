/**
 * Which spots carry a guessed water type: a place picked in the location
 * search, or a pin tapped on the setup map, whose type came from
 * smartDetectWaterType (geo.ts). The spot card says "gættet – ret hvis
 * forkert" beside it until the user picks a type. And which carry a guessed
 * bottom type, kept the same way (markBottomGuessed).
 *
 * This visit only, by id: the moment it matters is right after adding the
 * spot, and a flag in the synced setup would be an edit pushed to every device.
 * Kept in sessionStorage, so a reload within the visit keeps it: a new build
 * takes over an open page by reloading it (swUpdate.ts), and held in memory
 * the guess went with it — the tag, and a lake pin's turn to fresh once the
 * map finds the lake. With the storage blocked it lives as long as the page.
 */
import { reactive } from 'vue'
import type { CoastAuto } from './coast'
import type { Location } from './types'

const KEY = 'fc2-water-guessed'
/** Guesses whose turn to fresh the user undid: still guesses, which the map no longer turns. */
const MAP_UNDONE_KEY = 'fc2-water-map-undone'
/** Spots whose bottom type is still the guess they were added with (bottomGuessed). */
const BOTTOM_GUESSED_KEY = 'fc2-bottom-guessed'

function load(key: string): string[] {
  try {
    const v = JSON.parse(globalThis.sessionStorage?.getItem(key) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

const guessed = reactive(new Set<string>(load(KEY)))
const mapUndone = reactive(new Set<string>(load(MAP_UNDONE_KEY)))
const bottomGuesses = reactive(new Set<string>(load(BOTTOM_GUESSED_KEY)))

function save(): void {
  try {
    globalThis.sessionStorage?.setItem(KEY, JSON.stringify([...guessed]))
    globalThis.sessionStorage?.setItem(MAP_UNDONE_KEY, JSON.stringify([...mapUndone]))
    globalThis.sessionStorage?.setItem(BOTTOM_GUESSED_KEY, JSON.stringify([...bottomGuesses]))
  } catch { /* blocked: this page only */ }
}

/**
 * Which spots carry a guessed bottom type: a searched place or a tapped pin,
 * whose bottom type came from the official spots near it (geo.ts
 * inferBottomType). The spot card says "gættet" beside it until the user
 * picks one, as it does beside the water type, and for this visit too. Apart
 * from the water type's guess: a type picked in the map sheet leaves the
 * bottom type a guess.
 */
export function markBottomGuessed(id: string): void { bottomGuesses.add(id); save() }
export function bottomGuessed(id: string): boolean { return bottomGuesses.has(id) }
export function clearBottomGuess(id: string): void { if (bottomGuesses.delete(id)) save() }

export function markWaterGuessed(id: string): void { guessed.add(id); save() }
export function waterGuessed(id: string): boolean { return guessed.has(id) }
export function clearWaterGuess(id: string): void {
  const was = guessed.delete(id)
  if (mapUndone.delete(id) || was) save()
}

/**
 * A spot's guess as it stands: a guess; a guess whose turn to fresh the
 * user undid ('mapUndone'), still shown as a guess but no longer turned by
 * the map; or none, a type the user picked.
 */
export type WaterGuess = 'guess' | 'mapUndone' | null
export function waterGuessOf(id: string): WaterGuess {
  return !guessed.has(id) ? null : mapUndone.has(id) ? 'mapUndone' : 'guess'
}
/**
 * Puts a spot's guess back as it was (waterGuessOf): "Fortryd" after a change
 * of water type (LocationsView setWater). Left cleared, a type that was a
 * guess once more lost its "gættet".
 */
export function restoreWaterGuess(id: string, g: WaterGuess): void {
  if (g) guessed.add(id)
  else guessed.delete(id)
  if (g === 'mapUndone') mapUndone.add(id)
  else mapUndone.delete(id)
  save()
}

/**
 * Whether a guessed salt or brackish spot turns fresh now the coast lookup
 * has landed: the map finds a lake or river nearest and no sea within reach
 * (coast.ts 'inland'). Offline, a lake spot 3 km off is no sign — Hornbæk's
 * is 4 km off — so a pin in mid-Arresø is guessed brackish, and the map is
 * what knows. A type the user picked stays; the coast check asks instead.
 * So does a guess whose turn the user undid: that is their "no" to fresh.
 */
export function guessFollowsMap(loc: Location, auto: CoastAuto | undefined): boolean {
  return guessed.has(loc.id) && !mapUndone.has(loc.id) && loc.waterType !== 'fresh' && auto?.water === 'inland'
}
