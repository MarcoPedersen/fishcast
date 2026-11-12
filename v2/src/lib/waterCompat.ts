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

/**
 * Can an official spot in `spotWater` tell what lives at a location of this
 * water type? Its species fill in a custom spot nearby (geo.ts
 * speciesFromNearby), and brackish water accepts fresh species, so by species
 * alone a coastal town took a lake's: Hornbæk, guessed brackish, was saved
 * with the carp, pike and zander of Gurre Sø and Esrum Sø, 7 and 11 km
 * inland. A lake or river says nothing about the sea, so a salt or brackish
 * location takes no fresh spot's species. A fresh location takes every spot's
 * and keeps the species that live in fresh water: a sea fish never does, and
 * the sea trout of the Gudenå at Randers come from Randers Fjord's spot.
 */
export function speaksForWater(spotWater: string, locWater: string | undefined): boolean {
  return spotWater !== 'fresh' || locWater === undefined || locWater === 'fresh' || locWater === 'both'
}
