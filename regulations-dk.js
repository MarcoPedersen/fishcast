/**
 * FishCast — Danish Fishing Regulations Dataset
 * Region: Denmark (DK)
 *
 * ⚠ DISCLAIMER: These data are for guidance only and may be incomplete.
 * Always verify current rules at: https://lfst.dk/lyst-og-fritidsfiskeri/mindstemaal-og-fredningstider/
 * Regulations are subject to change (e.g. EU emergency measures, annual updates).
 * Last reviewed against lfst.dk: June 2026.
 */

const DK_REGULATIONS = {
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
        { note: '🚫 Torskefiskeri forbudt i hele 2026 i Vestlige Østersø (ICES 22-24).', year: 2026 },
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
      restrictions: [
        { note: 'Nordsøen syd for Hanstholm: Kun catch-and-release i januar. Max 3 fisk/dag april-december.' },
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
        { startMonth: 11, startDay: 15, endMonth: 1, endDay: 15, where: 'Saltvandskyster og åer' },
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
        { area: 'everywhere', minCm: 60, waterNote: 'Saltvand' },
        { area: 'everywhere', minCm: 40, waterNote: 'Ferskvand' },
      ],
      closedSeasons: [
        { startMonth: 11, startDay: 16, endMonth: 2, endDay: 28, where: 'Ferskvand' },
        { startMonth: 11, startDay: 16, endMonth: 1, endDay: 15, where: 'Saltvand (gydefisk)' },
        { startMonth: 9, startDay: 15, endMonth: 2, endDay: 28, where: 'Vadehavet' },
      ],
      bagLimit: 'Max 1 klipfinne-laks per dag (saltvand)',
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
        { startMonth: 1, startDay: 1, endMonth: 12, endDay: 31, where: 'EU-forbud 2026-2028', year: [2026, 2027, 2028] },
      ],
      restrictions: [
        { note: '🚫 Lystfiskeri efter ål i saltvand FORBUDT i 2026, 2027 og 2028 (EU-forordning 2026/249).' },
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
        { note: '⚠ Ruser i ferskvand forbudt 16. oktober – 31. juli. Tjek lokale regler.' },
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
      closedSeasons: [
        { startMonth: 3, startDay: 15, endMonth: 4, endDay: 30, where: 'Ferskvand' },
      ],
      saltClosedSeasons: [
        { startMonth: 4, startDay: 1, endMonth: 5, endDay: 15, where: 'Saltvand' },
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
        { startMonth: 5, startDay: 1, endMonth: 5, endDay: 31, where: 'Ferskvand' },
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
        { area: 'everywhere', minCm: 24, areaNote: 'Visse farvande ved Sydsjælland, Møn, Lolland, Falster (max 30 cm)' },
      ],
      closedSeasons: [
        { startMonth: 3, startDay: 1, endMonth: 4, endDay: 30, where: 'Visse farvande ved Sydsjælland/Møn/Lolland/Falster' },
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
      closedSeasons: [
        { startMonth: 3, startDay: 15, endMonth: 5, endDay: 15, where: 'Ferskvand (fra 2027+)' },
        { startMonth: 1, startDay: 1, endMonth: 5, endDay: 15, where: 'Fredning hele 2026' },
      ],
      restrictions: [
        { note: '⚠ Totalfredet frem til 15. maj 2026. Fra 2027: fredning 15. marts – 15. maj.' },
      ],
      bestMonths: [6, 7, 8, 9, 10, 11],
      habitat: 'Klare, kolde åer og vandløb',
      status: 'closed', // until May 15 2026
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
        { startMonth: 11, startDay: 1, endMonth: 2, endDay: 28, where: 'Vandløb (generelt)' },
      ],
      restrictions: [
        { note: '⚠ Fredningsperioder varierer kraftigt lokalt — tjek altid lokalt fisketegn/regler.' },
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

  // ── Helper: check if a species is in open season for a date ─
  isInSeason(species, date) {
    if (species.status === 'closed') return false;

    const m = date.getMonth() + 1; // 1-12
    const d = date.getDate();

    const allClosed = [...(species.closedSeasons || [])];
    for (const cs of allClosed) {
      if (isInClosedPeriod(m, d, cs.startMonth, cs.startDay, cs.endMonth, cs.endDay)) {
        return false;
      }
    }
    return true;
  },

  getPrimarySize(species) {
    if (!species.sizes || !species.sizes.length) return null;
    return species.sizes[0].minCm;
  },
};

// Utility: check if date (month m, day d) falls within a closed period
function isInClosedPeriod(m, d, sm, sd, em, ed) {
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
