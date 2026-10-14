// @ts-nocheck
// Ported from v1 regulations-dk.js — Danish fishing regulations (guidance only)
/**
 * FishCast — Danish Fishing Regulations Dataset
 * Region: Denmark (DK)
 *
 * ⚠ DISCLAIMER: These data are for guidance only and may be incomplete.
 * Always verify current rules at: https://lfst.dk/lyst-og-fritidsfiskeri/mindstemaal-og-fredningstider/
 * Regulations are subject to change (e.g. EU emergency measures, annual updates).
 * Last reviewed against lfst.dk: June 2026.
 */

export const DK_REGULATIONS: any = {
  region: 'Denmark',
  regionCode: 'dk',
  currency: 'DKK',
  officialUrl: 'https://lfst.dk/lyst-og-fritidsfiskeri/mindstemaal-og-fredningstider/',
  disclaimer: 'Regler er vejledende. Verificér altid på lfst.dk inden fiskeri.',

  // ── Saltwater Areas (used in size rules) ──────────────────
  areas: {
    northSea:   { id: 'northSea',   label: 'Nordsøen (inkl. Limfjorden & Ringkøbing Fjord)' },
    skagerrak:  { id: 'skagerrak',  label: 'Skagerrak / Kattegat' },
    belts:      { id: 'belts',      label: 'Bælter & Østersøen (22-24)' },
    baltic:     { id: 'baltic',     label: 'Østersøen (25-32)' },
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
      sizes: [
        { area: 'everywhere', minCm: 27 },
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
      sizes: [
        { area: 'belts',   minCm: 23, areaNote: 'ICES 22-25' },
        { area: 'baltic',  minCm: 21, areaNote: 'ICES 26-28' },
        { area: 'baltic',  minCm: 18, areaNote: 'ICES 29-32' },
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
      sizes: [
        { area: 'everywhere', minCm: 25 },
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
      sizes: [
        { area: 'everywhere', minCm: 40 },
      ],
      closedSeasons: [
        { startMonth: 11, startDay: 15, endMonth: 1, endDay: 15, where: 'Saltvandskyster og åer', whereEn: 'Saltwater coasts and streams' },
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
      closedSeasons: [
        { startMonth: 11, startDay: 16, endMonth: 2, endDay: 28, where: 'Ferskvand', whereEn: 'Freshwater', water: 'fresh' },
        { startMonth: 11, startDay: 16, endMonth: 1, endDay: 15, where: 'Saltvand (gydefisk)', whereEn: 'Saltwater (spawning fish)', water: 'salt' },
        { startMonth: 9, startDay: 15, endMonth: 2, endDay: 28, where: 'Vadehavet', whereEn: 'Wadden Sea', water: 'salt', regional: true },
      ],
      bagLimit: 'Max 1 klipfinne-laks per dag (saltvand)',
      bagLimitEn: 'Max 1 fin-clipped salmon per day (saltwater)',
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
      sizes: [
        { area: 'northSea', minCm: 30, areaNote: 'Nordsøen' },
      ],
      closedSeasons: [],
      bestMonths: [9, 10, 11, 12, 1, 2, 3, 4],
      habitat: 'Pelagisk til demersal — offshore rev og vrag, skolevis',
      notes: 'Verificér mindstemål på lfst.dk — EU-reguleret art.',
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
      closedSeasons: [],
      bestMonths: [3, 4, 5],
      habitat: 'Stenrev, kystnært',
      notes: 'Hunner fanget fra februar–maj for rogn.',
      status: 'open',
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
      sizes: [],
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
      sizes: [
        { area: 'everywhere', minCm: 20, areaNote: 'Generelt' },
        // Coastal waters, like the closure below: untagged, it hedged every
        // 20–24 cm lake perch as "maybe undersized".
        { area: 'everywhere', minCm: 24, areaNote: 'Visse farvande ved Sydsjælland, Møn, Lolland, Falster (max 30 cm)', water: 'salt' },
      ],
      closedSeasons: [
        { startMonth: 3, startDay: 1, endMonth: 4, endDay: 30, where: 'Visse farvande ved Sydsjælland/Møn/Lolland/Falster', whereEn: 'Certain waters off South Zealand/Møn/Lolland/Falster', water: 'salt', regional: true },
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
      sizes: [],
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
    {
      id: 'bækørred',
      name: 'Bæk-/Søørred',
      nameEn: 'Brown Trout (river/lake)',
      emoji: '🐟',
      waterType: ['fresh'],
      sizes: [
        { area: 'everywhere', minCm: 30, areaNote: 'Vandløb — kan variere' },
      ],
      closedSeasons: [
        { startMonth: 11, startDay: 1, endMonth: 2, endDay: 28, where: 'Vandløb (generelt)', whereEn: 'Streams (general)', water: 'fresh' },
      ],
      restrictions: [
        { note: '⚠ Fredningsperioder varierer kraftigt lokalt — tjek altid lokalt fisketegn/regler.', noteEn: '⚠ Closed seasons vary a lot locally — always check the local permit/rules.' },
      ],
      bestMonths: [3, 4, 5, 6, 9, 10],
      habitat: 'Kolde vandløb, klarvandssøer',
      status: 'open',
    },
    {
      id: 'brasen',
      name: 'Brasen',
      nameEn: 'Bream',
      emoji: '🐡',
      waterType: ['fresh'],
      sizes: [
        { area: 'everywhere', minCm: 25 },
      ],
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
      sizes: [],
      closedSeasons: [],
      bestMonths: [10, 11, 12, 1],
      habitat: 'Dybe, kolde søer',
      notes: 'Sæsonbetonet, fanges mest om vinteren.',
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
  closuresOn(species, date, waterType) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1; // 1-12
    const d = date.getDate();
    return (species.closedSeasons || []).filter((cs) =>
      appliesInYear(cs, y) && appliesInWater(cs, waterType) &&
      isInClosedPeriod(m, d, cs.startMonth, cs.startDay, cs.endMonth, cs.endDay, y));
  },

  // ── Helper: check if a species is in open season for a date ─
  // `regional` closures (one named area, e.g. Vadehavet) don't make a species
  // closed — the location can't be placed in or out of the area from its water
  // type, so they're reported separately (regionalClosuresOn) as a hedged note.
  isInSeason(species, date, waterType) {
    if (species.status === 'closed') return false;
    return !this.closuresOn(species, date, waterType).some((cs) => !cs.regional);
  },

  regionalClosuresOn(species, date, waterType) {
    return this.closuresOn(species, date, waterType).filter((cs) => cs.regional);
  },

  /** The closures that exist at all in `year` (for listing them). */
  closuresInYear(species, year) {
    return (species.closedSeasons || []).filter((cs) => appliesInYear(cs, year));
  },

  getPrimarySize(species) {
    if (!species.sizes || !species.sizes.length) return null;
    return species.sizes[0].minCm;
  },

  // ── Helper: minimum size range for a location's water type ──
  // sizes[0] alone was the STRICTEST area for several species (mackerel 30 cm
  // North Sea vs 20 cm Kattegat), so legal fish were flagged as undersized.
  // Returns the most lenient and the strictest minimum that could apply.
  sizeRange(species, waterType) {
    const mins = (species.sizes || [])
      .filter((s) => appliesInWater(s, waterType))
      .map((s) => s.minCm);
    if (!mins.length) return null;
    return { min: Math.min(...mins), max: Math.max(...mins) };
  },
};

function appliesInYear(cs, year) {
  if (Array.isArray(cs.year) && !cs.year.includes(year)) return false;
  if (cs.fromYear && year < cs.fromYear) return false;
  return true;
}

// Brackish (and an unknown or 'both' location) can't rule either rule set out —
// fjords are legally saltwater up to a boundary line, and a pin we couldn't
// classify defaults to brackish — so both apply there. Guidance errs on caution.
function appliesInWater(rule, waterType) {
  if (!rule.water || (waterType !== 'salt' && waterType !== 'fresh')) return true;
  return rule.water === waterType;
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
