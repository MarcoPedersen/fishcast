/**
 * FishCast — Main Application v2
 * Integrates:
 *  - Open-Meteo weather + Marine wave API (free, no key)
 *  - DMI Tidewater API (official Danish tidal predictions, free)
 *  - DMI Lightning API (real-time strike warning, free)
 *  - DMI metObs (current observed pressure/wind from nearest Danish station)
 *  - Solunar scoring, shore/boat recommendations, Beaufort scale
 */

'use strict';

// ═══════════════════════════════════════════
//  API ENDPOINTS
// ═══════════════════════════════════════════
const OPEN_METEO    = 'https://api.open-meteo.com/v1/forecast';
const MARINE_API    = 'https://marine-api.open-meteo.com/v1/marine';
const GEOCODING     = 'https://geocoding-api.open-meteo.com/v1/search';
const DMI_LIGHTNING = 'https://dmigw.govcloud.dk/v2/lightningdata/collections/observation/items';
const DMI_TIDES     = 'https://dmigw.govcloud.dk/v2/oceanObs/collections/tidewater/items';
const DMI_TIDE_STN  = 'https://dmigw.govcloud.dk/v2/oceanObs/collections/tidewaterstation/items';
const DMI_METOBS    = 'https://dmigw.govcloud.dk/v2/metObs/collections/observation/items';
const FORECAST_DAYS = 7;

// ═══════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════
const DAYS_SHORT = ['Søn','Man','Tir','Ons','Tor','Fre','Lør'];
const MONTHS     = ['Jan','Feb','Mar','Apr','Maj','Jun','Jul','Aug','Sep','Okt','Nov','Dec'];

// ═══════════════════════════════════════════
//  INTERNATIONALISATION (i18n)
// ═══════════════════════════════════════════
const STRINGS = {
  da: {
    // General
    back:'← Tilbage', next:'Næste →', skip:'Spring over →', close:'Luk',
    add:'+ Tilføj', added:'✓ Tilføjet', save:'Gem', cancel:'Annuller',
    reset_btn:'🔄 Start forfra — nulstil alt',
    reset_confirm:'Nulstil alt — lokationer, tidsvinduer og målarter slettes. Er du sikker?',
    show_on_map:'Vis på kort 🗺', rename:'Omdøb',
    update_all:'⟳ Opdater alle data', data_ok:'✓ Data',
    loading:'Henter…', error:'Fejl', details:'Detaljer',
    // Days
    day0:'Søn',day1:'Man',day2:'Tir',day3:'Ons',day4:'Tor',day5:'Fre',day6:'Lør',
    // Months
    month0:'Jan',month1:'Feb',month2:'Mar',month3:'Apr',month4:'Maj',month5:'Jun',
    month6:'Jul',month7:'Aug',month8:'Sep',month9:'Okt',month10:'Nov',month11:'Dec',
    // Welcome
    welcome_tagline:'Din personlige fiskeassistent.',
    welcome_sub:'Angiv dine lokationer og tidspunkter — vi finder det bedste vindue.',
    welcome_setup:'Opsæt mine fiskepladser →',
    welcome_continue:'Fortsæt til dashboard',
    welcome_or:'eller',
    welcome_shortcut:'Find fiskesteder hurtigt — ingen opsætning nødvendig',
    welcome_lucky_title:'Held og lykke',
    welcome_lucky_sub:'Find Danmarks bedste hotspot for en bestemt art',
    welcome_nearby_title:'Find i nærheden',
    welcome_nearby_sub:'Søg fiskepladser inden for en given afstand fra dig',
    attribution:'Vejrdata: Open-Meteo · Tidevand + Lyn: DMI Open Data · Regler: lfst.dk',
    // Availability
    avail_title:'Hvornår kan du fiske?',
    avail_sub:'Angiv dine tilgængelige tidsvinduer',
    avail_window:'Tidsvindow',
    avail_add:'+ Tilføj tidsvindow',
    avail_notice:'ℹ️ Tilføj mindst ét tidsvindow for at fortsætte.',
    time_from:'Fra', time_to:'Til',
    method_label:'Fiskemetode', method_pick:'Vælg en eller flere',
    method_required:'Mindst én metode skal være valgt',
    method_shore:'Fra kyst', method_waders:'Waders', method_boat:'Fra båd',
    fm_shore_hint:'Kystfiskeri / stangfiskeri fra land',
    fm_waders_hint:'Vadefiskeri — bundtype og underdrift vægtes',
    fm_boat_hint:'Bådtur — bølgehøjde og vind vægtes hårdere',
    next_species:'Næste: Målarter →',
    next_choose_art:'Næste: Vælg art →',
    next_choose_start:'Næste: Vælg startsted →',
    edit_time:'Rediger →',
    // Water type
    wt_title:'Hvilken type fiskevand?',
    wt_sub:'Vælg de vandtyper du primært fisker i',
    wt_fact_hd:'Vidste du?',
    wt_fact_body:'Det meste af Danmarks kyst er <em>brakvand</em> — ikke ægte saltvand. Kattegat, Øresund, de danske bælter og Østersøen er alle blandinger af salt- og ferskvand. Kun Nordsøen (Jyllands vestkyst) er rigtigt hav. Det betyder at ferskvandsfisk som gedde og aborre kan leve i mange danske havne og fjorde.',
    wt_most_dk:'Mest i DK',
    wt_fresh_label:'Ferskvand', wt_fresh_sub:'Søer, åer og vandløb',
    wt_brackish_label:'Brakvand', wt_brackish_sub:'Fjorde, bælter, Østersøen',
    wt_salt_label:'Saltvand', wt_salt_sub:'Nordsøen (vestkysten)',
    wt_both_label:'Alt vand', wt_both_sub:'Alle vandtyper',
    wt_salt_hint:'Nordsøen / ægte saltvand (~30–35 ppt)',
    wt_brackish_hint:'Kattegat, Øresund, Bælterne, Østersøen (~5–25 ppt). Blanding af salt- og ferskvandsarter.',
    wt_fresh_hint:'Søer, åer og vandløb (~0 ppt)',
    wt_both_hint:'Varierende vandtype — se stedets beskrivelse',
    wt_salt_label_full:'🌊 Saltvand',
    wt_brackish_label_full:'🌿 Brakvand',
    wt_fresh_label_full:'💧 Ferskvand',
    wt_both_label_full:'🗺 Blandet',
    wt_override:'Klik for at overstyre vandtype',
    wt_override_warn:'⚠️ Overstyrende officielle data',
    // Locations
    loc_title:'Dine fiskelokationer',
    loc_sub:'Søg, browse officielle pladser, eller klik direkte på kortet',
    loc_search_tab:'Søg & Browse', loc_map_tab:'Kort',
    loc_search_ph:'F.eks. Køge, Esbjerg, Silkeborg...',
    loc_popular:'⭐ Populære fiskepladser', loc_nearby_hd:'📍 Fiskepladser i nærheden',
    loc_db_count:'pladser i database',
    loc_empty:'Ingen lokationer tilføjet endnu',
    loc_official:'🎣 Officielt fiskested', loc_custom:'📌 Brugerdefineret spot',
    loc_brackish_note:'🌿 Brakvand — salt- og ferskvandsarter mulige ℹ️',
    loc_in_season:'Ingen aktive arter denne måned',
    // Species
    sp_title:'Hvilke arter fisker du efter?',
    sp_sub:'Vælg dine målarter — scoren tilpasses de valgte arters præferencer',
    sp_show:'Vis fiskeforhold →',
    sp_lucky_btn:'🎲 Find bedste hotspot',
    sp_high_season:'⭐ Høj sæson nu',
    sp_in_season:'✅ I sæson nu', sp_restricted:'⚠️ Med begrænsninger', sp_closed:'🚫 Lukket sæson',
    sp_banned_label:'Fangst forbudt', sp_restricted_label:'Begrænsninger',
    sp_handle:'Brug tang ved håndtering',
    sp_regs_note:'⚠️ Regler er vejledende. Verificér altid på',
    // Dashboard
    dash_best:'🏆 Bedste vindue',
    dash_targets:'🎯 Målarter:',
    dash_no_windows:'Ingen tidsvinduer fundet. Tilføj en tilgængelighed i opsætningen.',
    dash_no_forecast:'Ingen vejrdata — tryk Opdater',
    tab_windows:'📅 Tidsvinduer', tab_seasons:'🐟 Fiskesæsoner', tab_conditions:'🌤 Vejr & Bølger',
    best_hour:'Bedste time:',
    lure_label:'🎨 Agn:',
    your_locs:'📍 Dine lokationer',
    moon_title:'🌙 Månefase i dag',
    lightning_title:'⚡ Lyn-status',
    no_lightning:'Ingen lyn registreret',
    update_lightning:'⟳ Opdater lyn',
    lightning_src:'Kilde: DMI · Sidst 45 min · Kun lyn i Danmark',
    lightning_checked:'Tjekket',
    explanation:'ℹ️ Forklaring',
    sunrise:'Solopgang', sunset:'Solnedgang',
    moonrise:'Måneopgang', moonset:'Månenedgang', culmination:'Kulminering',
    moon_phase_today:'Fase:',
    moon_tip_new:'🌑 Nymåne — vandstanden ændrer sig mest (springflod). Fiskene er ekstra aktive; de bedste majortider falder tæt på solop- og nedgang.',
    moon_tip_full:'🌕 Fuldmåne — stærkeste solunareffekt. Springflod giver kraftige strømme og aktive fisk. Især natfiskeri kan være fremragende.',
    moon_tip_quarter:'🌓 Kvartmåne — neapflod med svagere strøm. Fiskene er mindre aktive end ved ny- og fuldmåne, men solaktive perioder virker stadig.',
    moon_tip_gibbous:'🌔 Gibbøs måne — næsten fuld/ny. Aktiviteten stiger — fiskenes appetit tiltar efterhånden som månecyklussen nærmer sig sit højdepunkt.',
    no_windows_empty:'Ingen tidsvinduer. Tjek din tilgængelighed.',
    no_locs_empty:'Ingen lokationer.',
    data_missing:'Ingen vejrdata',
    load_data_btn:'Hent vejrdata', load_data_for:'Hent data til', load_data_missing:'lokationer mangler vejrdata',
    // Hardcoded strings
    locs_ready:'lokationer klar', locs_failed:'fejlede',
    invalid_window:'Ugyldigt tidsvindue',
    no_official_spots:'Ingen officielle fiskesteder inden for 40 km',
    wt_salt_opt:'🌊 Saltvand (~33 ppt)', wt_brackish_opt:'🌿 Brakvand (fjorde, bælter, Østersøen)', wt_fresh_opt:'💧 Ferskvand (søer, åer)',
    lightning_strikes_near:'lynnedslag i',
    sf_no_spots_found:'Ingen pladser fundet', sf_no_spots_db:'i databasen', sf_no_spots_radius:'inden for',
    sf_try_broader:'Prøv en bredere søgning, eller tilføj din lokation manuelt via 📍 Lokationer → Kort.',
    sf_score_hint:'Pladsscore baseret på art, sæson og habitat — vejrdata hentes efter du tilføjer stedet',
    score_lightning_name:'Lynsikkerhed', score_lightning_desc:'Aktive lynslag inden for 10 km sætter scoren til maks 15 og viser rød advarsel. Kulstofstænger er lynledere — gå aldrig ud.',
    topbar_species:'🎯 Målarter', topbar_locations:'📍 Lokationer', topbar_times:'⏱ Tidsvinduer',
    save_back_dash:'Gem og tilbage til dashboard',
    // Score labels
    score_excellent:'Fremragende', score_good:'Godt', score_avg:'Middel',
    score_below:'Under middel', score_poor:'Dårligt',
    // Score info modal
    score_modal_title:'📊 Fiskeindeks — forklaring',
    score_modal_base:'Basisværdi for alle vinduer',
    score_breakdown_title:'Score-fordeling bedste time:',
    score_tip:'💡 Tilvælg målarter for at justere scoren til de valgte arters præferencer.',
    // Wind trend labels
    wind_rising_fast:'↑↑ Tiltagende kraftigt',
    wind_rising:'↑ Tiltagende',
    wind_falling_fast:'↓↓ Aftager kraftigt',
    wind_falling:'↓ Aftager',
    wind_stable:'→ Stabilt',
    // Pressure trend labels
    press_rising_fast:'Stigende kraftigt ↑↑',
    press_rising:'Svagt stigende ↑',
    press_stable:'Stabilt →',
    press_falling:'Svagt faldende ↓',
    press_falling_fast:'Faldende kraftigt ↓↓',
    press_fish_rising_fast:'📈 Hurtigt stigende tryk — fiskene aktiveres kraftigt og jager aggressivt. Et af de bedste tidsvinduer til kystfiskeri.',
    press_fish_rising:'📈 Stigende tryk — fiskenes aktivitet tiltar. Forventede gode bid, særligt i starten af stigningen.',
    press_fish_stable:'➡️ Stabilt tryk — fiskene har tilpasset sig og holder til på kendte dybder. Fiskeri er forudsigeligt, men ingen ekstra aktivitetspeak.',
    press_fish_falling:'📉 Faldende tryk — fiskene mærker det og fodrer aktivt inden trykket rammer bunden. Fang dem nu, mens de stadig er oppe.',
    press_fish_falling_fast:'📉 Kraftigt faldende tryk — fiskene trækker sig til bunden. Forvent sværere fiskeri; de fleste arter holder lav profil.',
    // Tide labels
    tide_rising:'🌊 Stigende tidevand',
    tide_falling:'🌊 Faldende tidevand',
    // Conditions tab
    cond_temp:'Temperatur', cond_wind:'Vind', cond_gust:'Vindstød',
    cond_cloud:'Skydække', cond_precip:'Nedbørschance',
    cond_wave:'Bølgehøjde', cond_period:'Bølgeperiode', cond_swell:'Dønning',
    cond_tide:'Tidevand', cond_tide_from:'Tidevand fra',
    wave_forecast:'📈 Bølgeprognose',
    // Spot finder
    sf_lucky_badge:'🎲 Held og lykke', sf_nearby_badge:'📍 Find i nærheden',
    sf_when:'🗓 Hvornår vil du ud og fiske?',
    sf_date:'Dato', sf_time:'Tidspunkt', sf_radius:'Radius',
    sf_from_where:'Fra hvor?',
    sf_geo_ph:'By, sted eller postnummer...',
    sf_search_btn:'📍 Find fiskepladser',
    sf_search_lucky:"🎲 Find Danmarks bedste spots",
    sf_no_results:'Ingen pladser fundet i denne radius.',
    sf_results_nearby:'Fiskepladser inden for',
    sf_results_km:'km',
    sf_add_to_locs:'+ Tilføj til mine lokationer',
    sf_goto_dash:'Gå til dashboard →',
    sf_use_location:'📍 Brug min placering',
    sf_searching:'Søger...',
    sf_dist:'km væk',
    sf_no_windows:'Ingen tidsvinduer',
    // Lure colors
    lure_silver:'Sølv', lure_pearl:'Perlemorshvid', lure_gold:'Guld',
    lure_chartreuse:'Chartreuse', lure_orange:'Orange', lure_red:'Rød',
    lure_firetiger:'Firetiger', lure_uvwhite:'UV-hvid', lure_green:'Grøn',
    lure_black:'Sort', lure_pink:'Pink',
    lure_reason_silver:'Klart vand + sol — naturlig blink',
    lure_reason_pearl:'Klart vand + sol — subtilt blinkende',
    lure_reason_gold:'Delvist overskyet — varm flash',
    lure_reason_chartreuse:'Overskyet / diffust lys — høj synlighed',
    lure_reason_orange:'Grumset vand / stærk vind — kontrastfarve',
    lure_reason_red:'Mørkt / grumset vand — maks kontrast',
    lure_reason_firetiger:'Høje bølger / silt — voldsom kontrast',
    lure_reason_uvwhite:'Lavt lys / morgen-aften — lyser op',
    lure_reason_green:'Grumset ferskvand — mimetisk',
    lure_reason_black:'Meget grumset / nat — silhuet-kontrast',
    lure_reason_pink:'Klart saltvandsforhold — havørred-favorit',
    lure_tip_murky:'Grumset vand: brug store, kraftige farver og langsommere bevægelse',
    lure_tip_lowlight:'Lavt lys: UV-hvid og chartreuse reflekterer diffust lys bedst',
    lure_tip_clear:'Klart stille vand: naturlige subtile farver — fiskene er sky',
    lure_tip_overcast:'Overskyet: mellemstærke attractor-farver virker godt i diffust lys',
    // Species tackle tips
    tip_hornfisk:'🐟 Hornfisk: brug silketråd eller små tripler på en dropper-line efter blinket — hornfisken hugger short',
    tip_gedde:'🐊 Gedde: brug stålfortom — geddens tænder skærer monofilament over',
    tip_sandart:'🐊 Sandart: langsom bundjigging 0.5–1.5 m over bunden — kræver tålmodighed',
    tip_aborre:'🐡 Aborre: drop-shot eller micro-jig 3–8 g — reagerer godt på langsom animation',
    tip_torsk:'🐡 Torsk: tung pilker 40–150 g afhængig af dybde og strøm — bund-rig med orm virker også',
    tip_havørred:'🐟 Havørred: blink, wobler eller flue langs bræmmer og stenrev — tidlig morgen bedst',
    tip_laks:'🐟 Laks: brug kraftig fortom (20–30 lb) og store wobler/spinners — fisk i strømmende vand',
    tip_al:'🐍 Ål: orm eller død agnfisk på bunden nat-fiskeri — fisk stille med slap linje',
    tip_makrel:'🐟 Makrel: sølv-sluk eller feathered jig i hurtig bevægelse — find stimerne visuelt',
    tip_fjaesing:'☠️ Fjæsing: vadefisk — ALTID vandsko/vadesko. Stikket er smertefuldt, nedsænk i varmt vand (45°C)',
    // Moon phases (from solunar.js)
    moon_new:'Nymåne', moon_waxing_crescent:'Tiltagende halvmåne',
    moon_first_quarter:'Første kvarter', moon_waxing_gibbous:'Tiltagende',
    moon_full:'Fuldmåne', moon_waning_gibbous:'Aftagende',
    moon_last_quarter:'Sidste kvarter', moon_waning_crescent:'Aftagende halvmåne',
    // Solunar periods
    solunar_major:'🌕 Majortid', solunar_minor:'🌙 Minortid',
    solunar_golden:'Gode fisketider:', solunar_none:'Ingen solunar periode i dette vindue',
    // Week sparkline
    best_day_week:'Bedste dag:', week_overview:'Ugeoversigt',
    // Water temperature
    water_temp:'Vandtemp.',
    // Conditions tab labels
    cond_beaufort:'Beaufort', cond_wind_trend:'Vindtrend',
    // Favourite spots
    fav_add:'Tilføj til favoritter', fav_remove:'Fjern fra favoritter',
    // Spot notes
    note_placeholder:'Tilføj note til dette sted…',
    note_label:'📝 Note', note_save:'Gem', note_saved:'✓ Gemt',
    // Stale data
    stale_banner:'Data fra', stale_banner2:'— kan være forældet.',
    stale_update:'Opdater nu',
    // Condition delta
    vs_yesterday:'vs. i går',
    // Wind relative to shore
    wind_onshore:'Pålandsvind', wind_offshore:'Aflandsvind',
    wind_cross_onshore:'Tværvind (ind)', wind_cross_offshore:'Tværvind (ud)',
    wind_shore_label:'Kystretning:',
    // Tide arrows on window cards
    tide_up:'↑ Stigende', tide_down:'↓ Faldende',
    // Min size / bag limit on species cards
    sp_min_size:'Min.', sp_bag_limit:'Dagskvoter:', sp_cr:'♻️ C&R anbefalet',
    // Pressure graph
    pressure_graph:'Lufttryk — 48 timer', pressure_hpa:'hPa',
    // Share
    share_btn:'🔗 Del', share_copied:'✓ Kopieret!', share_window:'Delt fiskevindue',
    share_add_loc:'+ Tilføj lokation', share_view_dash:'Gå til dashboard →',
    share_intro:'En anden FishCast-bruger har delt dette vindue med dig:',
    // Notifications
    notif_enable:'🔔 Påmindelser', notif_enabled:'🔔 Aktiv',
    notif_denied:'Notifikationer blokeret', notif_scheduled:'Påmindelser planlagt',
    notif_title:'🎣 FishCast — Godt vindue snart!',
    notif_none:'Ingen kommende vinduer at minde om',
    // Quick reset
    reset_data_btn:'🗑 Ryd vejrdata', reset_data_confirm:'Ryd alle gemte vejrdata? Lokationer og indstillinger beholdes.',
    reset_data_ok:'✓ Data ryddet',
  },
  en: {
    // General
    back:'← Back', next:'Next →', skip:'Skip →', close:'Close',
    add:'+ Add', added:'✓ Added', save:'Save', cancel:'Cancel',
    reset_btn:'🔄 Reset everything',
    reset_confirm:'Reset all — locations, time windows and target species will be deleted. Are you sure?',
    show_on_map:'Show on map 🗺', rename:'Rename',
    update_all:'⟳ Update all data', data_ok:'✓ Data',
    loading:'Loading…', error:'Error', details:'Details',
    // Days
    day0:'Sun',day1:'Mon',day2:'Tue',day3:'Wed',day4:'Thu',day5:'Fri',day6:'Sat',
    // Months
    month0:'Jan',month1:'Feb',month2:'Mar',month3:'Apr',month4:'May',month5:'Jun',
    month6:'Jul',month7:'Aug',month8:'Sep',month9:'Oct',month10:'Nov',month11:'Dec',
    // Welcome
    welcome_tagline:'Your personal fishing assistant.',
    welcome_sub:'Set your locations and time slots — we find the best window.',
    welcome_setup:'Set up my fishing spots →',
    welcome_continue:'Continue to dashboard',
    welcome_or:'or',
    welcome_shortcut:'Find fishing spots fast — no setup needed',
    welcome_lucky_title:'Lucky Cast',
    welcome_lucky_sub:"Find Denmark's best hotspot for a specific species",
    welcome_nearby_title:'Find Nearby',
    welcome_nearby_sub:'Search fishing spots within a given distance from you',
    attribution:'Weather: Open-Meteo · Tides + Lightning: DMI Open Data · Regulations: lfst.dk',
    // Availability
    avail_title:'When can you fish?',
    avail_sub:'Set your available time windows',
    avail_window:'Time Window',
    avail_add:'+ Add time window',
    avail_notice:'ℹ️ Add at least one time window to continue.',
    time_from:'From', time_to:'To',
    method_label:'Fishing method', method_pick:'Select one or more',
    method_required:'At least one method must be selected',
    method_shore:'Shore', method_waders:'Waders', method_boat:'From boat',
    fm_shore_hint:'Shore fishing / rod fishing from land',
    fm_waders_hint:'Wading — bottom type and undercurrent weighted',
    fm_boat_hint:'Boat trip — wave height and wind weighted harder',
    next_species:'Next: Target species →',
    next_choose_art:'Next: Choose species →',
    next_choose_start:'Next: Choose start location →',
    edit_time:'Edit →',
    // Water type
    wt_title:'What type of fishing water?',
    wt_sub:'Choose the water types you primarily fish in',
    wt_fact_hd:'Did you know?',
    wt_fact_body:"Most of Denmark's coast is <em>brackish</em> — not true saltwater. Kattegat, Øresund, the Danish straits and the Baltic Sea are all mixtures of salt and freshwater. Only the North Sea (Jutland's west coast) is true ocean. This means freshwater fish like pike and perch can live in many Danish harbours and fjords.",
    wt_most_dk:'Most common in DK',
    wt_fresh_label:'Freshwater', wt_fresh_sub:'Lakes, rivers and streams',
    wt_brackish_label:'Brackish', wt_brackish_sub:'Fjords, straits, Baltic Sea',
    wt_salt_label:'Saltwater', wt_salt_sub:'North Sea (west coast)',
    wt_both_label:'All water', wt_both_sub:'All water types',
    wt_salt_hint:'North Sea / true saltwater (~30–35 ppt)',
    wt_brackish_hint:'Kattegat, Øresund, Straits, Baltic Sea (~5–25 ppt). Mix of salt & freshwater species.',
    wt_fresh_hint:'Lakes, rivers and streams (~0 ppt)',
    wt_both_hint:'Varying water type — see spot description',
    wt_salt_label_full:'🌊 Saltwater',
    wt_brackish_label_full:'🌿 Brackish',
    wt_fresh_label_full:'💧 Freshwater',
    wt_both_label_full:'🗺 Mixed',
    wt_override:'Click to override water type',
    wt_override_warn:'⚠️ Overriding official data',
    // Locations
    loc_title:'Your fishing locations',
    loc_sub:'Search, browse official spots, or click directly on the map',
    loc_search_tab:'Search & Browse', loc_map_tab:'Map',
    loc_search_ph:'E.g. Køge, Esbjerg, Silkeborg...',
    loc_popular:'⭐ Popular fishing spots', loc_nearby_hd:'📍 Fishing spots nearby',
    loc_db_count:'spots in database',
    loc_empty:'No locations added yet',
    loc_official:'🎣 Official fishing spot', loc_custom:'📌 Custom spot',
    loc_brackish_note:'🌿 Brackish — both salt & freshwater species possible ℹ️',
    loc_in_season:'No active species this month',
    // Species
    sp_title:'Which species are you targeting?',
    sp_sub:'Choose your target species — the score adapts to their preferences',
    sp_show:'Show fishing conditions →',
    sp_lucky_btn:'🎲 Find best hotspot',
    sp_high_season:'⭐ Peak season now',
    sp_in_season:'✅ In season now', sp_restricted:'⚠️ With restrictions', sp_closed:'🚫 Closed season',
    sp_banned_label:'Catch banned', sp_restricted_label:'Restrictions',
    sp_handle:'Use pliers when handling',
    sp_regs_note:'⚠️ Regulations are advisory. Always verify at',
    // Dashboard
    dash_best:'🏆 Best window',
    dash_targets:'🎯 Target species:',
    dash_no_windows:'No time windows found. Add availability in the setup.',
    dash_no_forecast:'No weather data — press Update',
    tab_windows:'📅 Time windows', tab_seasons:'🐟 Fishing seasons', tab_conditions:'🌤 Weather & Waves',
    best_hour:'Best hour:',
    lure_label:'🎨 Lure:',
    your_locs:'📍 Your locations',
    moon_title:'🌙 Moon phase today',
    lightning_title:'⚡ Lightning status',
    no_lightning:'No lightning detected',
    update_lightning:'⟳ Update lightning',
    lightning_src:'Source: DMI · Last 45 min · Danish lightning only',
    lightning_checked:'Checked',
    explanation:'ℹ️ Explanation',
    sunrise:'Sunrise', sunset:'Sunset',
    moonrise:'Moonrise', moonset:'Moonset', culmination:'Culmination',
    moon_phase_today:'Phase:',
    moon_tip_new:'🌑 New moon — tides are at their strongest (spring tide). Fish are highly active; the best solunar periods align with sunrise and sunset.',
    moon_tip_full:'🌕 Full moon — peak solunar effect. Spring tides create strong currents and active fish. Night fishing can be exceptional.',
    moon_tip_quarter:'🌓 Quarter moon — neap tide with weaker currents. Fish are less active than at new/full moon, but solar periods still produce bites.',
    moon_tip_gibbous:'🌔 Gibbous moon — approaching peak. Activity is building as the lunar cycle nears its strongest point — fishing improves day by day.',
    no_windows_empty:'No time windows. Check your availability.',
    no_locs_empty:'No locations.',
    data_missing:'No weather data',
    load_data_btn:'Fetch weather', load_data_for:'Fetch data for', load_data_missing:'locations missing weather data',
    // Hardcoded strings
    locs_ready:'locations ready', locs_failed:'failed',
    invalid_window:'Invalid time window',
    no_official_spots:'No official fishing spots within 40 km',
    wt_salt_opt:'🌊 Saltwater (~33 ppt)', wt_brackish_opt:'🌿 Brackish (fjords, straits, Baltic)', wt_fresh_opt:'💧 Freshwater (lakes, rivers)',
    lightning_strikes_near:'strikes within',
    sf_no_spots_found:'No spots found', sf_no_spots_db:'in the database', sf_no_spots_radius:'within',
    sf_try_broader:'Try a broader search, or add your location manually via 📍 Locations → Map.',
    sf_score_hint:'Spot score based on species, season and habitat — weather data loads after you add the spot',
    score_lightning_name:'Lightning safety', score_lightning_desc:'Active lightning within 10 km caps the score at 15 and shows a red warning. Carbon rods conduct lightning — never fish in a storm.',
    topbar_species:'🎯 Species', topbar_locations:'📍 Locations', topbar_times:'⏱ Time slots',
    save_back_dash:'Save and back to dashboard',
    // Score labels
    score_excellent:'Excellent', score_good:'Good', score_avg:'Average',
    score_below:'Below average', score_poor:'Poor',
    // Score info modal
    score_modal_title:'📊 Fishing index — explanation',
    score_modal_base:'Base value for all windows',
    score_breakdown_title:'Score breakdown (best hour):',
    score_tip:'💡 Select target species to adjust the score to their preferences.',
    // Wind trend labels
    wind_rising_fast:'↑↑ Increasing rapidly',
    wind_rising:'↑ Increasing',
    wind_falling_fast:'↓↓ Decreasing rapidly',
    wind_falling:'↓ Decreasing',
    wind_stable:'→ Stable',
    // Pressure trend labels
    press_rising_fast:'Rising rapidly ↑↑',
    press_rising:'Slightly rising ↑',
    press_stable:'Stable →',
    press_falling:'Slightly falling ↓',
    press_falling_fast:'Falling rapidly ↓↓',
    press_fish_rising_fast:'📈 Rapidly rising pressure — fish are feeding aggressively. One of the best windows for shore fishing.',
    press_fish_rising:'📈 Rising pressure — fish activity is building. Expect good bites, especially early in the rise.',
    press_fish_stable:'➡️ Stable pressure — fish have settled at their usual depths. Fishing is predictable but no extra activity peak expected.',
    press_fish_falling:'📉 Falling pressure — fish sense the drop and feed actively before it bottoms out. Get out while they\'re still up.',
    press_fish_falling_fast:'📉 Rapidly falling pressure — fish retreat to deeper water. Most species go quiet; expect a tough session.',
    // Tide labels
    tide_rising:'🌊 Rising tide',
    tide_falling:'🌊 Falling tide',
    // Conditions tab
    cond_temp:'Temperature', cond_wind:'Wind', cond_gust:'Gusts',
    cond_cloud:'Cloud cover', cond_precip:'Precip. chance',
    cond_wave:'Wave height', cond_period:'Wave period', cond_swell:'Swell',
    cond_tide:'Tide', cond_tide_from:'Tide station',
    wave_forecast:'📈 Wave forecast',
    // Spot finder
    sf_lucky_badge:'🎲 Lucky Cast', sf_nearby_badge:'📍 Find Nearby',
    sf_when:'🗓 When do you want to fish?',
    sf_date:'Date', sf_time:'Time', sf_radius:'Radius',
    sf_from_where:'From where?',
    sf_geo_ph:'Town, place or postcode...',
    sf_search_btn:'📍 Find fishing spots',
    sf_search_lucky:"🎲 Find Denmark's best spots",
    sf_no_results:'No spots found within this radius.',
    sf_results_nearby:'Fishing spots within',
    sf_results_km:'km',
    sf_add_to_locs:'+ Add to my locations',
    sf_goto_dash:'Go to dashboard →',
    sf_use_location:'📍 Use my location',
    sf_searching:'Searching...',
    sf_dist:'km away',
    sf_no_windows:'No time windows',
    // Lure colors
    lure_silver:'Silver', lure_pearl:'Pearl white', lure_gold:'Gold',
    lure_chartreuse:'Chartreuse', lure_orange:'Orange', lure_red:'Red',
    lure_firetiger:'Firetiger', lure_uvwhite:'UV white', lure_green:'Green',
    lure_black:'Black', lure_pink:'Pink',
    lure_reason_silver:'Clear water + sun — natural flash',
    lure_reason_pearl:'Clear water + sun — subtle shine',
    lure_reason_gold:'Partly cloudy — warm flash',
    lure_reason_chartreuse:'Overcast / diffuse light — high visibility',
    lure_reason_orange:'Murky water / strong wind — contrast colour',
    lure_reason_red:'Dark / murky water — max contrast',
    lure_reason_firetiger:'High waves / silt — extreme contrast',
    lure_reason_uvwhite:'Low light / dawn-dusk — glows up',
    lure_reason_green:'Murky freshwater — mimetic',
    lure_reason_black:'Very murky / night — silhouette contrast',
    lure_reason_pink:'Clear saltwater — sea trout favourite',
    lure_tip_murky:'Murky water: use large, bold colours and slower retrieves',
    lure_tip_lowlight:'Low light: UV white and chartreuse reflect diffuse light best',
    lure_tip_clear:'Clear calm water: natural subtle colours — fish are wary',
    lure_tip_overcast:'Overcast: medium-strength attractor colours work well in diffuse light',
    // Species tackle tips
    tip_hornfisk:'🐟 Garfish: use silk thread or small treble hooks on a dropper-line behind the lure — garfish strike short',
    tip_gedde:'🐊 Pike: use a wire leader — pike teeth cut through monofilament',
    tip_sandart:'🐊 Zander: slow bottom jigging 0.5–1.5 m above the bottom — requires patience',
    tip_aborre:'🐡 Perch: drop-shot or micro-jig 3–8 g — responds well to slow animation',
    tip_torsk:'🐡 Cod: heavy pirk 40–150 g depending on depth and current — bottom rig with worm also works',
    tip_havørred:'🐟 Sea trout: spinner, wobbler or fly along edges and rock reefs — early morning best',
    tip_laks:'🐟 Salmon: use strong leader (20–30 lb) and large wobblers/spinners — fish in running water',
    tip_al:'🐍 Eel: worm or dead baitfish on the bottom at night — fish still with slack line',
    tip_makrel:'🐟 Mackerel: silver lure or feathered jig retrieved fast — find the schools visually',
    tip_fjaesing:'☠️ Greater Weever: wading — ALWAYS wear water shoes. The sting is painful; submerge in hot water (45°C)',
    // Moon phases (from solunar.js)
    moon_new:'New Moon', moon_waxing_crescent:'Waxing Crescent',
    moon_first_quarter:'First Quarter', moon_waxing_gibbous:'Waxing Gibbous',
    moon_full:'Full Moon', moon_waning_gibbous:'Waning Gibbous',
    moon_last_quarter:'Last Quarter', moon_waning_crescent:'Waning Crescent',
    // Solunar periods
    solunar_major:'🌕 Major period', solunar_minor:'🌙 Minor period',
    solunar_golden:'Good fishing times:', solunar_none:'No solunar period in this window',
    // Week sparkline
    best_day_week:'Best day:', week_overview:'Week overview',
    // Water temperature
    water_temp:'Water temp.',
    // Conditions tab labels
    cond_beaufort:'Beaufort', cond_wind_trend:'Wind trend',
    // Favourite spots
    fav_add:'Add to favourites', fav_remove:'Remove from favourites',
    // Spot notes
    note_placeholder:'Add a note for this spot…',
    note_label:'📝 Note', note_save:'Save', note_saved:'✓ Saved',
    // Stale data
    stale_banner:'Data from', stale_banner2:'— may be outdated.',
    stale_update:'Update now',
    // Condition delta
    vs_yesterday:'vs. yesterday',
    // Wind relative to shore
    wind_onshore:'Onshore wind', wind_offshore:'Offshore wind',
    wind_cross_onshore:'Crosswind (in)', wind_cross_offshore:'Crosswind (out)',
    wind_shore_label:'Shore direction:',
    // Tide arrows on window cards
    tide_up:'↑ Rising', tide_down:'↓ Falling',
    // Min size / bag limit on species cards
    sp_min_size:'Min.', sp_bag_limit:'Bag limit:', sp_cr:'♻️ C&R recommended',
    // Pressure graph
    pressure_graph:'Air pressure — 48 hours', pressure_hpa:'hPa',
    // Share
    share_btn:'🔗 Share', share_copied:'✓ Copied!', share_window:'Shared fishing window',
    share_add_loc:'+ Add location', share_view_dash:'Go to dashboard →',
    share_intro:'Another FishCast user shared this window with you:',
    // Notifications
    notif_enable:'🔔 Reminders', notif_enabled:'🔔 Active',
    notif_denied:'Notifications blocked', notif_scheduled:'Reminders scheduled',
    notif_title:'🎣 FishCast — Great window soon!',
    notif_none:'No upcoming windows to remind about',
    // Quick reset
    reset_data_btn:'🗑 Clear weather data', reset_data_confirm:'Clear all cached weather data? Locations and settings are kept.',
    reset_data_ok:'✓ Data cleared',
  }
};

