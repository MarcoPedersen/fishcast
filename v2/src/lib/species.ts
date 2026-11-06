export interface SpeciesPref {
  id: string; name: string; nameEn: string; emoji: string;
  waterType: string[]; tip: string; tipEn?: string;
  bonuses: Record<string, number>;
  bottomPref: string[]; depthPref: string;
  restricted?: boolean; banned?: boolean; venom?: boolean;
  /** Selectable, but tapping it in shows warningText first (cod: banned in the Baltic only). */
  selectNotice?: true;
  warningText?: string; warningTextEn?: string;
  /**
   * Preference for sea-surface temperature: [°C, 0–1] breakpoints, strictly
   * ascending, piecewise-linear and flat beyond the ends. Read by the
   * bd_watertemp row (0.5 is neutral) and the visitor gate. Omitted where no
   * source gives one.
   */
  sst?: [number, number][];
  /** A seasonal visitor: its bonuses don't pay while sstPreference < SCORE_WEIGHTS.visitorMinPref. Needs `sst`. */
  visitor?: true;
  /**
   * Feeds by day: for its share of the targets the midday penalty becomes the
   * ordinary daytime value. `true` also drops the overcast bonus (it hunts in
   * sun and daylight); `{ belowSst }` lifts only the midday penalty, and only
   * while the water is colder than that.
   */
  dayFeeder?: true | { belowSst: number };
  /**
   * Points by the wind relative to the spot's coast (bd_shorewind),
   * piecewise-linear in m/s and flat beyond the ends; each starts at (1.5, 0),
   * below which the direction is noise. Omitted where no source gives a
   * direction: a present target without one counts as 0 in the row.
   */
  shoreWind?: { on: [number, number][]; side: [number, number][]; off: [number, number][] };
  /**
   * Wants some wind and chop: for its share of the present targets the calm
   * (+4) and brisk (−5) wind points and the glassy-water bonus (+3) don't
   * apply. The gale penalty stays.
   */
  windy?: true;
}
import { BALTIC_COD_BAN_YEARS } from './regulations'

/** "2026 og 2027" / "2026 and 2027". */
function yearList(years: number[], and: string): string {
  return years.length > 1 ? `${years.slice(0, -1).join(', ')} ${and} ${years[years.length - 1]}` : String(years[0])
}
const COD_YEARS_DA = yearList(BALTIC_COD_BAN_YEARS, 'og')
const COD_YEARS_EN = yearList(BALTIC_COD_BAN_YEARS, 'and')

/**
 * FishCast - species targeting preferences (names, tips, warnings, score bonuses)
 * Consumed by the scoring engine and all species UI.
 *
 * Model v3 rewrote the bonuses, curves and tips from the research behind
 * model-spec.md (K§ = its knowledge.md section). Bonus values include the
 * model's one × 1.25 calibration (scoring.ts SCORE_WEIGHTS). Confidence is the research's:
 * high = a fisheries body or a study, medium = established angling sources,
 * low = a single angler or an inference. No species reads air pressure or
 * solunar periods any more: no source supports either (K§1.4).
 */

