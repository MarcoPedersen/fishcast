/**
 * Can a species with these water-type preferences be fished at a location of
 * this water type?
 *
 * Brackish water holds both sea and freshwater species — 47 of the 57 official
 * spots are brackish and list mackerel, cod and pike alike — so it accepts a
 * species tagged salt OR fresh. The spot finder and the location species
 * picker each had their own copy of this rule and they drifted apart (the
 * picker offered 8 species at a brackish pin), hence one shared helper.
 */
export function waterCompatible(prefWater: readonly string[] | undefined, locWater: string): boolean {
  if (!prefWater?.length) return true
  return prefWater.includes(locWater) ||
    (locWater === 'brackish' && (prefWater.includes('salt') || prefWater.includes('fresh')))
}
