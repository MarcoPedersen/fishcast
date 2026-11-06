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

const guessed = reactive(new Set<string>())

export function markWaterGuessed(id: string): void { guessed.add(id) }
export function waterGuessed(id: string): boolean { return guessed.has(id) }
export function clearWaterGuess(id: string): void { guessed.delete(id) }