// ── Species targeting preferences ────────────────────────────
// Each entry defines what conditions this species responds best to.
// bonuses are ADDITIONAL points added on top of the base score
// when those conditions are met at scoring time (the rules are
// SPECIES_CONDITIONS in scoring.ts).
export const SPECIES_PREFS: Record<string, SpeciesPref> = {
  havørred: {
    id:'havørred', name:'Havørred', nameEn:'Sea Trout', emoji:'🐟',
    waterType:['salt','brackish'],
    tip:'Kystens klassiker. Mest aktiv i 6–12 °C vand – forår og efterår – men fangsten pr. time er også god om vinteren, og ved Bornholm er november–marts bedst. Søg pålandsvind med lidt bølgegang og let grumset vand; spejlblankt, krystalklart vand er sjældent godt. Om sommeren mest ved daggry, i skumringen og om natten; i koldt vand kan den tage hele dagen. Husk fredningsbælterne ved åudløb: som hovedregel intet fiskeri inden for 500 m, hele året eller 16. sep. – 15. mar.',
    tipEn:'The coastal classic. Most active in 6–12 °C water – spring and autumn – but the catch per hour is good in winter too, and on Bornholm November–March is best. Look for onshore wind with some chop and slightly coloured water; glassy, gin-clear water is rarely good. In summer mostly at dawn, dusk and night; in cold water it can take all day. Mind the protection zones at stream mouths: as a rule no fishing within 500 m, all year or 16 Sep – 15 Mar.',
    // dawn/dusk: low light brings them into the shallows (medium). nightWarm:
    // at night almost permanently at the surface, deep by day above 17 °C (DTU
    // tagging, high). windOrChop: the direction-blind stand-in for onshore
    // wind, paid only while the spot's coast is unknown (scoring.ts). +2 is
    // the mean of bd_shorewind over the fixture hours the old +8 rule fired
    // (2.19, onshore.check.ts, since the basin rule reads only wind from
    // behind the spot and side wind the water along and across it; 1.87
    // before that; 2.60 → +3 until wind from a basin behind a
    // mole scored offshore and side wind paid by fetch, which kept an unknown
    // coast ~1 above a known one), so an unknown coast is neither rewarded nor penalised: at
    // east-facing Dragør 43 % of those hours blew offshore (critique M5). It
    // pays through the species row, which divides by ALL targets, while
    // bd_shorewind divides by the present ones: for havørred, fjæsing and
    // makrel in winter (both visitors gated) the fallback is a third of the
    // row's mean (critique suggestion 7; aligning the denominators is out of
    // scope).
    bonuses: { dawn:+6, dusk:+6, nightWarm:+13, windOrChop:+2, cloud:+4 },
    // "Søg pålandsvind og gang i vandet" (Sportsfiskeren, winter, medium); "on-
    // shore or good side wind" (fishingindenmark, medium); 5–7 m/s (Fisk & Fri,
    // medium); murky only above 7–8 m/s onshore (Havørred Fyn, medium); strong
    // onshore compromises it (VisitDenmark, medium). The direction is medium,
    // the speed edges low–medium, offshore −3 low–medium (onshore spec §2.2).
    shoreWind: {
      on:   [[1.5,0],[3,5],[4.5,8],[8,8],[10,2],[12,-4]],
      side: [[1.5,0],[3,3],[4.5,5],[8,5],[10,1],[12,-2]],
      off:  [[1.5,0],[3,-1],[4.5,-3],[8,-3],[10,-2],[12,-1]],
    },
    // "Spejlblankt, krystalklart vand er sjældent godt" (Fisk & Fri, medium):
    // the calm and glassy bonuses out-scored onshore chop for sea trout.
    windy: true,
    // DTU tagging: body temperature 10–16 °C, avoids > 17 °C by day (high);
    // shore fishing starts > 6 °C, very active 8–10 °C (Fisk & Fri, medium).
    // The cold end stays near neutral (0.4–0.5), not low: DTU Fangstjournalen
    // finds catch per hour HIGHER in autumn/winter than spring/summer (high),
    // against the anglers' "hard below 3–4 °C" (medium) — so winter is not
    // penalised beyond −2.
    sst: [[0,.4],[3,.45],[5,.7],[6,.85],[8,1],[12,1],[14,.8],[16,.55],[18,.3],[20,.2]],
    // Low–medium (critique M4): the evidence is winter sun warming the
    // shallows and K§2.3's own inference; the Sep–Oct "all day as the water
    // cools" happens in 10–15 °C water, above this threshold. Lifts only the
    // midday penalty (critique M3).
    dayFeeder: { belowSst: 10 },
    bottomPref:['stone','mixed'], depthPref:'shallow',
    // The rules behind the ⚠️ button: regulations.ts, from lfst's 2026 lists,
    // its havørred page and "Fredningsbælter" (checked 2026-11-06). Sea trout
    // at stream mouths is this app's core advice; the 500 m zones were never
    // mentioned.
    restricted: true,
    warningText: '⚠️ REGLER FOR HAVØRRED\n\n• Mindstemål: 40 cm.\n• Kysten, 16. nov. – 15. jan.: fisk i gydedragt er fredet; kun helt blanke fisk med løse skæl må tages med hjem.\n• Vandløb og søer: fredet 16. nov. – 28./29. feb.\n• Bornholm: farvede fisk fredet fra midt i september til udgangen af februar (kyst og vandløb). Vadehavet: alle fisk i samme periode.\n• Ringkøbing, Nissum og Stadil fjorde og Von Å: totalfredet hele året.\n\n🚫 FREDNINGSBÆLTER\nSom hovedregel må der ikke fiskes inden for 500 m fra et vandløbs udløb — hele året, hvis udløbet er 2 m bredt eller mere, ellers 16. sep. – 15. mar. Nogle bælter er anderledes; se kortet på lfst.dk.\n\nKilde: lfst.dk (2026)',
    warningTextEn: '⚠️ SEA TROUT RULES\n\n• Minimum size: 40 cm.\n• The coast, 16 Nov – 15 Jan: fish in spawning colours are protected; only fully bright fish with loose scales may be kept.\n• Streams and lakes: closed 16 Nov – 28/29 Feb.\n• Bornholm: coloured fish protected from mid-September to the end of February (coast and streams). Wadden Sea: all fish in the same period.\n• Ringkøbing, Nissum and Stadil fjords and Von Å: fully protected all year.\n\n🚫 PROTECTION ZONES\nAs a rule no fishing within 500 m of a stream mouth — all year where the mouth is 2 m wide or more, otherwise 16 Sep – 15 Mar. Some zones differ; see the map at lfst.dk.\n\nSource: lfst.dk (2026)',
  },
  gedde: {
    id:'gedde', name:'Gedde', nameEn:'Pike', emoji:'🐊',
    waterType:['fresh'],
    tip:'Bedst omkring solopgang og især i skumringen. Blæst er ingen ulempe – fangsterne er tværtimod ofte bedre i vind og køligt vejr. Foretrækker lavt vand med planter.',
    tipEn:'Best around sunrise and especially at dusk. Wind is no drawback – catches are often better in windy, cool weather. Prefers shallow water with plants.',
    // Higher catch rates at high wind and at dusk (Kuparinen et al. 2010, high);
    // the old calm bonus ran against that.
    bonuses: { breeze:+10, dawn:+5, dusk:+10 },
    // Wants wind, so for its share of the present targets the calm (+4), brisk
    // (−5) and glassy (+3) points don't apply. Kuparinen, Klefoth & Arlinghaus
    // 2010 (Fisheries Research 105:111–117), daily catch rates over several
    // months of 2005 in one small German lake (Kleiner Döllnsee): catch rates
    // "significantly increased at low temperatures, high wind speeds", around
    // full and new moon and at dusk; recent fishing effort mattered most (high:
    // a peer-reviewed field study, though one lake, spring to autumn). The same
    // group restates it as low wind speeds reducing catch rates there
    // (Arlinghaus et al. 2017, Fisheries Research 186:648–657, high). A
    // secondary summary (betterfishing.de) reports no optimum and no drop in
    // strong wind; the paper's full text was not read, and its observed wind
    // range is unknown. The 2017 experiment on the same lake took its wind
    // from a nearby weather station and averaged 1.5–2 m/s, so lifting the −5
    // at 5.5–8 m/s may reach beyond the wind the study saw (low). The effect
    // is between days: within a day, at 15-minute resolution, no weather
    // factor explained catches (Arlinghaus et al. 2017).
    // The breeze +10 above already pays this finding at 4–8 m/s; the flag
    // drops the generic rows that ran against it, so the one study now counts
    // in both. For pike alone, a calm, glassy hour against a 5.5–8 m/s one
    // (waves under 0.6 m) went from +7 vs +5 to 0 vs +10, and 4–5.5 m/s now
    // leads calm by 10 instead of 3: about 12 points of swing from one
    // correlational study of daily catches, applied hour by hour. Whether
    // breeze should shrink now that the −5 no longer offsets half of it is
    // open.
    // A lake takes no sea data (weather.ts takesSeaData), so it has no wave
    // row and no glassy bonus to withhold: the glassy part only matters
    // where gedde is a target at a salt or brackish spot (bd_wave_why).
    // Not only at lakes: the target species are one list for every spot, and
    // scoring doesn't filter them by water type, so for a user with gedde
    // among the targets the flag applies at brackish and salt coasts too.
    // There gedde counts as present (no sea-temperature gate), takes its
    // share of these points as its species-row bonuses always did, and,
    // having no direction table, dilutes bd_shorewind like any target
    // without one (scoring.test.ts 25d).
    windy: true,
    bottomPref:['mixed','seaweed'], depthPref:'shallow',
  },
  sandart: {
    id:'sandart', name:'Sandart', nameEn:'Zander', emoji:'🐊',
    waterType:['fresh','brackish'],
    tip:'Overvejende nataktiv rovfisk, der æder mest ved daggry og i skumringen. Trives i let grumset vand; undgå klart dagslys.',
    tipEn:'A mainly nocturnal predator that feeds most at dawn and dusk. Thrives in slightly turbid water; avoid bright daylight.',
    // Nocturnal, feeds at dawn and dusk, likes turbid water (fiskepleje, high).
    bonuses: { dawn:+8, dusk:+10, night:+10, cloud:+6 },
    bottomPref:['sand','mixed'], depthPref:'medium',
  },
  aborre: {
    id:'aborre', name:'Aborre', nameEn:'Perch', emoji:'🐟',
    waterType:['fresh','brackish','salt'],
    tip:'Flokfisk, der jager med synet – i klare søer er de store aborrer tydeligt dagaktive. Ofte gode hug ved daggry.',
    tipEn:'A schooling fish that hunts by sight – in clear lakes the big perch are clearly active by day. Often good takes at dawn.',
    // Large perch are day-active in clear lakes (fiskepleje, high).
    bonuses: { dawn:+6, daylight:+10 },
    dayFeeder: true,
    bottomPref:['stone','mixed'], depthPref:'shallow',
  },
  pighvar: {
    id:'pighvar', name:'Pighvar', nameEn:'Turbot', emoji:'🐡',
    waterType:['salt'],
    tip:'Rovfisk, der jager om dagen over sandbund. Let bølgegang, der hvirvler byttefisk op, er godt. Bedst om sommeren (maj–august); når vandet kommer under ca. 10 °C, trækker de fleste fladfisk ud på dybere vand.',
    tipEn:'A predator that hunts by day over sandy bottoms. Light wave action that stirs up baitfish is good. Best in summer (May–August); once the water drops below about 10 °C, most flatfish move out to deeper water.',
    // "Hunts during the day" (fiskepleje, high); the tide bonus overclaimed for
    // inner waters, where the tide is a few cm (K§1.1, high).
    bonuses: { daylight:+8, waveLight:+10, tide:+5 },
    sst: [[9,.3],[11,.7],[12,1]],
    dayFeeder: true,
    bottomPref:['sand'], depthPref:'shallow',
  },
  makrel: {
    id:'makrel', name:'Makrel', nameEn:'Mackerel', emoji:'🐟',
    waterType:['salt'],
    tip:'Sommergæst i stimer, der først kommer ind under land, når vandet er varmt (over ca. 12 °C) – i de indre farvande mest juli–september. Mest stabil i det salte vand i Kattegat og nord for København; længere sydpå og ved Bornholm mere tilfældig. Bedst tidlig morgen og sen aften på dybt vand tæt på land med strøm: moler, odder og broer.',
    tipEn:'A summer visitor in schools that only comes inshore once the water is warm (above about 12 °C) – in the inner Danish waters mostly July–September. Most reliable in the saltier water of the Kattegat and north of Copenhagen; further south and around Bornholm more hit-and-miss. Best early morning and late evening over deep water close to land with current: piers, points and bridges.',
    // Dawn/dusk (Sportsfiskeren, medium); deep water close to land (medium).
    // The old calm bonus is disputed (K§3.4).
    bonuses: { dawn:+8, dusk:+8, deep:+8 },
    // Low–medium (a synthesis, K§3.1). The high-confidence parts: found above
    // 8 °C (Utne et al. 2012) and spawning at 11–14 °C (fiskepleje). The 15–20 °C
    // peak rests on anglers (low) and on the inner waters' July–September
    // inshore season. Conflict: offshore, the preferred band is 9–13 °C
    // (Nikolioudakis et al. 2018, high), where this curve gives only 0.2–0.5 —
    // it encodes when the schools are within reach of the shore, not where the
    // fish are most comfortable. Like hornfisk's (critique S1), it can't tell
    // arrival from departure: October's 13–16 °C reads 0.65–1 while the
    // schools are leaving.
    sst: [[7,0],[8,.05],[10,.2],[12,.5],[14,.8],[15,1],[20,1],[22,.8]],
    visitor: true,
    bottomPref:[], depthPref:'medium',
  },
  hornfisk: {
    id:'hornfisk', name:'Hornfisk', nameEn:'Garfish', emoji:'🐟',
    waterType:['salt'],
    tip:'Jager med synet i dagslys og helst i solskin. Sæsonen går fra midt i april til juni med top i maj; nogle fisk igen i august–september, før de trækker ud.',
    tipEn:'Hunts by sight in daylight, preferably in sunshine. The season runs from mid-April to June, peaking in May; some fish again in August–September before they leave.',
    // Sight feeder, "mostly active during the day" (Naturhistorisk Museum,
    // high); "can be caught all day, provided the sun is shining" (medium).
    // The old dawn bonus contradicts both (K§4).
    bonuses: { daylight:+10, sunny:+10 },
    // Low: inferred from its arrival timing against coastal sea temperature;
    // the migration is "probably driven by temperature" (fiskepleje, high for
    // the qualitative claim only).
    // Known limit (critique S1, not adopted): sea temperature can't tell a
    // fish arriving from one leaving. The 12–17 °C plateau is late June–July
    // and again September–October in the inner waters, the months it leaves
    // for the Atlantic (fiskepleje, high), while the May peak (DTU
    // hornfiskebarometer, high) comes in 8–11 °C water, gated below ~8.7 °C.
    // So this curve overrates July–October and underrates the spring run; a
    // month or falling-SST taper for visitors would be the fix.
    sst: [[8,0],[9,.3],[10,.6],[12,1],[17,1],[20,.7]],
    visitor: true, dayFeeder: true,
    bottomPref:[], depthPref:'shallow',
  },
  torsk: {
    id:'torsk', name:'Torsk', nameEn:'Cod', emoji:'🐡',
    waterType:['salt'],
    tip:`Fangstforbud i hele Østersøen (Bælterne, Øresund, Bornholm) i ${COD_YEARS_DA}; tilladt i Kattegat, Skagerrak og Nordsøen. Klik ⚠️ for detaljer.`,
    tipEn:`Fishing ban in the whole Baltic (the Belts, the Sound, Bornholm) in ${COD_YEARS_EN}; allowed in the Kattegat, Skagerrak and North Sea. Click ⚠️ for details.`,
    bonuses: { deep:+6 },
    // Mainly 2–10 °C, avoids warm shallows in summer (fiskepleje, Naturhistorisk Museum, high).
    sst: [[0,1],[10,1],[12,.6],[15,.2],[20,.1]],
    bottomPref:['stone','mixed'], depthPref:'deep',
    restricted: true,
    // Banned in ICES 22–32 only (regulations.ts BALTIC_COD_BAN_YEARS, with the
    // sources); legal in the Kattegat, Skagerrak and North Sea at 30 / 35 cm
    // (lfst 2026), where Fornæs Fyr and Hundested list cod. `banned` blocked
    // targeting it anywhere; now it can be selected after the notice, and the
    // dashboard flags a window at a Baltic spot. Bornholm sits on the 24/25
    // border (Reg. 2187/2005 Annex I): both are in the ban.
    selectNotice: true,
    warningText: `🚫 FANGSTFORBUD I ØSTERSØEN ${COD_YEARS_DA}\n\nRekreativt torskefiskeri er forbudt i hele Østersøen i ${COD_YEARS_DA} (ICES 22–32): Bælterne, Øresund, farvandene syd for Sjælland og hele farvandet omkring Bornholm. En torsk, der fanges ved et uheld, skal genudsættes straks.\n\nI Kattegat, Skagerrak og Nordsøen er torskefiskeri tilladt. Mindstemål: 30 cm i Skagerrak/Kattegat, 35 cm i Nordsøen.\n\nForbuddet for 2027 bygger på EU-landbrugs- og fiskeriministrenes aftale af 26. oktober 2026. Tjek altid de aktuelle regler på lfst.dk, inden du fisker.`,
    warningTextEn: `🚫 FISHING BAN IN THE BALTIC ${COD_YEARS_EN}\n\nRecreational cod fishing is banned in the whole Baltic Sea in ${COD_YEARS_EN} (ICES 22–32): the Belts, the Sound, the waters south of Zealand and all the waters around Bornholm. A cod caught by accident must be released at once.\n\nIn the Kattegat, Skagerrak and North Sea cod fishing is allowed. Minimum size: 30 cm in the Skagerrak/Kattegat, 35 cm in the North Sea.\n\nThe 2027 ban rests on the EU fisheries ministers' agreement of 26 October 2026. Always check the current rules at lfst.dk before fishing.`,
  },
  havbars: {
    id:'havbars', name:'Havbars', nameEn:'Sea Bass', emoji:'🐟',
    waterType:['salt'],
    tip:'Stærk rovfisk, der elsker strøm og brændingszonen. Aktiv ved daggry og i skumringen på rev og sandbund.',
    tipEn:'A strong predator that loves current and the surf zone. Active at dawn and dusk over reefs and sandy bottoms.',
    bonuses: { dawn:+10, dusk:+8, tide:+6 },
    bottomPref:['stone','sand'], depthPref:'shallow',
    restricted: true,
    // lfst 2026 saltwater list and havbars page (checked 2026-11-06): 3 a day
    // in January and 1 April – 31 December, none in February–March. The text
    // had January as catch-and-release only, and 4 a day in IVc and 7a–7k.
    warningText: '⚠️ DAGSKVOTER GÆLDER\n\n• Nordsøen syd for Hanstholm (ICES IVb), IVc og 7a–7k: højst 3 havbars pr. fisker pr. dag i januar og fra 1. april til 31. december.\n• I februar og marts er kun catch-and-release tilladt: ingen havbars må tages med hjem.\n• Kun stang eller håndline.\n\nMindstemål: 42 cm (Nordsøen og Skagerrak/Kattegat). EU-regler, der fastsættes hvert år. Kilde: lfst.dk (2026)',
    warningTextEn: '⚠️ DAILY BAG LIMITS APPLY\n\n• North Sea south of Hanstholm (ICES IVb), IVc and 7a–7k: at most 3 bass per angler per day in January and from 1 April to 31 December.\n• In February and March only catch and release is allowed: no bass may be kept.\n• Rod or handline only.\n\nMinimum size: 42 cm (North Sea and Skagerrak/Kattegat). EU rules, set every year. Source: lfst.dk (2026)',
  },
  laks: {
    id:'laks', name:'Laks', nameEn:'Salmon', emoji:'🐟',
    waterType:['fresh','salt'],
    tip:'Kræver strømmende, koldt vand. Bedst i lavt lys ved daggry og i skumringen.',
    tipEn:'Needs flowing, cold water. Best in low light at dawn and dusk.',
    bonuses: { dawn:+6, dusk:+6 },
    bottomPref:['stone'], depthPref:'medium',
    restricted: true,
    warningText: '⚠️ FANGSTBEGRÆNSNINGER\n\n• Max 1 fedtfinneklippet laks per dag (saltvand).\n• Mindstemål: 60 cm (saltvand), 40 cm (ferskvand).\n• Fredning ferskvand: 16. nov – 28. feb.\n• Vadehavet: 15. sep – 28. feb.\n\nKilde: lfst.dk',
    warningTextEn: '⚠️ CATCH RESTRICTIONS\n\n• Max 1 adipose-fin-clipped salmon per day (saltwater).\n• Minimum size: 60 cm (saltwater), 40 cm (freshwater).\n• Closed season freshwater: 16 Nov – 28 Feb.\n• Wadden Sea: 15 Sep – 28 Feb.\n\nSource: lfst.dk',
  },
  skrubbe: {
    id:'skrubbe', name:'Skrubbe', nameEn:'Flounder', emoji:'🐡',
    waterType:['salt','brackish'],
    tip:'Opportunistisk fladfisk på mudder- og sandbund og i brakvand. Mest aktiv ved solopgang, solnedgang og højvande, og står højere i vandet om natten. Fanges mest fra juli til november.',
    tipEn:'An opportunistic flatfish on mud and sand and in brackish water. Most active at sunrise, sunset and high water, and higher in the water at night. Mostly caught from July to November.',
    // "Most active at sunrise, sunset and high tide", higher in the water at
    // night (fiskepleje, high); the calm bonus had no source.
    bonuses: { dawn:+6, dusk:+6, night:+5, tide:+8 },
    sst: [[9,.3],[11,.7],[12,1]],
    bottomPref:['mud','sand','mixed'], depthPref:'shallow',
  },
  roedspætte: {
    id:'roedspætte', name:'Rødspætte', nameEn:'Plaice', emoji:'🐡',
    waterType:['salt'],
    tip:'Klassisk sandbundsfisk, der ligger nedgravet om dagen og især æder om natten, hvor den søger ind på lavere vand. Trækker ind mod kysten om foråret og ud igen om efteråret.',
    tipEn:'A classic sandy-bottom fish that lies buried by day and feeds mainly at night, when it moves into shallower water. Moves towards the coast in spring and back out in autumn.',
    // "Feeds mainly at night" (fiskepleje, high).
    bonuses: { night:+13, tide:+5, waveLight:+5 },
    sst: [[9,.3],[11,.7],[12,1]],
    bottomPref:['sand','mixed'], depthPref:'shallow',
  },
  ising: {
    id:'ising', name:'Ising', nameEn:'Dab', emoji:'🐡',
    waterType:['salt'],
    tip:'Almindelig fladfisk på sandbund, der jager mere aktivt om dagen end de større fladfisk. Fra kysten mest i den varme del af året. Intet mindstemål – en god begynderfisk på orm og små stykker madding.',
    tipEn:'A common flatfish on sandy bottoms that hunts more actively by day than the larger flatfish. From the shore mostly in the warm part of the year. No minimum size – a good beginner\'s fish on worms and small pieces of bait.',
    bonuses: { daylight:+8, tide:+5 },
    sst: [[9,.3],[11,.7],[12,1]],
    dayFeeder: true,
    bottomPref:['sand','mud'], depthPref:'shallow',
  },
  lubbe: {
    id:'lubbe', name:'Lubbe', nameEn:'Pollock', emoji:'🐟',
    waterType:['salt'],
    tip:'Aktiv halvpelagisk rovfisk ved rev, stenstrukturer og vrag. Tager spinnere og gummiagn. Bedst ved kraftig strøm ved daggry og i skumringen.',
    tipEn:'An active semi-pelagic predator near reefs, rocky structure and wrecks. Takes spinners and soft lures. Best in strong current at dawn and dusk.',
    bonuses: { dawn:+9, dusk:+8, tide:+8 },
    bottomPref:['stone'], depthPref:'deep',
  },
  morksej: {
    id:'morksej', name:'Mørksej', nameEn:'Coalfish', emoji:'🐟',
    waterType:['salt'],
    tip:'Pelagisk stimefisk, der jager sild og tobis over dybere rev. Fanger godt på tunge gummiagn og pirke, når strømmen sætter i – bedst i de koldere måneder.',
    tipEn:'A schooling pelagic fish that hunts herring and sandeel over deeper reefs. Fishes well on heavy soft lures and pirks when the current picks up – best in the colder months.',
    bonuses: { tide:+10, dawn:+6 },
    bottomPref:['stone','mixed'], depthPref:'deep',
  },
  sild: {
    id:'sild', name:'Sild', nameEn:'Herring', emoji:'🐟',
    waterType:['salt','brackish'],
    tip:'Sild går i store stimer langs kysten – især fra sidst i marts til først i maj, når de søger ind for at gyde (i mange havne omkring påske), og igen i september–oktober. Fanges fra mole og havn på sildeforfang, gerne i sol og let vind. Følger vand på ca. 5–10 °C.',
    tipEn:'Herring move in large schools along the coast – especially from late March to early May, when they come in to spawn (around Easter in many harbours), and again in September–October. Caught from piers and harbours on herring rigs, preferably in sunshine and a light breeze. They follow water of about 5–10 °C.',
    // "Gerne bagende sol og let vind" (fishingindenmark, medium): let vind is
    // a light breeze, not dead calm, which the old calm bonus paid.
    bonuses: { sunny:+10, lightWind:+8 },
    // Follows ~5–10 °C (Sportsfiskeren, medium).
    sst: [[2,.5],[4,1],[10,1],[14,.6],[18,.3]],
    dayFeeder: true,
    bottomPref:[], depthPref:'medium',
  },
  hvilling: {
    id:'hvilling', name:'Hvilling', nameEn:'Whiting', emoji:'🐡',
    waterType:['salt','brackish'],
    tip:'Aktiv bundfisk, der fanges bedst om efteråret og vinteren. Bedst om aftenen og natten på orm eller fiskestykker.',
    tipEn:'An active bottom fish that catches best in autumn and winter. Best in the evening and at night on worms or cut bait.',
    bonuses: { dusk:+8, night:+6 },
    bottomPref:['sand','mixed'], depthPref:'medium',
  },
  brasen: {
    id:'brasen', name:'Brasen', nameEn:'Bream', emoji:'🐡',
    waterType:['fresh','brackish'],
    tip:'Stor flokfisk i lavvandede, næringsrige søer, bedst forår og sommer. Mest aktiv omkring solopgang og solnedgang og søger næsten ikke føde under ca. 8 °C.',
    tipEn:'A large schooling fish of shallow, nutrient-rich lakes, best in spring and summer. Most active around sunrise and sunset, and hardly feeds below about 8 °C.',
    // Most active around sunrise and sunset, LOWEST at night (fiskepleje,
    // high) — so no night bonus, whatever night-angling practice says.
    bonuses: { dawn:+8, dusk:+8 },
    bottomPref:['mud','mixed'], depthPref:'shallow',
  },
  karpe: {
    id:'karpe', name:'Karpe', nameEn:'Carp', emoji:'🐡',
    waterType:['fresh'],
    tip:'Stor, stærk fisk, der om sommeren æder mest ved daggry og i skumringen; forår og efterår flytter aktiviteten til dagen, når vandet er varmest. Holder op med at æde under ca. 6 °C.',
    tipEn:'A large, strong fish that feeds most at dawn and dusk in summer; in spring and autumn activity moves to the day, when the water is warmest. Stops feeding below about 6 °C.',
    // Summer feeding peaks at dawn and dusk (fiskepleje, high).
    bonuses: { dawn:+6, dusk:+6 },
    bottomPref:['mud','mixed'], depthPref:'shallow',
  },
  suder: {
    id:'suder', name:'Suder', nameEn:'Tench', emoji:'🐡',
    waterType:['fresh'],
    tip:'Smuk grøn-bronze ferskvandsfisk med karakteristiske røde øjne – en nær slægtning til karpen. Foretrækker varmt, stille vand med tæt undervandsvegetation. Mest aktiv morgen og aften om sommeren og gemmer sig i planterne om dagen.',
    tipEn:'Beautiful green-bronze freshwater fish with distinctive red eyes – a close relative of the carp. Prefers warm, still water with dense underwater vegetation. Most active in the morning and evening in summer, hiding in the plants by day.',
    // Most active morning and evening (fiskepleje, high). The tip used to
    // add "Mindstemål: 25 cm", which neither lfst list has (checked 2026-11-06).
    bonuses: { dawn:+10, dusk:+6 },
    bottomPref:['mud','seaweed'], depthPref:'shallow',
  },
  stenbider: {
    id:'stenbider', name:'Stenbider', nameEn:'Lumpsucker', emoji:'🐡',
    waterType:['salt','brackish'],
    tip:'Totalfredet: Lystfiskere må ikke fange stenbider, og en fisk, der fanges ved et uheld, skal genudsættes straks. Hunnerne søger ind på lavt vand for at gyde fra februar til maj.',
    tipEn:'Fully protected: anglers may not catch lumpsucker, and a fish caught by accident must be released at once. The females move into shallow water to spawn from February to May.',
    bonuses: { dawn:+6, tide:+5 },
    bottomPref:['stone'], depthPref:'shallow',
    // Total recreational ban since 17 Jan 2025, continued through 2026
    // (fiskepleje / TV2 Kosmopol, high; the 2026 order itself not found, medium).
    restricted: true,
    banned: true,
    warningText: '🚫 TOTALFREDET\n\nStenbider må ikke fanges af lyst- og fritidsfiskere (forbud siden 17. januar 2025, videreført i 2026). En fisk, der fanges ved et uheld, skal genudsættes straks.\n\nTjek altid de aktuelle regler på lfst.dk.',
    warningTextEn: '🚫 FULLY PROTECTED\n\nRecreational anglers may not catch lumpsucker (banned since 17 January 2025, continued in 2026). A fish caught by accident must be released immediately.\n\nAlways check the current rules at lfst.dk.',
  },
  fjaesing: {
    id:'fjaesing', name:'Fjæsing', nameEn:'Greater Weever', emoji:'☠️',
    waterType:['salt'],
    tip:'Graver sig ned i sandbunden med giftige pigge opad og jager mest om natten. Fanges bedst på sandstrand i den varme del af året (juni–september). Fremragende spisefisk – men brug ALTID tang ved håndtering!',
    tipEn:'Buries itself in the sandy bottom with venomous spines pointing up, and hunts mostly at night. Best caught from sandy beaches in the warm part of the year (June–September). Excellent eating – but ALWAYS use pliers when handling!',
    // "Hunts mainly at night" (fiskepleje, high); the calm bonus had no source.
    bonuses: { night:+13, waveLight:+4, tide:+4 },
    sst: [[8,0],[10,.2],[13,.6],[15,1],[18,1],[21,.7]],
    // Low (critique M9): fiskepleje's 15–18 °C is the temperature of best
    // SPAWNING success in the Kattegat, not a band where it is found or
    // caught; the curve infers its summer-half-year shallows from it.
    // The cold end (onshore spec §2.9). In winter it fasts at 16–25 m in
    // water below 6 °C (88–98 % empty stomachs January–April); in May it
    // moves inshore (< 15 m) and starts feeding; the inshore pound nets took
    // it May–September, most in June; in September it starts moving back
    // towards 15–24 m, and in October and November it is at about 24 m with
    // over 60 % of stomachs empty again (Bagge 2004, ICES J. Mar. Sci.
    // 61:933, Kattegat 1961–73, high). Shallow (1–25 m) in the summer
    // half-year, deeper and fasting in the winter half (fiskepleje, high);
    // 2–15 m in summer, near-dormant in winter (Naturhistorisk Museum, high).
    // The inner waters are ~8–10 °C in May and 10–15 °C in June (K§1.3,
    // medium), so 0 at 8 °C rising to the gate's 0.2 at 10 °C, where makrel's
    // crosses it too, lets it in from about late May (low–medium: the mapping
    // to sea temperature is an inference). Two facts in Bagge weaken it: his
    // only temperature is a feeding border of about 6 °C at the seabed, and
    // aquarium fish refused food from October to March at a constant
    // 14–16 °C, which he reads as an internal feeding rhythm rather than a
    // response to temperature. May is already a feeding month (38 % of
    // stomachs empty) with a pound-net catch about a third of June's, so
    // 10 °C likely admits it a few weeks after it arrives. The curve
    // began flat at 0.2, which the strict gate never undercut, so it counted
    // as present all year. Like makrel's, it can't tell arrival from
    // departure, and departure starts in September: September's water reads
    // well above the gate while the fish start leaving, and October's
    // 10–12 °C reads present while Bagge has them at about 24 m.
    visitor: true,
    bottomPref:['sand'], depthPref:'shallow',
    venom: true,
    warningText: '☠️ GIFTIGE PIGGE — Alvorlig fare!\n\nFjæsingen har giftige pigge på rygfinnen og gællelågene. Den graver sig ned i sandbunden med pigge opad og er næsten usynlig — særlig farlig for vadefiskere på sandstrande.\n\n🩺 VED STIK: Nedsænk STRAKS i så varmt vand du kan tåle (45–50°C) i 30–60 min. Varme nedbryder giften og reducerer smerten.\n\n🦾 HÅNDTERING: Brug altid fiskepincet/tang. Skær alle pigge af med saks inden rensning.',
    warningTextEn: '☠️ VENOMOUS SPINES — Serious danger!\n\nThe greater weever has venomous spines on its dorsal fin and gill covers. It buries itself in the sand with spines pointing up and is nearly invisible — especially dangerous for wading anglers on sandy beaches.\n\n🩺 IF STUNG: IMMEDIATELY immerse in water as hot as you can tolerate (45–50°C) for 30–60 min. Heat breaks down the venom and reduces the pain.\n\n🦾 HANDLING: Always use fishing pliers. Cut off all spines with scissors before cleaning.',
  },
};