/** Translate a key using the current language */
function t(key) {
  const lang = (typeof state !== 'undefined' && state.lang) || 'da';
  return (STRINGS[lang] ?? STRINGS.da)[key] ?? STRINGS.da[key] ?? key;
}

/** Switch UI language and re-render */
function setLang(lang) {
  state.lang = lang;
  saveState();
  render();
}

/** Map moon emoji (from solunar.js) to STRINGS translation key */
const MOON_EMOJI_KEY = {
  '🌑':'moon_new',       '🌒':'moon_waxing_crescent',
  '🌓':'moon_first_quarter', '🌔':'moon_waxing_gibbous',
  '🌕':'moon_full',      '🌖':'moon_waning_gibbous',
  '🌗':'moon_last_quarter',  '🌘':'moon_waning_crescent',
};
/** Translate the label returned by Solunar.moonPhaseLabel() */
function translateMoonLabel(label) {
  const parts = label.split(' ');
  const key = MOON_EMOJI_KEY[parts[0]];
  return key ? parts[0] + ' ' + t(key) : label;
}

// Beaufort scale (m/s boundaries — standard meteorological)
const BEAUFORT = [
  { bf:0,  maxMs:0.3,  label:'Stille',           sea:'Spejlblank',              boatOk: true       },
  { bf:1,  maxMs:1.6,  label:'Svag luftning',     sea:'Rislende bølger',         boatOk: true       },
  { bf:2,  maxMs:3.4,  label:'Svag brise',        sea:'Småbølger',               boatOk: true       },
  { bf:3,  maxMs:5.5,  label:'Let brise',         sea:'Svagt krusede bølger',    boatOk: true       },
  { bf:4,  maxMs:8.0,  label:'Jævn brise',        sea:'Tydelige bølger',         boatOk: true       },
  { bf:5,  maxMs:10.8, label:'Frisk brise',       sea:'Hvide kammebølger',       boatOk: 'caution'  },
  { bf:6,  maxMs:13.9, label:'Stiv kuling',       sea:'Større bølger, skumdrag', boatOk: false      },
  { bf:7,  maxMs:17.2, label:'Hård kuling',       sea:'Brydende søgang',         boatOk: false      },
  { bf:8,  maxMs:20.8, label:'Stormende kuling',  sea:'Moderat høje bølger',     boatOk: false      },
  { bf:9,  maxMs:24.5, label:'Storm',             sea:'Høje bølger',             boatOk: false      },
  { bf:10, maxMs:28.5, label:'Stærk storm',       sea:'Meget høje bølger',       boatOk: false      },
  { bf:11, maxMs:32.7, label:'Voldsom storm',     sea:'Usædvanlig høje bølger',  boatOk: false      },
  { bf:12, maxMs:999,  label:'Orkan',             sea:'Luften fyldt med skum',   boatOk: false      },
];

// Wind direction labels (Danish)
const WIND_DIRS = ['N','NNØ','NØ','ØNØ','Ø','ØSØ','SØ','SSØ','S','SSV','SV','VSV','V','VNV','NV','NNV'];

// ── Species targeting preferences ────────────────────────────
// Each entry defines what conditions this species responds best to.
// bonuses are ADDITIONAL points added on top of the base score
// when those conditions are met at scoring time.
const SPECIES_PREFS = {
  havørred: {
    id:'havørred', name:'Havørred', nameEn:'Sea Trout', emoji:'🐟',
    waterType:['salt','brackish'],
    tip:'Aktiveres kraftigt af stigende lufttryk og tidevandsbevægelse. Bedst ved daggry på en overskyet dag i let til moderat bølgegang.',
    bonuses: {
      pressureRising:+10, tide:+8, dawn:+5, dusk:+3,
      cloud:+3, waveLight:+5,   // 0.1–0.5m wave action = good
    },
    bottomPref:['stone','mixed'], depthPref:'shallow',
  },
  gedde: {
    id:'gedde', name:'Gedde', nameEn:'Pike', emoji:'🐊',
    waterType:['fresh'],
    tip:'Meget solunar-sensitiv. Foretrækker roligt vejr, lavvandet vand med vegetation, og fanger bedst i de store solunar-perioder.',
    bonuses: { pressureStable:+5, solunarMajor:+10, calm:+5 },
    bottomPref:['mixed','seaweed'], depthPref:'shallow',
  },
  sandart: {
    id:'sandart', name:'Sandart', nameEn:'Zander', emoji:'🐊',
    waterType:['fresh','brackish'],
    tip:'Nattaktiv rovfisk. Solunar-perioder og lavlys er nøglen — undgå klart dagslys. Bedst ved skumring og i de store månens perioder.',
    bonuses: { solunarMajor:+12, dusk:+8, night:+8, cloud:+5 },
    bottomPref:['sand','mixed'], depthPref:'medium',
  },
  aborre: {
    id:'aborre', name:'Aborre', nameEn:'Perch', emoji:'🐟',
    waterType:['fresh','brackish','salt'],
    tip:'Flokfisk der jager aktivt ved daggry og skumring. Solunar-aktiv, foretrækker let overskyet.',
    bonuses: { dawn:+5, solunarMajor:+8, pressureRising:+5, cloud:+3 },
    bottomPref:['stone','mixed'], depthPref:'shallow',
  },
  pighvar: {
    id:'pighvar', name:'Pighvar', nameEn:'Turbot', emoji:'🐡',
    waterType:['salt'],
    tip:'Elsker let bølgegang der hvirvler byttefisk op fra sandbunden. Bedst ved stigende tidevand på en sandstrand.',
    bonuses: { tide:+10, waveLight:+10 },  // specifically wants 0.2–0.6m waves
    bottomPref:['sand'], depthPref:'shallow',
  },
  makrel: {
    id:'makrel', name:'Makrel', nameEn:'Mackerel', emoji:'🐟',
    waterType:['salt'],
    tip:'Overfladefisk der jager i stimer. Bedst i roligt vejr om morgenen og aftenen — brat vejrskifte spredte stimerne.',
    bonuses: { calm:+8, dawn:+5, dusk:+5, pressureStable:+3 },
    bottomPref:[], depthPref:'medium',
  },
  hornfisk: {
    id:'hornfisk', name:'Hornfisk', nameEn:'Garfish', emoji:'🐟',
    waterType:['salt'],
    tip:'Hurtig overfladefisk. Kræver rolige betingelser og er bedst om morgenen i sæsonen (april–september).',
    bonuses: { calm:+8, dawn:+6, pressureRising:+4 },
    bottomPref:[], depthPref:'shallow',
  },
  torsk: {
    id:'torsk', name:'Torsk', nameEn:'Cod', emoji:'🐡',
    waterType:['salt'],
    tip:'Fangsteforbud i 2026. Klik ⛔ for detaljer.',
    bonuses: { pressureHigh:+5, deep:+5 },
    bottomPref:['stone','mixed'], depthPref:'deep',
    restricted: true,
    banned: true,
    warningText: '🚫 FANGSTEFORBUD 2026\n\nTorskefiskeri er forbudt for lyst- og fritidsfiskere i Vestlige Østersø (ICES 22–24) i hele 2026 iht. EU-nødforordning om bestandsbeskyttelse.\n\nForbuddet kan forlænges i 2027. Tjek altid de aktuelle regler på lfst.dk inden du fisker.',
  },
  havbars: {
    id:'havbars', name:'Havbars', nameEn:'Sea Bass', emoji:'🐟',
    waterType:['salt'],
    tip:'Stærk rovfisk der elsker strøm og brudzone. Aktiv ved daggry, skumring og i solunar-perioder på rev og sandbund.',
    bonuses: { dawn:+8, dusk:+6, solunarMajor:+8, tide:+5 },
    bottomPref:['stone','sand'], depthPref:'shallow',
    restricted: true,
    warningText: '⚠️ DAGSKVOTER GÆLDER\n\n• Nordsøen syd for Hanstholm: Kun catch-and-release i januar. Max 3 fisk/dag april–december.\n• ICES IVc og 7a–7k: Max 4 fisk/dag april–december.\n\nMindstemål: 42 cm. Kilde: lfst.dk',
  },
  laks: {
    id:'laks', name:'Laks', nameEn:'Salmon', emoji:'🐟',
    waterType:['fresh','salt'],
    tip:'Kræver strømmende, koldtvand. Bedst ved stigende tryk og lavlys.',
    bonuses: { pressureRising:+8, dawn:+5, dusk:+5 },
    bottomPref:['stone'], depthPref:'medium',
    restricted: true,
    warningText: '⚠️ FANGSTBEGRÆNSNINGER\n\n• Max 1 klipfinne-laks per dag (saltvand).\n• Mindstemål: 60 cm (saltvand), 40 cm (ferskvand).\n• Fredning ferskvand: 16. nov – 28. feb.\n• Vadehavet: 15. sep – 28. feb.\n\nKilde: lfst.dk',
  },
  skrubbe: {
    id:'skrubbe', name:'Skrubbe', nameEn:'Flounder', emoji:'🐡',
    waterType:['salt','brackish'],
    tip:'Opportunistisk fladfisk der trives på mudderbund og i brakvand. Tager madding og spinneagn — aktiv ved tidevandsskift og stigende vand i fjorde og lavvandede kyster.',
    bonuses: { tide:+8, calm:+5, pressureStable:+3 },
    bottomPref:['mud','sand','mixed'], depthPref:'shallow',
  },
  roedspætte: {
    id:'roedspætte', name:'Rødspætte', nameEn:'Plaice', emoji:'🐡',
    waterType:['salt'],
    tip:'Klassisk sandbundsfisk med høj aktivitet i forårs- og sommermånederne. Reagerer godt på tidevandsbevægelse og er mest aktiv i let til moderat bølgegang over flad sandbund.',
    bonuses: { tide:+10, waveLight:+6, pressureRising:+4 },
    bottomPref:['sand','mixed'], depthPref:'shallow',
  },
  ising: {
    id:'ising', name:'Ising', nameEn:'Dab', emoji:'🐡',
    waterType:['salt'],
    tip:'Meget almindelig fladfisk i danske farvande — let at fange på sandbund hele sæsonen. Ingen mindstemål, god begynderfisk. Tager orm og småstykker madding.',
    bonuses: { tide:+5, calm:+5 },
    bottomPref:['sand','mud'], depthPref:'shallow',
  },
  lubbe: {
    id:'lubbe', name:'Lubbe', nameEn:'Pollock', emoji:'🐟',
    waterType:['salt'],
    tip:'Aktiv halvpelagisk rovfisk der holder til ved rev, stenstrukturer og vrag. Tager spinner og gummiagn. Bedst ved kraftig strøm i daggry og skumring — meget solunar-sensitiv.',
    bonuses: { dawn:+7, dusk:+6, solunarMajor:+8, tide:+6 },
    bottomPref:['stone'], depthPref:'deep',
  },
  morksej: {
    id:'morksej', name:'Mørksej', nameEn:'Coalfish', emoji:'🐟',
    waterType:['salt'],
    tip:'Skolevis pelagisk fisk der jager sild og tobis over dybere offshore-rev. Fanger godt på tunge gummiagn og pirke ved tidevandsskift — bedst i de koldere måneder.',
    bonuses: { tide:+8, solunarMajor:+6, dawn:+5 },
    bottomPref:['stone','mixed'], depthPref:'deep',
  },
  sild: {
    id:'sild', name:'Sild', nameEn:'Herring', emoji:'🐟',
    waterType:['salt','brackish'],
    tip:'Sild bevæger sig i store stimer og fånges bedst om efteråret og vinteren fra mole og havn på pirk eller silderigge. Meget aktive i stille vejr med overskyet himmel.',
    bonuses: { calm:+6, cloud:+5, pressureStable:+3, dawn:+3 },
    bottomPref:[], depthPref:'medium',
  },
  hvilling: {
    id:'hvilling', name:'Hvilling', nameEn:'Whiting', emoji:'🐡',
    waterType:['salt','brackish'],
    tip:'Aktiv bundfisk der fanger bedst om efteråret og vinteren. Bedst om aftenen og natten på orm eller stykker — meget solunar-sensitiv.',
    bonuses: { dusk:+6, night:+5, solunarMajor:+6, pressureStable:+4 },
    bottomPref:['sand','mixed'], depthPref:'medium',
  },
  brasen: {
    id:'brasen', name:'Brasen', nameEn:'Bream', emoji:'🐡',
    waterType:['fresh','brackish'],
    tip:'Stor, flokbaseret ferskvandsfisk bedst om sommeren og foråret. Foretrækker lavvandede, næringsrige søer. Meget solunar-sensitiv — fanger godt om natten på majs og madding.',
    bonuses: { solunarMajor:+10, night:+7, dusk:+5, pressureStable:+5 },
    bottomPref:['mud','mixed'], depthPref:'shallow',
  },
  karpe: {
    id:'karpe', name:'Karpe', nameEn:'Carp', emoji:'🐡',
    waterType:['fresh'],
    tip:'Stor, stærk fisk der fanger bedst i varmt stille vejr om sommeren. Meget vejr-sensitiv — stigende temperatur og stabilt tryk er nøglen. Foretrækker solrige dage og varme nætter.',
    bonuses: { pressureRising:+6, pressureStable:+8, calm:+6 },
    bottomPref:['mud','mixed'], depthPref:'shallow',
  },
  suder: {
    id:'suder', name:'Suder', nameEn:'Tench', emoji:'🐡',
    waterType:['fresh'],
    tip:'Smuk grøn-bronze ferskvandsfisk med karakteristiske røde øjne — en nær slægtning til karpen. Foretrækker varmt, stille vand med tæt undervandsvegetation. Bedst i tidlig morgen ved stabilt, varmt sommervejr. Mindstemål: 25 cm.',
    bonuses: { dawn:+8, pressureStable:+7, calm:+6 },
    bottomPref:['mud','seaweed'], depthPref:'shallow',
  },
  stenbider: {
    id:'stenbider', name:'Stenbider', nameEn:'Lumpsucker', emoji:'🐡',
    waterType:['salt','brackish'],
    tip:'Fånges bedst fra februar til maj når hunnerne søger ind på lavt vand for at lægge rogn. Stenrev og tangbund er det rette habitat — tidlig sæson og solunar er vigtige faktorer.',
    bonuses: { dawn:+5, solunarMajor:+5, tide:+4 },
    bottomPref:['stone'], depthPref:'shallow',
  },
  fjaesing: {
    id:'fjaesing', name:'Fjæsing', nameEn:'Greater Weever', emoji:'☠️',
    waterType:['salt'],
    tip:'Graver sig ned i sandbunden med giftige pigge opad. Fanges bedst på sandstrand i roligt vejr juni–september. Fremragende smag — men brug ALTID tang ved håndtering!',
    bonuses: { calm:+8, waveLight:+5, tide:+3 },
    bottomPref:['sand'], depthPref:'shallow',
    venom: true,
    warningText: '☠️ GIFTIGE PIGGE — Alvorlig fare!\n\nFjæsingen har giftige pigge på rygfinnen og gællelågene. Den graver sig ned i sandbunden med pigge opad og er næsten usynlig — særlig farlig for vadefiskere på sandstrande.\n\n🩺 VED STIK: Nedsænk STRAKS i så varmt vand du kan tåle (45–50°C) i 30–60 min. Varme nedbryder giften og reducerer smerten.\n\n🦾 HÅNDTERING: Brug altid fiskepincet/tang. Skær alle pigge af med saks inden rensning.',
  },
};

// ═══════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════
let state = {
  step: 'welcome',
  lang: 'da',
  waterType: null,
  region: 'dk',
  locations: [],
  targetSpecies: [],          // ['havørred','gedde', ...]
  availability: { recurring: [], specific: [] },
  scoreInfoOpen: false,
  forecasts:  {},   // {locId: {hourly, marine, tides}}
  fetchStatus:{},   // {locId: 'loading'|'ok'|'error'}
  lightning:  {},   // {locId: {strikes, dangerKm, lastCheck}}
  tideStations: [], // cached DMI tide station list
  activeTab: 'windows',
  spotFinder: {
    mode:     'lucky',    // 'lucky' | 'nearby'
    sfStep:   'time',     // 'time' | 'search'
    sfDate:   null,       // 'YYYY-MM-DD'
    sfFrom:   '06:00',
    sfTo:     '12:00',
    speciesId: null,
    nearbyQuery: '',
    nearbyGeoResults: [],
    nearbyLat: null, nearbyLon: null,
    nearbyRadius: 40,
    results: [],
    searching: false,
    showSpeciesPicker: false,
  },
  locationView: 'search',   // 'search' | 'map'
  showSpotLayer: true,       // show DK_SPOTS on map
  scoreInfoOpen: false,
  editingLocationId:  null,  // which location is being renamed
  editingWaterTypeId: null,  // which location's water type override is open
  speciesInfoPopup:   null,  // species ID whose warning popup is open
  focusLocationId:   null,   // fly-to this location when map opens
  locationSearchResults: [],
  locationSearchQuery: '',
  fetchingForecast: false,
  favLocations: [],          // [locId, ...] — pinned to top
  locNotes: {},              // {locId: 'note text'}
  notifsEnabled: false,      // user has granted notification permission
};

// ═══════════════════════════════════════════
//  PERSISTENCE
// ═══════════════════════════════════════════
function saveState() {
  const s = { waterType:state.waterType, region:state.region, locations:state.locations,
              targetSpecies:state.targetSpecies,
              availability:state.availability, lang:state.lang,
              favLocations:state.favLocations, locNotes:state.locNotes,
              notifsEnabled:state.notifsEnabled };
  try { localStorage.setItem('fishcast_state', JSON.stringify(s)); } catch(e){}
}
function loadState() {
  try {
    const raw = localStorage.getItem('fishcast_state');
    if (!raw) return false;
    Object.assign(state, JSON.parse(raw));
    return true;
  } catch(e) { return false; }
}

// ═══════════════════════════════════════════
//  UTILITIES
// ═══════════════════════════════════════════
function uid()  { return Math.random().toString(36).slice(2,9); }
function clamp(v,lo,hi) { return Math.min(hi, Math.max(lo, v)); }
function avg(arr) { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }

function haversine(lat1,lon1,lat2,lon2) {
  const R=6371, dL=(lat2-lat1)*Math.PI/180, dO=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dL/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dO/2)**2;
  return R*2*Math.asin(Math.sqrt(a));
}

