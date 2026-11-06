/**
 * Which spots carry a guessed water type: a place picked in the location
 * search, or a pin tapped on the setup map, whose type came from
 * smartDetectWaterType (geo.ts). The spot card says "gættet – ret hvis
 * forkert" beside it until the user picks a type.
 *
 * This session only, by id: the moment it matters is right after adding the
 * spot, and a flag in the synced setup would be an edit pushed to every device.
 */
import { reactive } from 'vue'
import type { CoastAuto } from './coast'
import type { Location } from './types'

const guessed = reactive(new Set<string>())

export function markWaterGuessed(id: string): void { guessed.add(id) }
export function waterGuessed(id: string): boolean { return guessed.has(id) }
export function clearWaterGuess(id: string): void { guessed.delete(id) }

/**
 * Whether a guessed salt or brackish spot turns fresh now the coast lookup
 * has landed: the map finds a lake or river nearest and no sea within reach
 * (coast.ts 'inland'). Offline, a lake spot 3 km off is no sign — Hornbæk's
 * is 4 km off — so a pin in mid-Arresø is guessed brackish, and the map is
 * what knows. A type the user picked stays; the coast check asks instead.
 */
export function guessFollowsMap(loc: Location, auto: CoastAuto | undefined): boolean {
  return guessed.has(loc.id) && loc.waterType !== 'fresh' && auto?.water === 'inland'
}
