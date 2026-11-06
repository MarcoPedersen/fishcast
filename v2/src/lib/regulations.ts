// @ts-nocheck
// Ported from v1 regulations-dk.js — Danish fishing regulations (guidance only)
import { SEA_AREAS } from './ruleArea'
/**
 * FishCast — Danish Fishing Regulations Dataset
 * Region: Denmark (DK)
 *
 * ⚠ DISCLAIMER: These data are for guidance only and may be incomplete.
 * Always verify current rules at: https://lfst.dk/lyst-og-fritidsfiskeri/mindstemaal-og-fredningstider/
 * Regulations are subject to change (e.g. EU emergency measures, annual updates).
 * Last reviewed against lfst.dk: 6 November 2026 (the 2026 saltwater list, the
 * freshwater list and the species pages). Each rule names its source.
 */

export const DK_REGULATIONS: any = {
  region: 'Denmark',
  regionCode: 'dk',
  currency: 'DKK',
  officialUrl: 'https://lfst.dk/lyst-og-fritidsfiskeri/mindstemaal-og-fredningstider/',
  disclaimer: 'Regler er vejledende. Verificér altid på lfst.dk inden fiskeri.',

  // ── Saltwater Areas (used in size rules) ──────────────────
  areas: {
    // The columns of lfst's 2026 minimum-size list; ruleArea.ts places a
    // location in them. 'belts' is the whole Baltic (ICES 22–32): Bornholm
    // (24/25) is in it, and no Danish water lies in 26–32.
    northSea:   { id: 'northSea',   label: 'Nordsøen (inkl. Limfjorden & Ringkøbing Fjord)' },
    skagerrak:  { id: 'skagerrak',  label: 'Skagerrak / Kattegat' },
    belts:      { id: 'belts',      label: 'Bælterne & Østersøen (22-32)' },
    everywhere: { id: 'everywhere', label: 'Overalt' },
  },

  // ── Species ───────────────────────────────────────────────
  species: [

    // ═══════════════════ SALTWATER ═══════════════════
    {
      id: 'torsk',
      name: 'Torsk',
      nameEn: 'Cod',
      emoji: '🐡',
      waterType: ['salt'],
      sizes: [
        { area: 'northSea',  minCm: 35 },
        { area: 'skagerrak', minCm: 30 },
        { area: 'belts',     minCm: 35 },
      ],
      closedSeasons: [],
      restrictions: [
        { note: '🚫 Torskefiskeri forbudt i hele 2026 i Vestlige Østersø (ICES 22-24).', noteEn: '🚫 Cod fishing banned throughout 2026 in the Western Baltic (ICES 22-24).', year: 2026 },
      ],
      bestMonths: [9, 10, 11, 12, 1, 2, 3],
      habitat: 'Sandbund, rev, offshore',
      status: 'restricted', // 'open' | 'restricted' | 'closed'
    },
    {
      id: 'roedspætte',
      name: 'Rødspætte',
      nameEn: 'Plaice',
      emoji: '🐡',
      waterType: ['salt'],
      // lfst "Mindstemål … i saltvand" 2026 (valid from 01.01.2026), checked 2026-11-06.
      // 27 cm everywhere scolded a legal 26 cm plaice from the Belts.
      sizes: [
        { area: 'northSea',  minCm: 27 },
        { area: 'skagerrak', minCm: 27 },
        { area: 'belts',     minCm: 25 },
      ],
      closedSeasons: [],
      bestMonths: [3, 4, 5, 6, 7, 8, 9, 10],
      habitat: 'Sandbund, kystnært',
      status: 'open',
    },
    {
      id: 'skrubbe',
      name: 'Skrubbe',
      nameEn: 'Flounder',
      emoji: '🐡',
      waterType: ['salt', 'brackish'],
      // lfst "Mindstemål … i saltvand" 2026 (valid from 01.01.2026), checked 2026-11-06.
      // "Bælterne og Østersøen: underområde 22-25: 23 cm" (26-28: 21 cm and
      // 29-32: 18 cm lie outside Danish waters). No minimum in the Kattegat or
      // the North Sea.
      sizes: [
        { area: 'belts',   minCm: 23, areaNote: 'ICES 22-25' },
      ],
      closedSeasons: [],
      bestMonths: [3, 4, 5, 6, 7, 8, 9, 10],
      habitat: 'Sand- og mudderbund, fjorde',
      status: 'open',
    },
    {
      id: 'pighvar',
      name: 'Pighvar',
      nameEn: 'Turbot',
      emoji: '🐡',
      waterType: ['salt'],
      sizes: [
        { area: 'belts', minCm: 30, areaNote: 'Bælter & Østersøen' },
      ],
      closedSeasons: [],
      bestMonths: [5, 6, 7, 8, 9],
      habitat: 'Sandbund, kystrev',
      status: 'open',
    },
    {
      id: 'slethvar',
      name: 'Slethvar',
      nameEn: 'Brill',
      emoji: '🐡',
      waterType: ['salt'],
      // lfst "Mindstemål … i saltvand" 2026 (valid from 01.01.2026), checked 2026-11-06.
      // Only "Bælterne og Østersøen: 30 cm"; the app had 25 cm everywhere.
      sizes: [
        { area: 'belts', minCm: 30, areaNote: 'Bælterne & Østersøen' },
      ],
      closedSeasons: [],
      bestMonths: [4, 5, 6, 7, 8, 9],
      habitat: 'Sandbund',
      status: 'open',
    },
    {
      id: 'makrel',
      name: 'Makrel',
      nameEn: 'Mackerel',
      emoji: '🐟',
      waterType: ['salt'],
      sizes: [
        { area: 'northSea',  minCm: 30 },
        { area: 'skagerrak', minCm: 20 },
      ],
      closedSeasons: [],
      bestMonths: [5, 6, 7, 8, 9, 10],
      habitat: 'Pelagisk, åbent hav og kyst',
      status: 'open',
    },
    {
      id: 'hvilling',
      name: 'Hvilling',
      nameEn: 'Whiting',
      emoji: '🐡',
      waterType: ['salt'],
      sizes: [
        { area: 'northSea',  minCm: 27 },
        { area: 'skagerrak', minCm: 23 },
      ],
      closedSeasons: [],
      bestMonths: [10, 11, 12, 1, 2, 3, 4],
      habitat: 'Sandbund, offshore og kyst',
      status: 'open',
    },
    {
      id: 'kuller',
      name: 'Kuller',
      nameEn: 'Haddock',
      emoji: '🐡',
      waterType: ['salt'],
      sizes: [
        { area: 'northSea',  minCm: 30 },
        { area: 'skagerrak', minCm: 27 },
      ],
      closedSeasons: [],
      bestMonths: [10, 11, 12, 1, 2, 3, 4],
      habitat: 'Offshore, rev og grus',
      status: 'open',
    },
    {
      id: 'havbars',
      name: 'Havbars',
      nameEn: 'Sea Bass',
      emoji: '🐟',
      waterType: ['salt'],
      sizes: [
        { area: 'everywhere', minCm: 42 },
      ],
      closedSeasons: [],
      bagLimit: '3 fisk/dag (Nordsøen syd for Hanstholm), 4 fisk/dag (andre EU-farvande)',
      bagLimitEn: '3 fish/day (North Sea south of Hanstholm), 4 fish/day (other EU waters)',
      restrictions: [
        { note: 'Nordsøen syd for Hanstholm: Kun catch-and-release i januar. Max 3 fisk/dag april-december.', noteEn: 'North Sea south of Hanstholm: catch-and-release only in January. Max 3 fish/day April–December.' },
      ],
      bestMonths: [6, 7, 8, 9, 10],
      habitat: 'Rev, kystlinje, løber',
      status: 'restricted',
    },
    {
      id: 'havørred',
      name: 'Havørred',
      nameEn: 'Sea Trout',
      emoji: '🐟',
      waterType: ['salt', 'fresh'],
      // 40 cm in salt and fresh water (lfst havørred page and both 2026 lists).
      sizes: [
        { area: 'everywhere', minCm: 40 },
      ],
      // lfst "Fredning og mindstemål i saltvand 2026" (valid from 01.01.2026),
      // the freshwater list (closures valid from 17.01.2025) and lfst's
      // havørred page, checked 2026-11-06. The coast closure used to be
      // 15 Nov – 15 Jan for every fish on "coasts and streams": a day early,
      // for bright fish that may be kept, and it reopened streams on 16 Jan.
      closedSeasons: [
        // "Overalt (i yngledragt)": only fully bright fish with loose scales
        // may be kept; coloured fish go back at once.
        { startMonth: 11, startDay: 16, endMonth: 1, endDay: 15, water: 'salt', kind: 'coloured', where: 'Saltvand: fisk i gydedragt (blanke fisk må tages med)', whereEn: 'Saltwater: fish in spawning colours (bright fish may be kept)' },
        { startMonth: 11, startDay: 16, endMonth: 2, endDay: 28, water: 'fresh', where: 'Ferskvand', whereEn: 'Freshwater' },
        // The 2026 PDF starts these on 16 Sep, the lfst havørred page on
        // 15 Sep; the earlier date is used.
        { startMonth: 9, startDay: 15, endMonth: 2, endDay: 28, water: 'salt', region: 'wadden', where: 'Vadehavet (alle fisk)', whereEn: 'Wadden Sea (all fish)' },
        // Salt list: "Farvandet omkring Bornholm (i yngledragt)"; freshwater
        // list: "farvet havørred fredet i bornholmske vandløb" from 16 Sep.
        { startMonth: 9, startDay: 15, endMonth: 2, endDay: 28, region: 'bornholm', kind: 'coloured', where: 'Bornholm: fisk i gydedragt (kyst og vandløb)', whereEn: 'Bornholm: fish in spawning colours (coast and streams)' },
        // "I Ringkøbing, Nissum og Stadil Fjorde og Von Å er havørred totalfredet."
        { startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, water: 'salt', region: 'ringkobing', where: 'Ringkøbing Fjord: totalfredet', whereEn: 'Ringkøbing Fjord: fully protected' },
        { startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, water: 'salt', region: 'nissum', where: 'Nissum Fjord: totalfredet', whereEn: 'Nissum Fjord: fully protected' },
        { startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, region: 'stadil', where: 'Stadil Fjord og Von Å: totalfredet', whereEn: 'Stadil Fjord and Von Å: fully protected' },
      ],
      bestMonths: [3, 4, 5, 9, 10, 11],
      habitat: 'Åer, strande, havkyster',
      status: 'open', // dynamic — check closed season
    },
    {
      id: 'laks',
      name: 'Laks',
      nameEn: 'Salmon',
      emoji: '🐟',
      waterType: ['salt', 'fresh'],
      sizes: [
        { area: 'everywhere', minCm: 60, waterNote: 'Saltvand', water: 'salt' },
        { area: 'everywhere', minCm: 40, waterNote: 'Ferskvand', water: 'fresh' },
      ],
      // lfst laks page and the 2026 lists, checked 2026-11-06. In salt water
      // 16 Nov – 15 Jan is "Overalt (i yngledragt)", the same colour rule as
      // sea trout; it was a closure for every fish.
      closedSeasons: [
        { startMonth: 11, startDay: 16, endMonth: 2, endDay: 28, where: 'Ferskvand', whereEn: 'Freshwater', water: 'fresh' },
        { startMonth: 11, startDay: 16, endMonth: 1, endDay: 15, where: 'Saltvand: fisk i gydedragt (blanke fisk må tages med)', whereEn: 'Saltwater: fish in spawning colours (bright fish may be kept)', water: 'salt', kind: 'coloured' },
        { startMonth: 9, startDay: 15, endMonth: 2, endDay: 28, where: 'Vadehavet', whereEn: 'Wadden Sea', water: 'salt', region: 'wadden' },
        // "Hele året: Vadehavet nord for Låningsvejen til Mandø, i Ringkøbing,
        // Nissum og Stadil Fjorde og Von Å er laks totalfredet."
        { startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, where: 'Vadehavet nord for Låningsvejen: totalfredet', whereEn: 'Wadden Sea north of Låningsvejen: fully protected', water: 'salt', region: 'wadden' },
        { startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, water: 'salt', region: 'ringkobing', where: 'Ringkøbing Fjord: totalfredet', whereEn: 'Ringkøbing Fjord: fully protected' },
        { startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, water: 'salt', region: 'nissum', where: 'Nissum Fjord: totalfredet', whereEn: 'Nissum Fjord: fully protected' },
        { startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, region: 'stadil', where: 'Stadil Fjord og Von Å: totalfredet', whereEn: 'Stadil Fjord and Von Å: fully protected' },
      ],
      // An EU limit for the Baltic only: "Østersøen, underområde 22-31".
      bagLimit: 'Max 1 fedtfinneklippet laks pr. dag (Østersøen)',
      bagLimitEn: 'Max 1 adipose-fin-clipped salmon per day (Baltic)',
      bestMonths: [4, 5, 6, 7, 8, 9],
      habitat: 'Åer, elvmundinger, offshore',
      status: 'restricted',
    },
    {
      id: 'aal_salt',
      name: 'Ål (saltvand)',
      nameEn: 'Eel (saltwater)',
      emoji: '🐍',
      waterType: ['salt'],
      sizes: [
        { area: 'northSea',  minCm: 40, areaNote: 'Nordsøen' },
        { area: 'skagerrak', minCm: 40, areaNote: 'Kattegat' },
        { area: 'belts',     minCm: 38, areaNote: 'Ringkøbing/Nissum/Stadil Fjord' },
        { area: 'belts',     minCm: 38, areaNote: 'Roskilde Fjord & Isefjord' },
      ],
      closedSeasons: [
        { startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, where: 'EU-forbud 2026-2028', whereEn: 'EU ban 2026-2028', year: [2026, 2027, 2028] },
      ],
      restrictions: [
        { note: '🚫 Lystfiskeri efter ål i saltvand FORBUDT i 2026, 2027 og 2028 (EU-forordning 2026/249).', noteEn: '🚫 Recreational eel fishing in saltwater BANNED in 2026, 2027 and 2028 (EU Regulation 2026/249).' },
      ],
      bestMonths: [],
      status: 'closed',
    },
    {
      id: 'aal_fresh',
      name: 'Ål (ferskvand)',
      nameEn: 'Eel (freshwater)',
      emoji: '🐍',
      waterType: ['fresh'],
      sizes: [
        { area: 'everywhere', minCm: 45 },
      ],
      closedSeasons: [],
      restrictions: [
        { note: '⚠ Ruser i ferskvand forbudt 16. oktober – 31. juli. Tjek lokale regler.', noteEn: '⚠ Fyke nets banned in freshwater 16 October – 31 July. Check local rules.' },
      ],
      bestMonths: [8, 9, 10],
      status: 'restricted',
    },
    {
      id: 'lubbe',
      name: 'Lubbe',
      nameEn: 'Pollock',
      nameLatin: 'Pollachius pollachius',
      emoji: '🐟',
      waterType: ['salt'],
      sizes: [
        { area: 'northSea', minCm: 30, areaNote: 'Nordsøen inkl. Limfjorden og Ringkøbing Fjord' },
      ],
      closedSeasons: [],
      bestMonths: [9, 10, 11, 12, 1, 2, 3, 4],
      habitat: 'Stenrev, vrag, offshore — halvpelagisk rovfisk',
      status: 'open',
    },
    {
      id: 'morksej',
      name: 'Mørksej',
      nameEn: 'Coalfish',
      nameLatin: 'Pollachius virens',
      emoji: '🐟',
      waterType: ['salt'],
      // lfst "Mindstemål … i saltvand" 2026 (valid from 01.01.2026), checked 2026-11-06.
      // North Sea 35 cm (was 30), Skagerrak/Kattegat 30 cm (was missing).
      sizes: [
        { area: 'northSea',  minCm: 35 },
        { area: 'skagerrak', minCm: 30 },
      ],
      closedSeasons: [],
      bestMonths: [9, 10, 11, 12, 1, 2, 3, 4],
      habitat: 'Pelagisk til demersal — offshore rev og vrag, skolevis',
      status: 'open',
    },
    {
      id: 'ising',
      name: 'Ising',
      nameEn: 'Dab',
      nameLatin: 'Limanda limanda',
      emoji: '🐡',
      waterType: ['salt'],
      sizes: [],   // ingen mindstemål for lystfiskere i DK — verificér på lfst.dk
      closedSeasons: [],
      bestMonths: [3, 4, 5, 6, 7, 8, 9, 10],
      habitat: 'Sand- og mudderbund, lavvandet kyst — meget udbredt i Kattegat og Nordsøen',
      status: 'open',
    },
    {
      id: 'stenbider',
      name: 'Stenbider',
      nameEn: 'Lumpsucker',
      emoji: '🐡',
      waterType: ['salt'],
      sizes: [],
      // lfst stenbider page (checked 2026-11-06): "Stenbider fredet hele året
      // i alle farvande" — "Hele året, Overalt" in the 2026 saltwater list and
      // "Hele året" in the freshwater list. It was 'open', with a peak in
      // March–May and a note about taking the females for roe.
      closedSeasons: [
        { startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, where: 'Overalt: totalfredet', whereEn: 'Everywhere: fully protected' },
      ],
      restrictions: [
        { note: '🚫 Totalfredet hele året i alle farvande. En stenbider, der fanges ved et uheld, skal genudsættes straks.', noteEn: '🚫 Fully protected all year in all waters. A lumpsucker caught by accident must be released at once.' },
      ],
      bestMonths: [],
      habitat: 'Stenrev, kystnært',
      status: 'closed',
    },
    {
      id: 'fjaesing',
      name: 'Fjæsing',
      nameEn: 'Greater Weever',
      nameLatin: 'Trachinus draco',
      emoji: '☠️',
      waterType: ['salt'],
      sizes: [],            // ingen mindstemål — verificér på lfst.dk
      closedSeasons: [],    // ingen fredningstid
      bestMonths: [6, 7, 8, 9],
      habitat: 'Sandbund, lavvandet kyst, Nordsø og Kattegat',
      status: 'open',
      venom: true,
      venomWarning: '⚠️ GIFTIGE PIGGE — Fjæsingen har giftige pigge på rygfinnen og gællelågene. Trådt på eller fejlhåndteret giver øjeblikkeligt kraftige smerter. Behandling: nedsænk i så varmt vand du tåler (45–50°C) i 30–60 min — dette nedbryder giften. Søg læge ved alvorlig reaktion. Brug altid tang ved håndtering.',
      venomWarningEn: '⚠️ VENOMOUS SPINES — the greater weever has venomous spines on its dorsal fin and gill covers. Stepping on one or handling it carelessly causes immediate, intense pain. Treatment: immerse in water as hot as you can tolerate (45–50°C) for 30–60 min — this breaks down the venom. Seek medical help for a severe reaction. Always use pliers when handling.',
      notes: 'Graver sig ned i sandbunden med pigge op — særlig farlig for vadefiskere. Fremragende spisekvalitet.',
    },
    {
      id: 'sild',
      name: 'Sild',
      nameEn: 'Herring',
      emoji: '🐟',
      waterType: ['salt'],
      // lfst "Mindstemål … i saltvand" 2026 (valid from 01.01.2026), checked 2026-11-06.
      // North Sea 20 cm, Skagerrak/Kattegat 18 cm; none in the Baltic.
      sizes: [
        { area: 'northSea',  minCm: 20 },
        { area: 'skagerrak', minCm: 18 },
      ],
      closedSeasons: [],
      bestMonths: [10, 11, 12, 1, 2, 3, 4],
      habitat: 'Pelagisk, fjorde og bælter',
      status: 'open',
    },

    // ═══════════════════ FRESHWATER ═══════════════════
    {
      id: 'gedde',
      name: 'Gedde',
      nameEn: 'Pike',
      emoji: '🐊',
      waterType: ['fresh'],
      sizes: [
        { area: 'everywhere', minCm: 60 },
      ],
      // The saltwater closure used to sit in a separate `saltClosedSeasons` list
      // that nothing read, so a pike from a fjord on 10 May was never flagged.
      closedSeasons: [
        { startMonth: 3, startDay: 15, endMonth: 4, endDay: 30, where: 'Ferskvand', whereEn: 'Freshwater', water: 'fresh' },
        { startMonth: 4, startDay: 1, endMonth: 5, endDay: 15, where: 'Saltvand', whereEn: 'Saltwater', water: 'salt' },
        // BEK nr 1673 af 10/12/2025 §3 (in force 1 Jan 2026, read on
        // retsinformation.dk 2026-11-06): pike may not be landed at all in the
        // salt waters of its bilag 1 and the streams of bilag 2, by
        // Sydsjælland, Møn, Lolland and Falster.
        { startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, region: 'southZealand', where: 'Visse farvande ved Sydsjælland/Møn/Lolland/Falster: må ikke hjemtages', whereEn: 'Certain waters by South Zealand/Møn/Lolland/Falster: may not be landed' },
      ],
      bestMonths: [9, 10, 11, 12, 1, 2, 3, 5, 6],
      habitat: 'Søer, åer, vandhuller',
      status: 'open',
    },
    {
      id: 'sandart',
      name: 'Sandart',
      nameEn: 'Pike-Perch / Zander',
      emoji: '🐊',
      waterType: ['fresh', 'brackish'],
      sizes: [
        { area: 'everywhere', minCm: 50 },
      ],
      closedSeasons: [
        { startMonth: 5, startDay: 1, endMonth: 5, endDay: 31, where: 'Ferskvand', whereEn: 'Freshwater', water: 'fresh' },
      ],
      bestMonths: [3, 4, 6, 7, 8, 9, 10],
      habitat: 'Store søer, fjorde, langsomt flydende åer',
      status: 'open',
    },
    {
      id: 'aborre',
      name: 'Aborre',
      nameEn: 'Perch',
      emoji: '🐟',
      waterType: ['fresh', 'brackish', 'salt'],
      // lfst aborre page and BEK nr 1673 af 10/12/2025 (in force 1 Jan 2026;
      // read on retsinformation.dk 2026-11-06): 20 cm in general; 24 cm (and a
      // 30 cm maximum, 3 a day) in certain salt waters (bilag 3) AND fresh
      // waters (bilag 4) by Sydsjælland, Møn, Lolland and Falster (§6). The
      // 24 cm row was tagged salt, and the closure below too, though §5 bans
      // landing perch 1 Mar – 30 Apr in the bilag 4 FRESH waters only.
      sizes: [
        { area: 'everywhere', minCm: 20, areaNote: 'Generelt' },
        { area: 'everywhere', minCm: 24, region: 'southZealand', areaNote: 'Visse farvande ved Sydsjælland, Møn, Lolland, Falster (max 30 cm)' },
      ],
      closedSeasons: [
        { startMonth: 3, startDay: 1, endMonth: 4, endDay: 30, where: 'Visse ferskvande ved Sydsjælland/Møn/Lolland/Falster', whereEn: 'Certain fresh waters by South Zealand/Møn/Lolland/Falster', water: 'fresh', region: 'southZealand' },
      ],
      bestMonths: [5, 6, 7, 8, 9, 10],
      habitat: 'Søer, åer, brackvandsfjorde',
      status: 'open',
    },
    {
      id: 'stalling',
      name: 'Stalling',
      nameEn: 'Grayling',
      emoji: '🐟',
      waterType: ['fresh'],
      // lfst freshwater list (checked 2026-11-06): "Stalling 33 cm (gælder fra
      // 16. maj 2026)". There was none.
      sizes: [
        { area: 'everywhere', minCm: 33, fromDate: '2026-05-16' },
      ],
      // The years are data, not prose: the 2026 total protection must not carry
      // into 2027, and the 2027+ season must not close 2026 twice.
      closedSeasons: [
        { startMonth: 3, startDay: 15, endMonth: 5, endDay: 15, where: 'Ferskvand (fra 2027+)', whereEn: 'Freshwater (2027 onwards)', water: 'fresh', fromYear: 2027 },
        { startMonth: 1, startDay: 1, endMonth: 5, endDay: 15, where: 'Totalfredning 2026', whereEn: 'Full protection 2026', year: [2026] },
      ],
      restrictions: [
        { note: '⚠ Totalfredet frem til 15. maj 2026. Fra 2027: fredning 15. marts – 15. maj.', noteEn: '⚠ Fully protected until 15 May 2026. From 2027: closed season 15 March – 15 May.' },
      ],
      bestMonths: [6, 7, 8, 9, 10, 11],
      habitat: 'Klare, kolde åer og vandløb',
      // Was hard-coded 'closed' ("until May 15 2026"), which kept grayling under
      // "Lukket sæson" for months after its protection ended. The closures above
      // now carry the dates, so the status is derived from them like any species.
      status: 'open',
    },
    // Brown trout and lake trout were one row at 30 cm and closed from 1 Nov.
    // lfst's freshwater list (sizes valid from 01.07.2021, closures from
    // 17.01.2025; checked 2026-11-06): bækørred 30 cm, søørred 40 cm, both
    // closed 16 Nov – 28 (29) Feb. The saltwater 2026 list: "Alle ørredarter er
    // i Ringkøbing og Stadil fjord samt von å fredede, hele året."
    {
      id: 'bækørred',
      name: 'Bækørred',
      nameEn: 'Brown Trout (river)',
      emoji: '🐟',
      waterType: ['fresh'],
      sizes: [
        { area: 'everywhere', minCm: 30 },
      ],
      closedSeasons: [
        { startMonth: 11, startDay: 16, endMonth: 2, endDay: 28, where: 'Ferskvand', whereEn: 'Freshwater', water: 'fresh' },
        { startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, water: 'salt', region: 'ringkobing', where: 'Ringkøbing Fjord: totalfredet', whereEn: 'Ringkøbing Fjord: fully protected' },
        { startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, region: 'stadil', where: 'Stadil Fjord og Von Å: totalfredet', whereEn: 'Stadil Fjord and Von Å: fully protected' },
      ],
      restrictions: [
        { note: '⚠ Mange vandløb har lokale regler — tjek altid fiskevandets regler.', noteEn: '⚠ Many streams have local rules — always check the rules of the water.' },
      ],
      bestMonths: [3, 4, 5, 6, 9, 10],
      habitat: 'Kolde vandløb',
      status: 'open',
    },
    {
      id: 'søørred',
      name: 'Søørred',
      nameEn: 'Lake Trout',
      emoji: '🐟',
      waterType: ['fresh'],
      sizes: [
        { area: 'everywhere', minCm: 40 },
      ],
      closedSeasons: [
        { startMonth: 11, startDay: 16, endMonth: 2, endDay: 28, where: 'Ferskvand', whereEn: 'Freshwater', water: 'fresh' },
        { startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, water: 'salt', region: 'ringkobing', where: 'Ringkøbing Fjord: totalfredet', whereEn: 'Ringkøbing Fjord: fully protected' },
        { startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, region: 'stadil', where: 'Stadil Fjord og Von Å: totalfredet', whereEn: 'Stadil Fjord and Von Å: fully protected' },
      ],
      bestMonths: [3, 4, 5, 9, 10],
      habitat: 'Klare, dybe søer',
      status: 'open',
    },
    {
      id: 'brasen',
      name: 'Brasen',
      nameEn: 'Bream',
      emoji: '🐡',
      waterType: ['fresh'],
      // Neither lfst list (saltwater 2026, freshwater) nor lfst's species
      // index has a bream minimum (checked 2026-11-06). The 25 cm here was
      // invented and scolded a legal 22 cm bream.
      sizes: [],
      closedSeasons: [],
      bestMonths: [5, 6, 7, 8],
      habitat: 'Store søer, lavvandede fjorde',
      status: 'open',
    },
    {
      id: 'karpe',
      name: 'Karpe',
      nameEn: 'Carp',
      emoji: '🐡',
      waterType: ['fresh'],
      sizes: [],
      closedSeasons: [],
      bestMonths: [5, 6, 7, 8, 9],
      habitat: 'Søer, damme, lune vandhuller',
      notes: 'Ofte catch & release praksis. Tjek vandets ejers regler.',
      status: 'open',
    },
    {
      id: 'helt',
      name: 'Helt',
      nameEn: 'Vendace / Whitefish',
      emoji: '🐟',
      waterType: ['fresh', 'salt'],
      // lfst helt page and the 2026 lists (checked 2026-11-06): 36 cm in all
      // waters, salt and fresh; "34 cm* — Gælder kun Ringkøbing Fjord".
      sizes: [
        { area: 'everywhere', minCm: 36 },
        { area: 'everywhere', minCm: 34, region: 'ringkobing', areaNote: 'Ringkøbing Fjord' },
      ],
      // Saltwater: 1 Nov – 31 Jan "Overalt", Nissum Fjord 1 Oct – 31 Mar,
      // Ringkøbing & Stadil Fjord 1 Nov – 28/29 Feb. Freshwater: "Helt og
      // heltling 01. november - 31. januar". There was no closure at all, so
      // the Seasons tab showed helt "in season" at its "peak" in November.
      // (The 2026 PDF also prints "01. juli - 31. aug Limfjorden" under helt,
      // but lfst's helt page doesn't list it: it is the next row's, hummer.)
      closedSeasons: [
        { startMonth: 11, startDay: 1, endMonth: 1, endDay: 31, where: 'Overalt (salt- og ferskvand)', whereEn: 'Everywhere (salt and fresh water)' },
        { startMonth: 10, startDay: 1, endMonth: 3, endDay: 31, water: 'salt', region: 'nissum', where: 'Nissum Fjord', whereEn: 'Nissum Fjord' },
        { startMonth: 11, startDay: 1, endMonth: 2, endDay: 28, water: 'salt', region: 'ringkobing', where: 'Ringkøbing Fjord', whereEn: 'Ringkøbing Fjord' },
        { startMonth: 11, startDay: 1, endMonth: 2, endDay: 28, water: 'salt', region: 'stadil', where: 'Stadil Fjord', whereEn: 'Stadil Fjord' },
      ],
      // Was [10, 11, 12, 1]: three of those four are the closed season. No
      // source gives a peak inside the open season; October is what is left.
      bestMonths: [10],
      habitat: 'Fjorde og dybe, kolde søer',
      status: 'open',
    },
  ],

  // ── Helper: get species valid for a given water type ───────
  forWaterType(type) {
    if (type === 'both') return this.species;
    return this.species.filter(s => s.waterType.includes(type) || s.waterType.includes('brackish'));
  },

  // ── Helper: closures in force on a date ────────────────────
  // Every closure used to apply to every catch: the Wadden-Sea-only salmon
  // closure flagged each salmon logged in October anywhere in Denmark, and the
  // 2026-only grayling protection would have repeated every year. A closure now
  // applies only in its `year` list / from its `fromYear`, and a `water`-scoped
  // one only where that water type can't be ruled out (`waterType` is the
  // catch location's, when known).
  //
  // A closure can also be scoped to a `region` (ruleArea.ts: Bornholm, the
  // Wadden Sea, the west-coast fjords…) or a sea `area` (the cod ban: ICES
  // 22–32), and a `kind` can narrow it to fish in spawning colours ('coloured':
  // bright fish may be kept) or to keeping fish at all ('release': catch and
  // release only). `place` is rulePlaceAt() of the location, when known.
  // Each applicable closure gets a level (closureLevel): 'closed' for certain,
  // 'maybe' when the place can't be pinned down or only some fish are covered.
  closuresOn(species, date, waterType, place) {
    return (species.closedSeasons || []).filter((cs) => closureLevel(cs, date, waterType, place) != null);
  },

  // ── Helper: check if a species is in open season for a date ─
  // Hedged closures (a named area the location may or may not be in, or one
  // that covers only coloured fish) don't make a species closed — they're
  // reported separately (regionalClosuresOn) as a hedged note.
  isInSeason(species, date, waterType, place) {
    if (species.status === 'closed') return false;
    return !(species.closedSeasons || []).some((cs) => closureLevel(cs, date, waterType, place) === 'closed');
  },

  /** The hedged closures in force: see closureLevel. */
  regionalClosuresOn(species, date, waterType, place) {
    return (species.closedSeasons || []).filter((cs) => closureLevel(cs, date, waterType, place) === 'maybe');
  },

  closureLevel(cs, date, waterType, place) {
    return closureLevel(cs, date, waterType, place);
  },

  /** The closures that exist at all in `year` (for listing them). */
  closuresInYear(species, year) {
    return (species.closedSeasons || []).filter((cs) => appliesInYear(cs, year));
  },

  getPrimarySize(species) {
    if (!species.sizes || !species.sizes.length) return null;
    return species.sizes[0].minCm;
  },

  // ── Helper: minimum size range for a location ───────────────
  // sizes[0] alone was the STRICTEST area for several species (mackerel 30 cm
  // North Sea vs 20 cm Kattegat), so legal fish were flagged as undersized.
  // Returns the most lenient and the strictest minimum that could apply at
  // `place` (rulePlaceAt; unknown = every area) on `date` (rules with a
  // `fromDate` start then), and `anyWithout`: whether the fish could come
  // from waters with no minimum at all — a blank cell in lfst's table (no
  // mackerel minimum in the Baltic), where "under the lenient minimum" is
  // still only a maybe.
  sizeRange(species, waterType, place, date) {
    const kept = (species.sizes || []).filter((s) =>
      appliesInWater(s, waterType) && appliesFrom(s, date) &&
      regionLevel(s, place) != null && areaLevel(s, place) != null);
    if (!kept.length) return null;
    const mins = kept.map((s) => s.minCm);
    return { min: Math.min(...mins), max: Math.max(...mins), anyWithout: someWaterWithout(species, kept, waterType, place) };
  },
};