function formatDate(d)   { return `${t('day'+d.getDay())} ${d.getDate()}. ${t('month'+d.getMonth())}`; }
function formatHHMM(d)   { return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`; }
function escHtml(s)      { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escJson(o)      { return escHtml(JSON.stringify(o)); }
// Water type labels + salinity context (bilingual via t())
const WATER_TYPE_INFO = {
  salt:     { icon:'🌊', labelKey:'wt_salt_label',     hintKey:'wt_salt_hint' },
  brackish: { icon:'🌿', labelKey:'wt_brackish_label', hintKey:'wt_brackish_hint' },
  fresh:    { icon:'💧', labelKey:'wt_fresh_label',    hintKey:'wt_fresh_hint' },
  both:     { icon:'🗺', labelKey:'wt_both_label',     hintKey:'wt_both_hint' },
};
function waterTypeLabel(w) {
  const info = WATER_TYPE_INFO[w];
  return info ? `${info.icon} ${t(info.labelKey)}` : w;
}
function waterTypeHint(w) {
  const info = WATER_TYPE_INFO[w];
  return info ? t(info.hintKey) : '';
}
// Returns true if a location should display freshwater species alongside saltwater ones
function showsFreshwaterSpecies(loc) {
  return loc.waterType === 'fresh' || loc.waterType === 'brackish';
}
function showsSaltwaterSpecies(loc) {
  return loc.waterType === 'salt' || loc.waterType === 'brackish' || loc.waterType === 'both';
}

function windDirLabel(deg) {
  if (deg == null) return '–';
  return WIND_DIRS[Math.round(((deg%360)+360)%360/22.5)%16];
}

function getBeaufort(ms) {
  for (const b of BEAUFORT) { if (ms < b.maxMs) return b; }
  return BEAUFORT[BEAUFORT.length-1];
}

/** Estimate the "offshore" bearing for a coastal spot relative to Denmark's land centre */
function getShorelineBearing(lat, lon) {
  const DK_LAT = 56.3, DK_LON = 9.8; // approx geographic centre of Jutland
  const dLon = (lon - DK_LON) * Math.PI / 180;
  const lat1 = DK_LAT * Math.PI / 180;
  const lat2 = lat    * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

/** Classify wind direction as onshore / offshore / crosswind for a given spot.
 *  Colour for onshore depends on strength:
 *    < 3 m/s  → green  (light onshore oxygenates water, pushes baitfish in — good)
 *    3–6 m/s  → gold   (moderate — mixed)
 *    > 6 m/s  → red    (strong onshore churns surf, hampers casting — bad)
 */
function windRelativeToShore(windDeg, windMs, lat, lon) {
  if (windDeg == null) return null;
  const offshoreBearing = getShorelineBearing(lat, lon);
  const onshoreDir      = (offshoreBearing + 180) % 360;
  const diff = Math.abs(((windDeg - onshoreDir + 540) % 360) - 180);
  const ms   = windMs || 0;
  if (diff < 45) {
    // Onshore — quality depends on wind strength
    const color = ms < 3 ? 'var(--green)' : ms < 6 ? 'var(--gold)' : 'var(--red)';
    return { key:'wind_onshore', icon:'🏖', color };
  }
  if (diff < 90)  return { key:'wind_cross_onshore',  icon:'↗️', color:'var(--gold)'  };
  if (diff < 135) return { key:'wind_cross_offshore', icon:'↙️', color:'var(--cyan)'  };
  return                 { key:'wind_offshore',       icon:'🌊', color:'var(--green)' };
}

// Wind direction quality for fishing (classic lore)
function windDirFishBonus(deg) {
  if (deg == null) return 0;
  const d = ((deg%360)+360)%360;
  if (d >= 247 && d < 337) return 5;   // W/NW — best
  if (d >= 157 && d < 247) return 2;   // S/SW — decent
  if (d >= 337 || d < 22)  return 3;   // N — ok
  if (d >= 22  && d < 112) return -5;  // NE/E — worst
  return 0;
}

function scoreColor(s) {
  if (s >= 80) return 'score-excellent';
  if (s >= 65) return 'score-good';
  if (s >= 45) return 'score-avg';
  return 'score-poor';
}
function scoreFish(s) {
  if (s >= 80) return '🐟🐟🐟🐟🐟';
  if (s >= 65) return '🐟🐟🐟🐟';
  if (s >= 45) return '🐟🐟🐟';
  if (s >= 30) return '🐟🐟';
  return '🐟';
}
function scoreLabel(s) {
  if (s >= 80) return t('score_excellent');
  if (s >= 65) return t('score_good');
  if (s >= 45) return t('score_avg');
  if (s >= 30) return t('score_below');
  return t('score_poor');
}

// ═══════════════════════════════════════════
//  WIND & WAVE ANALYSIS
// ═══════════════════════════════════════════
function getWindTrend(hourly, idx) {
  if (!hourly || hourly.length < 4) return { dir:'stable', label:t('wind_stable'), delta:0, score:0 };
  const now   = hourly[idx]?.windMs || 0;
  const prev  = hourly[Math.max(0, idx-3)]?.windMs || 0;
  const delta = now - prev;
  if (delta >  2.5) return { dir:'rising',  label:t('wind_rising_fast'), delta, score:-15, cls:'tag-red'    };
  if (delta >  1.0) return { dir:'rising',  label:t('wind_rising'),      delta, score:-8,  cls:'tag-orange' };
  if (delta < -2.5) return { dir:'falling', label:t('wind_falling_fast'),delta, score:+8,  cls:'tag-green'  };
  if (delta < -1.0) return { dir:'falling', label:t('wind_falling'),     delta, score:+4,  cls:'tag-green'  };
  return                   { dir:'stable',  label:t('wind_stable'),      delta, score:0,  cls:'tag-gray'   };
}

function getPressureTrend(hourly, idx) {
  if (!hourly || hourly.length < 4) return { dir:'stable', label:t('press_stable'), delta:0, fishLabel:null, score:3 };
  const now  = hourly[idx]?.pressure || 1013;
  const prev = hourly[Math.max(0, idx-3)]?.pressure || 1013;
  const delta = now - prev;
  if (delta >  3) return { dir:'rising',  label:t('press_rising_fast'), delta, fishLabel:t('press_fish_rising_fast'), score:22, cls:'tag-green' };
  if (delta >  1) return { dir:'rising',  label:t('press_rising'),      delta, fishLabel:t('press_fish_rising'),      score:12, cls:'tag-green' };
  if (delta > -1) return { dir:'stable',  label:t('press_stable'),      delta, fishLabel:null,                        score:1,  cls:'tag-gray'  };
  if (delta > -3) return { dir:'falling', label:t('press_falling'),     delta, fishLabel:t('press_fish_falling'),     score:-12,cls:'tag-orange'};
  return               { dir:'falling',  label:t('press_falling_fast'),delta, fishLabel:t('press_fish_falling_fast'),score:-25,cls:'tag-red'   };
}

/**
 * getShoreBoatRec — Shore / Boat / Wader safety recommendation
 * waveM:       wave height m (null = freshwater)
 * windKph:     wind speed km/h
 * windTrend:   'rising'|'stable'|'falling'
 * bottomType:  'sand'|'stone'|'mixed'|'mud'|'seaweed'
 * wavePeriod:  wave period s (undercurrent proxy)
 * tides:       tide predictions array
 * targetMs:    timestamp ms
 * Returns { boat, shore, wader, safetyLevel, undercurrent, tidalCurrent }
 */
function getShoreBoatRec(waveM, windKph, windTrend, bottomType='mixed', wavePeriod=null, tides=null, targetMs=null) {
  const bf        = getBeaufort(windKph);
  const worsening = windTrend === 'rising';

  // ── Undercurrent estimate (Stokes drift proxy: H²/T) ──
  let undercurrent = 'negligible';
  if (waveM && wavePeriod && wavePeriod > 0) {
    const proxy = (waveM * waveM) / wavePeriod;
    if      (proxy >= 0.10)  undercurrent = 'strong';
    else if (proxy >= 0.04)  undercurrent = 'moderate';
    else if (proxy >= 0.015) undercurrent = 'low';
  }

  // ── Tidal current estimate (rate of level change) ─────
  let tidalCurrent = 'low';
  if (tides && targetMs) {
    const h1 = getTideCycleAtTime(tides, targetMs - 30*60000);
    const h2 = getTideCycleAtTime(tides, targetMs + 30*60000);
    if (h1 && h2) {
      const ratePerHour = Math.abs(h2.value - h1.value) * 60;
      if      (ratePerHour > 0.5)  tidalCurrent = 'strong';
      else if (ratePerHour > 0.25) tidalCurrent = 'moderate';
    }
  }

  // ── Bottom risk profile ────────────────────────────────
  const BOTTOM_RISK = {
    sand:    { level:'low',      note:'Sandbund — sikker vadeoverflade. ⚠️ Obs: Fjæsinger graver sig ned i sandbunden om sommeren — brug skridsikre sko og vad forsigtigt.' },
    mixed:   { level:'low',      note:'Blandet bund — opmærksom på ujævnheder' },
    stone:   { level:'moderate', note:'⚠️ Stenrevsbund — skridsikre sko + vadevandsstav anbefales' },
    mud:     { level:'high',     note:'🚫 Mudderbund — risiko for at synke fast, vad ikke alene' },
    seaweed: { level:'moderate', note:'⚠️ Tangbund — meget glat, brug vadevandsstav' },
  };
  const bottomRisk = BOTTOM_RISK[bottomType] || { level:'low', note:'Bundtype ukendt — vær forsigtig' };

  // ── BOAT ──────────────────────────────────────────────
  let boat = {};
  if (waveM !== null) {
    if      (waveM < 0.3 && bf.bf <= 3) boat = { ok:'yes',     icon:'🚢', label:'Ideelt for lille båd',      cls:'rec-good'    };
    else if (waveM < 0.6 && bf.bf <= 4) boat = { ok:'yes',     icon:'🚢', label:'Godt for båd',              cls:'rec-good'    };
    else if (waveM < 1.0 && bf.bf <= 5) boat = { ok:'caution', icon:'⚠️', label:'Lille båd — vær forsigtig', cls:'rec-caution' };
    else if (waveM < 1.5 && bf.bf <= 6) boat = { ok:'no',      icon:'🚫', label:'Ikke anbefalet lille båd',  cls:'rec-bad'     };
    else if (waveM < 2.5)               boat = { ok:'no',      icon:'🚫', label:'Farligt — bliv i land',     cls:'rec-bad'     };
    else                                boat = { ok:'no',      icon:'🚫', label:'Farligt — bliv i land',     cls:'rec-bad'     };
  } else {
    if      (bf.bf <= 2) boat = { ok:'yes',     icon:'🚢', label:'Roligt, ideelt for båd',  cls:'rec-good'    };
    else if (bf.bf <= 4) boat = { ok:'yes',     icon:'🚢', label:'Acceptabelt for båd',     cls:'rec-good'    };
    else if (bf.bf <= 5) boat = { ok:'caution', icon:'⚠️', label:'Båd — vis forsigtighed',  cls:'rec-caution' };
    else                 boat = { ok:'no',      icon:'🚫', label:'For blæsende til båd',    cls:'rec-bad'     };
  }

  // ── SHORE ─────────────────────────────────────────────
  let shore = {};
  if (waveM !== null) {
    if      (waveM < 0.6 && bf.bf <= 4) shore = { ok:'yes',     icon:'🎣', label:'Fremragende kystfiskeri',   cls:'rec-good'    };
    else if (waveM < 1.0 && bf.bf <= 5) shore = { ok:'yes',     icon:'🎣', label:'God fra kyst',             cls:'rec-good'    };
    else if (waveM < 1.5 && bf.bf <= 6) shore = { ok:'yes',     icon:'🎣', label:'Fisk fra kyst i stedet',   cls:'rec-good'    };
    else if (waveM < 2.5)               shore = { ok:'caution', icon:'⚠️', label:'Vær forsigtig ved kysten', cls:'rec-caution' };
    else                                shore = { ok:'no',      icon:'🚫', label:'Undgå eksponerede kyster', cls:'rec-bad'     };
  } else {
    if      (bf.bf <= 4) shore = { ok:'yes',     icon:'🎣', label:'God fra bred',             cls:'rec-good'    };
    else if (bf.bf <= 5) shore = { ok:'yes',     icon:'🎣', label:'God fra bred',             cls:'rec-good'    };
    else                 shore = { ok:'caution', icon:'⚠️', label:'Blæsende — vanskelig kast', cls:'rec-caution' };
  }

  // ── WADERS ────────────────────────────────────────────
  let wader = {};
  const waderWave  = waveM ?? 0;
  const undStrong  = undercurrent === 'strong';
  const undMod     = undercurrent === 'moderate';
  const tidalBad   = tidalCurrent === 'strong';
  const bottomBad  = bottomType === 'mud';
  const bottomSlip = bottomType === 'stone' || bottomType === 'seaweed';

  // Collect all relevant safety notes
  const waderNotes = [];
  if (bottomRisk.level !== 'low')   waderNotes.push(bottomRisk.note);
  if (undStrong)                    waderNotes.push('🚫 Kraftig underdrift — risiko for fald og understrøm');
  else if (undMod)                  waderNotes.push('⚠️ Moderat underdrift — brug vadevandsstav');
  if (tidalBad)                     waderNotes.push('⚠️ Stærk tidevandsstrøm — hold dig i lavt vand');
  if (bottomSlip && waderWave > 0.2) waderNotes.push('⚠️ Glat bund + bølger — forhøjet faldrisiko');
  if (waderWave > 0.3 && waderWave <= 0.5) waderNotes.push('⚠️ Bølger kan forstyrre balance — vad forsigtigt');

  if (bottomBad || undStrong || waderWave > 0.8) {
    wader = {
      ok:'no', icon:'🚫',
      label: bottomBad   ? 'Mudderbund — vad ikke her' :
             undStrong   ? 'Kraftig underdrift — ikke sikkert' :
                           'Bølger for høje til waders',
      cls:'rec-bad', notes:waderNotes, undercurrent, tidalCurrent, bottomType,
    };
  } else if (bottomSlip || undMod || tidalBad || waderWave > 0.4 || bf.bf >= 5) {
    wader = {
      ok:'caution', icon:'⚠️',
      label: bottomSlip && !undMod ? 'Egnet — skridsikre sko + stav' :
             undMod               ? 'Moderat underdrift — brug vadevandsstav' :
             tidalBad             ? 'Stærk strøm — hold dig i lavt vand' :
                                    'Vadefiskeri med forsigtighed',
      cls:'rec-caution', notes:waderNotes, undercurrent, tidalCurrent, bottomType,
    };
  } else {
    wader = {
      ok:'yes', icon:'🦺',
      label: waderWave < 0.2 ? 'Ideelt til vadefiskeri' : 'God til vadefiskeri',
      cls:'rec-good', notes:waderNotes, undercurrent, tidalCurrent, bottomType,
    };
  }

  // Worsen boat if wind worsening
  if (worsening && boat.ok === 'yes')     { boat.ok='caution'; boat.icon='⚠️'; boat.cls='rec-caution'; boat.label += ' ↑'; }
  if (worsening && boat.ok === 'caution') { boat.label += ' ↑'; }

  const safetyLevel = (boat.ok==='no' || wader.ok==='no') ? 'danger'
                    : (boat.ok==='caution' || wader.ok==='caution') ? 'caution' : 'safe';
  return { boat, shore, wader, safetyLevel, undercurrent, tidalCurrent };
}

// ── Tide cycle detection ──────────────────
function getTideCycleAtTime(tides, targetMs) {
  if (!tides || tides.length < 3) return null;
  // Find surrounding tide values
  let prev = null, curr = null, next = null;
  for (let i = 1; i < tides.length - 1; i++) {
    if (tides[i].time <= targetMs && tides[i+1].time > targetMs) {
      prev = tides[i-1]; curr = tides[i]; next = tides[i+1];
      break;
    }
  }
  if (!curr) return null;
  const rising = curr.value > prev?.value;
  // Simple: interpolate between surrounding predictions
  const frac   = (targetMs - curr.time) / (next.time - curr.time);
  const val    = curr.value + frac * (next.value - curr.value);
  return { value: val, rising, label: rising ? '↑ Stigende tidevand' : '↓ Faldende tidevand' };
}

function getTideScore(tideState) {
  if (!tideState) return { score:0, label:null };
  return tideState.rising
    ? { score:12, label:t('tide_rising') }
    : { score:5,  label:t('tide_falling') };
}

// ── Lightning classification ──────────────
function getLightningStatus(strikes) {
  if (!strikes || !strikes.length) return { level:'clear', label:null, closestKm:null };
  // Focus on cloud-to-ground strikes (type 0 or negative amplitude = more dangerous)
  const dangerous = strikes.filter(s => s.type === 0 || s.amp < 0);
  const all       = strikes;
  const closest   = (dangerous.length ? dangerous : all).reduce((a,b)=>a.dist<b.dist?a:b);
  const km        = closest.dist;
  if (km < 10)  return { level:'danger',  label:`⚡ LYN! ${km.toFixed(0)} km — FISK IKKE`, closestKm:km };
  if (km < 25)  return { level:'warning', label:`⚡ Lyn ${km.toFixed(0)} km væk — Overvej at stoppe`, closestKm:km };
  if (km < 50)  return { level:'caution', label:`⚡ Lyn ${km.toFixed(0)} km væk — Hold øje`, closestKm:km };
  return               { level:'clear',   label:null, closestKm:km };
}

// ═══════════════════════════════════════════
//  WEATHER & MARINE FETCHING
// ═══════════════════════════════════════════
async function fetchWeatherForLocation(loc) {
  // wind_speed_unit=ms → values in m/s (standard meteorological unit)
  const url = `${OPEN_METEO}?latitude=${loc.lat}&longitude=${loc.lon}`
    + `&hourly=temperature_2m,precipitation_probability,pressure_msl,wind_speed_10m,`
    + `wind_direction_10m,wind_gusts_10m,cloud_cover`
    + `&wind_speed_unit=ms&timezone=Europe%2FCopenhagen&forecast_days=${FORECAST_DAYS}`;
  const res  = await fetch(url);
  const data = await res.json();
  const h    = data.hourly;
  return h.time.map((t,i) => ({
    time:      new Date(t).getTime(),
    temp:      h.temperature_2m[i],
    precipPct: h.precipitation_probability[i],
    pressure:  h.pressure_msl[i],
    windMs:    h.wind_speed_10m[i],   // m/s
    windDir:   h.wind_direction_10m[i],
    gustMs:    h.wind_gusts_10m[i],   // m/s
    cloud:     h.cloud_cover[i],
  }));
}

async function fetchMarineForLocation(loc) {
  // Only fetch for non-freshwater locations
  if (loc.waterType === 'fresh') return null;
  try {
    const url = `${MARINE_API}?latitude=${loc.lat}&longitude=${loc.lon}`
      + `&hourly=wave_height,wave_direction,wave_period,wind_wave_height,swell_wave_height,sea_surface_temperature`
      + `&forecast_days=${FORECAST_DAYS}`;
    const res  = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const h    = data.hourly;
    if (!h) return null;
    return h.time.map((t,i) => ({
      time:        new Date(t).getTime(),
      waveM:       h.wave_height[i],
      waveDir:     h.wave_direction[i],
      wavePeriod:  h.wave_period[i],
      windWaveM:   h.wind_wave_height[i],
      swellM:      h.swell_wave_height[i],
      seaTempC:    h.sea_surface_temperature?.[i] ?? null,
    }));
  } catch(e) { return null; }
}

async function fetchDMITideStations() {
  if (state.tideStations.length) return state.tideStations;
  try {
    const res  = await fetch(`${DMI_TIDE_STN}?limit=100`);
    const data = await res.json();
    state.tideStations = (data.features || [])
      .filter(f => f.properties?.country === 'DNK')
      .map(f => ({
        id:   f.properties.stationId,
        name: f.properties.name,
        lat:  f.geometry.coordinates[1],
        lon:  f.geometry.coordinates[0],
      }));
    return state.tideStations;
  } catch(e) { return []; }
}

async function fetchDMITidesForLocation(loc) {
  if (loc.waterType === 'fresh') return null;
  try {
    const stations = await fetchDMITideStations();
    if (!stations.length) return null;
    // Find nearest station
    const nearest = stations.reduce((best, s) => {
      const d = haversine(loc.lat, loc.lon, s.lat, s.lon);
      return (!best || d < best.dist) ? { ...s, dist:d } : best;
    }, null);
    if (!nearest || nearest.dist > 120) return null; // >120km away — not relevant

    // Fetch 7-day predictions for this station
    const now  = new Date();
    const end  = new Date(now.getTime() + FORECAST_DAYS * 86400000);
    const url  = `${DMI_TIDES}?stationId=${nearest.id}&limit=1500`
      + `&datetime=${now.toISOString()}/${end.toISOString()}`;
    const res  = await fetch(url);
    const data = await res.json();

    const predictions = (data.features || [])
      .map(f => ({
        time:  new Date(f.properties.predictionTime).getTime(),
        value: f.properties.value,
      }))
      .sort((a,b) => a.time - b.time);

    return { stationName: nearest.name, distKm: Math.round(nearest.dist), predictions };
  } catch(e) { return null; }
}

async function fetchLightningForLocation(loc) {
  try {
    const pad  = 0.8; // ~80km bounding box
    const bbox = `${loc.lon-pad},${loc.lat-pad},${loc.lon+pad},${loc.lat+pad}`;
    const now  = new Date();
    const ago  = new Date(now.getTime() - 45 * 60000); // last 45 minutes
    const url  = `${DMI_LIGHTNING}?limit=200&bbox=${bbox}`
      + `&datetime=${ago.toISOString()}/${now.toISOString()}`;
    const res  = await fetch(url);
    const data = await res.json();
    const strikes = (data.features || []).map(f => ({
      dist: haversine(loc.lat, loc.lon, f.geometry.coordinates[1], f.geometry.coordinates[0]),
      type: f.properties.type,
      amp:  f.properties.amp,
      time: f.properties.observed,
    }));
    return strikes.sort((a,b) => a.dist - b.dist);
  } catch(e) { return []; }
}

// Fetch forecast for a single location, with retry
async function fetchForecastForLocation(loc, retries = 2) {
  state.fetchStatus[loc.id] = 'loading';
  render();
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) await new Promise(r => setTimeout(r, 1000 * attempt)); // backoff
      const [hourly, marine, tides] = await Promise.all([
        fetchWeatherForLocation(loc),
        fetchMarineForLocation(loc),
        fetchDMITidesForLocation(loc),
      ]);
      state.forecasts[loc.id]   = { fetched: Date.now(), hourly, marine, tides };
      state.fetchStatus[loc.id] = 'ok';
      render();
      return true;
    } catch(e) {
      if (attempt === retries) {
        console.error('Forecast failed after retries:', loc.name, e);
        state.fetchStatus[loc.id] = 'error';
        render();
      }
    }
  }
  return false;
}

async function fetchAllForecasts() {
  state.fetchingForecast = true;
  state.fetchStatus = {};
  render();

  // Batch fetches — 3 locations at a time to avoid rate-limiting
  const BATCH = 3;
  const locs  = state.locations;
  for (let i = 0; i < locs.length; i += BATCH) {
    const batch = locs.slice(i, i + BATCH);
    await Promise.all(batch.map(loc => fetchForecastForLocation(loc)));
    if (i + BATCH < locs.length) {
      await new Promise(r => setTimeout(r, 400)); // small gap between batches
    }
  }

  // Lightning check after all weather data loaded
  await updateLightningAll();

  state.fetchingForecast = false;
  render();
}

async function updateLightningAll() {
  await Promise.all(state.locations.map(async loc => {
    const strikes = await fetchLightningForLocation(loc);
    state.lightning[loc.id] = { strikes, status: getLightningStatus(strikes), lastCheck: Date.now() };
  }));
}

// ═══════════════════════════════════════════
//  SCORING ENGINE
// ═══════════════════════════════════════════
function findHourIndex(hourly, targetMs) {
  if (!hourly) return -1;
  let best = -1, bestDiff = Infinity;
  for (let i = 0; i < hourly.length; i++) {
    const diff = Math.abs(hourly[i].time - targetMs);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  }
  return bestDiff < 3600000 ? best : -1;
}

function findMarineIndex(marine, targetMs) {
  return findHourIndex(marine, targetMs);
}

// ── Lure colour suggestion ────────────────────────────────────────────────────
// Returns { colors:[{hex,name,reason}], tackleTips:[string] }
// based on median weather conditions for the window + selected target species.
const LURE_COLORS = {
  silver:      { hex:'#C0C0C0', nameKey:'lure_silver',      reasonKey:'lure_reason_silver' },
  pearl:       { hex:'#F0EEE0', nameKey:'lure_pearl',       reasonKey:'lure_reason_pearl' },
  gold:        { hex:'#FFD700', nameKey:'lure_gold',        reasonKey:'lure_reason_gold' },
  chartreuse:  { hex:'#7FFF00', nameKey:'lure_chartreuse',  reasonKey:'lure_reason_chartreuse' },
  orange:      { hex:'#FF6A00', nameKey:'lure_orange',      reasonKey:'lure_reason_orange' },
  red:         { hex:'#E8001E', nameKey:'lure_red',         reasonKey:'lure_reason_red' },
  firetiger:   { hex:'#FF4500', nameKey:'lure_firetiger',   reasonKey:'lure_reason_firetiger' },
  uvwhite:     { hex:'#F8F0FF', nameKey:'lure_uvwhite',     reasonKey:'lure_reason_uvwhite' },
  green:       { hex:'#3CB371', nameKey:'lure_green',       reasonKey:'lure_reason_green' },
  black:       { hex:'#1A1A1A', nameKey:'lure_black',       reasonKey:'lure_reason_black' },
  pink:        { hex:'#FF69B4', nameKey:'lure_pink',        reasonKey:'lure_reason_pink' },
};
// Resolve translated name+reason for a LURE_COLORS entry
function lureEntry(c) { return { hex:c.hex, name:t(c.nameKey), reason:t(c.reasonKey) }; }

function suggestLure(cond, targetSpecies) {
  // cond = { cloud, waveM, windMs, precipPct, isDawn, isDusk }
  const { cloud=50, waveM=0, windMs=3, precipPct=10, isDawn=false, isDusk=false } = cond || {};

  const colors = [];
  const tips   = [];

  const isCalm   = windMs < 3 && waveM < 0.2;
  const isMurky  = waveM > 0.6 || windMs > 7;
  const isLowLight = isDawn || isDusk || cloud > 80;
  const isClear  = cloud < 30 && !isMurky;
  const isOvercast = cloud > 65;

  if (isMurky) {
    colors.push(lureEntry(LURE_COLORS.firetiger), lureEntry(LURE_COLORS.orange), lureEntry(LURE_COLORS.red));
    tips.push(t('lure_tip_murky'));
  } else if (isLowLight) {
    colors.push(lureEntry(LURE_COLORS.uvwhite), lureEntry(LURE_COLORS.chartreuse), lureEntry(LURE_COLORS.orange));
    tips.push(t('lure_tip_lowlight'));
  } else if (isClear && isCalm) {
    colors.push(lureEntry(LURE_COLORS.silver), lureEntry(LURE_COLORS.pearl), lureEntry(LURE_COLORS.pink));
    tips.push(t('lure_tip_clear'));
  } else if (isOvercast) {
    colors.push(lureEntry(LURE_COLORS.chartreuse), lureEntry(LURE_COLORS.gold), lureEntry(LURE_COLORS.orange));
    tips.push(t('lure_tip_overcast'));
  } else {
    // Partly cloudy default
    colors.push(lureEntry(LURE_COLORS.gold), lureEntry(LURE_COLORS.silver), lureEntry(LURE_COLORS.chartreuse));
  }

  // Species-specific tackle tips (translated)
  for (const id of (targetSpecies || [])) {
    const tipKey = 'tip_' + id;
    if (STRINGS.da[tipKey]) tips.push(t(tipKey));
  }

  return { colors: colors.slice(0, 3), tips };
}

function scoreWindow(w) {
  const loc = w.location;
  const fc  = state.forecasts[loc.id];
  if (!fc) return { score:20, noData:true, tags:[{label:t('data_missing'),cls:'tag-gray'}], bestHourStr:null, rec:null };

  const { hourly, marine, tides } = fc;
  const date          = w.date;
  const lat           = loc.lat, lon = loc.lon;
  const bottomType    = loc.bottomType || 'mixed';
  const fishingMethod = w.availMethod   || 'shore'; // from the time window, not location

  const fromH = parseInt(w.from);
  const toH   = parseInt(w.to);
  // Guard: invalid or overnight (from >= to) — skip scoring
  if (isNaN(fromH) || isNaN(toH) || fromH >= toH) return { score:0, noData:false, fromH, toH, tags:[{label:t('invalid_window'),cls:'tag-gray'}], bestHourStr:null, rec:null, lure:null };
  const hours = [];

  for (let h = fromH; h <= Math.min(toH, fromH+12); h++) {
    const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), h));
    const idx    = findHourIndex(hourly, target.getTime());
    if (idx >= 0) hours.push({ idx, hour:h, target });
  }
  if (!hours.length) return { score:50, noData:false, fromH, toH, tags:[{label:t('data_missing'),cls:'tag-gray'}], bestHourStr:null, rec:null };

  const sunTimes      = Solunar.getSunTimes(date, lat, lon);
  const solunarPeriods = Solunar.getSolunarPeriods(date, lat, lon);
  const moonPhaseVal   = Solunar.getMoonPhase(date);
  const moonPhaseInfo  = Solunar.moonPhaseLabel(moonPhaseVal);
  const moonBonus      = moonPhaseInfo.score;

  let hourScores     = [];
  let hourBreakdowns = [];   // per-hour score breakdown for the best hour
  let allTags        = new Map();
  let recSamples     = [];

  for (const { idx, target } of hours) {
    let s  = 20;
    const hd = hourly[idx];
    if (!hd) continue;

    // Breakdown tracking for this hour
    const bd = [{ icon:'⚙️', factor:t('score_modal_base'), contribution:20, label:t('score_modal_base') }];
    const addBd = (icon, factor, contribution, label, hint='') => {
      if (contribution !== 0) bd.push({ icon, factor, contribution, label, hint });
    };

    // 1. Pressure trend
    const pt = getPressureTrend(hourly, idx);
    s += pt.score;
    addBd('🌡️','Lufttryk', pt.score, pt.label, pt.fishLabel || 'Lufttryk trend påvirker fiskenes aktivitetsniveau');
    if (pt.fishLabel) allTags.set('pressure', {
      label: pt.dir==='rising'?'↑ '+pt.label:pt.label, cls:pt.cls,
      hint: pt.fishLabel + (pt.score>0?' (+'+pt.score+')':' ('+pt.score+')')
    });

    // 2. Solunar
    const sol = Solunar.solunarScore(target, solunarPeriods);
    s += sol.score;
    addBd('🌙','Solunar', sol.score, sol.label||'Ingen aktiv solunar periode', 'Månens position bestemmer fiskenes aktivitetscyklus');
    if (sol.label) allTags.set('solunar', {
      label: sol.label, cls:'tag-blue',
      hint: `Solunar ${sol.period==='major'?'major':'minor'} periode (+${sol.score} point) — fiskene er markant mere aktive`
    });

    // 3. Time of day
    const tod = Solunar.timeOfDayScore(target, sunTimes);
    s += tod.score;
    addBd('🌅','Tidspunkt', tod.score, tod.label||'Ingen særlig dag-aktivitet', 'Tidspunkt relativt til solopgang/solnedgang');
    if (tod.label && (tod.score >= 10 || tod.score < 0))
      allTags.set('timeofday', {
        label: tod.label, cls: tod.score>=10?'tag-gold':'tag-gray',
        hint: tod.label + (tod.score>0?' (+'+tod.score+' point)':' ('+tod.score+' point)')
      });

    // 4. Cloud cover
    let cloudScore = 0;
    if (hd.cloud > 65)  { cloudScore = 8;  }
    s += cloudScore;
    addBd('☁️','Skydække', cloudScore, `${hd.cloud}% skydække`, 'Overskyet (>65%) giver +8 — fisk jager friere i diffust lys');
    if (cloudScore > 0) allTags.set('cloud', { label:'☁ Overskyet', cls:'tag-blue', hint:`${hd.cloud}% skydække — fisk jager mere aktivt (+${cloudScore} point)` });

    // 5. Wind speed
    let windScore = 0;
    if (hd.windMs < 3)        windScore = 7;
    else if (hd.windMs > 8)   windScore = -18;
    else if (hd.windMs > 5.5) windScore = -8;
    s += windScore;
    addBd('💨','Vind', windScore, `${hd.windMs?.toFixed(1)} m/s ${windDirLabel(hd.windDir)}`, 'Svag vind er ideelt; stærk vind gør fiskeri vanskeligt');
    if (windScore > 0)  allTags.set('wind', { label:'💨 Svag vind',   cls:'tag-green', hint:`Svag vind ${hd.windMs?.toFixed(1)} m/s — ideelle forhold (+${windScore} point)` });
    if (windScore < -10) allTags.set('wind', { label:'💨 Stærk vind', cls:'tag-red',   hint:`Stærk vind ${hd.windMs?.toFixed(1)} m/s — vanskelige forhold (${windScore} point)` });

    // 6. Precipitation
    let precipScore = 0;
    if (hd.precipPct > 70)      precipScore = -12;
    else if (hd.precipPct > 40) precipScore = 4;
    s += precipScore;
    addBd('🌧','Nedbør', precipScore, `${hd.precipPct}% nedbørschance`, '>70% = tordenvejrsrisiko, straffer hårdt');
    if (hd.precipPct > 70) allTags.set('precip', { label:'🌧 Risiko for tordenvejr', cls:'tag-red', hint:`${hd.precipPct}% nedbørschance — tordenvejrsrisiko, kulfiberstænger tiltrækker lyn! (${precipScore} point)` });

    // 7. Wind trend
    const wt = getWindTrend(hourly, idx);
    s += wt.score;
    addBd('📈','Vindtrend', wt.score, wt.label, wt.score<0?'Stigende vind forværrer betingelserne gradvist':'Aftagende vind forbedrer betingelserne');
    if (Math.abs(wt.delta) > 1.0) allTags.set('windtrend', {
      label: wt.label, cls: wt.cls,
      hint: `Vind ${wt.dir==='rising'?'stiger':'aftager'} ${Math.abs(wt.delta).toFixed(1)} m/s over 3 timer — betingelserne ${wt.dir==='rising'?'forværres':'forbedres'} (${wt.score>0?'+':''}${wt.score} point)`
    });

    // 8. Wind direction bonus
    const wdBonus = windDirFishBonus(hd.windDir);
    s += wdBonus;
    addBd('🧭','Vindretning', wdBonus, `${windDirLabel(hd.windDir)}-vind`, 'V/VNV = bedst; NØ/Ø = ugunstig (gammel fiskeviden)');
    if (wdBonus < 0) allTags.set('winddir', { label:`${windDirLabel(hd.windDir)}-vind (ugunstig)`, cls:'tag-orange', hint:`${windDirLabel(hd.windDir)}-vind anses traditionelt for ugunstig for fiskeri (${wdBonus} point)` });

    // 9. Wave height (saltwater)
    if (marine) {
      const mi = findMarineIndex(marine, target.getTime());
      if (mi >= 0) {
        const md = marine[mi];
        let waveScore = 0;
        let waveLabel = `🌊 ${md.waveM.toFixed(2)}m bølger`;
        if      (md.waveM >= 1.5) { waveScore = -20; waveLabel = `🌊 Farlig sø ${md.waveM.toFixed(1)}m`; allTags.set('wave', { label:waveLabel, cls:'tag-red',   hint:`${md.waveM.toFixed(2)}m bølger — farlige forhold, frarådes kraftigt (${waveScore} point)` }); }
        else if (md.waveM >= 1.0) { waveScore = -12; waveLabel = `🌊 Høj sø ${md.waveM.toFixed(1)}m`;   allTags.set('wave', { label:waveLabel, cls:'tag-red',   hint:`${md.waveM.toFixed(2)}m bølger — vanskelige betingelser (${waveScore} point)` }); }
        else if (md.waveM >= 0.6) { waveScore = -6;  waveLabel = `🌊 ${md.waveM.toFixed(1)}m`;           allTags.set('wave', { label:waveLabel, cls:'tag-gold',  hint:`${md.waveM.toFixed(2)}m bølger — let forsigtighed anbefales ved vadefiskeri (${waveScore} point)` }); }
        else if (md.waveM < 0.3)  { waveScore = 5;   waveLabel = `🌊 Blik ${md.waveM.toFixed(1)}m`;     allTags.set('wave', { label:waveLabel, cls:'tag-green', hint:`${md.waveM.toFixed(2)}m bølger — næsten blikstille, ideelt for alle metoder (+${waveScore} point)` }); }
        s += waveScore;
        addBd('🌊','Bølgehøjde', waveScore, waveLabel, `${md.waveM.toFixed(2)}m bølgehøjde`);
        recSamples.push({ waveM: md.waveM, waveP: md.wavePeriod, windMs: hd.windMs, windTrend: wt.dir, cloud: hd.cloud, precipPct: hd.precipPct, hour: target.getUTCHours() });

        // 9b. Fishing method adjustments
        let methodScore = 0;
        if (fishingMethod === 'boat') {
          if (md.waveM > 1.5) methodScore = -15;
          else if (md.waveM > 0.8) methodScore = -8;
        } else if (fishingMethod === 'waders') {
          if (md.waveM > 0.6) methodScore = -12;
          else if (md.waveM > 0.4) methodScore = -6;
          if (md.waveM < 0.2) methodScore += 5;
        }
        if (methodScore !== 0) { s += methodScore; addBd('🎣','Fiskemetode', methodScore, `${methodLabel(fishingMethod)} ved ${md.waveM.toFixed(2)}m`, 'Ekstra vægtning for valgt fiskemetode'); }
      }
    } else {
      recSamples.push({ waveM: null, waveP: null, windMs: hd.windMs, windTrend: wt.dir, cloud: hd.cloud, precipPct: hd.precipPct, hour: target.getUTCHours() });
    }

    // 10. Tides (saltwater)
    if (tides) {
      const tc = getTideCycleAtTime(tides.predictions, target.getTime());
      const ts = getTideScore(tc);
      s += ts.score;
      addBd('🌊','Tidevand', ts.score, tc ? (tc.rising?'↑ Stigende':'↓ Faldende')+` (${tc.value?.toFixed(2)}m)` : 'Ingen tidevand', 'Stigende tidevand aktiverer kystfisk markant');
      if (ts.label) allTags.set('tide', {
        label: ts.label, cls:'tag-blue',
        hint: `${tc?.rising?'Stigende':'Faldende'} tidevand ved ${tc?.value?.toFixed(2)}m — ${tc?.rising?'aktiverer kystfisk':'moderat aktivitet'} (+${ts.score} point)`
      });
    }

    // 11. Moon phase bonus
    const moonScore = Math.round(moonBonus * 0.3);
    s += moonScore;
    addBd('🌕','Månefase', moonScore, moonPhaseInfo.label, 'Ny- og fuldmåne giver ekstra aktivitet');

    // 12. Lightning risk
    if (hd.precipPct > 65) { s -= 20; addBd('⚡','Lynskred', -20, 'Tordenvejrsrisiko', 'Høj nedbørschance = mulig tordenvejr, ekstra straf'); }

    // 13. Species-specific bonuses
    if (state.targetSpecies.length) {
      let speciesBonus = 0;
      for (const spId of state.targetSpecies) {
        const pref = SPECIES_PREFS[spId];
        if (!pref) continue;
        const b = pref.bonuses;
        // Pressure
        if (b.pressureRising && pt.dir === 'rising')         speciesBonus += b.pressureRising;
        if (b.pressureStable && pt.dir === 'stable')         speciesBonus += b.pressureStable;
        if (b.pressureHigh   && (hourly[idx]?.pressure||0) > 1015) speciesBonus += b.pressureHigh;
        // Solunar
        if (b.solunarMajor && sol.period === 'major')        speciesBonus += b.solunarMajor;
        // Time of day
        if (b.dawn  && tod.label?.includes('Daggry'))        speciesBonus += b.dawn;
        if (b.dusk  && tod.label?.includes('Skumring'))      speciesBonus += b.dusk;
        if (b.night && tod.score === 5)                      speciesBonus += b.night;
        // Wind / calm
        if (b.calm  && hd.windMs < 3)                        speciesBonus += b.calm;
        // Tide
        if (b.tide  && tides) {
          const tc = getTideCycleAtTime(tides.predictions, target.getTime());
          if (tc?.rising) speciesBonus += b.tide;
        }
        // Wave preferences
        if (marine) {
          const mi = findMarineIndex(marine, target.getTime());
          if (mi >= 0) {
            const wm = marine[mi].waveM;
            if (b.waveLight && wm >= 0.1 && wm <= 0.6) speciesBonus += b.waveLight;
            if (b.deep      && marine[mi].waveM > 0)   speciesBonus += b.deep * 0.5; // proxy
          }
        }
        // Overcast
        if (b.cloud && hd.cloud > 60)                        speciesBonus += b.cloud;
      }
      // Average across selected species, cap contribution
      const spScore = clamp(Math.round(speciesBonus / state.targetSpecies.length), 0, 25);
      s += spScore;
      addBd('🎯','Artspræferencer', spScore,
        state.targetSpecies.map(id=>SPECIES_PREFS[id]?.name).join(', '),
        'Betingelserne matcher dine valgte målartes præferencer');
    }

    hourScores.push(clamp(Math.round(s), 0, 100));
    hourBreakdowns.push(bd);
  }

  const finalScore = clamp(Math.round(avg(hourScores)), 0, 100);
  const bestIdx    = hourScores.indexOf(Math.max(...hourScores));
  const bestHour   = hours[bestIdx];

  // Build shore/boat rec from median sample
  let rec = null;
  let lure = null;
  if (recSamples.length) {
    const mid = recSamples[Math.floor(recSamples.length/2)];
    rec = getShoreBoatRec(mid.waveM, mid.windMs, mid.windTrend, bottomType, mid.waveP, tides?.predictions, mid.targetMs);
    rec.primaryMethod = fishingMethod; // carry through for display emphasis
    // Build lure suggestion from median window conditions
    const sunT = Solunar.getSunTimes(date, lat, lon);
    const fromHr = parseInt(w.from), toHr = parseInt(w.to);
    const midHr  = Math.round((fromHr + Math.min(toHr, fromHr + 12)) / 2);
    const isDawn = sunT.sunriseH !== undefined && Math.abs(midHr - sunT.sunriseH) <= 1;
    const isDusk = sunT.sunsetH  !== undefined && Math.abs(midHr - sunT.sunsetH)  <= 1;
    lure = suggestLure({ cloud: mid.cloud||50, waveM: mid.waveM||0, windMs: mid.windMs||2, precipPct: mid.precipPct||0, isDawn, isDusk }, state.targetSpecies);
  }

  // Spot relevance: bonus if spot has target species active this month
  let relevanceBonus = 0;
  if (state.targetSpecies.length && loc.species?.length) {
    const month = date.getMonth() + 1;
    const matchCount = state.targetSpecies.filter(spId =>
      loc.species.some(s => {
        const spName = SPECIES_PREFS[spId]?.nameEn?.toLowerCase() || '';
        return s.nameEn?.toLowerCase() === spName && s.months.includes(month);
      })
    ).length;
    if (matchCount > 0) {
      relevanceBonus = Math.round((matchCount / state.targetSpecies.length) * 12);
      allTags.set('species', { label: `🎯 ${matchCount}/${state.targetSpecies.length} målart${matchCount>1?'er':''} aktive her`, cls:'tag-green' });
    } else if (state.targetSpecies.length > 0) {
      allTags.set('species', { label:'⚠️ Målarter ikke registreret her', cls:'tag-gray' });
    }
  }

  const finalScoreWithBonus = clamp(finalScore + relevanceBonus, 0, 100);

  // Build best-hour breakdown with actual total
  const bestBreakdown = hourBreakdowns[bestIdx] || [];
  if (relevanceBonus > 0) bestBreakdown.push({ icon:'📍', factor:'Spotrelevans', contribution:relevanceBonus, label:'Målart aktiv på dette sted denne måned' });
  bestBreakdown.push({ icon:'🏁', factor:'TOTAL', contribution:finalScoreWithBonus, label:'', isTotal:true });

  // Tide direction + wind dir at best hour for window card display
  let tideRising   = null;
  let bestWindDir  = null;
  let bestWindMs   = null;
  if (bestHour) {
    const bestHd = hourly[hours[bestIdx].idx];
    bestWindDir = bestHd?.windDir ?? null;
    bestWindMs  = bestHd?.windMs  ?? null;
    if (tides) {
      const tc = getTideCycleAtTime(tides.predictions, bestHour.target.getTime());
      if (tc != null) tideRising = tc.rising;
    }
  }

  return {
    score:       finalScoreWithBonus,
    tags:        [...allTags.values()].slice(0,6),
    bestHourStr: bestHour ? `${String(bestHour.hour).padStart(2,'0')}:00` : null,
    rec,
    lure,
    breakdown:   bestBreakdown,
    solunar:     solunarPeriods,
    tideRising,
    bestWindDir,
    bestWindMs,
    noData:      false,
    fromH,
    toH,
  };
}

function getScoredWindows() {
  const windows = [];
  const now     = new Date();
  for (let day = 0; day < FORECAST_DAYS; day++) {
    const date = new Date(now);
    date.setUTCDate(date.getUTCDate() + day);
    date.setUTCHours(0,0,0,0);
    const dow = date.getDay();
    for (const avail of state.availability.recurring) {
      if (!avail.days.includes(dow)) continue;
      for (const loc of state.locations) {
        const methods = avail.methods || [avail.method || 'shore']; // support both old & new
        const sc = scoreWindow({ date, from:avail.from, to:avail.to, location:loc, availMethod:methods[0]||'shore' });

        // Lightning override
        const lgt = state.lightning[loc.id]?.status;
        const lightningHit = lgt && lgt.level !== 'clear';

        windows.push({
          date, from:avail.from, to:avail.to,
          fromStr:avail.from, toStr:avail.to,
          location:loc,
          availMethods: methods,
          availMethod:  methods[0] || 'shore', // primary for scoring
          score: lightningHit && lgt.level==='danger' ? Math.min(sc.score,15) : sc.score,
          tags: lightningHit
            ? [{ label:lgt.label, cls:'tag-red' }, ...sc.tags]
            : sc.tags,
          bestHourStr: sc.bestHourStr,
          rec:         sc.rec,
          lure:        sc.lure,
          breakdown:   sc.breakdown,
          solunar:     sc.solunar,
          tideRising:  sc.tideRising,
          bestWindDir: sc.bestWindDir,
          bestWindMs:  sc.bestWindMs,
          noData:      sc.noData,
          fromH:       sc.fromH,
          toH:         sc.toH,
          lightningStatus: lgt,
        });
      }
    }
  }
  // Deduplicate: same location + date + time window (can happen if availability has duplicate entries)
  const seen = new Set();
  const deduped = windows.filter(w => {
    const key = `${w.location.id}|${w.date.toISOString().slice(0,10)}|${w.from}-${w.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped.sort((a,b) => b.score - a.score);
}

function getCurrentConditions(fc) {
  if (!fc?.hourly?.length) return null;
  const now  = Date.now();
  const idx  = fc.hourly.reduce((bi,h,i) => Math.abs(h.time-now)<Math.abs(fc.hourly[bi].time-now)?i:bi, 0);
  const h    = fc.hourly[idx];
  // 24h-ago reading for delta display
  const idx24 = Math.max(0, idx - 24);
  const h24   = fc.hourly[idx24];
  const delta = (now - fc.hourly[idx24].time) > 20*3600*1000 ? {   // only show if ≥20h ago
    tempC:    h.temp    != null && h24.temp    != null ? (h.temp    - h24.temp).toFixed(1)    : null,
    windMs:   h.windMs  != null && h24.windMs  != null ? (h.windMs  - h24.windMs).toFixed(1)  : null,
    pressure: h.pressure!= null && h24.pressure!= null ? (h.pressure- h24.pressure).toFixed(0): null,
  } : null;
  return {
    tempC:       h.temp?.toFixed(1)     || '–',
    pressureHpa: h.pressure?.toFixed(0) || '–',
    windMs:      h.windMs?.toFixed(1)   || '–',
    windDir:     h.windDir,
    gustMs:      h.gustMs?.toFixed(1)   || '–',
    cloud:       h.cloud?.toFixed(0)    || '–',
    precipPct:   h.precipPct?.toFixed(0)|| '–',
    rawHourly:   h,
    idx,
    delta,
  };
}

/** Format a numeric delta as e.g. "+1.2" or "−0.8" with colour */
function fmtDelta(val, unit='', invertColour=false) {
  if (val == null) return '';
  const n = parseFloat(val);
  if (Math.abs(n) < 0.05) return '';
  const sign  = n > 0 ? '+' : '−';
  const abs   = Math.abs(n).toFixed(unit===''?0:1);
  const good  = invertColour ? n < 0 : n > 0;
  const color = good ? 'var(--green)' : 'var(--red)';
  return `<span style="font-size:.65rem;color:${color};margin-left:3px">${sign}${abs}${unit}</span>`;
}

// ═══════════════════════════════════════════
//  RENDER ENGINE
// ═══════════════════════════════════════════
const app = document.getElementById('app');
function render() {
  // ── Preserve focused input state across re-render ──────────
  const activeEl  = document.activeElement;
  const focusId   = activeEl?.id;
  const focusStart = activeEl?.selectionStart;
  const focusEnd   = activeEl?.selectionEnd;

  if      (state.step==='welcome')      app.innerHTML = renderWelcome();
  else if (state.step==='watertype')    app.innerHTML = renderWaterType();
  else if (state.step==='locations')    app.innerHTML = renderLocations();
  else if (state.step==='species')      app.innerHTML = renderSpeciesTarget();
  else if (state.step==='availability') app.innerHTML = renderAvailability();
  else if (state.step==='spotfinder')   app.innerHTML = renderSpotFinderWizard();
  else if (state.step==='dashboard')    app.innerHTML = renderDashboard();

  // ── Restore focus after DOM rebuild ───────────────────────
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus();
      if (el.setSelectionRange && focusStart != null) {
        try { el.setSelectionRange(focusStart, focusEnd); } catch(e) {}
      }
    }
  }

  // ── Init map if locations map view is active ───────────────
  if (state.step === 'locations' && state.locationView === 'map') {
    requestAnimationFrame(() => initMap());
  }
}

