export interface SpeciesPref {
  id: string; name: string; nameEn: string; emoji: string;
  waterType: string[]; tip: string; tipEn?: string;
  bonuses: Record<string, number>;
  bottomPref: string[]; depthPref: string;
  restricted?: boolean; banned?: boolean; venom?: boolean;
  warningText?: string; warningTextEn?: string;
  /**
   * Water-temperature preference: [°C, 0–1] breakpoints, ascending,
   * piecewise-linear and flat beyond the ends. Read by the bd_watertemp row
   * (0.5 is neutral). Omitted where no source gives one.
   */
  sst?: [number, number][];
  /**
   * When the species feeds through the day, so the global dawn/dusk bonus and
   * midday penalty don't apply to it: 'day' always, 'dayWhenCold' in water
   * under 10 °C. Omitted: the global time-of-day curve applies.
   */
  todProfile?: 'day' | 'dayWhenCold';
}
/**
 * FishCast - species targeting preferences (names, tips, warnings, score bonuses)
 * Consumed by the scoring engine and all species UI.
 *
 * Model v2 rewrote the bonuses, curves and tips from the research behind
 * model-spec.md (K§ = its knowledge.md section). Confidence is the research's:
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
    tip:'Kystens klassiker. Bedst i 6–12 °C vand, dvs. forår og efterår. Søg pålandsvind med lidt bølgegang og let grumset vand; spejlblankt og krystalklart vand er sjældent godt. Om sommeren mest ved daggry, skumring og nat; fra oktober til april kan den tage hele dagen.',
    tipEn:'The coastal classic. Best in 6–12 °C water, i.e. spring and autumn. Look for onshore wind with some chop and slightly coloured water; glassy, gin-clear water is rarely good. In summer mostly at dawn, dusk and night; from October to April it can take all day.',
    // dawn/dusk: low light brings them into the shallows (medium). nightWarm:
    // at night almost permanently at the surface, deep by day above 17 °C (DTU
    // tagging, high). daylightCold: all day once the water cools (medium).
    // breezeOrChop: onshore wind with some chop (low–medium, K§2.4).
    bonuses: { dawn:+5, dusk:+5, nightWarm:+6, daylightCold:+5, breezeOrChop:+5, cloud:+3 },
    // DTU tagging: body temperature 10–16 °C, avoids > 17 °C by day (high);
    // shore fishing starts > 6 °C, very active 8–10 °C (Fisk & Fri, medium).
    // The cold end stays near neutral (0.4–0.5), not low: DTU Fangstjournalen
    // finds catch per hour HIGHER in autumn/winter than spring/summer (high),
    // against the anglers' "hard below 3–4 °C" (medium) — so winter is not
    // penalised beyond −2.
    sst: [[0,.4],[4,.5],[6,.85],[8,1],[12,1],[14,.8],[16,.55],[18,.3],[20,.2]],
    todProfile: 'dayWhenCold',
    bottomPref:['stone','mixed'], depthPref:'shallow',
  },
  gedde: {
    id:'gedde', name:'Gedde', nameEn:'Pike', emoji:'🐊',
    waterType:['fresh'],
    tip:'Bedst omkring solopgang og især i skumringen. Blæst er ingen ulempe – fangsterne er tværtimod ofte bedre i vind og køligt vejr. Foretrækker lavt vand med planter.',
    tipEn:'Best around sunrise and especially at dusk. Wind is no drawback – catches are often better in windy, cool weather. Prefers shallow water with plants.',
    // Higher catch rates at high wind and at dusk (Kuparinen et al. 2010, high);
    // the old calm bonus ran against that.
    bonuses: { breeze:+5, dawn:+4, dusk:+6 },
    bottomPref:['mixed','seaweed'], depthPref:'shallow',
  },
  sandart: {
    id:'sandart', name:'Sandart', nameEn:'Zander', emoji:'🐊',
    waterType:['fresh','brackish'],
    tip:'Overvejende nataktiv rovfisk, der æder mest ved daggry og skumring. Trives i let grumset vand; undgå klart dagslys.',
    tipEn:'A mainly nocturnal predator that feeds most at dawn and dusk. Thrives in slightly turbid water; avoid bright daylight.',
    // Nocturnal, feeds at dawn and dusk, likes turbid water (fiskepleje, high).
    bonuses: { dawn:+6, dusk:+8, night:+8, cloud:+5 },
    bottomPref:['sand','mixed'], depthPref:'medium',
  },
  aborre: {
    id:'aborre', name:'Aborre', nameEn:'Perch', emoji:'🐟',
    waterType:['fresh','brackish','salt'],
    tip:'Flokfisk, der jager med synet – i klare søer er de store aborrer tydeligt dagaktive. Ofte gode hug ved daggry.',
    tipEn:'A schooling fish that hunts by sight – in clear lakes the big perch are clearly active by day. Often good takes at dawn.',
    // Large perch are day-active in clear lakes (fiskepleje, high).
    bonuses: { dawn:+5, daylight:+5 },
    bottomPref:['stone','mixed'], depthPref:'shallow',
  },
  pighvar: {
    id:'pighvar', name:'Pighvar', nameEn:'Turbot', emoji:'🐡',
    waterType:['salt'],
    tip:'Rovfisk, der jager om dagen over sandbund. Let bølgegang, der hvirvler byttefisk op, er godt. Bedst om sommeren (maj–august).',
    tipEn:'A predator that hunts by day over sandy bottoms. Light wave action that stirs up baitfish is good. Best in summer (May–August).',
    // "Hunts during the day" (fiskepleje, high); the tide bonus overclaimed for
    // inner waters, where the tide is a few cm (K§1.1, high).
    bonuses: { daylight:+4, waveLight:+6, tide:+4 },  // waveLight: 0.1–0.6 m
    todProfile: 'day',
    bottomPref:['sand'], depthPref:'shallow',
  },
  makrel: {
    id:'makrel', name:'Makrel', nameEn:'Mackerel', emoji:'🐟',
    waterType:['salt'],
    tip:'Sommergæst i stimer, der først kommer ind under land, når vandet er varmt (over ca. 12 °C) – i de indre farvande mest juli–september. Bedst tidlig morgen og sen aften på dybt vand tæt på land med strøm: moler, odder og broer.',
    tipEn:'A summer visitor in schools that only comes inshore once the water is warm (above about 12 °C) – in the inner Danish waters mostly July–September. Best early morning and late evening over deep water close to land with current: piers, points and bridges.',
    // Dawn/dusk (Sportsfiskeren, medium); deep water close to land (medium).
    // The old calm bonus is disputed (K§3.4).
    bonuses: { dawn:+6, dusk:+6, deep:+4 },
    // Low–medium (a synthesis, K§3.1). The high-confidence parts: found above
    // 8 °C (Utne et al. 2012) and spawning at 11–14 °C (fiskepleje). The 15–20 °C
    // peak rests on anglers (low) and on the inner waters' July–September
    // inshore season. Conflict: offshore, the preferred band is 9–13 °C
    // (Nikolioudakis et al. 2018, high), where this curve gives only 0.2–0.5 —
    // it encodes when the schools are within reach of the shore, not where the
    // fish are most comfortable.
    sst: [[7,0],[8,.05],[10,.2],[12,.5],[14,.8],[15,1],[20,1],[22,.8]],
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
    bonuses: { sunny:+8, daylight:+6 },
    // Low: inferred from its arrival timing against coastal sea temperature;
    // the migration is "probably driven by temperature" (fiskepleje, high for
    // the qualitative claim only).
    sst: [[8,0],[9,.3],[10,.6],[12,1],[17,1],[20,.7]],
    todProfile: 'day',
    bottomPref:[], depthPref:'shallow',
  },
  torsk: {
    id:'torsk', name:'Torsk', nameEn:'Cod', emoji:'🐡',
    waterType:['salt'],
    tip:'Fangsteforbud i 2026. Klik ⛔ for detaljer.',
    tipEn:'Fishing ban in 2026. Click ⛔ for details.',
    bonuses: { deep:+5 },  // deep: needs Location.depth (official spots)
    // Mainly 2–10 °C, avoids warm shallows in summer (fiskepleje, Naturhistorisk Museum, high).
    sst: [[0,1],[10,1],[12,.6],[15,.2],[20,.1]],
    bottomPref:['stone','mixed'], depthPref:'deep',
    restricted: true,
    banned: true,
    // Bornholm (ICES 25): the 2025 landing ban is confirmed, its 2026 status is
    // not — so the text says 2025 and asks the reader to check.
    warningText: '🚫 FANGSTFORBUD 2026\n\nTorskefiskeri er forbudt for lyst- og fritidsfiskere i den vestlige Østersø (ICES 22–24: Bælterne, Øresund og farvandene omkring Sjælland) i hele 2026 i henhold til EU-reglerne om bestandsbeskyttelse. I 2025 var det også forbudt at hjemtage torsk ved Bornholm (ICES 25) – tjek om det gælder i år.\n\nForbuddet kan blive forlænget i 2027. Tjek altid de aktuelle regler på lfst.dk, inden du fisker.',
    warningTextEn: '🚫 FISHING BAN 2026\n\nCod fishing is prohibited for recreational anglers in the Western Baltic (ICES 22–24: the Belts, the Øresund and the waters around Zealand) throughout 2026 under EU stock-protection rules. In 2025, keeping cod was also banned around Bornholm (ICES 25) – check whether that applies this year.\n\nThe ban may be extended into 2027. Always check the current rules at lfst.dk before fishing.',
  },
  havbars: {
    id:'havbars', name:'Havbars', nameEn:'Sea Bass', emoji:'🐟',
    waterType:['salt'],
    tip:'Stærk rovfisk, der elsker strøm og brændingszonen. Aktiv ved daggry og skumring på rev og sandbund.',
    tipEn:'A strong predator that loves current and the surf zone. Active at dawn and dusk over reefs and sandy bottoms.',
    bonuses: { dawn:+8, dusk:+6, tide:+5 },  // not researched beyond dropping solunar
    bottomPref:['stone','sand'], depthPref:'shallow',
    restricted: true,
    warningText: '⚠️ DAGSKVOTER GÆLDER\n\n• Nordsøen syd for Hanstholm: Kun catch-and-release i januar. Max 3 fisk/dag april–december.\n• ICES IVc og 7a–7k: Max 4 fisk/dag april–december.\n\nMindstemål: 42 cm. Kilde: lfst.dk',
    warningTextEn: '⚠️ DAILY BAG LIMITS APPLY\n\n• North Sea south of Hanstholm: Catch-and-release only in January. Max 3 fish/day April–December.\n• ICES IVc and 7a–7k: Max 4 fish/day April–December.\n\nMinimum size: 42 cm. Source: lfst.dk',
  },
  laks: {
    id:'laks', name:'Laks', nameEn:'Salmon', emoji:'🐟',
    waterType:['fresh','salt'],
    tip:'Kræver strømmende, koldt vand. Bedst i lavt lys ved daggry og skumring.',
    tipEn:'Needs flowing, cold water. Best in low light at dawn and dusk.',
    bonuses: { dawn:+5, dusk:+5 },
    bottomPref:['stone'], depthPref:'medium',
    restricted: true,
    warningText: '⚠️ FANGSTBEGRÆNSNINGER\n\n• Max 1 klipfinne-laks per dag (saltvand).\n• Mindstemål: 60 cm (saltvand), 40 cm (ferskvand).\n• Fredning ferskvand: 16. nov – 28. feb.\n• Vadehavet: 15. sep – 28. feb.\n\nKilde: lfst.dk',
    warningTextEn: '⚠️ CATCH RESTRICTIONS\n\n• Max 1 fin-clipped salmon per day (saltwater).\n• Minimum size: 60 cm (saltwater), 40 cm (freshwater).\n• Closed season freshwater: 16 Nov – 28 Feb.\n• Wadden Sea: 15 Sep – 28 Feb.\n\nSource: lfst.dk',
  },
  skrubbe: {
    id:'skrubbe', name:'Skrubbe', nameEn:'Flounder', emoji:'🐡',
    waterType:['salt','brackish'],
    tip:'Opportunistisk fladfisk på mudder- og sandbund og i brakvand. Mest aktiv ved solopgang, solnedgang og højvande, og står højere i vandet om natten. Fanges mest fra juli til november.',
    tipEn:'An opportunistic flatfish on mud and sand and in brackish water. Most active at sunrise, sunset and high water, and higher in the water at night. Mostly caught from July to November.',
    // "Most active at sunrise, sunset and high tide", higher in the water at
    // night (fiskepleje, high); the calm bonus had no source.
    bonuses: { dawn:+5, dusk:+5, night:+3, tide:+4 },
    bottomPref:['mud','sand','mixed'], depthPref:'shallow',
  },
  roedspætte: {
    id:'roedspætte', name:'Rødspætte', nameEn:'Plaice', emoji:'🐡',
    waterType:['salt'],
    tip:'Klassisk sandbundsfisk, der ligger nedgravet om dagen og især æder om natten, hvor den søger ind på lavere vand. Trækker ind mod kysten om foråret og ud igen om efteråret.',
    tipEn:'A classic sandy-bottom fish that lies buried by day and feeds mainly at night, when it moves into shallower water. Moves towards the coast in spring and back out in autumn.',
    // "Feeds mainly at night" (fiskepleje, high).
    bonuses: { night:+8, tide:+4, waveLight:+4 },
    bottomPref:['sand','mixed'], depthPref:'shallow',
  },
  ising: {
    id:'ising', name:'Ising', nameEn:'Dab', emoji:'🐡',
    waterType:['salt'],
    tip:'Meget almindelig fladfisk i danske farvande — let at fange på sandbund hele sæsonen. Ingen mindstemål, god begynderfisk. Tager orm og småstykker madding.',
    tipEn:'Very common flatfish in Danish waters — easy to catch on sandy bottoms all season. No minimum size, a good beginner fish. Takes worms and small bait pieces.',
    bonuses: { tide:+5, calm:+5 },  // not researched
    bottomPref:['sand','mud'], depthPref:'shallow',
  },
  lubbe: {
    id:'lubbe', name:'Lubbe', nameEn:'Pollock', emoji:'🐟',
    waterType:['salt'],
    tip:'Aktiv halvpelagisk rovfisk ved rev, stenstrukturer og vrag. Tager spinnere og gummiagn. Bedst ved kraftig strøm i daggry og skumring.',
    tipEn:'An active semi-pelagic predator near reefs, rocky structure and wrecks. Takes spinners and soft lures. Best in strong current at dawn and dusk.',
    bonuses: { dawn:+7, dusk:+6, tide:+6 },
    bottomPref:['stone'], depthPref:'deep',
  },
  morksej: {
    id:'morksej', name:'Mørksej', nameEn:'Coalfish', emoji:'🐟',
    waterType:['salt'],
    tip:'Skolevis pelagisk fisk der jager sild og tobis over dybere offshore-rev. Fanger godt på tunge gummiagn og pirke ved tidevandsskift — bedst i de koldere måneder.',
    tipEn:'Schooling pelagic fish that hunts herring and sandeel over deeper offshore reefs. Fishes well on heavy soft lures and pirks at tide changes — best in the colder months.',
    bonuses: { tide:+8, dawn:+5 },
    bottomPref:['stone','mixed'], depthPref:'deep',
  },
  sild: {
    id:'sild', name:'Sild', nameEn:'Herring', emoji:'🐟',
    waterType:['salt','brackish'],
    tip:'Sild går i store stimer langs kysten – især forår og efterår, og i Øresund i store mængder om efteråret. Fanges fra mole og havn på pirk eller sildeforfang og følger vand på ca. 5–10 °C.',
    tipEn:'Herring move in large schools along the coast – especially in spring and autumn, and in great numbers in the Øresund in autumn. Caught from piers and harbours on pirks or herring rigs; they follow water of about 5–10 °C.',
    bonuses: { calm:+6, cloud:+5, dawn:+3 },  // harmless, not researched (K§7)
    // Follows ~5–10 °C (Sportsfiskeren, medium).
    sst: [[2,.5],[4,1],[10,1],[14,.6],[18,.3]],
    bottomPref:[], depthPref:'medium',
  },
  hvilling: {
    id:'hvilling', name:'Hvilling', nameEn:'Whiting', emoji:'🐡',
    waterType:['salt','brackish'],
    tip:'Aktiv bundfisk, der fanger bedst om efteråret og vinteren. Bedst om aftenen og natten på orm eller fiskestykker.',
    tipEn:'An active bottom fish that catches best in autumn and winter. Best in the evening and at night on worms or cut bait.',
    bonuses: { dusk:+6, night:+5 },
    bottomPref:['sand','mixed'], depthPref:'medium',
  },
  brasen: {
    id:'brasen', name:'Brasen', nameEn:'Bream', emoji:'🐡',
    waterType:['fresh','brackish'],
    tip:'Stor flokfisk i lavvandede, næringsrige søer, bedst forår og sommer. Mest aktiv omkring solopgang og solnedgang og søger næsten ikke føde under ca. 8 °C.',
    tipEn:'A large schooling fish of shallow, nutrient-rich lakes, best in spring and summer. Most active around sunrise and sunset, and hardly feeds below about 8 °C.',
    // Most active around sunrise and sunset, LOWEST at night (fiskepleje,
    // high) — so no night bonus, whatever night-angling practice says.
    bonuses: { dawn:+6, dusk:+6 },
    bottomPref:['mud','mixed'], depthPref:'shallow',
  },
  karpe: {
    id:'karpe', name:'Karpe', nameEn:'Carp', emoji:'🐡',
    waterType:['fresh'],
    tip:'Stor, stærk fisk, der om sommeren æder mest ved daggry og skumring; forår og efterår flytter aktiviteten til dagen, når vandet er varmest. Stopper med at æde under ca. 6 °C.',
    tipEn:'A large, strong fish that feeds most at dawn and dusk in summer; in spring and autumn activity moves to the day, when the water is warmest. Stops feeding below about 6 °C.',
    // Summer feeding peaks at dawn and dusk (fiskepleje, high).
    bonuses: { dawn:+5, dusk:+5 },
    bottomPref:['mud','mixed'], depthPref:'shallow',
  },
  suder: {
    id:'suder', name:'Suder', nameEn:'Tench', emoji:'🐡',
    waterType:['fresh'],
    tip:'Smuk grøn-bronze ferskvandsfisk med karakteristiske røde øjne – en nær slægtning til karpen. Foretrækker varmt, stille vand med tæt undervandsvegetation. Mest aktiv morgen og aften om sommeren og gemmer sig i planterne om dagen. Mindstemål: 25 cm.',
    tipEn:'Beautiful green-bronze freshwater fish with distinctive red eyes – a close relative of the carp. Prefers warm, still water with dense underwater vegetation. Most active in the morning and evening in summer, hiding in the plants by day. Minimum size: 25 cm.',
    // Most active morning and evening (fiskepleje, high).
    bonuses: { dawn:+8, dusk:+5 },
    bottomPref:['mud','seaweed'], depthPref:'shallow',
  },
  stenbider: {
    id:'stenbider', name:'Stenbider', nameEn:'Lumpsucker', emoji:'🐡',
    waterType:['salt','brackish'],
    tip:'Totalfredet: Lystfiskere må ikke fange stenbider, og en fisk, der fanges ved et uheld, skal genudsættes straks. Hunnerne søger ind på lavt vand for at gyde fra februar til maj.',
    tipEn:'Fully protected: anglers may not catch lumpsucker, and a fish caught by accident must be released at once. The females move into shallow water to spawn from February to May.',
    bonuses: { dawn:+5, tide:+4 },
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
    bonuses: { night:+8, waveLight:+3, tide:+3 },
    // Best at 15–18 °C (fiskepleje, high for the band, medium for the curve).
    sst: [[10,.2],[13,.6],[15,1],[18,1],[21,.7]],
    bottomPref:['sand'], depthPref:'shallow',
    venom: true,
    warningText: '☠️ GIFTIGE PIGGE — Alvorlig fare!\n\nFjæsingen har giftige pigge på rygfinnen og gællelågene. Den graver sig ned i sandbunden med pigge opad og er næsten usynlig — særlig farlig for vadefiskere på sandstrande.\n\n🩺 VED STIK: Nedsænk STRAKS i så varmt vand du kan tåle (45–50°C) i 30–60 min. Varme nedbryder giften og reducerer smerten.\n\n🦾 HÅNDTERING: Brug altid fiskepincet/tang. Skær alle pigge af med saks inden rensning.',
    warningTextEn: '☠️ VENOMOUS SPINES — Serious danger!\n\nThe greater weever has venomous spines on its dorsal fin and gill covers. It buries itself in the sand with spines pointing up and is nearly invisible — especially dangerous for wading anglers on sandy beaches.\n\n🩺 IF STUNG: IMMEDIATELY immerse in water as hot as you can tolerate (45–50°C) for 30–60 min. Heat breaks down the venom and reduces the pain.\n\n🦾 HANDLING: Always use fishing pliers. Cut off all spines with scissors before cleaning.',
  },
};
