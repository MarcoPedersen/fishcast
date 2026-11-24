/**
 * The brackish lagoons behind the west coast's dunes: Ringkøbing Fjord and
 * Nissum Fjord. Each lies behind a barrier of dunes a kilometre or two wide
 * and meets the North Sea only through a sluice (Hvide Sande, Thorsminde).
 * West of 8.6° the water-type guess says salt, for the North Sea (geo.ts
 * smartDetectWaterType), and it called both lagoons salt as well.
 *
 * Outlines, not the official spots or boxes. The catalogue's one spot on
 * that coast is Grærup Strand, 38 km south of Hvide Sande. A box that holds
 * a lagoon also holds a stretch of the beach, where the barrier bends (the
 * boxes ruleArea.ts draws round these fjords for their rules are a hedge, and
 * hold the beach by the Nymindegab arm). Each outline follows the shore as
 * the OpenStreetMap contributors map it (data under the ODbL), simplified to
 * within about 500 m. On the barrier side it keeps to the shore or inside it,
 * so the beach, the harbours of Hvide Sande and Thorsminde and the sluice
 * channels stay the sea's. On the land side it mostly takes in a little more:
 * a few hundred metres past the shore, so a pin on the quay at Ringkøbing
 * counts, and the marshes and spits inside the lagoon (Tipperne).
 *
 * Simplified, an outline still passes just inside some harbours on the
 * shore, by 7 to 120 m, on the barrier side and on the land side. A pin on
 * these lagoons most likely goes to a harbour, so those are listed with the
 * outline (OpenStreetMap leisure=marina, with the lagoon's shore within
 * 150 m), and a point within HARBOUR_KM of one counts too. Not a wider
 * outline: the put & take lake at Skaven lies about 70 m outside it, and the map's
 * turn to fresh (waterGuess.ts guessFollowsMap) and the coast card's
 * question (coast.ts) are right there. A straight edge cut through the
 * lake's west end, so a vertex keeps all of it out.
 */
import { haversine } from './math'

type LatLon = readonly [number, number]

/** How far from one of a lagoon's listed harbours a point counts as the lagoon's (km). */
const HARBOUR_KM = 0.25

const LAGOONS: readonly { name: string; outline: readonly LatLon[]; harbours: readonly LatLon[] }[] = [
  {
    name: 'Ringkøbing Fjord',
    outline: [
      [56.1050, 8.1601], [56.1018, 8.1497], [56.0896, 8.1328], [56.0378, 8.1237], [56.0083, 8.1311],
      [56.0076, 8.1439], // the Hvide Sande channel left out
      [55.9982, 8.1337], [55.9563, 8.1568], [55.9499, 8.1718], [55.9460, 8.1637], [55.9118, 8.1759],
      [55.9065, 8.1674], [55.9051, 8.1747], [55.8826, 8.1838], [55.8740, 8.1798], [55.8640, 8.1971],
      [55.8526, 8.1813], [55.8448, 8.1748], [55.8259, 8.1757], [55.8189, 8.1840],
      [55.8178, 8.1906], // the south tip, at Nymindegab
      // The land side, with Tipperne.
      [55.8400, 8.2750], [55.8694, 8.3320],
      [55.8935, 8.3650], // west of Skaven Fiskesø, which a straight edge cut through
      [55.9060, 8.3870], [55.9547, 8.3770], [55.9926, 8.3190],
      [56.0580, 8.3080], [56.0960, 8.2500],
    ],
    // Vinterleje, Bjerregård and Render Havn on the barrier, and the slipway
    // at Nymindegab Havn.
    harbours: [[55.9188, 8.1730], [55.8804, 8.1817], [55.9848, 8.1397], [55.8187, 8.1847]],
  },
  {
    name: 'Nissum Fjord',
    outline: [
      [56.4353, 8.1629], [56.4287, 8.1346], [56.4196, 8.1320], [56.4038, 8.1309], [56.3901, 8.1359],
      [56.3859, 8.1364], [56.3777, 8.1321],
      [56.3710, 8.1333], // the Thorsminde channel left out
      [56.3644, 8.1390], [56.3484, 8.1279], [56.3396, 8.1316], [56.3299, 8.1297], [56.3278, 8.1309],
      [56.3369, 8.1663], [56.3233, 8.1691], [56.3218, 8.2379],
      // The land side, with Felsted Kog.
      [56.2860, 8.2470], [56.2950, 8.2810], [56.3170, 8.2970], [56.3570, 8.2440], [56.3800, 8.1900],
      [56.4050, 8.1690], [56.4340, 8.1700],
    ],
    // Helmklink Havn on the barrier, Sandholm and Felsted Kog Havn on the
    // south shore.
    harbours: [[56.3308, 8.1473], [56.3218, 8.2005], [56.3201, 8.2364]],
  },
]

/** Whether the point lies inside the outline (even-odd rule). */
function inside(lat: number, lon: number, outline: readonly LatLon[]): boolean {
  let hit = false
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [aLat, aLon] = outline[i]
    const [bLat, bLon] = outline[j]
    if ((aLat > lat) !== (bLat > lat) && lon < aLon + ((lat - aLat) / (bLat - aLat)) * (bLon - aLon)) hit = !hit
  }
  return hit
}

/** The west-coast lagoon a point lies in, or by one of its listed harbours, by name; or undefined. */
export function westCoastLagoonAt(lat: number, lon: number): string | undefined {
  return LAGOONS.find((l) => inside(lat, lon, l.outline)
    || l.harbours.some(([hLat, hLon]) => haversine(lat, lon, hLat, hLon) <= HARBOUR_KM))?.name
}