function shell(content) {
  const isEn = state.lang === 'en';
  return `<div class="shell">
    <div class="topbar">
      <div class="topbar-logo" onclick="navigate('welcome')" title="${isEn?'Back to start':'Tilbage til start'}" style="cursor:pointer">
        <span class="emoji">🎣</span> <span>FishCast</span>
      </div>
      <div class="topbar-actions">
        ${state.step==='dashboard'?`
          <button class="btn btn-ghost btn-sm" onclick="navigate('species')">${t('topbar_species')}${state.targetSpecies.length?' ('+state.targetSpecies.length+')':''}</button>
          <button class="btn btn-ghost btn-sm" onclick="navigate('locations')">${t('topbar_locations')}</button>
          <button class="btn btn-ghost btn-sm" onclick="state.fromDash=true;navigate('availability')">${t('topbar_times')}${state.availability.recurring.length?' ('+state.availability.recurring.length+')':''}</button>
        `:''}
        <button class="btn btn-ghost btn-sm lang-btn ${!isEn?'lang-active':''}" onclick="setLang('da')" title="Dansk">🇩🇰</button>
        <button class="btn btn-ghost btn-sm lang-btn ${isEn?'lang-active':''}"  onclick="setLang('en')" title="English">🇬🇧</button>
      </div>
    </div>
    <div class="main">${content}</div>
    ${state.scoreInfoOpen     ? renderScoreInfoModal()   : ''}
    ${state.speciesInfoPopup  ? renderSpeciesInfoPopup() : ''}
  </div>`;
}

// ── Wizard dots ───────────────────────────
// Unified wizard order: availability first, then watertype → locations → species
function stepDots(cur) {
  const steps = ['availability','watertype','locations','species'];
  return `<div class="step-indicator">${steps.map((s,i)=>{
    const idx=steps.indexOf(cur);
    return `<div class="step-dot ${i<idx?'done':i===idx?'active':''}"></div>`;
  }).join('')}</div>`;
}

// ═══════════════════════════════════════════
//  MAP ENGINE (Leaflet)
// ═══════════════════════════════════════════
let fishMap           = null;  // Leaflet map instance
let mapMarkers        = [];    // all markers currently on map
let locationMarkerMap = {};    // {locId: leafletMarker} — for fly-to
let pendingPin        = null;  // red "placing" marker

// Custom marker icons using DivIcons (no image dependency)
function makeMarkerIcon(color, size=14) {
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;background:${color};border-radius:50%;border:2px solid rgba(255,255,255,.9);box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>`,
    iconSize: [size, size], iconAnchor: [size/2, size/2], popupAnchor: [0, -(size/2+4)], className:'',
  });
}

const ICON_SAVED   = () => makeMarkerIcon('#38bdf8', 16); // blue  — saved location
const ICON_SPOT    = () => makeMarkerIcon('#22c55e', 10); // green — DK_SPOTS database
const ICON_PENDING = () => makeMarkerIcon('#ef4444', 18); // red   — pending new pin

function initMap() {
  const container = document.getElementById('fishing-map');
  if (!container) return;

  // If the old Leaflet instance is detached from the current DOM, destroy it first
  if (fishMap && !document.body.contains(fishMap.getContainer())) {
    fishMap.remove();
    fishMap = null;
  }

  if (!fishMap) {
    fishMap = L.map('fishing-map', { zoomControl: true }).setView([56.0, 10.5], 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 18,
    }).addTo(fishMap);
    fishMap.on('click', onMapClick);
  } else {
    fishMap.invalidateSize();
  }

  // Remove old markers
  mapMarkers.forEach(m => m.remove());
  mapMarkers        = [];
  locationMarkerMap = {};

  // Official DK_SPOTS layer (green circles)
  if (state.showSpotLayer) {
    DK_SPOTS.filter(s => typeof s === 'object' && s.lat).forEach(spot => {
      const month = new Date().getMonth() + 1;
      const active = (spot.species || []).filter(sp => sp.months.includes(month));
      const popup  = `<div style="min-width:180px;font-size:13px">
        <strong>${spot.name}</strong><br>
        <span style="color:#888">${spot.region} · ${spot.spotType}</span>
        ${active.length ? `<div style="margin:5px 0;display:flex;gap:4px;flex-wrap:wrap">
          ${active.slice(0,5).map(sp=>`<span style="background:#166534;color:#bbf7d0;padding:1px 6px;border-radius:10px;font-size:11px">${sp.name}</span>`).join('')}
        </div>` : ''}
        ${spot.facilities?.parking ? '🅿️ ' : ''}${spot.facilities?.boatRamp ? '⛵ ' : ''}${spot.facilities?.wheelchair ? '♿ ' : ''}
        <br><button onclick="addSpotFromMap(${escJson(spot)})"
          style="margin-top:6px;background:#38bdf8;color:#000;border:none;padding:5px 10px;border-radius:6px;cursor:pointer;width:100%">
          ${t('sf_add_to_locs')}</button>
      </div>`;
      const m = L.circleMarker([spot.lat, spot.lon], {
        radius:6, color:'#16a34a', fillColor:'#22c55e', fillOpacity:.8, weight:1.5
      }).addTo(fishMap).bindPopup(popup);
      mapMarkers.push(m);
    });
  }

  // Saved locations (blue markers)
  state.locations.forEach(loc => {
    const popup = `<div style="font-size:13px;min-width:160px">
      <strong>${loc.name}</strong><br>
      <span style="color:#888">${waterTypeLabel(loc.waterType)}</span>
      ${loc.isCustom ? '<br><span style="color:#f59e0b;font-size:11px">📌 Brugerdefineret spot</span>' : ''}
      ${loc.notes ? `<br><span style="color:#888;font-size:11px">${loc.notes}</span>` : ''}
      <br><button onclick="startRename('${loc.id}')"
        style="margin-top:6px;background:transparent;border:1px solid #444;color:#94a3b8;padding:3px 8px;border-radius:5px;cursor:pointer;font-size:11px">
        ✏️ Omdøb
      </button>
    </div>`;
    const m = L.marker([loc.lat, loc.lon], { icon: ICON_SAVED() })
      .addTo(fishMap)
      .bindPopup(popup);
    mapMarkers.push(m);
    locationMarkerMap[loc.id] = m;
  });

  // ── Fly to focused location ───────────────────────────────
  if (state.focusLocationId) {
    const loc = state.locations.find(l => l.id === state.focusLocationId);
    const m   = locationMarkerMap[state.focusLocationId];
    if (loc && m) {
      fishMap.flyTo([loc.lat, loc.lon], 14, { duration: 1.2 });
      setTimeout(() => m.openPopup(), 1300); // open popup after fly animation
    }
    state.focusLocationId = null;
  }
}

async function onMapClick(e) {
  const { lat, lng } = e.latlng;

  // Remove previous pending pin
  if (pendingPin) { pendingPin.remove(); pendingPin = null; }

  // Place loading marker
  pendingPin = L.marker([lat, lng], { icon: ICON_PENDING() })
    .addTo(fishMap)
    .bindPopup(`<div style="font-size:13px;padding:4px">⏳ Henter stedsdata…</div>`)
    .openPopup();

  // Parallel: reverse geocode + find nearby spots
  const [name, nearbySpots] = await Promise.all([
    reverseGeocode(lat, lng),
    Promise.resolve(DK_SPOTS.findNearby(lat, lng, 40).slice(0, 5)),
  ]);

  const species   = inferSpecies(lat, lng, nearbySpots);
  const waterType = smartDetectWaterType(lat, lng, name, nearbySpots);
  const bottom    = inferBottomType(nearbySpots);

  pendingPin.setPopupContent(buildPinPopup(lat, lng, name, species, nearbySpots, waterType));
  pendingPin.openPopup();
}

function buildPinPopup(lat, lng, name, species, nearbySpots, waterType) {
  const month  = new Date().getMonth() + 1;
  const active = species.filter(s => (s.months||[]).includes(month));
  const latS   = lat.toFixed(5), lngS = lng.toFixed(5);

  return `<div style="min-width:220px;font-size:13px;font-family:system-ui,sans-serif">
    <div style="font-weight:700;margin-bottom:8px">📌 Nyt fiskested</div>
    <label style="font-size:11px;color:#888;display:block;margin-bottom:2px">Navn</label>
    <input id="pin-name" value="${name.replace(/"/g,'&quot;')}"
      style="width:100%;padding:5px 8px;border:1px solid #444;border-radius:5px;background:#1a2a3a;color:#fff;font-size:13px;margin-bottom:8px"/>
    <label style="font-size:11px;color:#888;display:block;margin-bottom:2px">
      Vandtype
      <span style="color:#5eead4;font-size:10px;margin-left:4px">(auto-detekteret)</span>
    </label>
    <select id="pin-wt" style="width:100%;padding:5px;border:1px solid #444;border-radius:5px;background:#1a2a3a;color:#fff;margin-bottom:4px">
      <option value="salt"     ${waterType==='salt'    ?'selected':''}>${t('wt_salt_opt')}</option>
      <option value="brackish" ${waterType==='brackish'?'selected':''}>${t('wt_brackish_opt')}</option>
      <option value="fresh"    ${waterType==='fresh'   ?'selected':''}>${t('wt_fresh_opt')}</option>
      <option value="both"     ${waterType==='both'    ?'selected':''}>🗺 Blandet</option>
    </select>
    <div style="font-size:10px;color:#666;margin-bottom:8px">${waterTypeHint(waterType)}</div>
    ${nearbySpots.length ? `
    <div style="font-size:11px;color:#888;margin-bottom:4px">
      Estimat baseret på: ${nearbySpots.slice(0,3).map(s=>`${s.name} (${s.distKm}km)`).join(', ')}
    </div>
    <div style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:8px">
      ${active.slice(0,6).map(s=>`<span style="background:#164e63;color:#67e8f9;padding:1px 6px;border-radius:10px;font-size:11px">${s.name}</span>`).join('')}
      ${active.length===0?'<span style="font-size:11px;color:#888">Ingen aktive arter denne måned nærved</span>':''}
    </div>` : `<div style="font-size:11px;color:#888;margin-bottom:8px">${t('no_official_spots')}</div>`}
    <button onclick="addPinLocation(${latS},${lngS})"
      style="background:#38bdf8;color:#07111f;border:none;padding:7px 12px;border-radius:6px;cursor:pointer;width:100%;font-weight:600;font-size:13px">
      + Tilføj lokation</button>
  </div>`;
}

async function addPinLocation(lat, lng) {
  const name   = document.getElementById('pin-name')?.value?.trim() || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  const wt     = document.getElementById('pin-wt')?.value || 'salt';

  const nearbySpots = DK_SPOTS.findNearby(lat, lng, 40).slice(0, 5);
  const species     = inferSpecies(lat, lng, nearbySpots);
  const bottom      = inferBottomType(nearbySpots);

  state.locations.push({
    id:           uid(),
    name,
    lat,
    lon:          lng,
    waterType:    wt,
    species:      species,
    bottomType:   bottom,
    isCustom:     true,
    notes:        nearbySpots.length
      ? `Estimat fra: ${nearbySpots.slice(0,2).map(s=>s.name).join(', ')}`
      : 'Brugerdefineret spot',
  });

  if (pendingPin) { pendingPin.remove(); pendingPin = null; }
  saveState();
  render();
  requestAnimationFrame(() => initMap());
}

function addSpotFromMap(spot) {
  if (state.locations.some(l => l.spotSlug === spot.slug)) return;
  addSpot(spot);
  requestAnimationFrame(() => initMap());
}

// Reverse geocode using Nominatim (free, no key)
async function reverseGeocode(lat, lng) {
  try {
    const url  = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=17&addressdetails=1&accept-language=da`;
    const res  = await fetch(url, { headers: { 'User-Agent': 'FishCast/1.0' } });
    const data = await res.json();
    const a    = data.address || {};
    // Build a meaningful place name from address components
    const specific = a.amenity || a.tourism || a.leisure || a.natural || a.pier || a.man_made;
    const road     = a.road || a.path || a.footway;
    const place    = a.hamlet || a.quarter || a.suburb || a.village || a.town || a.city;
    if (specific && place) return `${specific}, ${place}`;
    if (specific)           return specific;
    if (road && place)      return `${road}, ${place}`;
    if (place)              return place;
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  } catch(e) {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  }
}

// Infer catchable species from nearby official spots (distance-weighted)
function inferSpecies(lat, lng, nearbySpots) {
  const month   = new Date().getMonth() + 1;
  const spMap   = new Map();
  for (const spot of nearbySpots) {
    const weight = 1 / (spot.distKm + 0.5);
    for (const sp of spot.species || []) {
      if (!spMap.has(sp.name)) spMap.set(sp.name, { ...sp, score: 0 });
      spMap.get(sp.name).score += weight;
      if (sp.months.includes(month)) spMap.get(sp.name).score += weight * 0.6;
    }
  }
  return [...spMap.values()].sort((a,b) => b.score - a.score);
}

/**
 * Smart water type detection using 4-tier logic:
 * 1. Nearby official spots (distance-weighted, most reliable)
 * 2. Place name keywords from reverse geocode
 * 3. Geographic zones (North Sea coast, Bornholm, inland)
 * 4. Default: brackish (Denmark coast is almost never true saltwater)
 */
/**
 * Smart water type detection — 4-tier logic:
 * 1. Very close official spots (< 8 km, type-filtered by place name)
 * 2. Place name keywords from reverse geocode
 * 3. Geographic zones (North Sea, Bornholm, inland)
 * 4. Default: brackish (Danish coast almost never true salt)
 */
function smartDetectWaterType(lat, lon, placeName, nearbySpots) {
  const name = (placeName || '').toLowerCase();

  // Classify the place name intent upfront
  const nameIsCoastal  = /fjord|vig|bugt|havn|strand|odde|næs|holm|rev|kyst|klint|mole|pynt/.test(name);
  const nameIsFresh    = /\b(sø|søen|lake|dam|mose|kanal)\b/.test(name) ||
                         /(?<![a-z])å(?![a-z])|aaen|vandl|river/.test(name);

  // ── Tier 1: nearby official spots (only very close + type-compatible) ─
  if (nearbySpots.length) {
    // Only trust spots within 8km, and filter by name intent
    const close = nearbySpots.filter(s => {
      if (s.distKm > 8) return false;               // must be very close
      if (nameIsCoastal && s.waterType === 'fresh') return false; // coastal name → ignore freshwater spots
      if (nameIsFresh   && s.waterType !== 'fresh') return false; // fresh name → ignore salt/brackish
      return true;
    });
    if (close.length) {
      const weighted = {};
      close.forEach(s => {
        const w = 1 / (s.distKm + 0.5);
        weighted[s.waterType] = (weighted[s.waterType] || 0) + w;
      });
      return Object.entries(weighted).sort((a,b)=>b[1]-a[1])[0][0];
    }
  }

  // ── Tier 2: place name keywords ────────────────────────────
  if (nameIsFresh)   return 'fresh';

  if (nameIsCoastal) {
    // Coastal name — distinguish North Sea from rest
    if (lon < 8.6 && lat > 54.5 && lat < 58.0) return 'salt';  // North Sea
    return 'brackish';                                            // All other Danish coast
  }

  // ── Tier 3: geographic zones ───────────────────────────────
  // North Sea coast (west Jutland)
  if (lon < 8.6 && lat > 54.5 && lat < 58.0) return 'salt';

  // Bornholm / Baltic (~7-8 ppt)
  if (lat > 54.9 && lat < 55.35 && lon > 14.4 && lon < 15.25) return 'brackish';

  // Inland Midtjylland heartland (lakes and rivers common)
  if (lat > 55.8 && lat < 56.8 && lon > 9.0 && lon < 10.8) {
    if (nameIsCoastal)                      return 'brackish';
    if (nameIsFresh)                        return 'fresh';
    return lon < 9.8 ? 'brackish' : 'fresh'; // west = Limfjord coast, east = lakes
  }

  // ── Tier 4: Denmark coast default = brackish ───────────────
  return 'brackish';
}