function appliesFrom(rule, date) {
  if (!rule.fromDate || !date) return true;
  const [y, m, d] = rule.fromDate.split('-').map(Number);
  return date.getTime() >= new Date(y, m - 1, d).getTime();
}

/**
 * Could the fish come from waters where none of `kept` applies? The waters are
 * fresh and/or the sea areas the location may be in, among those the species
 * lives in. A region-scoped size (Ringkøbing Fjord's 34 cm helt) covers only
 * part of an area, so it never counts as covering one.
 */
function someWaterWithout(species, kept, waterType, place) {
  const lw = legalWater(waterType);
  const lives = species.waterType || [];
  const zones = [];
  if (lw !== 'salt' && lives.includes('fresh')) zones.push('fresh');
  if (lw !== 'fresh' && (lives.includes('salt') || lives.includes('brackish'))) {
    zones.push(...(place?.areas?.length ? place.areas : SEA_AREAS));
  }
  const ruleWater = (e) => e.water ?? (e.area && e.area !== 'everywhere' ? 'salt' : undefined);
  const covers = (e, z) => {
    if (e.region) return false;
    const wide = !e.area || e.area === 'everywhere';
    return z === 'fresh' ? ruleWater(e) !== 'salt' && wide : ruleWater(e) !== 'fresh' && (wide || e.area === z);
  };
  return zones.some((z) => !kept.some((e) => covers(e, z)));
}

