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
 *
 * A water type's mark keeps the type guessed. The marks are this tab's, and
 * the spot is synced: another tab or device can pick its type meanwhile,
 * before this tab reloads too. A mark held by id alone could not tell that
 * pick from the guess, and the map turned it to fresh (guessFollowsMap).
 */
import { reactive } from 'vue'
import type { CoastAuto } from './coast'
import { westCoastLagoonAt } from './lagoons'
import type { Location, WaterType } from './types'

/** Spots whose water type is a guess, and the type guessed (null: not known yet, settleWaterGuess). */
const KEY = 'fc2-water-guessed'
/** Guesses whose turn to fresh the user undid: still guesses, which the map no longer turns. */
const MAP_UNDONE_KEY = 'fc2-water-map-undone'
/** Spots whose bottom type is still the guess they were added with (bottomGuessed). */
const BOTTOM_GUESSED_KEY = 'fc2-bottom-guessed'
/** Spots whose bottom type the user picked this visit (bottomPicked). */
const BOTTOM_PICKED_KEY = 'fc2-bottom-picked'

function load(key: string): string[] {
  try {
    const v = JSON.parse(globalThis.sessionStorage?.getItem(key) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

const isWaterType = (w: unknown): w is WaterType => w === 'salt' || w === 'brackish' || w === 'fresh' || w === 'both'

/**
 * The water-type marks: an object of id to the type guessed. A tab open when
 * a new build takes it over reloads with the list of ids the older build
 * kept: those are guesses of a type not known yet.
 */
function loadGuesses(): Map<string, WaterType | null> {
  try {
    const v: unknown = JSON.parse(globalThis.sessionStorage?.getItem(KEY) ?? '{}')
    if (Array.isArray(v)) return new Map(v.filter((id): id is string => typeof id === 'string').map((id) => [id, null]))
    if (typeof v !== 'object' || v === null) return new Map()
    return new Map(Object.entries(v).filter((e): e is [string, WaterType | null] => e[1] === null || isWaterType(e[1])))
  } catch { return new Map() }
}

const guessed = reactive(loadGuesses())
const mapUndone = reactive(new Set<string>(load(MAP_UNDONE_KEY)))
const bottomGuesses = reactive(new Set<string>(load(BOTTOM_GUESSED_KEY)))
const bottomPicks = new Set<string>(load(BOTTOM_PICKED_KEY))

function save(): void {
  try {
    globalThis.sessionStorage?.setItem(KEY, JSON.stringify(Object.fromEntries(guessed)))
    globalThis.sessionStorage?.setItem(MAP_UNDONE_KEY, JSON.stringify([...mapUndone]))
    globalThis.sessionStorage?.setItem(BOTTOM_GUESSED_KEY, JSON.stringify([...bottomGuesses]))
    globalThis.sessionStorage?.setItem(BOTTOM_PICKED_KEY, JSON.stringify([...bottomPicks]))
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

/**
 * Bottom types the user picked this visit, the guess itself too (a tap on
 * the active pill): a change of water type re-guesses a bottom type only
 * while it equals the guess (LocationsView setWater), and so took a
 * confirmed one. This visit only, like the guesses: no synced flag.
 */
export function bottomPicked(id: string): boolean { return bottomPicks.has(id) }
export function setBottomPicked(id: string, picked: boolean): void {
  if (picked === bottomPicks.has(id)) return
  if (picked) bottomPicks.add(id)
  else bottomPicks.delete(id)
  save()
}

/**
 * Marks a spot's water type as a guess: of `waterType`, or, left out, of the
 * type the spot has when the app next looks at it (settleWaterGuess). The
 * views mark a spot right after adding it, so that is the type guessed.
 */
export function markWaterGuessed(id: string, waterType?: WaterType): void { guessed.set(id, waterType ?? null); save() }
export function waterGuessed(id: string): boolean { return guessed.has(id) }
export function clearWaterGuess(id: string): void {
  const was = guessed.delete(id)
  if (mapUndone.delete(id) || was) save()
}

/** Whether the spot still has the type its mark guessed (one not known yet counts). */
function guessHolds(loc: Pick<Location, 'id' | 'waterType'>): boolean {
  const w = guessed.get(loc.id)
  return guessed.has(loc.id) && (w === null || w === loc.waterType)
}

/**
 * A spot's mark, put in line with the spot as the list now holds it (the
 * app's watcher, waterChange.ts useMapFreshTurn). A mark of a type the spot
 * no longer has was ended elsewhere: the user picked a type in another tab
 * or on another device, and the sync brought it here, or had brought it
 * before this tab reloaded. That is their pick, so the mark goes, and with
 * it the card's "gættet" and the map's turn to fresh. A mark of a type not
 * known yet takes the type the spot has now.
 */
export function settleWaterGuess(loc: Pick<Location, 'id' | 'waterType'>): void {
  if (!guessed.has(loc.id)) return
  if (!guessHolds(loc)) clearWaterGuess(loc.id)
  else if (guessed.get(loc.id) === null && loc.waterType) { guessed.set(loc.id, loc.waterType); save() }
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
 * guess once more lost its "gættet". A guess put back is of `waterType`, the
 * type Fortryd put back with it.
 */
export function restoreWaterGuess(id: string, g: WaterGuess, waterType?: WaterType): void {
  if (g) guessed.set(id, waterType ?? null)
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
 * what knows. A type the user picked stays, here or in another tab or on
 * another device (a guess holds only while the spot has the type guessed,
 * settleWaterGuess); the coast check asks instead. So does a guess whose
 * turn the user undid: that is their "no" to fresh.
 * So does a guess in a lagoon behind the west coast's dunes (lagoons.ts):
 * OpenStreetMap maps Ringkøbing Fjord as a lagoon, which the map draws as a
 * lake, and the lake it finds there is the brackish lagoon itself.
 */
export function guessFollowsMap(loc: Location, auto: CoastAuto | undefined): boolean {
  return guessHolds(loc) && !mapUndone.has(loc.id) && loc.waterType !== 'fresh' && auto?.water === 'inland'
    && !westCoastLagoonAt(loc.lat, loc.lon)
}