function inferWaterType(nearbySpots, lat, lng, placeName) {
  return smartDetectWaterType(lat, lng, placeName, nearbySpots);
}

function inferBottomType(nearbySpots) {
  const counts = {};
  nearbySpots.forEach(s => { if(s.bottomType) counts[s.bottomType] = (counts[s.bottomType]||0)+1; });
  return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0] || 'mixed';
}

/**
 * Does a species appear in the targeting list for a given waterType setting?
 * Brackish shows everything — it's the transition zone with both salt & fresh species.
 * Salt shows coastal/salt species. Fresh shows freshwater species.
 */
function speciesMatchesWaterType(sp, wt) {
  if (!wt || wt === 'both') return true;
  const types = sp.waterType || [];
  if (wt === 'brackish') return true;  // brackish has all species — show full list
  if (wt === 'salt')     return types.some(t => t === 'salt' || t === 'brackish');
  if (wt === 'fresh')    return types.some(t => t === 'fresh' || t === 'brackish');
  return true;
}

// ── Fishing method labels ─────────────────
const FISHING_METHODS = {
  shore:  { icon:'🎣', labelKey:'method_shore',  hintKey:'fm_shore_hint' },
  waders: { icon:'🦺', labelKey:'method_waders', hintKey:'fm_waders_hint' },
  boat:   { icon:'🚢', labelKey:'method_boat',   hintKey:'fm_boat_hint' },
};
function methodLabel(key) {
  const m = FISHING_METHODS[key];
  return m ? `${m.icon} ${t(m.labelKey)}` : key;
}

function renderLocationItem(loc) {
  const isEditing = state.editingLocationId === loc.id;
  return `<div class="location-item" style="flex-wrap:wrap;gap:8px">
    <span style="font-size:1.4rem">${loc.isCustom ? '📌' : '📍'}</span>
    <div class="location-item-info" style="min-width:140px">
      ${isEditing
        ? `<input id="loc-rename-${loc.id}" class="loc-rename-input" value="${escHtml(loc.name)}"
            onblur="saveLocationName('${loc.id}')"
            onkeydown="if(event.key==='Enter')saveLocationName('${loc.id}');if(event.key==='Escape')cancelRename()"
            style="font-weight:600;font-size:.9rem" />`
        : `<h4 style="display:flex;align-items:center;gap:6px">
            <span class="loc-name-link" onclick="focusOnMap('${loc.id}')" title="Vis på kort 🗺">
              ${escHtml(loc.name)}
            </span>
            <button class="rename-btn" onclick="startRename('${loc.id}')" title="Omdøb">✏️</button>
           </h4>`}
      <p>${loc.lat.toFixed(3)}°N, ${loc.lon.toFixed(3)}°E</p>
      ${loc.isCustom ? `<p style="color:var(--gold);font-size:.74rem">${t('loc_custom')}</p>` :
        loc.spotSlug ? `<p style="color:var(--cyan);font-size:.74rem">${t('loc_official')}</p>` : ''}
      ${loc.waterType === 'brackish' ? `<p style="font-size:.72rem;color:var(--green)" title="${escHtml(loc.brackishNote||waterTypeHint('brackish'))}">
        ${t('loc_brackish_note')}</p>` : ''}
    </div>
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      ${state.editingWaterTypeId !== loc.id ? `
        <!-- Static badge with optional override -->
        <div class="wt-badge ${loc.waterType}" title="${escHtml(waterTypeHint(loc.waterType))}">
          ${waterTypeLabel(loc.waterType)}
        </div>
        <button class="wt-override-btn" onclick="toggleWaterTypeOverride('${loc.id}')"
          title="${escHtml(waterTypeHint(loc.waterType))}\n\n${t('wt_override')}">✏️</button>
      ` : `
        <select onchange="setLocWaterType('${loc.id}',this.value);state.editingWaterTypeId=null;render()" style="width:auto">
          <option value="salt"     ${loc.waterType==='salt'    ?'selected':''}>${t('wt_salt_label_full')}</option>
          <option value="brackish" ${loc.waterType==='brackish'?'selected':''}>${t('wt_brackish_label_full')}</option>
          <option value="fresh"    ${loc.waterType==='fresh'   ?'selected':''}>${t('wt_fresh_label_full')}</option>
          <option value="both"     ${loc.waterType==='both'    ?'selected':''}>${t('wt_both_label_full')}</option>
        </select>
        ${loc.spotSlug?`<span style="font-size:.7rem;color:var(--gold)">${t('wt_override_warn')}</span>`:''}
      `}
      <!-- method now set per availability window -->
      <button class="btn-icon" onclick="removeLocation('${loc.id}')">🗑</button>
    </div>
  </div>`;
}

// Render a single method pill in window cards — emphasise if it's the primary method
/** Shared species card used in both wizard targeting and spot finder */
function renderSpeciesCard(sp, selectedList, compact=false) {
  const isSelected = selectedList?.includes(sp.id);
  const hasWarning = !!(sp.restricted || sp.venom || sp.banned);
  const isBanned   = !!sp.banned;

  const cardCls = [
    compact ? 'sf-species-card' : 'species-target-card',
    isSelected && !isBanned ? 'selected' : '',
    isBanned ? 'species-banned' : (sp.restricted ? 'restricted-species' : ''),
  ].filter(Boolean).join(' ');

  const onclick = isBanned
    ? `showSpeciesInfo('${sp.id}')`
    : `toggleTargetSpecies('${sp.id}')`;

  if (compact) {
    return `<div class="${cardCls}" onclick="${onclick}">
      <span class="sf-sp-emoji" style="${isBanned?'opacity:.4;filter:grayscale(1)':''}">${sp.emoji}</span>
      <span class="sf-sp-name" style="${isBanned?'text-decoration:line-through;opacity:.45':''}">${sp.name}</span>
      ${hasWarning?`<span class="sf-sp-warn" onclick="event.stopPropagation();showSpeciesInfo('${sp.id}')">${isBanned?'⛔':'⚠️'}</span>`:''}
    </div>`;
  }

  return `<div class="${cardCls}" onclick="${onclick}">
    <div class="stc-top">
      <span class="stc-emoji" style="${isBanned?'opacity:.4;filter:grayscale(1)':''}">${sp.emoji}</span>
      <div style="display:flex;gap:4px;align-items:center">
        ${isSelected && !isBanned ? `<span class="stc-check">✓</span>` : ''}
        ${hasWarning ? `<span class="stc-warn" onclick="event.stopPropagation();showSpeciesInfo('${sp.id}')" style="cursor:pointer">
          ${isBanned?'⛔':'⚠️'}</span>` : ''}
      </div>
    </div>
    <div class="stc-name" style="${isBanned?'text-decoration:line-through;opacity:.45':''}">${sp.name}</div>
    <div class="stc-en">${sp.nameEn}</div>
    <div class="stc-tip">${sp.tip}</div>
  </div>`;
}

// Render the single chosen method pill prominently (used in window cards)
function renderSingleMethodPill(rec, method) {
  const map    = { boat: rec.boat, shore: rec.shore, waders: rec.wader };
  const icons  = { boat:'🚢', shore:'🎣', waders:'🦺' };
  const labels = { boat:'Fra båd', shore:'Fra kyst', waders:'Med waders' };
  const r = map[method] || map['shore'];
  if (!r) return '';
  return `<span class="rec-pill ${r.cls}">${icons[method]||'🎣'} ${labels[method]}: ${r.label}</span>`;
}

function renderMethodPill(rec, method, primary) {
  const map   = { boat: rec.boat, shore: rec.shore, waders: rec.wader };
  const icons = { boat:'🚢', shore:'🎣', waders:'🦺' };
  const r     = map[method];
  if (!r) return '';
  const isPrimary = primary === method;
  const style = isPrimary
    ? 'font-weight:700;font-size:.78rem'
    : 'font-size:.74rem;opacity:.7';
  return `<span class="rec-pill-sm ${r.cls}" style="margin-right:3px">${icons[method]}</span>
          <span style="${style};color:var(--muted)">${r.label}</span>`;
}

function focusOnMap(id) {
  state.focusLocationId = id;
  state.locationView    = 'map';
  // If already on locations page, just re-render (initMap will fly-to)
  // If on dashboard, navigate to locations first
  if (state.step !== 'locations') {
    navigate('locations');
  } else {
    render();
  }
}