function appliesInYear(cs, year) {
  if (Array.isArray(cs.year) && !cs.year.includes(year)) return false;
  if (cs.fromYear && year < cs.fromYear) return false;
  return true;
}

/**
 * The water a location's rules come from. The app's brackish is "fjorde,
 * bælter, Østersøen" (strings: wt_brackish_opt), which Danish law treats as
 * saltwater up to each watercourse's salt/fresh boundary — so the saltwater
 * list applies there. Read as "either", the freshwater sea-trout closure (16 Nov
 * – end of February) closed every coastal spot all winter. An unknown or 'both'
 * location still can't rule either set out, so both apply. Guidance errs on
 * caution.
 */
function legalWater(waterType) {
  if (waterType === 'salt' || waterType === 'brackish') return 'salt';
  if (waterType === 'fresh') return 'fresh';
  return undefined;
}

// A rule scoped to a sea area is a saltwater rule: the size columns and the
// cod ban are from the saltwater list.
function appliesInWater(rule, waterType) {
  const ruleWater = rule.water ?? (rule.area && rule.area !== 'everywhere' ? 'salt' : undefined);
  const lw = legalWater(waterType);
  if (!ruleWater || !lw) return true;
  return ruleWater === lw;
}

/** 'in', 'maybe' or null (doesn't apply) for a rule's `region` at `place`. */
function regionLevel(rule, place) {
  if (!rule.region) return 'in';
  if (!place) return 'maybe';
  return place.regions?.[rule.region] ?? null;
}