function startRename(id) {
  state.editingLocationId = id;
  render();
  // Focus the input after render
  requestAnimationFrame(() => {
    const el = document.getElementById(`loc-rename-${id}`);
    if (el) { el.focus(); el.select(); }
  });
}
function saveLocationName(id) {
  const el = document.getElementById(`loc-rename-${id}`);
  const loc = state.locations.find(l => l.id === id);
  if (loc && el) {
    const newName = el.value.trim();
    if (newName) loc.name = newName;
  }
  state.editingLocationId = null;
  saveState();
  render();
}
function cancelRename() {
  state.editingLocationId = null;
  render();
}
function showLureTips(idx) {
  const el = document.getElementById('lure-tips-' + idx);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function toggleWaterTypeOverride(id) {
  const loc = state.locations.find(l => l.id === id);
  if (!loc) return;
  // Replace badge with a temporary select by toggling a flag
  state.editingWaterTypeId = state.editingWaterTypeId === id ? null : id;
  render();
}


// ═══════════════════════════════════════════
//  WIZARD VIEWS
// ═══════════════════════════════════════════
function renderWelcome() {
  const hasSetup = state.locations?.length && state.availability?.recurring?.length;

  return shell(`<div class="wizard">
    <div class="wizard-header" style="margin-top:40px">
      <div style="font-size:4.5rem;margin-bottom:12px">🎣</div>
      <h1>FishCast</h1>
      <p>${t('welcome_tagline')}<br>${t('welcome_sub')}</p>
    </div>

    <!-- Primary CTAs -->
    <div style="display:flex;flex-direction:column;gap:10px;margin-top:28px">
      <button class="btn btn-primary" style="width:100%;justify-content:center;padding:16px;font-size:1rem"
        onclick="navigate('availability')">${t('welcome_setup')}</button>
      ${hasSetup ? `<button class="btn btn-ghost" style="width:100%;justify-content:center"
        onclick="navigate('dashboard')">${t('welcome_continue')}</button>` : ''}
    </div>

    <!-- Quick-access divider -->
    <div class="welcome-divider">
      <span>${t('welcome_or')}</span>
    </div>

    <!-- Spot Finder shortcuts -->
    <p style="text-align:center;font-size:.8rem;color:var(--muted);margin-bottom:12px">
      ${t('welcome_shortcut')}
    </p>
    <div class="welcome-finder-cards">
      <div class="welcome-finder-card" onclick="goToSpotFinder('lucky')">
        <div class="wfc-icon">🎲</div>
        <div class="wfc-body">
          <div class="wfc-title">${t('welcome_lucky_title')}</div>
          <div class="wfc-sub">${t('welcome_lucky_sub')}</div>
        </div>
        <div class="wfc-arrow">→</div>
      </div>
      <div class="welcome-finder-card" onclick="goToSpotFinder('nearby')">
        <div class="wfc-icon">📍</div>
        <div class="wfc-body">
          <div class="wfc-title">${t('welcome_nearby_title')}</div>
          <div class="wfc-sub">${t('welcome_nearby_sub')}</div>
        </div>
        <div class="wfc-arrow">→</div>
      </div>
    </div>

    <!-- Clear button -->
    ${(state.targetSpecies.length || state.availability.recurring.length) ? `
    <div style="margin-top:16px;text-align:center">
      <button class="btn btn-ghost btn-sm" onclick="if(confirm(t('reset_confirm')))clearPersonalChoices()" style="opacity:.6;font-size:.76rem">
        ${t('reset_btn')}
      </button>
    </div>` : ''}

    <p style="text-align:center;color:var(--muted);font-size:.75rem;margin-top:16px">
      ${t('attribution')}
    </p>
  </div>`);
}

function renderWaterType() {
  const sel = state.waterType;
  const wtCards = [
    { wt:'fresh',    icon:'💧', labelKey:'wt_fresh_label',    subKey:'wt_fresh_sub',    badge:false },
    { wt:'brackish', icon:'🌿', labelKey:'wt_brackish_label', subKey:'wt_brackish_sub', badge:true  },
    { wt:'salt',     icon:'🌊', labelKey:'wt_salt_label',     subKey:'wt_salt_sub',     badge:false },
    { wt:'both',     icon:'🗺️', labelKey:'wt_both_label',     subKey:'wt_both_sub',     badge:false },
  ];
  return shell(`<div class="wizard">
    ${stepDots('watertype')}
    <div class="wizard-header">
      <h1 style="font-size:1.6rem">${t('wt_title')}</h1>
      <p>${t('wt_sub')}</p>
    </div>

    <!-- Salinity fact callout -->
    <div class="water-type-fact">
      <span class="wtf-icon">💡</span>
      <div><strong>${t('wt_fact_hd')}</strong> ${t('wt_fact_body')}</div>
    </div>

    <!-- 4 cards in 2×2 grid — ordered as salinity gradient -->
    <div class="water-cards water-cards-4">
      ${wtCards.map(c => `
        <div class="water-card ${sel===c.wt?'selected':''}" onclick="selectWaterType('${c.wt}')">
          <div class="icon">${c.icon}</div>
          <h3>${t(c.labelKey)}</h3>
          <p class="wc-sub">${t(c.subKey)}</p>
          ${c.badge?`<span class="wc-badge">${t('wt_most_dk')}</span>`:''}
        </div>`).join('')}
    </div>

    <div class="wizard-nav">
      <button class="btn btn-ghost" onclick="navigate('availability')">${t('back')}</button>
      <button class="btn btn-primary" onclick="navigate('locations')" ${!sel?'disabled':''}>${t('next')}</button>
    </div>
  </div>`);
}

function renderLocations() {
  const locs = state.locations;
  const month = new Date().getMonth() + 1;

  // Build suggested spots: nearby if we have locations, else show popular ones
  let suggestedSpots = [];
  if (locs.length) {
    const last = locs[locs.length - 1];
    suggestedSpots = DK_SPOTS.findNearby(last.lat, last.lon, 60).slice(0, 6);
  } else {
    // Show a mix of popular spots from different regions
    suggestedSpots = ['sletterhage','fyns-hoved','houens-odde','kegnaes-fyr','stubbehage','gronlandshavn-oest']
      .map(slug => DK_SPOTS.find(s => s.slug === slug)).filter(Boolean)
      .map(s => ({ ...s, distKm: null }));
  }

  const isMap = state.locationView === 'map';

  return shell(`<div class="wizard">
    ${stepDots('locations')}
    <div class="wizard-header"><h1 style="font-size:1.6rem">${t('loc_title')}</h1>
    <p>${t('loc_sub')}</p></div>

    <div class="tabs" style="margin-bottom:16px">
      <button class="tab-btn ${!isMap?'active':''}" onclick="state.locationView='search';render()">🔍 ${t('loc_search_tab')}</button>
      <button class="tab-btn ${isMap ?'active':''}" onclick="state.locationView='map';render()">🗺 ${t('loc_map_tab')}</button>
    </div>

    ${isMap ? `
    <div class="map-container">
      <div id="fishing-map"></div>
      <div class="map-legend">
        <span><span class="map-dot" style="background:#38bdf8"></span> Dine lokationer</span>
        <span><span class="map-dot" style="background:#22c55e"></span> Officielle pladser</span>
        <span><span class="map-dot" style="background:#ef4444"></span> Klik for ny</span>
        <label style="margin-left:8px;font-size:.75rem;cursor:pointer">
          <input type="checkbox" ${state.showSpotLayer?'checked':''} onchange="state.showSpotLayer=this.checked;requestAnimationFrame(()=>initMap())">
          Vis alle pladser
        </label>
      </div>
      <p style="font-size:.78rem;color:var(--muted);margin-top:6px">
        🖱 Klik på kortet for at placere et nyt fiskested. Grønne cirkler = officielle pladser fra fishingindenmark.info.
      </p>
    </div>
    ` : `
    <div class="form-group">
      <label>Søg efter lokation</label>
      <div class="location-search">
        <input type="text" id="loc-search" placeholder="F.eks. Køge, Esbjerg, Silkeborg…"
          value="${escHtml(state.locationSearchQuery)}"
          oninput="handleLocationSearch(this.value)" autocomplete="off"/>
        ${state.locationSearchResults.length?`<div class="search-results">
          ${state.locationSearchResults.map(r=>`<div class="search-result-item" onclick="addLocationFromResult(${escJson(r)})">
            <span>📍</span><div>
              <div>${escHtml(r.name)}${r.admin1?', '+escHtml(r.admin1):''}</div>
              <div style="font-size:.76rem;color:var(--muted)">${r.lat.toFixed(4)}°N, ${r.lon.toFixed(4)}°E</div>
            </div></div>`).join('')}
        </div>`:''}
      </div>
    </div>

    ${suggestedSpots.length ? `
    <div style="margin-bottom:16px">
      <label style="margin-bottom:8px">${locs.length ? t('loc_nearby_hd') : t('loc_popular')}</label>
      <div class="spot-grid">
        ${suggestedSpots.map(s => {
          const activeNow = s.species.filter(sp => sp.months.includes(month));
          const alreadyAdded = locs.some(l => l.spotSlug === s.slug);
          return `<div class="spot-card ${alreadyAdded?'spot-added':''}" onclick="${alreadyAdded?'':` addSpot(${escJson(s)})`}">
            <div class="spot-card-top">
              <span class="spot-type-badge">${spotTypeIcon(s.spotType)} ${escHtml(s.spotType)}</span>
              ${s.distKm!=null?`<span style="font-size:.72rem;color:var(--muted)">${s.distKm} km</span>`:''}
              ${s.facilities.parking?'<span title="Parkering">🅿️</span>':''}
              ${s.facilities.boatRamp?'<span title="Bådrampe">⛵</span>':''}
              ${s.facilities.wheelchair?'<span title="Kørestolsvenlig">♿</span>':''}
            </div>
            <div class="spot-card-name">${escHtml(s.name)}</div>
            <div class="spot-card-region">${escHtml(s.region)} · ${waterTypeBadge(s.waterType)}</div>
            <div class="spot-species">
              ${activeNow.slice(0,4).map(sp=>`<span class="spot-species-pill">${sp.name}</span>`).join('')}
              ${activeNow.length===0?`<span style="font-size:.72rem;color:var(--muted)">${t('loc_in_season')}</span>`:''}
            </div>
            ${alreadyAdded?`<div style="font-size:.74rem;color:var(--green);margin-top:4px">${t('added')}</div>`:
              `<div style="font-size:.74rem;color:var(--primary);margin-top:4px">${t('add')}</div>`}
          </div>`;
        }).join('')}
      </div>
      <p style="font-size:.72rem;color:var(--muted);margin-top:6px">
        Data: <a href="https://fishingindenmark.info" target="_blank" style="color:var(--muted)">fishingindenmark.info</a>
        · ${DK_SPOTS.filter(s=>typeof s==='object'&&s.lat).length} ${t('loc_db_count')}
      </p>
    </div>` : ''}
    `}

    ${locs.length?`<div class="location-list" style="margin-top:12px">${locs.map(loc=>renderLocationItem(loc)).join('')}</div>`
    :`<div class="empty-state"><div class="icon">🗺️</div><p>${t('loc_empty')}</p></div>`}
    <div class="wizard-nav" style="margin-top:24px">
      <button class="btn btn-ghost" onclick="navigate('watertype')">${t('back')}</button>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn btn-ghost" onclick="gotoDashboard()" ${!locs.length?'disabled':''}>${t('skip')}</button>
        <button class="btn btn-primary" onclick="navigate('species')" ${!locs.length?'disabled':''}>${t('next_species')}</button>
      </div>
    </div>
  </div>`);
}

/**
 * Shared species selection step — used by both setup wizard AND Held og lykke wizard.
 * context: 'wizard' | 'lucky'
 *   wizard → back to locations, next calls gotoDashboard()
 *   lucky  → back to tilgængelighed step, next runs lucky search
 */
function renderSpeciesStep(context) {
  const sel       = state.targetSpecies;
  const wt        = state.waterType || 'both';
  const available = Object.values(SPECIES_PREFS).filter(sp => speciesMatchesWaterType(sp, wt));

  const isLucky   = context === 'lucky';
  const backAction = isLucky
    ? `state.spotFinder.sfStep='time';render();window.scrollTo(0,0)`
    : `navigate('locations')`;
  const nextAction = isLucky
    ? `runLuckySearch();state.spotFinder.sfStep='results';render();window.scrollTo(0,0)`
    : `gotoDashboard()`;
  const nextLabel = isLucky ? t('sp_lucky_btn') : t('sp_show');

  // Context subtitle
  const subtitle = isLucky
    ? `⏱ ${state.availability.recurring.map(a=>`${a.days.map(d=>t('day'+d)).join('/')} ${a.from}–${a.to}`).join(' · ')}
       <button class="btn-ghost btn-sm" onclick="state.spotFinder.sfStep='time';render();window.scrollTo(0,0)"
         style="margin-left:8px;padding:2px 8px;font-size:.72rem">${t('edit_time')}</button>`
    : t('sp_sub');

  const header = isLucky
    ? `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
         <div class="sf-mode-badge lucky">🎲 Held og lykke</div>
         <button class="btn-icon" onclick="navigate('welcome')" title="Tilbage til start">✕</button>
       </div>`
    : stepDots('species');

  return shell(`<div class="wizard">
    ${header}
    <div class="wizard-header" style="margin-top:8px">
      <h1 style="font-size:1.6rem">${t('sp_title')}</h1>
      <p>${subtitle}</p>
    </div>

    <div class="species-target-grid">
      ${available.map(sp => renderSpeciesCard(sp, sel)).join('')}
    </div>

    ${sel.length === 0 ? `
      <div class="notice" style="margin-top:12px">
        ℹ️ Vælg ingen arter for en generel anbefaling, eller vælg en eller flere for målrettet scoring.
      </div>` : `
      <div style="background:rgba(56,189,248,.08);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-top:12px;font-size:.82rem">
        <strong>Valgte:</strong> ${sel.map(id => SPECIES_PREFS[id]?.emoji + ' ' + SPECIES_PREFS[id]?.name).join(', ')}
      </div>`}

    ${sel.includes('fjaesing') ? `
      <div class="venom-banner" style="margin-top:12px">
        ☠️ <strong>Fjæsing valgt — vigtig advarsel:</strong>
        Giftige pigge — brug tang ved håndtering. Ved stik: varmt vand 45–50°C i 30–60 min.
      </div>` : ''}

    <div class="wizard-nav" style="margin-top:24px">
      <button class="btn btn-ghost" onclick="${backAction}">${t('back')}</button>
      <button class="btn btn-primary" onclick="${nextAction}">${nextLabel}</button>
    </div>
  </div>`);
}

// Setup wizard entry point — delegates to shared step
function renderSpeciesTarget() {
  return renderSpeciesStep('wizard');
}

// Shared availability block — used in wizard AND SF wizard
function renderAvailBlock(a, i) {
  // Migrate old single 'method' to 'methods' array on first render
  if (!a.methods) a.methods = [a.method || 'shore'];
  const ms = a.methods;
  return `<div class="avail-block">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <span style="font-weight:600;font-size:.9rem">${t('avail_window')} ${i+1}</span>
      <button class="btn-icon" onclick="removeAvail('${a.id}')">🗑</button>
    </div>
    <div class="day-toggles">${[0,1,2,3,4,5,6].map(idx=>`
      <button class="day-btn ${a.days.includes(idx)?'active':''}" onclick="toggleAvailDay('${a.id}',${idx})">${t('day'+idx)}</button>
    `).join('')}</div>
    <div class="time-range" style="margin-bottom:12px">
      <label>${t('time_from')}</label>
      <input type="time" value="${a.from}" onchange="setAvailTime('${a.id}','from',this.value)" style="width:auto"/>
      <label style="margin-left:8px">${t('time_to')}</label>
      <input type="time" value="${a.to}" onchange="setAvailTime('${a.id}','to',this.value)" style="width:auto"/>
    </div>
    <div>
      <label style="margin-bottom:6px;display:block">
        ${t('method_label')}
        <span style="font-size:.7rem;color:var(--muted);margin-left:6px">${t('method_pick')}</span>
      </label>
      <div class="method-btns">
        <button class="method-btn ${ms.includes('shore') ?'active':''}" onclick="toggleAvailMethod('${a.id}','shore')"
          title="${t('fm_shore_hint')}">
          🎣 ${t('method_shore')}
        </button>
        <button class="method-btn ${ms.includes('waders')?'active':''}" onclick="toggleAvailMethod('${a.id}','waders')"
          title="${t('fm_waders_hint')}">
          🦺 ${t('method_waders')}
        </button>
        <button class="method-btn ${ms.includes('boat')  ?'active':''}" onclick="toggleAvailMethod('${a.id}','boat')"
          title="${t('fm_boat_hint')}">
          🚢 ${t('method_boat')}
        </button>
      </div>
      ${ms.length===1?`<p style="font-size:.7rem;color:var(--muted);margin-top:4px">${t('method_required')}</p>`:''}
    </div>
  </div>`;
}

function renderAvailability() {
  const rec = state.availability.recurring;
  return shell(`<div class="wizard">
    ${stepDots('availability')}
    <div class="wizard-header"><h1 style="font-size:1.6rem">${t('avail_title')}</h1>
    <p>${t('avail_sub')}</p></div>
    ${rec.map((a,i)=>renderAvailBlock(a,i)).join('')}
    <button class="btn btn-ghost" onclick="addAvail()" style="width:100%;justify-content:center;margin-top:4px">
      ${t('avail_add')}</button>
    ${!rec.length?`<div class="notice" style="margin-top:16px">${t('avail_notice')}</div>`:''}
    <div class="wizard-nav" style="margin-top:24px">
      ${state.fromDash
        ? `<button class="btn btn-primary" style="width:100%;justify-content:center" onclick="state.fromDash=false;navigate('dashboard')">✓ ${t('save_back_dash')}</button>`
        : `<button class="btn btn-ghost" onclick="navigate('welcome')">${t('back')}</button>
           <button class="btn btn-primary" onclick="navigate('watertype')" ${!rec.length?'disabled':''}>${t('next')}</button>`
      }
    </div>
  </div>`);
}

// ═══════════════════════════════════════════
//  DASHBOARD
// ═══════════════════════════════════════════
function renderDashboard() {
  const windows = getScoredWindows();
  const top     = windows[0];
  const today   = new Date();
  const month   = today.getMonth()+1;
  const wt      = state.waterType || 'both';
  const allSp   = DK_REGULATIONS.forWaterType(wt);
  // ✅ In season (green): must be open AND within date window — no restrictions/bans
  const inSeason   = allSp.filter(s => s.status === 'open' && DK_REGULATIONS.isInSeason(s, today));
  // ⚠️ Restricted: species with bag limits, bans, or special rules (regardless of date)
  const restricted = allSp.filter(s => s.status === 'restricted');
  // 🚫 Closed: either explicitly closed status OR currently in a protected date period
  const closed     = allSp.filter(s => s.status === 'closed' || !DK_REGULATIONS.isInSeason(s, today));

  // Lightning banners for all locations
  const lightningBanners = state.locations.map(loc => {
    const lgt = state.lightning[loc.id]?.status;
    if (!lgt || lgt.level==='clear') return '';
    const cls = lgt.level==='danger'?'lightning-danger':lgt.level==='warning'?'lightning-warning':'lightning-caution';
    return `<div class="lightning-banner ${cls}">
      ⚡ <strong>${escHtml(loc.name)}:</strong> ${escHtml(lgt.label)}
      <span style="font-size:.76rem;opacity:.8;margin-left:8px">Kulfiberstænger tiltrækker lyn!</span>
    </div>`;
  }).join('');

  // Shared-window banner
  const sw = state._sharedWindow;
  const sharedBanner = sw ? `<div class="shared-banner">
    <div class="shared-banner-hd">📤 ${t('share_window')}</div>
    <p style="font-size:.82rem;color:var(--muted);margin:4px 0 10px">${t('share_intro')}</p>
    <div class="shared-banner-card">
      <div style="font-weight:700;font-size:.95rem">📍 ${escHtml(sw.n)}</div>
      <div style="font-size:.82rem;color:var(--muted);margin-top:2px">${sw.d} · ${sw.f}–${sw.t}</div>
      <div class="score-badge ${scoreColor(sw.s)}" style="margin-top:8px;display:inline-flex"><span>${sw.s}</span></div>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn btn-primary btn-sm" onclick="(function(){
        const loc={id:'shared-'+Date.now(),name:${JSON.stringify(sw.n)},lat:${sw.lat},lon:${sw.lon},waterType:${JSON.stringify(sw.wt)}};
        if(!state.locations.find(l=>l.lat===${sw.lat}&&l.lon===${sw.lon})){state.locations.push(loc);}
        state._sharedWindow=null; saveState(); render();
      })()">${t('share_add_loc')}</button>
      <button class="btn btn-ghost btn-sm" onclick="state._sharedWindow=null;render()">${t('close')}</button>
    </div>
  </div>` : '';

  return shell(`
    ${lightningBanners}
    ${sharedBanner}
    <div class="dash-grid">

      <!-- LEFT COLUMN -->
      <div>
        ${state.fetchingForecast?`<div class="card" style="margin-bottom:16px">
          <div style="display:flex;align-items:center;gap:12px">
            <div class="spinner"></div>
            <div>
              <div>${t('loading')}…</div>
              <div style="font-size:.76rem;color:var(--muted);margin-top:2px">
                ${Object.values(state.fetchStatus).filter(s=>s==='ok').length} / ${state.locations.length} ${t('locs_ready')}
                ${Object.values(state.fetchStatus).filter(s=>s==='error').length > 0
                  ? ` · <span style="color:var(--red)">${Object.values(state.fetchStatus).filter(s=>s==='error').length} ${t('locs_failed')}</span>` : ''}
              </div>
            </div>
          </div></div>`:''}

        ${state.activeTab === 'spotfinder' ? '' : !top ? `<div class="notice">⚠️ ${t('dash_no_windows')}</div>` : ''}
        ${top && state.activeTab !== 'spotfinder' ?`<div class="hero-rec">
          <div class="hero-score">
            <div class="score-num" style="color:${top.score>=65?'var(--green)':top.score>=45?'var(--gold)':'var(--red)'}">
              ${top.score}</div>
            <div class="score-fish">${scoreFish(top.score)}</div>
            <div style="font-size:.75rem;color:var(--muted);margin-top:4px">${scoreLabel(top.score)}</div>
            <button class="score-info-btn" onclick="openScoreInfo()" title="${t('explanation')}">${t('explanation')}</button>
          </div>
          <div class="hero-rec-details">
            <h2>${t('dash_best')}: ${formatDate(top.date)}</h2>
            <p style="display:flex;align-items:center;flex-wrap:wrap;gap:6px">
              📍 ${escHtml(top.location.name)} · ${top.fromStr} – ${top.toStr}${top.bestHourStr?' · '+t('best_hour')+' '+top.bestHourStr:''}
              ${windBadgeHtml(top.bestWindDir,top.bestWindMs,top.location.lat,top.location.lon)}
              ${tideArrowHtml(top.tideRising)}
            </p>
                ${state.targetSpecies.length ? `<div style="font-size:.78rem;color:var(--cyan);margin-bottom:6px">
              ${t('dash_targets')} ${state.targetSpecies.map(id=>SPECIES_PREFS[id]?.emoji+' '+(state.lang==='en'&&SPECIES_PREFS[id]?.nameEn?SPECIES_PREFS[id].nameEn:SPECIES_PREFS[id]?.name)).join(', ')}
            </div>` : ''}
            ${top.rec?`<div class="rec-row" style="flex-wrap:wrap">
              ${(top.availMethods||[top.availMethod||'shore']).map(m=>renderSingleMethodPill(top.rec,m)).join('')}
            </div>`:''}
            <div class="tags">${top.tags.map(tg=>`<span class="tag ${tg.cls}" ${tg.hint?`title="${escHtml(tg.hint)}"`:''} style="cursor:${tg.hint?'help':'default'}">${tg.label}</span>`).join('')}</div>
            ${top.solunar&&top.solunar.length?`<div style="margin-top:6px">${renderSolunarRow(top.solunar,top.fromH,top.toH)}</div>`:''}
            ${top.lure?`<div class="lure-row" style="margin-top:10px">
              <span class="lure-label">${t('lure_label')}</span>
              ${top.lure.colors.map(c=>`<span class="lure-swatch" style="background:${c.hex}" title="${escHtml(c.name+' — '+c.reason)}"></span><span class="lure-name" title="${escHtml(c.reason)}">${c.name}</span>`).join('<span class="lure-sep">·</span>')}
              ${top.lure.tips.length?`<button class="lure-tips-btn" onclick="event.stopPropagation();showLureTips('hero')" title="💡">💡</button>`:''}
            </div>
            ${top.lure.tips.length?`<div class="lure-tips-panel" id="lure-tips-hero" style="display:none">
              ${top.lure.tips.map(tip=>`<div class="lure-tip">${escHtml(tip)}</div>`).join('')}
            </div>`:''}` : ''}
            <div style="margin-top:10px;display:flex;justify-content:flex-end">
              <button class="share-btn" onclick="shareWindow(window._fcWindows?.[0])" title="${t('share')}">🔗 ${t('share')}</button>
            </div>
          </div>
        </div>` : ''}

        ${windows.length >= 2 ? renderWeekSparkline(windows) : ''}

        ${(()=>{
          const missing = state.locations.filter(l => !state.forecasts[l.id]);
          if (!missing.length) return '';
          const isFetching = Object.values(state.fetchStatus).some(s=>s==='loading');
          return `<div class="no-data-banner">
            <span>⚠️ ${missing.length === 1
              ? `${t('load_data_for')} <strong>${escHtml(missing[0].name)}</strong>`
              : `${missing.length} ${t('load_data_missing')}`}</span>
            <button class="btn btn-primary btn-sm" onclick="fetchAllForecasts()" ${isFetching?'disabled':''}>
              ${isFetching?'⏳ '+t('loading'):'⟳ '+t('load_data_btn')}
            </button>
          </div>`;
        })()}

        <div class="tabs">
          <button class="tab-btn ${state.activeTab==='windows'   ?'active':''}" onclick="setTab('windows')">${t('tab_windows')}</button>
          <button class="tab-btn ${state.activeTab==='species'   ?'active':''}" onclick="setTab('species')">${t('tab_seasons')}</button>
          <button class="tab-btn ${state.activeTab==='conditions'?'active':''}" onclick="setTab('conditions')">${t('tab_conditions')}</button>
        </div>

        ${state.activeTab==='windows'    ? renderWindowsTab(windows) : ''}
        ${state.activeTab==='species'    ? renderSpeciesTab(inSeason,restricted,closed,today,month) : ''}
        ${state.activeTab==='conditions' ? renderConditionsTab() : ''}
      </div>

      <!-- RIGHT COLUMN -->
      <div>
        <div class="card" style="margin-bottom:16px">
          <div class="card-title">${t('your_locs')}</div>
          ${(()=>{
            // Sort: favourites first, then original order
            const sorted = [...state.locations].sort((a,b)=>{
              const af = state.favLocations.includes(a.id)?0:1;
              const bf = state.favLocations.includes(b.id)?0:1;
              return af - bf;
            });
            return sorted.map(loc=>{
              const fc     = state.forecasts[loc.id];
              const cur    = fc ? getCurrentConditions(fc) : null;
              const lgt    = state.lightning[loc.id]?.status;
              const isFav  = state.favLocations.includes(loc.id);
              const note   = state.locNotes[loc.id] || '';
              const month  = new Date().getMonth() + 1;
              const activeSpecies = loc.species
                ? loc.species.filter(sp => sp.months.includes(month))
                : [];
              // Stale data: fetched > 3h ago
              const staleMs = fc?.fetched ? Date.now() - fc.fetched : 0;
              const isStale = staleMs > 3 * 3600 * 1000;
              const staleTime = fc?.fetched ? new Date(fc.fetched).toLocaleTimeString(state.lang==='en'?'en-GB':'da-DK',{hour:'2-digit',minute:'2-digit'}) : '';
              return `<div class="loc-card-row ${isFav?'loc-fav':''}">
                ${isFav?`<div class="loc-fav-bar"></div>`:''}
                <div style="display:flex;align-items:flex-start;gap:8px">
                  <button class="fav-star ${isFav?'fav-active':''}" onclick="toggleFav('${loc.id}')"
                    title="${isFav?t('fav_remove'):t('fav_add')}">${isFav?'⭐':'☆'}</button>
                  <div style="flex:1;min-width:0">
                    <div style="font-weight:600;font-size:.88rem;display:flex;align-items:center;gap:6px">
                      <span class="loc-name-link" onclick="focusOnMap('${loc.id}')" title="${t('show_on_map')}">${escHtml(loc.name)}</span>
                    </div>
                    <div style="font-size:.76rem;color:var(--muted)">${waterTypeLabel(loc.waterType)}
                      ${loc.facilities?.parking?'· 🅿️':''}
                      ${loc.facilities?.boatRamp?'· ⛵':''}
                      ${loc.facilities?.wheelchair?'· ♿':''}
                    </div>
                    ${cur?`<div style="font-size:.76rem;color:var(--muted);margin-top:2px">
                      ${cur.tempC}°C · ${cur.windMs} m/s ${windDirLabel(cur.windDir)} · ${cur.pressureHpa} hPa
                    </div>`:''}
                    ${fc?.tides?`<div style="font-size:.74rem;color:var(--cyan);margin-top:2px">
                      🌊 ${escHtml(fc.tides.stationName)} (${fc.tides.distKm} km)
                    </div>`:''}
                    ${activeSpecies.length?`<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:5px">
                      ${activeSpecies.map(sp=>`<span class="spot-species-pill">${sp.name}</span>`).join('')}
                    </div>`:''}
                    ${loc.accessNote?`<div style="font-size:.72rem;color:var(--gold);margin-top:3px">${loc.accessNote}</div>`:''}
                    ${isStale?`<div class="stale-notice">⏱ ${t('stale_banner')} ${staleTime} ${t('stale_banner2')}
                      <button class="btn btn-ghost btn-sm" style="padding:1px 7px;font-size:.7rem;margin-left:4px"
                        onclick="fetchForecastForLocation(state.locations.find(l=>l.id==='${loc.id}'))">${t('stale_update')}</button>
                    </div>`:''}
                    <!-- Spot note -->
                    <details class="loc-note-details">
                      <summary class="loc-note-summary">${t('note_label')}${note?` <span class="loc-note-dot"></span>`:''}</summary>
                      <div class="loc-note-body">
                        <textarea class="loc-note-ta" id="note-ta-${loc.id}" rows="2"
                          placeholder="${t('note_placeholder')}"
                          onchange="saveLocNote('${loc.id}', this.value)"
                          onblur="saveLocNote('${loc.id}', this.value)">${escHtml(note)}</textarea>
                        <button id="note-save-${loc.id}" class="btn btn-ghost btn-sm" style="margin-top:4px"
                          onclick="saveLocNote('${loc.id}', document.getElementById('note-ta-${loc.id}').value)">${t('note_save')}</button>
                      </div>
                    </details>
                  </div>
                  <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
                    ${lgt&&lgt.level!=='clear'?`<span class="tag tag-red">⚡</span>`:''}
                    ${(() => {
                      const st = state.fetchStatus[loc.id];
                      if (st === 'loading') return `<span class="tag tag-gray"><span class="spinner" style="width:12px;height:12px"></span> ${t('loading')}</span>`;
                      if (st === 'error')   return `<span class="tag tag-red" style="cursor:pointer" onclick="fetchForecastForLocation(state.locations.find(l=>l.id==='${loc.id}'))">⚠ ${t('error')}</span>`;
                      if (fc)              return `<span class="tag tag-green">${t('data_ok')}</span>`;
                      return `<span class="tag tag-gray" style="cursor:pointer" onclick="fetchForecastForLocation(state.locations.find(l=>l.id==='${loc.id}'))">${t('loading')}</span>`;
                    })()}
                    ${loc.spotSlug?`<a href="https://fishingindenmark.info/fiskepladser/${loc.spotSlug}" target="_blank"
                      style="font-size:.7rem;color:var(--muted);text-decoration:none">🔗 ${t('details')}</a>`:''}
                  </div>
                </div>
              </div>`;
            }).join('');
          })()}
          <div style="display:flex;gap:6px;margin-top:12px">
            <button class="btn btn-ghost btn-sm" style="flex:1;justify-content:center"
              onclick="fetchAllForecasts()">${t('update_all')}</button>
            <button class="btn btn-ghost btn-sm" style="justify-content:center"
              title="${t('reset_data_btn')}" onclick="clearWeatherData()">🗑</button>
          </div>
          ${(()=>{
            if (!('Notification' in window)) return '';
            const perm = Notification.permission;
            if (perm === 'denied') return `<div style="font-size:.7rem;color:var(--muted);text-align:center;margin-top:6px">🔕 ${t('notif_denied')}</div>`;
            if (perm === 'granted') return `<button class="btn btn-ghost btn-sm" style="margin-top:6px;width:100%;justify-content:center;color:var(--green)" onclick="scheduleWindowNotifications();render()">🔔 ${t('notif_enabled')}</button>`;
            return `<button class="btn btn-ghost btn-sm" style="margin-top:6px;width:100%;justify-content:center" onclick="enableNotifications()">${t('notif_enable')}</button>`;
          })()}
        </div>

        <div class="card" style="margin-bottom:16px">
          <div class="card-title">${t('moon_title')}</div>
          ${renderMoonCard(today)}
        </div>

        <div class="card">
          <div class="card-title">${t('lightning_title')}</div>
          ${renderLightningCard()}
        </div>
      </div>
    </div>
  `);
}

// ── Shared card fragment helpers ─────────
function windBadgeHtml(dir, ms, lat, lon) {
  const wr = windRelativeToShore(dir, ms, lat, lon);
  return wr ? `<span class="wind-shore-badge" style="color:${wr.color}" title="${t(wr.key)}">${wr.icon} ${t(wr.key)}</span>` : '';
}
function tideArrowHtml(rising) {
  if (rising == null) return '';
  return `<span class="tide-arrow ${rising?'tide-up':'tide-down'}">${rising?t('tide_up'):t('tide_down')}</span>`;
}

// ── Solunar periods helper ────────────────
function renderSolunarRow(solunar, fromH, toH) {
  if (!solunar) return '';
  const fmt = d => `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
  const hits = [];
  const check = (period, labelKey) => {
    if (!period) return;
    const startH = period.start.getUTCHours() + period.start.getUTCMinutes()/60;
    const endH   = period.end.getUTCHours()   + period.end.getUTCMinutes()/60;
    // Overlaps with the fishing window
    if (endH >= fromH && startH <= toH) {
      hits.push(`<span class="solunar-badge solunar-${labelKey.includes('major')?'major':'minor'}" title="${t(labelKey)}">${t(labelKey)} ${fmt(period.start)}–${fmt(period.end)}</span>`);
    }
  };
  check(solunar.major1, 'solunar_major');
  check(solunar.major2, 'solunar_major');
  check(solunar.minor1, 'solunar_minor');
  check(solunar.minor2, 'solunar_minor');
  if (!hits.length) return '';
  return `<div class="solunar-row"><span class="solunar-lbl">${t('solunar_golden')}</span>${hits.join('')}</div>`;
}

// ── 7-day score sparkline ─────────────────
function renderWeekSparkline(windows) {
  if (!windows.length) return '';
  // Best score per day (key = ISO date string)
  const byDay = {};
  for (const w of windows) {
    const key = w.date.toISOString().slice(0,10);
    if (!byDay[key] || w.score > byDay[key].score) byDay[key] = w;
  }
  const days = Object.values(byDay).sort((a,b) => a.date - b.date).slice(0,7);
  if (days.length < 2) return '';
  const max = Math.max(...days.map(d=>d.score), 1);
  const BAR_W = 32, GAP = 5, H = 52, LABEL_H = 18;
  const totalW = days.length * (BAR_W + GAP) - GAP;
  const best = days.reduce((a,b)=>b.score>a.score?b:a);
  // colour helpers (hex so SVG filter works)
  const barCol = s => s>=65?'#22c55e':s>=45?'#f59e0b':'#ef4444';
  const bars = days.map((d, i) => {
    const barH   = Math.max(4, Math.round((d.score / max) * H));
    const x      = i * (BAR_W + GAP);
    const y      = H - barH;
    const isBest = d === best;
    const col    = barCol(d.score);
    const dayLbl = t('day' + d.date.getUTCDay());
    return `<g ${isBest?'filter="url(#glow)"':''}>
      <rect x="${x}" y="${y}" width="${BAR_W}" height="${barH}" rx="4"
        fill="${col}" opacity="${isBest?1:0.45}"/>
      ${isBest?`<rect x="${x-1}" y="${y-1}" width="${BAR_W+2}" height="${barH+2}" rx="5"
        fill="none" stroke="${col}" stroke-width="2" opacity="0.8"/>`:''}
      <text x="${x+BAR_W/2}" y="${H+LABEL_H-1}" text-anchor="middle"
        font-size="${isBest?10:9}" font-weight="${isBest?700:400}"
        fill="${isBest?col:'#64748b'}">${dayLbl}</text>
      <text x="${x+BAR_W/2}" y="${y-5}" text-anchor="middle"
        font-size="${isBest?10:8}" font-weight="${isBest?700:400}"
        fill="${col}" opacity="${isBest?1:0.65}">${d.score}</text>
    </g>`;
  }).join('');
  return `<div class="week-sparkline">
    <div class="week-sparkline-hd">
      <span class="week-sparkline-title">📊 ${t('week_overview')}</span>
      <span class="week-best-lbl">🏆 ${t('best_day_week')} <strong>${t('day'+best.date.getUTCDay())} ${best.date.getUTCDate()}. ${t('month'+best.date.getUTCMonth())}</strong> · ${best.score}</span>
    </div>
    <svg width="${totalW}" height="${H+LABEL_H}" style="overflow:visible;display:block;margin:0 auto">
      <defs>
        <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      ${bars}
    </svg>
  </div>`;
}

// ── Tab: Tidsvinduer ──────────────────────
function renderWindowsTab(windows) {
  if (!windows.length) return `<div class="empty-state"><div class="icon">📅</div><p>${t('no_windows_empty')}</p></div>`;
  window._fcWindows = windows; // global ref for share buttons
  return `<div class="windows-list scroll-list">${windows.slice(0,20).map((w,i)=>`
    <div class="window-card ${i===0?'top':''}">
      <div class="score-badge ${w.noData?'score-nodata':scoreColor(w.score)}"><span>${w.noData?'?':w.score}</span></div>
      <div class="window-info">
        <h3>${formatDate(w.date)} · ${w.fromStr}–${w.toStr}${tideArrowHtml(w.tideRising)}</h3>
        <p>📍 ${escHtml(w.location.name)}${w.bestHourStr?' · '+t('best_hour')+' '+w.bestHourStr:''} ${windBadgeHtml(w.bestWindDir,w.bestWindMs,w.location.lat,w.location.lon)}</p>
        ${w.noData?`<button class="btn btn-primary btn-sm" style="margin-top:6px" onclick="fetchForecastForLocation(state.locations.find(l=>l.id==='${w.location.id}'))">⟳ ${t('load_data_btn')}</button>`:''}
        ${!w.noData&&w.rec?`<div class="rec-row" style="margin-top:6px;flex-wrap:wrap">
          ${(w.availMethods||[w.availMethod||'shore']).map(m=>renderSingleMethodPill(w.rec,m)).join('')}
        </div>`:''}
        <div class="window-factors">${w.noData?'':w.tags.slice(0,4).map(tg=>`<span class="tag ${tg.cls}" ${tg.hint?`title="${escHtml(tg.hint)}"`:''} style="cursor:${tg.hint?'help':'default'}">${tg.label}</span>`).join('')}</div>
        ${w.lure?`<div class="lure-row">
          <span class="lure-label">${t('lure_label')}</span>
          ${w.lure.colors.map(c=>`<span class="lure-swatch" style="background:${c.hex}" title="${escHtml(c.name+' — '+c.reason)}"></span><span class="lure-name" title="${escHtml(c.reason)}">${c.name}</span>`).join('<span class="lure-sep">·</span>')}
          ${w.lure.tips.length?`<button class="lure-tips-btn" onclick="event.stopPropagation();showLureTips(${i})" title="💡">💡</button>`:''}
        </div>`:''}
        ${w.lure?.tips?.length?`<div class="lure-tips-panel" id="lure-tips-${i}" style="display:none">
          ${w.lure.tips.map(tip=>`<div class="lure-tip">${escHtml(tip)}</div>`).join('')}
        </div>`:''}
        ${renderSolunarRow(w.solunar, w.fromH, w.toH)}
      </div>
      <div style="text-align:right;min-width:50px">
        <div style="font-size:1.1rem">${scoreFish(w.score)}</div>
        <button id="share-btn-${w.location.id+i}" class="share-btn" title="${t('share_btn')}"
          onclick="event.stopPropagation();shareWindow(window._fcWindows[${i}])">${t('share_btn')}</button>
      </div>
    </div>`).join('')}</div>`;
}

// ── Tab: Fiskesæsoner ─────────────────────
function renderSpeciesTab(inSeason,restricted,closed,today,month) {
  return `<div>
    <div class="notice">${t('sp_regs_note')}
      <a href="https://lfst.dk/lyst-og-fritidsfiskeri/mindstemaal-og-fredningstider/" target="_blank"
        style="color:var(--gold)">lfst.dk</a></div>

    ${[...inSeason, ...restricted].some(s => s.venom) ? `
    <div class="venom-banner">
      ☠️ <strong>Giftadvarsel — Fjæsing:</strong>
      Fjæsingen har giftige pigge på rygfinnen og gællelågene. Den graver sig ned i sandbunden med pigge opad og er svær at se — særlig farlig for vadefiskere på sandstrande.
      <div style="margin-top:6px;font-size:.78rem">
        🩺 <strong>Ved stik:</strong> Nedsænk straks i så varmt vand du tåler (45–50°C) i 30–60 min — varmen nedbryder giften. Søg læge ved alvorlig reaktion eller tegn på infektion.
        &nbsp;·&nbsp; 🦾 <strong>Håndtering:</strong> Brug altid fiskepincet/tang. Skær pigge af med saks inden rensning.
      </div>
    </div>` : ''}

    <p class="section-title">${t('sp_in_season')} (${inSeason.length})</p>
    <div class="species-grid" style="margin-bottom:20px">
      ${inSeason.map(s=>{
        const sz = DK_REGULATIONS.getPrimarySize(s);
        const bag = s.bagLimit || null;
        const allSizes = s.sizes?.length > 1 ? s.sizes : null;
        return `<div class="species-item species-open ${s.venom?'species-venom':''}">
          <h4>${s.emoji} ${s.name}${s.venom?' <span class="venom-badge" title="Giftige pigge — læs advarslen ovenfor">☠️ GIFTIG</span>':''}</h4>
          <p style="color:var(--muted);font-size:.76rem">${state.lang==='en'?s.nameEn:s.name}</p>
          <div class="sp-reg-row">
            ${sz?`<span class="sp-reg-badge sp-size">${t('sp_min_size')} ${sz} cm</span>`:''}
            ${bag?`<span class="sp-reg-badge sp-bag" title="${bag}">${t('sp_bag_limit')} ${bag.length>28?bag.slice(0,28)+'…':bag}</span>`:''}
          </div>
          ${allSizes?`<div style="font-size:.68rem;color:var(--muted);margin-top:3px">${allSizes.map(sz2=>`${sz2.area}: ${sz2.minCm}cm`).join(' · ')}</div>`:''}
          ${s.bestMonths?.includes(month)?`<p style="color:var(--green);font-size:.74rem;margin-top:4px">${t('sp_high_season')}</p>`:''}
          ${s.venom?`<p style="color:var(--red);font-size:.72rem">${t('sp_handle')}</p>`:''}
        </div>`;
      }).join('')}
    </div>
    ${restricted.length?`<p class="section-title">${t('sp_restricted')}</p>
    <div class="species-grid" style="margin-bottom:20px">
      ${restricted.map(s=>{
        const note = (s.restrictions||[])[0];
        const sz   = DK_REGULATIONS.getPrimarySize(s);
        const bag  = s.bagLimit || null;
        return `<div class="species-item species-caution">
          <h4>${s.emoji} ${s.name}</h4>
          <p style="color:var(--muted);font-size:.76rem">${s.nameEn}</p>
          <div class="sp-reg-row">
            ${sz?`<span class="sp-reg-badge sp-size">${t('sp_min_size')} ${sz} cm</span>`:''}
            ${bag?`<span class="sp-reg-badge sp-bag">${bag.length>28?bag.slice(0,28)+'…':bag}</span>`:''}
          </div>
          ${note?`<p style="font-size:.72rem;color:var(--gold);margin-top:4px">${note.note}</p>`:''}
        </div>`;
      }).join('')}
    </div>`:''}
    ${closed.filter(s=>s.status==='closed').length?`<p class="section-title">${t('sp_closed')}</p>
    <div class="species-grid">
      ${closed.filter(s=>s.status==='closed').map(s=>`
        <div class="species-item species-restricted species-closed">
          <h4>${s.emoji} ${s.name}</h4><p>${s.nameEn} — fredning aktiv</p></div>
      `).join('')}
    </div>`:''}
  </div>`;
}

// ── Tab: Vejr & Bølger ────────────────────
function renderConditionsTab() {
  const locs = state.locations;
  if (!locs.length) return `<div class="empty-state"><div class="icon">🌤</div><p>${t('no_locs_empty')}</p></div>`;

  return locs.map(loc => {
    const fc  = state.forecasts[loc.id];
    if (!fc)  return `<div class="card" style="margin-bottom:12px">
      <div class="card-title">📍 ${escHtml(loc.name)}</div>
      <p style="color:var(--muted);font-size:.85rem">${t('dash_no_forecast')}</p></div>`;

    const cur  = getCurrentConditions(fc);
    const pt   = getPressureTrend(fc.hourly, cur.idx);
    const wt   = getWindTrend(fc.hourly, cur.idx);
    const bf   = getBeaufort(parseFloat(cur.windMs)||0);
    const ptCtx = pressureContext(cur.pressureHpa, pt);

    // Current wave (marine)
    let waveCur = null;
    if (fc.marine) {
      const mi = findHourIndex(fc.marine, Date.now());
      if (mi >= 0) waveCur = fc.marine[mi];
    }

    // Tide now
    let tideNow = null;
    if (fc.tides) {
      tideNow = getTideCycleAtTime(fc.tides.predictions, Date.now());
    }

    // Shore/boat/wader rec now
    const recNow = getShoreBoatRec(
      waveCur?.waveM ?? null,
      parseFloat(cur.windMs)||0,
      wt.dir,
      loc.bottomType || 'mixed',
      waveCur?.wavePeriod ?? null,
      fc.tides?.predictions ?? null,
      Date.now()
    );

    const wtColor = wt.dir==='rising'?'var(--red)':wt.dir==='falling'?'var(--green)':'var(--muted)';

    return `<div class="card" style="margin-bottom:16px">
      <div class="card-title">📍 ${escHtml(loc.name)}</div>

      <div class="conditions-row">
        <div class="condition-tile">
          <div class="cval">${cur.tempC}°C${fmtDelta(cur.delta?.tempC,'°',false)}</div>
          <div class="clbl">${t('cond_temp')}${cur.delta?`<span style="font-size:.62rem;opacity:.55"> ${t('vs_yesterday')}</span>`:''}</div>
        </div>
        <div class="condition-tile pressure-tile ${ptCtx.cls}">
          <div class="cval pressure-label">${ptCtx.label}${fmtDelta(cur.delta?.pressure,'',false)}</div>
          <div class="pressure-fish-note">${ptCtx.fishNote}</div>
          <div class="clbl">${ptCtx.valNote}</div>
        </div>
        <div class="condition-tile">
          <div class="cval" style="color:${wtColor}">${cur.windMs} m/s${fmtDelta(cur.delta?.windMs,'',true)}</div>
          <div class="clbl">${windDirLabel(cur.windDir)} · Bft ${bf.bf}${cur.delta?`<span style="font-size:.62rem;opacity:.55"> ${t('vs_yesterday')}</span>`:''}</div>
        </div>
        <div class="condition-tile">
          <div class="cval">${cur.gustMs} m/s</div><div class="clbl">${t('cond_gust')}</div>
        </div>
        <div class="condition-tile">
          <div class="cval">${cur.cloud}%</div><div class="clbl">${t('cond_cloud')}</div>
        </div>
        <div class="condition-tile">
          <div class="cval">${cur.precipPct}%</div><div class="clbl">${t('cond_precip')}</div>
        </div>
        ${waveCur?`
        <div class="condition-tile">
          <div class="cval" style="color:${waveColor(waveCur.waveM)}">${waveCur.waveM?.toFixed(2)}m</div>
          <div style="font-size:.7rem;color:${waveColor(waveCur.waveM)};opacity:.8;margin-bottom:2px">${waveLabel(waveCur.waveM)}</div>
          <div class="clbl">${t('cond_wave')}</div>
        </div>
        <div class="condition-tile">
          <div class="cval">${waveCur.wavePeriod?.toFixed(1)}s</div>
          <div class="clbl">${t('cond_period')}</div>
        </div>
        <div class="condition-tile">
          <div class="cval">${waveCur.swellM?.toFixed(2)}m</div>
          <div class="clbl">${t('cond_swell')}</div>
        </div>
        ${waveCur.seaTempC != null ? `
        <div class="condition-tile water-temp-tile">
          <div class="cval" style="color:var(--cyan)">${waveCur.seaTempC.toFixed(1)}°C</div>
          <div class="clbl">${t('water_temp')}</div>
        </div>` : ''}`:''}
        ${tideNow?`
        <div class="condition-tile">
          <div class="cval" style="color:var(--cyan)">${tideNow.value?.toFixed(2)}m</div>
          <div class="clbl">${tideNow.rising?`↑ ${t('tide_rising').replace('🌊 ','')}`:` ↓ ${t('tide_falling').replace('🌊 ','')} `}</div>
        </div>`:''}
      </div>

      <div class="conditions-detail">
        <div><span style="color:var(--muted)">${t('cond_wind_trend')}:</span>
          <span style="color:${wtColor};font-weight:600"> ${wt.label}</span>
        </div>
        <div><span style="color:var(--muted)">${t('cond_beaufort')}:</span>
          <span style="font-weight:600"> Bft ${bf.bf} — ${bf.label}</span>
          <span style="color:var(--muted);font-size:.78rem"> (${bf.sea})</span>
        </div>
        ${fc.tides?`<div><span style="color:var(--muted)">${t('cond_tide_from')}:</span>
          <span style="color:var(--cyan)"> ${escHtml(fc.tides.stationName)} (${fc.tides.distKm} km)</span></div>`:''}
      </div>

      <!-- Shore / Boat / Wader recommendation -->
      <div class="rec-block rec-block-3">
        <div class="rec-card ${recNow.boat.cls}">
          <div class="rec-icon">${recNow.boat.icon}</div>
          <div><div class="rec-title">${t('method_boat')}</div>
          <div class="rec-label">${recNow.boat.label}</div></div>
        </div>
        <div class="rec-card ${recNow.shore.cls}">
          <div class="rec-icon">${recNow.shore.icon}</div>
          <div><div class="rec-title">${t('method_shore')}</div>
          <div class="rec-label">${recNow.shore.label}</div></div>
        </div>
        <div class="rec-card ${recNow.wader.cls}">
          <div class="rec-icon">${recNow.wader.icon}</div>
          <div><div class="rec-title">${t('method_waders')}</div>
          <div class="rec-label">${recNow.wader.label}</div></div>
        </div>
      </div>
      ${recNow.wader.notes?.length ? `
      <div class="wader-notes">
        <div class="wader-notes-title">🦺 Vadefiskeri detaljer</div>
        <div class="wader-detail-row">
          <span class="wader-detail-label">Bund</span>
          <span class="wader-detail-val">${bottomTypeLabel(loc.bottomType||'mixed')}</span>
        </div>
        <div class="wader-detail-row">
          <span class="wader-detail-label">Underdrift</span>
          <span class="wader-detail-val ${recNow.undercurrent==='strong'?'text-danger':recNow.undercurrent==='moderate'?'text-warn':''}">${undercurrentLabel(recNow.undercurrent)}</span>
        </div>
        <div class="wader-detail-row">
          <span class="wader-detail-label">Tidevandsstrøm</span>
          <span class="wader-detail-val ${recNow.tidalCurrent==='strong'?'text-warn':''}">${tidalCurrentLabel(recNow.tidalCurrent)}</span>
        </div>
        ${recNow.wader.notes.map(n=>`<div class="wader-note-item">${n}</div>`).join('')}
      </div>` : ''}

      <!-- Wave 24h sparkline description -->
      ${waveCur?`<div style="margin-top:10px">
        ${renderWaveForecast(fc.marine)}
      </div>`:''}

      <!-- Pressure 48h graph -->
      <div style="margin-top:10px">
        ${renderPressureGraph(fc.hourly)}
      </div>
    </div>`;
  }).join('');
}

function renderWaveForecast(marine) {
  if (!marine) return '';
  const now   = Date.now();
  const hours = marine.filter(m => m.time >= now && m.time <= now + 24*3600000);
  if (!hours.length) return '';
  const max   = Math.max(...hours.map(m=>m.waveM));
  return `<div class="wave-timeline">
    <div class="section-title" style="margin-bottom:6px">Bølger næste 24 timer</div>
    <div class="wave-bars">
      ${hours.filter((_,i)=>i%2===0).map(h=>{
        const hh  = new Date(h.time).getUTCHours();
        const pct = max>0?Math.round((h.waveM/max)*100):0;
        return `<div class="wave-bar-col">
          <div class="wave-bar-fill" style="height:${pct}%;background:${waveColor(h.waveM)}" title="${h.waveM.toFixed(2)}m"></div>
          <div class="wave-bar-lbl">${String(hh).padStart(2,'0')}</div>
        </div>`;
      }).join('')}
    </div>
    <div style="font-size:.75rem;color:var(--muted);margin-top:4px">
      Max bølgehøjde næste 24t:
      <strong style="color:${waveColor(max)}">${max.toFixed(2)} m</strong>
      <span style="color:${waveColor(max)};opacity:.8"> — ${waveLabel(max)}</span>
    </div>
  </div>`;
}

// ── Pressure 48h line graph ───────────────
function renderPressureGraph(hourly) {
  if (!hourly?.length) return '';
  const now   = Date.now();
  const pts   = hourly.filter(h => h.time >= now - 3600000 && h.time <= now + 47*3600000 && h.pressure != null);
  if (pts.length < 4) return '';
  // Sample every 2 hours for readability
  const sampled = pts.filter((_,i) => i % 2 === 0);
  const W = 280, H = 52, PAD = 4;
  const pressures = sampled.map(h => h.pressure);
  const minP = Math.min(...pressures) - 2;
  const maxP = Math.max(...pressures) + 2;
  const range = maxP - minP || 1;
  const xStep = (W - PAD*2) / (sampled.length - 1);
  // Build polyline points
  const points = sampled.map((h,i) => {
    const x = PAD + i * xStep;
    const y = PAD + (1 - (h.pressure - minP) / range) * (H - PAD*2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  // Colour gradient: rising = green, falling = red, stable = cyan
  const first = pressures[0], last = pressures[pressures.length-1];
  const diff  = last - first;
  const lineColor = diff > 1.5 ? '#22c55e' : diff < -1.5 ? '#ef4444' : '#06b6d4';
  // Now marker
  const nowIdx = sampled.findIndex(h => h.time >= now);
  const nowX   = nowIdx >= 0 ? PAD + nowIdx * xStep : null;
  // Label every 6h
  const labels = sampled.filter(h => new Date(h.time).getUTCHours() % 6 === 0);
  return `<div class="pressure-graph">
    <div class="section-title" style="margin-bottom:6px">${t('pressure_graph')}</div>
    <svg width="100%" viewBox="0 0 ${W} ${H+20}" style="overflow:visible;display:block">
      <!-- horizontal grid lines -->
      ${[0,.5,1].map(f=>{
        const gy = PAD + f*(H-PAD*2);
        const gp = (maxP - f*range).toFixed(0);
        return `<line x1="${PAD}" x2="${W-PAD}" y1="${gy}" y2="${gy}" stroke="rgba(255,255,255,.06)" stroke-width="1"/>
        <text x="${W-PAD+2}" y="${gy+3}" font-size="7" fill="var(--muted)" text-anchor="start">${gp}</text>`;
      }).join('')}
      <!-- area fill -->
      <defs>
        <linearGradient id="pgfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="${lineColor}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <polygon points="${points} ${(PAD+(sampled.length-1)*xStep).toFixed(1)},${H-PAD} ${PAD},${H-PAD}"
        fill="url(#pgfill)"/>
      <!-- line -->
      <polyline points="${points}" fill="none" stroke="${lineColor}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
      <!-- now marker -->
      ${nowX!=null?`<line x1="${nowX}" x2="${nowX}" y1="${PAD}" y2="${H-PAD}" stroke="rgba(255,255,255,.25)" stroke-width="1" stroke-dasharray="3,2"/>
        <text x="${nowX}" y="${H+14}" text-anchor="middle" font-size="7.5" fill="var(--muted)">Nu</text>`:''}
      <!-- hour labels -->
      ${sampled.filter((_,i)=>i%(Math.ceil(sampled.length/6))===0).map((h,_,arr)=>{
        const i = sampled.indexOf(h);
        const x = PAD + i * xStep;
        const hh = String(new Date(h.time).getUTCHours()).padStart(2,'0');
        return `<text x="${x}" y="${H+14}" text-anchor="middle" font-size="7.5" fill="var(--muted)">${hh}:00</text>`;
      }).join('')}
    </svg>
    <div style="font-size:.72rem;color:var(--muted);display:flex;justify-content:space-between;margin-top:2px">
      <span style="color:${lineColor}">${diff>1.5?'↑ '+t('press_rising_fast'):diff<-1.5?'↓ '+t('press_falling_fast'):'→ '+t('press_stable')}</span>
      <span>${first.toFixed(0)} → ${last.toFixed(0)} ${t('pressure_hpa')}</span>
    </div>
    <div style="margin-top:8px;font-size:.77rem;padding:7px 10px;border-radius:8px;background:rgba(255,255,255,.05);color:var(--muted);line-height:1.5">${
      diff > 3  ? t('press_fish_rising_fast') :
      diff > 1  ? t('press_fish_rising') :
      diff < -3 ? t('press_fish_falling_fast') :
      diff < -1 ? t('press_fish_falling') :
                  t('press_fish_stable')
    }</div>
  </div>`;
}

// ── Moon card ─────────────────────────────
function renderMoonCard(date) {
  const phase  = Solunar.getMoonPhase(date);
  const { label: rawLabel } = Solunar.moonPhaseLabel(phase);
  const label = translateMoonLabel(rawLabel);
  const lat = state.locations[0]?.lat||56, lon = state.locations[0]?.lon||10;
  const periods  = Solunar.getSolunarPeriods(date, lat, lon);
  const sunTimes = Solunar.getSunTimes(date, lat, lon);
  return `<div style="text-align:center;padding:8px 0">
    <div style="font-size:2.5rem">${label.split(' ')[0]}</div>
    <div style="font-weight:600;margin-top:4px">${label.split(' ').slice(1).join(' ')}</div>
    <div style="font-size:.78rem;color:var(--muted);margin-top:2px">${t('moon_phase_today')} ${Math.round(phase*100)}%</div>
    <div style="margin-top:8px;font-size:.77rem;padding:7px 10px;border-radius:8px;background:rgba(255,255,255,.05);color:var(--muted);line-height:1.5;text-align:left">${(()=>{
      const p = phase;
      if (p < 0.08 || p > 0.92) return t('moon_tip_new');
      if (p > 0.42 && p < 0.58) return t('moon_tip_full');
      if ((p > 0.17 && p < 0.33) || (p > 0.67 && p < 0.83)) return t('moon_tip_quarter');
      return t('moon_tip_gibbous');
    })()}</div>
  </div>
  <div style="margin-top:12px;font-size:.82rem">
    ${sunTimes.sunrise?`<div class="moon-row"><span>🌅 ${t('sunrise')}</span><span>${formatHHMM(sunTimes.sunrise)} UTC</span></div>`:''}
    ${sunTimes.sunset ?`<div class="moon-row"><span>🌇 ${t('sunset')}</span><span>${formatHHMM(sunTimes.sunset)}  UTC</span></div>`:''}
    ${periods.rise ?`<div class="moon-row"><span>🌙 ${t('moonrise')}</span><span>${formatHHMM(periods.rise)} UTC</span></div>`:''}
    ${periods.set  ?`<div class="moon-row"><span>🌙 ${t('moonset')}</span><span>${formatHHMM(periods.set)}  UTC</span></div>`:''}
    ${periods.transit?`<div class="moon-row" style="color:var(--primary)"><span>🌕 ${t('culmination')}</span><span>${formatHHMM(periods.transit)} UTC</span></div>`:''}
  </div>`;
}

// ── Lightning card ────────────────────────
function renderLightningCard() {
  const locs = state.locations;
  if (!locs.length) return `<p style="color:var(--muted);font-size:.85rem">Ingen lokationer.</p>`;
  const anyStrike = locs.some(l=>state.lightning[l.id]?.strikes?.length>0);

  return `${locs.map(loc=>{
    const lgt = state.lightning[loc.id];
    if (!lgt) return `<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:.82rem;color:var(--muted)">
      ${escHtml(loc.name)}: ${t('data_missing')}</div>`;
    const st = lgt.status;
    const icon = st.level==='danger'?'🔴':st.level==='warning'?'🟠':st.level==='caution'?'🟡':'🟢';
    const color = st.level==='danger'?'var(--red)':st.level==='warning'?'var(--orange)':st.level==='caution'?'var(--gold)':'var(--green)';
    const lastChk = lgt.lastCheck ? new Date(lgt.lastCheck).toLocaleTimeString('da-DK',{hour:'2-digit',minute:'2-digit'}) : '–';
    return `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:8px">
        <span>${icon}</span>
        <div style="flex:1">
          <div style="font-size:.84rem;font-weight:600">${escHtml(loc.name)}</div>
          <div style="font-size:.76rem;color:${color}">${st.label||t('no_lightning')}</div>
          ${lgt.strikes?.length?`<div style="font-size:.72rem;color:var(--muted)">${lgt.strikes.length} ${t('lightning_strikes_near')} ${st.closestKm?.toFixed(0)||'?'} km</div>`:''}
        </div>
        <div style="font-size:.7rem;color:var(--muted)">${t('lightning_checked')} ${lastChk}</div>
      </div>
    </div>`;
  }).join('')}
  <button class="btn btn-ghost btn-sm" style="margin-top:10px;width:100%;justify-content:center"
    onclick="refreshLightning()">${t('update_lightning')}</button>
  <p style="font-size:.72rem;color:var(--muted);margin-top:8px;text-align:center">
    ${t('lightning_src')}</p>`;
}

// ── Species info / warning popup ─────────
function renderSpeciesInfoPopup() {
  const sp = SPECIES_PREFS[state.speciesInfoPopup];
  if (!sp) return '';
  const isBanned = !!sp.banned;
  const isVenom  = !!sp.venom;
  const headerCls = isBanned ? 'var(--red)' : isVenom ? 'var(--red)' : 'var(--gold)';
  // Convert \n to <br> for display
  const body = (sp.warningText || '').split('\n').map(l => l ? `<p style="margin:3px 0">${escHtml(l)}</p>` : '<br>').join('');

  return `<div class="modal-overlay" onclick="closeSpeciesInfo(event)">
    <div class="modal" style="max-width:420px" onclick="event.stopPropagation()">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:1.8rem">${sp.emoji}</span>
          <div>
            <div style="font-weight:700;font-size:1rem">${sp.name}</div>
            <div style="font-size:.76rem;color:var(--muted)">${sp.nameEn}</div>
          </div>
        </div>
        <button class="btn-icon" onclick="closeSpeciesInfo()">✕</button>
      </div>
      <div style="background:rgba(0,0,0,.25);border-radius:8px;padding:14px;font-size:.82rem;line-height:1.6;border-left:3px solid ${headerCls}">
        ${body}
      </div>
      <div style="margin-top:14px;display:flex;justify-content:space-between;align-items:center">
        <a href="https://lfst.dk/lyst-og-fritidsfiskeri/mindstemaal-og-fredningstider/" target="_blank"
          style="font-size:.78rem;color:var(--muted)">Verificér på lfst.dk →</a>
        <button class="btn btn-ghost btn-sm" onclick="closeSpeciesInfo()">Luk</button>
      </div>
    </div>
  </div>`;
}

function openScoreInfo() {
  // Grab the top window's breakdown if available
  const windows = getScoredWindows();
  state.scoreBreakdown = windows[0]?.breakdown || null;
  state.scoreBreakdownTitle = windows[0]
    ? `${escHtml(windows[0].location.name)} · ${formatDate(windows[0].date)} · ${windows[0].fromStr}–${windows[0].toStr}`
    : null;
  state.scoreInfoOpen = true;
  render();
}

function showSpeciesInfo(id) { state.speciesInfoPopup = id; render(); }
function closeSpeciesInfo(e) {
  if (!e || e.target.classList.contains('modal-overlay')) {
    state.speciesInfoPopup = null; render();
  }
}

// ── Score info modal ──────────────────────
function renderScoreInfoModal() {
  const sel = state.targetSpecies;
  const factors = [
    { icon:'🌡️', name:'Lufttryk trend',    range:'±25',  desc:'Stigende tryk → fiskene aktiveres og jager aktivt. Faldende tryk → de trækker sig mod bunden. Den vigtigste enkeltfaktor.' },
    { icon:'🌙', name:'Solunare perioder', range:'+30',  desc:'Månens kulminering (overhead/underfoot) giver de største aktivitetsperioder. Major perioder = +30 point, minor (op/ned) = +15.' },
    { icon:'🌅', name:'Tidspunkt på dagen',range:'±20',  desc:'Daggry (±1t solopgang) er bedst (+20). Skumring er næstbedst (+15). Middag giver straf (−10). Nattefiskeri er neutralt.' },
    { icon:'🌊', name:'Tidevand',          range:'+20',  desc:'Kun ved saltvand. Stigende tidevand aktiverer kystfisk markant. Hentes fra DMIs officielle tidevandsdata for nærmeste station.' },
    { icon:'🌊', name:'Bølgehøjde',        range:'±20',  desc:'< 0.3m: ideelt (+5). 0.6–1m: straf (−6). > 1m: stor straf. Arter som Pighvar foretrækker let bølgegang — tilpasses af artsmål.' },
    { icon:'💨', name:'Vind',              range:'±18',  desc:'Svag vind (< 3 m/s) giver +7. Over 8 m/s giver −18. Stigende vind straffes ekstra. Vindretning påvirker også (V/VNV = bedst).' },
    { icon:'☁️', name:'Skydække',          range:'+8',   desc:'Overskyet (> 65%) giver +8 point. Fisk er mere aktive i diffust lys — de er sværere at se og jager mere frit.' },
    { icon:'🌧', name:'Nedbørschance',     range:'−20',  desc:'> 65% nedbørschance tolkes som tordenvejrsrisiko og straffes hårdt (−20). Desuden frarådes fiskeri med kulstofstænger ved lyn.' },
    { icon:'🌕', name:'Månefase',          range:'+15',  desc:'Ny- og fuldmåne giver ekstra aktivitet (+15). Halvmåne giver +5. Beregnes astronomisk for præcis dato og position.' },
    ...(sel.length ? [{ icon:'🎯', name:'Artspræferencer', range:'+25', desc:`Bonus for dine valgte målarter: ${sel.map(id=>SPECIES_PREFS[id]?.name).join(', ')}. Scoren øges når betingelserne matcher artens specifikke præferencer.` }] : []),
    { icon:'📍', name:'Spotrelevans',      range:'+12',  desc:'Bonus hvis fiskepladsen har dine målarter registreret som aktive denne måned (fra fishingindenmark.info). Officielle stedsdata.' },
    { icon:'⚡', name:t('score_lightning_name'), range:'−', desc:t('score_lightning_desc') },
  ];

  return `<div class="modal-overlay" onclick="closeScoreInfo(event)">
    <div class="modal" style="max-width:560px;max-height:85vh;overflow-y:auto" onclick="event.stopPropagation()">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2 style="margin:0">${t('score_modal_title')}</h2>
        <button class="btn-icon" onclick="closeScoreInfo()">✕</button>
      </div>
      <p style="font-size:.85rem;color:var(--muted);margin-bottom:16px">
        Scoren (0–100) samler alle vejr-, astronomiske og stedsspecifikke faktorer til én letlæselig anbefaling.
        <strong style="color:var(--text)"> 80+ = Fremragende · 65–79 = Godt · 45–64 = Middel · under 45 = Dårligt.</strong>
      </p>

      ${state.scoreBreakdown?.length ? `
      <div style="margin-bottom:20px">
        <div style="font-size:.78rem;color:var(--muted);margin-bottom:8px">
          📊 Faktisk pointfordeling for:
          <strong style="color:var(--text)">${state.scoreBreakdownTitle||''}</strong>
        </div>
        <div class="score-breakdown-table">
          ${state.scoreBreakdown.map(b => b.isTotal ? `
            <div class="sbt-row sbt-total">
              <span class="sbt-icon">🏁</span>
              <span class="sbt-factor">Samlet score</span>
              <span class="sbt-bar"></span>
              <span class="sbt-points sbt-total-val">${b.contribution}</span>
            </div>` : `
            <div class="sbt-row">
              <span class="sbt-icon">${b.icon}</span>
              <span class="sbt-factor">${b.factor}</span>
              <span class="sbt-label">${b.label}</span>
              <span class="sbt-points ${b.contribution>0?'sbt-pos':b.contribution<0?'sbt-neg':'sbt-zero'}">
                ${b.contribution>0?'+':''}${b.contribution}
              </span>
            </div>`).join('')}
        </div>
      </div>
      <div class="welcome-divider" style="margin:16px 0 14px"><span>Faktorforklaring</span></div>
      ` : ''}

      <div class="score-factors-list">
        ${factors.map(f => `
          <div class="score-factor-row">
            <div class="sf-icon">${f.icon}</div>
            <div class="sf-body">
              <div class="sf-header">
                <span class="sf-name">${f.name}</span>
                <span class="sf-range">op til ${f.range} point</span>
              </div>
              <div class="sf-desc">${f.desc}</div>
            </div>
          </div>`).join('')}
      </div>

      ${sel.length === 0 ? `<div class="notice" style="margin-top:16px">
        💡 Vælg målarter i opsætningen for endnu mere præcise anbefalinger.
      </div>` : ''}

      <div class="modal-actions">
        <button class="btn btn-primary" onclick="closeScoreInfo()">Forstået</button>
      </div>
    </div>
  </div>`;
}

// ═══════════════════════════════════════════
//  LOCATION SEARCH
// ═══════════════════════════════════════════
let searchTimer = null;
function handleLocationSearch(q) {
  state.locationSearchQuery = q;
  clearTimeout(searchTimer);
  if (!q.trim()) { state.locationSearchResults=[]; render(); return; }
  searchTimer = setTimeout(()=>doLocationSearch(q), 350);
}
async function doLocationSearch(q) {
  try {
    const res  = await fetch(`${GEOCODING}?name=${encodeURIComponent(q)}&count=6&language=da&format=json`);
    const data = await res.json();
    state.locationSearchResults = (data.results||[]).map(r=>({
      name:r.name, admin1:r.admin1||'', lat:r.latitude, lon:r.longitude, country:r.country_code
    }));
  } catch(e) { state.locationSearchResults=[]; }
  render();
}
function addLocationFromResult(r) {
  // Infer water type using smart 4-tier detection
  const nearbySpots = DK_SPOTS.findNearby(r.lat, r.lon, 25);
  const fullName    = r.admin1 ? `${r.name} ${r.admin1}` : r.name;
  const inferredWt  = state.waterType === 'fresh'
    ? 'fresh'                                           // user explicitly wants freshwater
    : smartDetectWaterType(r.lat, r.lon, fullName, nearbySpots);

  state.locations.push({ id:uid(), name:r.admin1?`${r.name}, ${r.admin1}`:r.name,
    lat:r.lat, lon:r.lon, country:r.country||'DK',
    waterType: inferredWt, notes:'' });
  state.locationSearchResults=[]; state.locationSearchQuery='';
  saveState(); render();
}

// ═══════════════════════════════════════════
//  ACTIONS
// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
//  SPOT FINDER ENGINE
// ═══════════════════════════════════════════

/** Score a single spot for a specific species. Returns null if species not present. */
function scoreSpotForSpecies(spot, speciesId, month) {
  const pref = SPECIES_PREFS[speciesId];
  if (!pref) return null;

  // Species must be listed at this spot
  const entry = spot.species?.find(s =>
    s.nameEn?.toLowerCase() === pref.nameEn?.toLowerCase()
  );
  if (!entry) return null;

  let score = 25; // base: species listed here

  // Active this month?
  const active = entry.months.includes(month);
  if (active) {
    score += 20;
    // Mid-season (both prev & next month also active) = solid run
    const prev = month === 1 ? 12 : month - 1;
    const next = month === 12 ? 1 : month + 1;
    if (entry.months.includes(prev) && entry.months.includes(next)) score += 8;
  } else {
    score -= 15; // off-season, still show but ranked lower
  }

  // Habitat preference matches
  if (pref.bottomPref?.includes(spot.bottomType)) score += 8;
  if (pref.depthPref === spot.depth)               score += 5;

  // Water type compatibility
  const wtMatch = pref.waterType.includes(spot.waterType) ||
    (spot.waterType === 'brackish' && (pref.waterType.includes('salt') || pref.waterType.includes('fresh')));
  if (wtMatch)  score += 6;
  else          score -= 12;

  // Spot richness bonus: many active species = well-known productive water
  const richness = spot.species?.filter(s => s.months.includes(month)).length || 0;
  score += Math.min(richness * 2, 8);

  // Real-time bonus: if a saved location is very near and has good forecast data
  const nearSaved = state.locations.find(l =>
    haversine(l.lat, l.lon, spot.lat, spot.lon) < 8
  );
  if (nearSaved && state.forecasts[nearSaved.id]) score += 5;

  return clamp(Math.round(score), 0, 100);
}

/** General score when no species is selected */
function scoreSpotGeneral(spot, month) {
  const active = spot.species?.filter(s => s.months.includes(month)).length || 0;
  return clamp(20 + active * 5, 0, 100);
}

/** Find best spots for a species across all of Denmark, region-diversified */
function runLuckySearch() {
  const sf = state.spotFinder;
  const searchDate = sf.sfDate ? new Date(sf.sfDate) : new Date();
  const month = searchDate.getMonth() + 1;
  // Use state.targetSpecies (primary system) — fall back to all species if none set
  const speciesIds = state.targetSpecies.length ? state.targetSpecies : null;

  const candidates = DK_SPOTS
    .filter(s => typeof s === 'object' && s.lat)
    .map(spot => {
      let score = null;
      if (speciesIds) {
        // Score for each target species, take the best match
        const scores = speciesIds.map(id => scoreSpotForSpecies(spot, id, month)).filter(s => s !== null);
        score = scores.length ? Math.max(...scores) : null;
      } else {
        score = scoreSpotGeneral(spot, month);
      }
      return score !== null ? { spot, score } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  // Region-diversify: at most 2 spots per region
  const regionCount = {};
  const results = [];
  for (const c of candidates) {
    const r = c.spot.region;
    regionCount[r] = (regionCount[r] || 0) + 1;
    if (regionCount[r] <= 2) results.push(c);
    if (results.length >= 6) break;
  }

  sf.results = results;
  render();
}

/** Find best spots within radius km of lat/lon, optionally filtered by species */
function runNearbySearch() {
  const sf = state.spotFinder;
  if (!sf.nearbyLat) return;
  sf.searching = true;
  render();

  const searchDate = sf.sfDate ? new Date(sf.sfDate) : new Date();
  const month      = searchDate.getMonth() + 1;
  const nearby  = DK_SPOTS.findNearby(sf.nearbyLat, sf.nearbyLon, sf.nearbyRadius);

  const speciesIds = state.targetSpecies.length ? state.targetSpecies : null;
  sf.results = nearby
    .map(spot => {
      let score = null;
      if (speciesIds) {
        const scores = speciesIds.map(id => scoreSpotForSpecies(spot, id, month)).filter(s => s !== null);
        score = scores.length ? Math.max(...scores) : scoreSpotGeneral(spot, month);
      } else {
        score = scoreSpotGeneral(spot, month);
      }
      return score !== null && score > 0 ? { spot, score } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);

  sf.searching = false;
  render();
}

let sfSearchTimer = null;
async function handleSFGeoSearch(query) {
  state.spotFinder.nearbyQuery = query;
  state.spotFinder.nearbyGeoResults = [];
  if (!query.trim()) { render(); return; }
  clearTimeout(sfSearchTimer);
  sfSearchTimer = setTimeout(async () => {
    try {
      const res  = await fetch(`${GEOCODING}?name=${encodeURIComponent(query)}&count=5&language=da&format=json`);
      const data = await res.json();
      state.spotFinder.nearbyGeoResults = (data.results || []).slice(0, 4).map(r => ({
        name: r.admin1 ? `${r.name}, ${r.admin1}` : r.name,
        lat: r.latitude, lon: r.longitude,
      }));
    } catch(e) {}
    render();
  }, 350);
}

function selectSFLocation(r) {
  state.spotFinder.nearbyLat   = r.lat;
  state.spotFinder.nearbyLon   = r.lon;
  state.spotFinder.nearbyQuery = r.name;
  state.spotFinder.nearbyGeoResults = [];
  render();
}

/** Full-screen Spot Finder wizard (used when accessed from welcome shortcuts) */
function renderSpotFinderWizard() {
  const sf      = state.spotFinder;
  const isLucky = sf.mode === 'lucky';
  const rec     = state.availability.recurring;

  // ── STEP 1: Tilgængelighed — shared with setup wizard ────
  if (sf.sfStep === 'time') {
    return shell(`<div class="wizard">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div class="sf-mode-badge ${isLucky?'lucky':'nearby'}">${isLucky?t('sf_lucky_badge'):t('sf_nearby_badge')}</div>
        <button class="btn-icon" onclick="navigate('welcome')" title="${t('back')}">✕</button>
      </div>
      <div class="wizard-header" style="margin-top:8px">
        <h1 style="font-size:1.5rem">${t('avail_title')}</h1>
        <p>${t('avail_sub')}</p>
      </div>

      ${rec.map((a,i)=>renderAvailBlock(a,i)).join('')}

      <button class="btn btn-ghost" onclick="addAvail()" style="width:100%;justify-content:center;margin-bottom:12px">
        ${t('avail_add')}</button>
      ${!rec.length?`<div class="notice">${t('avail_notice')}</div>`:''}

      <button class="btn btn-primary" style="width:100%;justify-content:center;padding:14px;font-size:1rem;margin-top:12px"
        onclick="state.spotFinder.sfStep='search';saveState();render();window.scrollTo(0,0)"
        ${!rec.length?'disabled':''}>
        ${isLucky?t('next_choose_art'):t('next_choose_start')}
      </button>
    </div>`);
  }

  // ── STEP: Search (species or location) ───────────────────
  // Summarise the saved availability windows
  const methodIcons = { shore:'🎣', waders:'🦺', boat:'🚢' };
  const availSummary = rec.length
    ? rec.map(a => {
        const ms = a.methods || [a.method || 'shore'];
        return `${ms.map(m=>methodIcons[m]).join('')} ${a.days.map(d=>t('day'+d)).join('/')} ${a.from}–${a.to}`;
      }).join(' · ')
    : t('sf_no_windows');

  // ── STEP: Results ────────────────────────────────────────
  if (sf.sfStep === 'results') {
    const month = new Date().getMonth() + 1;
    const title = isLucky
      ? `🏆 Bedste hotspots${state.targetSpecies.length ? ' for ' + state.targetSpecies.map(id=>SPECIES_PREFS[id]?.name).join(' + ') : ''}`
      : `📍 ${t('sf_results_nearby')} ${sf.nearbyRadius} km`;

    return shell(`<div class="wizard">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div class="sf-mode-badge ${isLucky?'lucky':'nearby'}">${isLucky?t('sf_lucky_badge'):t('sf_nearby_badge')}</div>
        <button class="btn-icon" onclick="navigate('welcome')" title="${t('back')}">✕</button>
      </div>

      ${sf.results.length ? `
        <p class="section-title" style="margin-bottom:12px">${title} <span style="font-weight:400">(${sf.results.length})</span></p>
        ${sf.results.map((r,i) => renderSpotResultCard(r, i, month)).join('')}
      ` : `
        <div class="empty-state">
          <div class="icon">🔍</div>
          <p>${t('sf_no_results')}</p>
        </div>
      `}

      <div style="display:flex;gap:10px;margin-top:20px">
        <button class="btn btn-ghost" onclick="state.spotFinder.sfStep='search';render();window.scrollTo(0,0)">${t('back')}</button>
        <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="state.step='dashboard';state.activeTab='windows';render()">
          ${t('sf_goto_dash')}
        </button>
      </div>
      <p style="font-size:.74rem;color:var(--muted);margin-top:10px;text-align:center">
        Klik + Tilføj på et spot for at tilføje det til dine fiskepladser
      </p>
    </div>`);
  }

  if (isLucky) {
    // Held og lykke — delegate to the shared species step
    return renderSpeciesStep('lucky');
  } else {
    // Find i nærheden — location + radius
    return shell(`<div class="wizard" style="max-width:600px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <div class="sf-mode-badge nearby">${t('sf_nearby_badge')}</div>
        <button class="btn-icon" onclick="navigate('welcome')" title="${t('back')}">✕</button>
      </div>
      <div class="wizard-header" style="margin-top:8px">
        <h1 style="font-size:1.5rem">${t('sf_from_where')}</h1>
        <p>⏱ ${escHtml(availSummary)}
          <button class="btn-ghost btn-sm" onclick="state.spotFinder.sfStep='time';render();window.scrollTo(0,0)" style="margin-left:8px;padding:2px 8px;font-size:.72rem">${t('edit_time')}</button>
        </p>
      </div>

      <div class="form-group">
        <label>Startsted</label>
        <div class="location-search">
          <input type="text" id="sf-geo-input" placeholder="Søg by eller sted…"
            value="${escHtml(sf.nearbyQuery)}" oninput="handleSFGeoSearch(this.value)" autocomplete="off"/>
          ${sf.nearbyGeoResults.length?`<div class="search-results">
            ${sf.nearbyGeoResults.map(r=>`<div class="search-result-item" onclick="selectSFLocation(${escJson(r)})">
              <span>📍</span><div>${escHtml(r.name)}</div></div>`).join('')}
          </div>`:''}
        </div>
        ${sf.nearbyLat?`<p style="font-size:.76rem;color:var(--green);margin-top:4px">✓ ${escHtml(sf.nearbyQuery)}</p>`:''}
        ${state.locations.length?`
        <div style="margin-top:10px">
          <div style="font-size:.74rem;color:var(--muted);margin-bottom:6px">— eller vælg fra dine pladser —</div>
          <div class="sf-loc-list">
            ${state.locations.slice(0,5).map(loc=>`
              <div class="sf-loc-item ${sf.nearbyLat===loc.lat&&sf.nearbyLon===loc.lon?'selected':''}"
                onclick="state.spotFinder.nearbyLat=${loc.lat};state.spotFinder.nearbyLon=${loc.lon};state.spotFinder.nearbyQuery='${escHtml(loc.name)}';render()">
                <span>${loc.isCustom?'📌':'📍'}</span>
                <div style="flex:1">
                  <div style="font-weight:600;font-size:.85rem">${escHtml(loc.name)}</div>
                  <div style="font-size:.73rem;color:var(--muted)">${waterTypeLabel(loc.waterType)}</div>
                </div>
                ${sf.nearbyLat===loc.lat&&sf.nearbyLon===loc.lon?'<span style="color:var(--green)">✓</span>':''}
              </div>`).join('')}
          </div>
        </div>`:''}
      </div>

      <div class="form-group">
        <label>${t('sf_radius')}: <strong>${sf.nearbyRadius} km</strong></label>
        <input type="range" min="10" max="120" step="5" value="${sf.nearbyRadius}"
          oninput="state.spotFinder.nearbyRadius=+this.value;render()"
          style="width:100%;accent-color:var(--primary)"/>
        <div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--muted);margin-top:2px">
          <span>10 km</span><span>120 km</span>
        </div>
      </div>

      <button class="btn btn-primary" style="width:100%;justify-content:center;padding:14px;font-size:1rem"
        onclick="runNearbySearch();state.spotFinder.sfStep='results';render();window.scrollTo(0,0)"
        ${!sf.nearbyLat?'disabled':''}>
        ${sf.searching?`<span class="spinner"></span> ${t('sf_searching')}`:t('sf_search_btn')}
      </button>
    </div>`);
  }
}

/** Render the Spot Finder tab content */
function renderSpotFinderTab() {
  const sf    = state.spotFinder;
  const month = new Date().getMonth() + 1;

  // Species picker — single select, includes all from SPECIES_PREFS
  const speciesOptions = Object.values(SPECIES_PREFS).filter(sp =>
    speciesMatchesWaterType(sp, state.waterType || 'both')
  );

  // ── Time step helper ──────────────────────────────────────
  const today    = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate()+1);
  const dayAfter = new Date(today); dayAfter.setDate(today.getDate()+2);

  // Find this/next Saturday and Sunday
  const getNext = (dow) => {
    const d = new Date(today);
    const diff = (dow - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return d;
  };
  const nextSat = getNext(6);
  const nextSun = getNext(0);

  const fmtDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const fmtShort = d => `${t('day'+d.getDay())} ${d.getDate()}. ${t('month'+d.getMonth())}`;

  const quickDates = [
    { label:'I dag',     date: fmtDate(today),    short: fmtShort(today) },
    { label:'I morgen',  date: fmtDate(tomorrow), short: fmtShort(tomorrow) },
    { label: fmtShort(nextSat), date: fmtDate(nextSat), short: fmtShort(nextSat) },
    { label: fmtShort(nextSun), date: fmtDate(nextSun), short: fmtShort(nextSun) },
  ];

  const TIME_PRESETS = [
    { label:'🌅 Tidlig morgen', from:'05:00', to:'09:00' },
    { label:'🌤 Formiddag',     from:'09:00', to:'13:00' },
    { label:'☀️ Eftermiddag',   from:'13:00', to:'18:00' },
    { label:'🌇 Aften',         from:'17:00', to:'22:00' },
  ];

  const timeIsSet = !!sf.sfDate;
  const selectedDateLabel = sf.sfDate
    ? (quickDates.find(q=>q.date===sf.sfDate)?.label || sf.sfDate)
    : null;

  return `
  <div class="spot-finder">

    <!-- Mode toggle -->
    <div class="sf-mode-toggle">
      <button class="sf-mode-btn ${sf.mode==='lucky'?'active':''}"
        onclick="if(state.spotFinder.mode!=='lucky'){state.spotFinder.mode='lucky';state.spotFinder.results=[];state.spotFinder.sfStep='time';render()}">
        🎲 Held og lykke
        <span class="sf-mode-sub">Bedste hotspot i Danmark</span>
      </button>
      <button class="sf-mode-btn ${sf.mode==='nearby'?'active':''}"
        onclick="if(state.spotFinder.mode!=='nearby'){state.spotFinder.mode='nearby';state.spotFinder.results=[];state.spotFinder.sfStep='time';render()}">
        📍 Find i nærheden
        <span class="sf-mode-sub">Søg fra et bestemt sted</span>
      </button>
    </div>

    <!-- ── Time selection step ─────────────────────── -->
    <div class="sf-time-section ${sf.sfStep==='time'?'':'sf-time-collapsed'}">
      <div class="sf-time-header" onclick="state.spotFinder.sfStep=state.spotFinder.sfStep==='time'?'search':'time';render()">
        <div>
          <div class="sf-time-title">🗓 Hvornår vil du ud og fiske?</div>
          ${timeIsSet ? `<div class="sf-time-chosen">${selectedDateLabel} · ${sf.sfFrom}–${sf.sfTo}</div>` : ''}
        </div>
        <span style="color:var(--muted)">${sf.sfStep==='time'?'▲':'▼'}</span>
      </div>

      ${sf.sfStep === 'time' ? `
      <div class="sf-time-body">
        <!-- Quick date buttons -->
        <p class="section-title" style="margin-bottom:8px">Dato</p>
        <div class="sf-date-btns">
          ${quickDates.map(q=>`
            <button class="sf-date-btn ${sf.sfDate===q.date?'active':''}"
              onclick="state.spotFinder.sfDate='${q.date}';render()">
              <span class="sf-date-main">${q.label}</span>
              <span class="sf-date-sub">${q.short !== q.label ? q.short : ''}</span>
            </button>`).join('')}
          <input type="date" class="sf-date-custom"
            value="${sf.sfDate||''}"
            min="${fmtDate(today)}"
            onchange="state.spotFinder.sfDate=this.value;render()"
            title="Vælg dato" />
        </div>

        <!-- Time presets -->
        <p class="section-title" style="margin:12px 0 8px">Tidspunkt</p>
        <div class="sf-time-presets">
          ${TIME_PRESETS.map(p=>`
            <button class="sf-time-preset ${sf.sfFrom===p.from&&sf.sfTo===p.to?'active':''}"
              onclick="state.spotFinder.sfFrom='${p.from}';state.spotFinder.sfTo='${p.to}';render()">
              ${p.label}
            </button>`).join('')}
        </div>
        <div class="sf-time-custom">
          <label>Fra</label>
          <input type="time" value="${sf.sfFrom}" onchange="state.spotFinder.sfFrom=this.value;render()" style="width:auto"/>
          <label>Til</label>
          <input type="time" value="${sf.sfTo}"   onchange="state.spotFinder.sfTo=this.value;render()"   style="width:auto"/>
        </div>

        <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:14px"
          onclick="state.spotFinder.sfStep='search';render()" ${!sf.sfDate?'disabled':''}>
          ${sf.mode==='lucky'?'Næste: Vælg art →':'Næste: Vælg startsted →'}
        </button>
      </div>` : ''}
    </div>

    <!-- ── Search step (hidden until time is set) ──── -->
    ${sf.sfStep !== 'time' ? `

    <!-- Species: inline picker, no navigation away -->
    <div class="sf-species-summary">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="font-size:.82rem;color:var(--muted)">🎯 Målarter:</span>
          ${state.targetSpecies.length
            ? state.targetSpecies.map(id => {
                const sp = SPECIES_PREFS[id];
                return sp ? `<span class="spot-species-pill" style="cursor:pointer" onclick="toggleTargetSpecies('${id}')" title="Klik for at fjerne">${sp.emoji} ${sp.name} ✕</span>` : '';
              }).join('')
            : `<span style="font-size:.78rem;color:var(--muted)">Ingen valgt — søger alle arter</span>`}
        </div>
        <button class="btn btn-ghost btn-sm" onclick="state.spotFinder.showSpeciesPicker=!state.spotFinder.showSpeciesPicker;render()" style="padding:3px 10px;font-size:.74rem">
          ${state.spotFinder.showSpeciesPicker ? 'Luk ▲' : '+ Tilpas ▼'}
        </button>
      </div>

      ${state.spotFinder.showSpeciesPicker ? `
      <div class="sf-species-grid sf-species-compact" style="margin-top:10px">
        ${speciesOptions.map(sp => {
          const isBanned   = !!sp.banned;
          const isSelected = state.targetSpecies.includes(sp.id);
          const hasWarning = !!(sp.restricted || sp.venom || sp.banned);
          const cardCls    = ['sf-species-card', isSelected&&!isBanned?'selected':'', isBanned?'species-banned':sp.restricted?'restricted-border':''].filter(Boolean).join(' ');
          const onclick    = isBanned ? `showSpeciesInfo('${sp.id}')` : `toggleTargetSpecies('${sp.id}')`;
          return `<div class="${cardCls}" onclick="${onclick}">
            <span class="sf-sp-emoji" style="${isBanned?'opacity:.4;filter:grayscale(1)':''}">${sp.emoji}</span>
            <span class="sf-sp-name" style="${isBanned?'text-decoration:line-through;opacity:.45':''}">${sp.name}</span>
            ${hasWarning?`<span class="sf-sp-warn" onclick="event.stopPropagation();showSpeciesInfo('${sp.id}')">${isBanned?'⛔':'⚠️'}</span>`:''}
          </div>`;
        }).join('')}
      </div>` : ''}
    </div>

    <!-- Lucky mode -->
    ${sf.mode === 'lucky' ? `
    <div class="sf-section" style="margin-top:14px">
      <button class="btn btn-primary" style="width:100%;justify-content:center"
        onclick="runLuckySearch()">
        🎲 Find bedste hotspot i Danmark
      </button>
    </div>` : ''}

    <!-- Nearby mode -->
    ${sf.mode === 'nearby' ? `
    <div class="sf-section" style="margin-top:14px">

      <!-- Start location: use saved locations -->
      <div class="form-group">
        <label>Startsted — vælg fra dine lokationer</label>
        <!-- Inline quick-search for new users or one-off starting points -->
        <div class="location-search" style="margin-bottom:8px">
          <input type="text" id="sf-geo-input" placeholder="Søg by eller sted som startpunkt…"
            value="${escHtml(sf.nearbyQuery)}"
            oninput="handleSFGeoSearch(this.value)" autocomplete="off"/>
          ${sf.nearbyGeoResults.length ? `
          <div class="search-results">
            ${sf.nearbyGeoResults.map(r => `
              <div class="search-result-item" onclick="selectSFLocation(${escJson(r)})">
                <span>📍</span><div>${escHtml(r.name)}</div>
              </div>`).join('')}
          </div>` : ''}
        </div>
        ${sf.nearbyLat ? `<p style="font-size:.76rem;color:var(--green);margin:-4px 0 8px">✓ ${escHtml(sf.nearbyQuery)}</p>` : ''}

        ${state.locations.length ? `
        <div style="font-size:.76rem;color:var(--muted);margin-bottom:6px">— eller vælg fra dine fiskepladser —</div>
        <div class="sf-loc-list">
          ${state.locations.map(loc => `
            <div class="sf-loc-item ${sf.nearbyLat===loc.lat&&sf.nearbyLon===loc.lon?'selected':''}"
              onclick="state.spotFinder.nearbyLat=${loc.lat};state.spotFinder.nearbyLon=${loc.lon};state.spotFinder.nearbyQuery='${escHtml(loc.name)}';render()">
              <span>${loc.isCustom?'📌':'📍'}</span>
              <div style="flex:1">
                <div style="font-weight:600;font-size:.85rem">${escHtml(loc.name)}</div>
                <div style="font-size:.73rem;color:var(--muted)">${waterTypeLabel(loc.waterType)}</div>
              </div>
              ${sf.nearbyLat===loc.lat&&sf.nearbyLon===loc.lon?'<span style="color:var(--green)">✓</span>':''}
            </div>`).join('')}
        </div>` : ''}
        <button class="btn btn-ghost btn-sm" style="margin-top:8px;width:100%;justify-content:center"
          onclick="navigate('locations')">🗺 Administrer mine fiskepladser</button>
      </div>

      <div class="form-group">
        <label>Maksimal afstand: <strong>${sf.nearbyRadius} km</strong></label>
        <input type="range" min="10" max="120" step="5" value="${sf.nearbyRadius}"
          oninput="state.spotFinder.nearbyRadius=+this.value;render()"
          style="width:100%;accent-color:var(--primary)"/>
        <div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--muted);margin-top:2px">
          <span>10 km</span><span>120 km</span>
        </div>
      </div>

      <button class="btn btn-primary" style="width:100%;justify-content:center"
        onclick="runNearbySearch()" ${!sf.nearbyLat?'disabled':''}>
        ${sf.searching?'<span class="spinner"></span> Søger…':'📍 Find fiskepladser i nærheden'}
      </button>
    </div>` : ''}

    <!-- Results -->
    ${sf.results.length ? `
    <div class="sf-results">
      <p class="section-title" style="margin:16px 0 10px">
        ${sf.mode==='lucky'
          ? `🏆 Bedste hotspots for ${SPECIES_PREFS[sf.speciesId]?.name||''}`
          : `📍 ${t('sf_results_nearby')} ${sf.nearbyRadius} km`}
        <span style="font-weight:400">(${sf.results.length} fundet)</span>
        ${sf.sfDate ? `<span style="font-weight:400;color:var(--muted)"> · 🗓 ${sf.sfDate} ${sf.sfFrom}–${sf.sfTo}</span>` : ''}
      </p>
      ${sf.results.map((r, i) => renderSpotResultCard(r, i, month)).join('')}
      <p style="font-size:.74rem;color:var(--muted);margin-top:10px;text-align:center">
        Data: <a href="https://fishingindenmark.info" target="_blank" style="color:var(--muted)">fishingindenmark.info</a>
        · ${DK_SPOTS.filter(s=>typeof s==='object'&&s.lat).length} ${t('loc_db_count')}
      </p>
    </div>`
    : sf.searching ? ''
    : (sf.speciesId !== null || sf.nearbyLat !== null) && sf.results.length === 0 && !sf.searching ? `
    <div class="empty-state" style="margin-top:16px">
      <div class="icon">🔍</div>
      <p>${t('sf_no_spots_found')}${sf.speciesId ? ` med <strong>${SPECIES_PREFS[sf.speciesId]?.name}</strong>` : ''} ${t('sf_no_spots_db')}${sf.mode==='nearby'?' '+t('sf_no_spots_radius')+' '+sf.nearbyRadius+' km':''}.
      </p>
      <p style="margin-top:8px;font-size:.78rem">${t('sf_try_broader')}</p>
    </div>` : ''}

    ` /* end sfStep !== 'time' wrapper */ : ''}

  </div>`;
}

function renderSpotResultCard(result, index, month) {
  const { spot, score } = result;
  const activeSpecies = spot.species?.filter(s => s.months.includes(month)) || [];
  const alreadyAdded  = state.locations.some(l =>
    l.spotSlug === spot.slug || haversine(l.lat, l.lon, spot.lat, spot.lon) < 0.5
  );
  const medals = ['🥇','🥈','🥉'];
  const medal  = medals[index] || `${index+1}.`;

  return `<div class="sf-result-card">
    <div class="sf-result-rank">${medal}</div>
    <div class="sf-result-body">
      <div class="sf-result-name">
        <span class="loc-name-link" onclick="focusOnMapByCoords(${spot.lat},${spot.lon},'${escHtml(spot.name)}')">${escHtml(spot.name)}</span>
        ${spot.distKm != null ? `<span class="sf-dist">${spot.distKm} km</span>` : ''}
      </div>
      <div class="sf-result-meta">${escHtml(spot.region)} · ${spotTypeIcon(spot.spotType)} ${spot.spotType} · ${waterTypeBadge(spot.waterType)}</div>
      ${spot.facilities?.parking||spot.facilities?.boatRamp||spot.facilities?.wheelchair ? `
      <div class="sf-result-fac">
        ${spot.facilities.parking    ? '🅿️' : ''}
        ${spot.facilities.boatRamp   ? '⛵' : ''}
        ${spot.facilities.wheelchair ? '♿' : ''}
      </div>` : ''}
      <div class="sf-result-species">
        ${activeSpecies.slice(0,5).map(s=>`<span class="spot-species-pill">${s.name}</span>`).join('')}
        ${activeSpecies.length===0 ? `<span style="font-size:.72rem;color:var(--muted)">${t('loc_in_season')}</span>` : ''}
      </div>
    </div>
    <div class="sf-result-right">
      <div class="${scoreColor(score)} score-badge" style="width:48px;height:48px;font-size:1.1rem" title="${t('sf_score_hint')}">${score}</div>
      <div style="display:flex;gap:5px;margin-top:6px">
        ${alreadyAdded
          ? `<span class="tag tag-green" style="font-size:.7rem">${t('added')}</span>`
          : `<button class="btn btn-primary btn-sm" onclick="addSpot(${escJson(spot)})">${t('add')}</button>`}
      </div>
    </div>
  </div>`;
}

/** Focus map on arbitrary coordinates (for spot finder results) */
function focusOnMapByCoords(lat, lon, name) {
  // If no matching saved location, create a temporary focus
  state.locationView  = 'map';
  if (state.step !== 'locations') navigate('locations');
  else render();
  requestAnimationFrame(() => {
    if (fishMap) fishMap.flyTo([lat, lon], 13, { duration: 1.0 });
  });
}

// ── Spot helpers ──────────────────────────
// Pressure context — turns raw hPa + trend into plain-language fishing guidance
function pressureContext(pressureHpa, trend) {
  const val = parseFloat(pressureHpa) || 1013;
  if (trend.dir === 'rising' && trend.delta > 3) {
    return { label:'Stigende hurtigt ↑↑', fishNote:'Fiskene aktiveres — god tid at fiske!', cls:'text-green', valNote: val.toFixed(0) + ' hPa' };
  }
  if (trend.dir === 'rising') {
    return { label:'Svagt stigende ↑',    fishNote:'God fiskeaktivitet forventes',           cls:'text-green', valNote: val.toFixed(0) + ' hPa' };
  }
  if (trend.dir === 'stable' && val >= 1015) {
    return { label:'Stabilt højt →',      fishNote:'Stabilt fiskeri — acceptabelt',          cls:'text-cyan',  valNote: val.toFixed(0) + ' hPa' };
  }
  if (trend.dir === 'stable') {
    return { label:'Stabilt →',           fishNote:'Neutralt for fiskeaktivitet',            cls:'text-muted', valNote: val.toFixed(0) + ' hPa' };
  }
  if (trend.delta < -3) {
    return { label:'Faldende hurtigt ↓↓', fishNote:'Fiskene trækker sig — dårlige betingelser', cls:'text-danger', valNote: val.toFixed(0) + ' hPa' };
  }
  return   { label:'Svagt faldende ↓',   fishNote:'Fiskeaktivitet faldende',                cls:'text-warn',  valNote: val.toFixed(0) + ' hPa' };
}

// Wave height colour + label — consistent thresholds used everywhere
function waveColor(m) {
  if (m < 0.3)  return 'var(--green)';
  if (m < 0.6)  return 'var(--cyan)';
  if (m < 1.0)  return 'var(--gold)';
  if (m < 1.5)  return 'var(--orange)';
  return               'var(--red)';
}
function waveLabel(m) {
  if (m < 0.3)  return 'Blik — ideelt for alt';
  if (m < 0.6)  return 'Let krusede — godt';
  if (m < 1.0)  return 'Moderate bølger — forsigtighed';
  if (m < 1.5)  return 'Høj sø — kun kystfiskeri';
  if (m < 2.5)  return 'Farlig søgang — bliv i land';
  return               'Meget høj sø — farligt';
}

function bottomTypeLabel(b) {
  return { sand:'Sand 🏖️', stone:'Sten 🪨', mixed:'Blandet 🌊', mud:'Mudder ⚠️', seaweed:'Tang 🌿' }[b] || b;
}
function undercurrentLabel(u) {
  return { negligible:'Ubetydelig ✅', low:'Lav ✅', moderate:'Moderat ⚠️', strong:'Kraftig 🚫' }[u] || u;
}
function tidalCurrentLabel(t) {
  return { low:'Svag ✅', moderate:'Moderat ⚠️', strong:'Stærk ⚠️' }[t] || t;
}

function spotTypeIcon(t) {
  return t==='pier'?'🪝':t==='mole'?'⚓':t==='coast'?'🌊':t==='river'?'🌿':t==='lake'?'💧':'📍';
}
function waterTypeBadge(w) {
  return w==='fresh'?t('wt_fresh_label'):w==='salt'?t('wt_salt_label'):t('wt_brackish_label');
}

function addSpot(spot) {
  // Don't add duplicates
  if (state.locations.some(l => l.spotSlug === spot.slug)) return;
  state.locations.push({
    id:         uid(),
    name:       spot.name,
    lat:        spot.lat,
    lon:        spot.lon,
    waterType:  spot.waterType,   // preserve exact type including 'brackish'
    spotSlug:   spot.slug,
    notes:      spot.description || '',
    facilities: spot.facilities || {},
    species:    spot.species || [],
    bottomType: spot.bottomType || 'mixed',
    brackishNote: spot.brackishNote || null,
  });
  state.locationSearchResults = [];
  state.locationSearchQuery   = '';
  saveState();
  render();
}

// ── Share a window ────────────────────────────────────────────
function shareWindow(w) {
  const payload = {
    n:   w.location.name,
    lat: w.location.lat,
    lon: w.location.lon,
    wt:  w.location.waterType || 'brackish',
    d:   w.date.toISOString().slice(0,10),
    f:   w.from,
    t:   w.to,
    s:   w.score,
  };
  const hash = '#share=' + btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
  const url  = window.location.origin + window.location.pathname + hash;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      const btn = document.querySelector('.share-btn');
      if (btn) {
        const orig = btn.textContent;
        btn.textContent = t('share_copied');
        setTimeout(() => { if(btn) btn.textContent = orig; }, 2000);
      }
    });
  } else {
    prompt(t('share_btn'), url);
  }
}

function parseSharedWindow() {
  try {
    const hash = window.location.hash;
    if (!hash.startsWith('#share=')) return null;
    const raw = decodeURIComponent(escape(atob(hash.slice(7))));
    return JSON.parse(raw);
  } catch(e) { return null; }
}

// ── Quick weather-data reset ──────────────────────────────────
function clearWeatherData() {
  if (!confirm(t('reset_data_confirm'))) return;
  state.forecasts   = {};
  state.lightning   = {};
  state.fetchStatus = {};
  saveState();
  render();
}

// ── Fishing window notifications ──────────────────────────────
async function enableNotifications() {
  if (!('Notification' in window)) { alert(t('notif_denied')); return; }
  const perm = await Notification.requestPermission();
  if (perm === 'granted') {
    state.notifsEnabled = true;
    scheduleWindowNotifications();
    saveState();
    render();
  } else {
    alert(t('notif_denied'));
  }
}

function scheduleWindowNotifications() {
  if (Notification.permission !== 'granted') return;
  const windows = getScoredWindows();
  const now     = Date.now();
  let count = 0;
  for (const w of windows) {
    if (count >= 3) break;
    const winMs = Date.UTC(w.date.getUTCFullYear(), w.date.getUTCMonth(), w.date.getUTCDate(), parseInt(w.from));
    const delay = winMs - now - 30 * 60000; // fire 30 min before window
    if (delay <= 0 || delay > 24 * 3600000) continue;
    if (w.score < 55) continue;
    count++;
    setTimeout(() => {
      new Notification(t('notif_title'), {
        body: `${w.location.name} · ${w.fromStr}–${w.toStr} · ${scoreLabel(w.score)} (${w.score})`,
        icon: '/fishcast/icons/icon.svg',
        badge: '/fishcast/icons/icon.svg',
        tag: 'fishcast-window-' + w.date.toISOString().slice(0,10) + '-' + w.from,
      });
    }, delay);
  }
  return count;
}

function clearPersonalChoices() {
  // Full session reset — clears everything and returns to Welcome
  state.locations               = [];
  state.availability.recurring  = [];
  state.availability.specific   = [];
  state.targetSpecies           = [];
  state.forecasts               = {};
  state.lightning               = {};
  state.waterType               = null;
  state.region                  = null;
  state.activeTab               = 'windows';
  state.editingWaterTypeId      = null;
  state.editingLocationId       = null;
  state.spotFinder              = { mode:'lucky', sfStep:'time', sfDate:null, sfFrom:'06:00', sfTo:'12:00', speciesId:null, nearbyQuery:'', nearbyGeoResults:[], nearbyLat:null, nearbyLon:null, nearbyRadius:40, results:[], searching:false, showSpeciesPicker:false };
  state.step                    = 'welcome';
  saveState();
  render();
}

function goToSpotFinder(mode) {
  state.spotFinder.mode    = mode;
  state.spotFinder.results = [];
  state.spotFinder.sfStep  = 'time';
  state.spotFinder.sfDate  = null;
  state.step = 'spotfinder';
  render();
  window.scrollTo(0, 0);
  if (state.locations.length) fetchAllForecasts();
}

function toggleTargetSpecies(id) {
  const idx = state.targetSpecies.indexOf(id);
  if (idx >= 0) state.targetSpecies.splice(idx, 1);
  else           state.targetSpecies.push(id);
  saveState(); render();
}
// openScoreInfo defined above
function closeScoreInfo(e) {
  if (!e || e.target.classList.contains('modal-overlay')) { state.scoreInfoOpen = false; render(); }
}

function navigate(step) { state.step=step; render(); window.scrollTo(0,0); }
function selectWaterType(t) { state.waterType=t; saveState(); render(); }
function removeLocation(id) { state.locations=state.locations.filter(l=>l.id!==id); saveState(); render(); }
function setLocWaterType(id,wt) { const l=state.locations.find(l=>l.id===id); if(l){l.waterType=wt;saveState();} }
function toggleFav(id) {
  if (state.favLocations.includes(id)) state.favLocations = state.favLocations.filter(x=>x!==id);
  else state.favLocations = [...state.favLocations, id];
  saveState(); render();
}
function saveLocNote(id, text) {
  state.locNotes = { ...state.locNotes, [id]: text };
  saveState();
  // Show a brief "Saved" flash on the button without full re-render
  const btn = document.getElementById('note-save-'+id);
  if (btn) { btn.textContent = t('note_saved'); setTimeout(()=>{ if(btn) btn.textContent = t('note_save'); }, 1500); }
}
function addAvail() { state.availability.recurring.push({id:uid(),days:[6,0],from:'06:00',to:'12:00',methods:['shore']}); render(); }
function toggleAvailMethod(id, m) {
  const a = state.availability.recurring.find(x => x.id === id);
  if (!a) return;
  // Migrate old single 'method' field to 'methods' array
  if (!a.methods) a.methods = [a.method || 'shore'];
  const idx = a.methods.indexOf(m);
  if (idx >= 0) {
    if (a.methods.length > 1) a.methods.splice(idx, 1); // must keep at least one
  } else {
    a.methods.push(m);
  }
  saveState(); render();
}
function removeAvail(id) { state.availability.recurring=state.availability.recurring.filter(a=>a.id!==id); saveState(); render(); }
function toggleAvailDay(id,day) {
  const a=state.availability.recurring.find(x=>x.id===id); if(!a)return;
  const i=a.days.indexOf(day); if(i>=0)a.days.splice(i,1); else a.days.push(day);
  saveState(); render();
}
function setAvailTime(id,field,val) { const a=state.availability.recurring.find(x=>x.id===id); if(a){a[field]=val;saveState();} }
async function gotoDashboard() { state.step='dashboard'; render(); await fetchAllForecasts(); }
function setTab(t) {
  // spotfinder tab removed — redirect to windows
  state.activeTab = t === 'spotfinder' ? 'windows' : t;
  render();
}
function openSettings()  { state.settingsOpen=true; render(); }
function closeSettings(e){ if(!e||e.target.classList.contains('modal-overlay')){state.settingsOpen=false;render();} }
function saveSettings() {
  const wt=document.getElementById('wt-global'); if(wt)state.waterType=wt.value;
  saveState(); state.settingsOpen=false; render();
}
async function refreshLightning() { await updateLightningAll(); render(); }

// ═══════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════
function init() {
  const hasSaved = loadState();

  // Handle shared window link (#share=...)
  const shared = parseSharedWindow();
  if (shared) {
    state._sharedWindow = shared;
    window.location.hash = ''; // clean up URL
  }

  state.step = (hasSaved && state.locations?.length && state.availability?.recurring?.length)
    ? 'dashboard' : 'welcome';

  // Re-schedule notifications if user previously enabled them
  if (state.notifsEnabled && Notification?.permission === 'granted') {
    setTimeout(scheduleWindowNotifications, 2000); // after forecasts load
  }

  render();
  if (state.step==='dashboard') fetchAllForecasts();
}
document.addEventListener('DOMContentLoaded', init);