/** The same for a rule's sea `area`: 'maybe' on a boundary or with no place. */
function areaLevel(rule, place) {
  if (!rule.area || rule.area === 'everywhere') return 'in';
  if (!place || !place.areas?.length) return 'maybe';
  if (!place.areas.includes(rule.area)) return null;
  return place.areas.length > 1 ? 'maybe' : 'in';
}

/**
 * How surely a closure applies on `date` at a location: null (not at all),
 * 'closed', or 'maybe' — a region or area the location may lie outside, or a
 * rule that leaves some fish legal (only coloured fish, or only keeping them).
 */
function closureLevel(cs, date, waterType, place) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1; // 1-12
  const d = date.getDate();
  if (!appliesInYear(cs, y) || !appliesInWater(cs, waterType)) return null;
  if (!isInClosedPeriod(m, d, cs.startMonth, cs.startDay, cs.endMonth, cs.endDay, y)) return null;
  const r = regionLevel(cs, place), a = areaLevel(cs, place);
  if (r == null || a == null) return null;
  if (cs.kind || r === 'maybe' || a === 'maybe') return 'maybe';
  return 'closed';
}

// Utility: check if date (month m, day d) falls within a closed period
function isInClosedPeriod(m, d, sm, sd, em, ed, year) {
  // "– 28. feb" means the end of February; in a leap year that is the 29th.
  if (em === 2 && ed === 28 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ed = 29;
  const cur  = m * 100 + d;
  const start = sm * 100 + sd;
  const end   = em * 100 + ed;
  if (start <= end) {
    return cur >= start && cur <= end;
  } else {
    // wraps around year (e.g. Nov–Jan)
    return cur >= start || cur <= end;
  }
}
