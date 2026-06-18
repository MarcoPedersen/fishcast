/**
 * FishCast — Danish Fishing Spots Database (ported to TS for v2)
 * Source: fishingindenmark.info · Attribution: Data courtesy of fishingindenmark.info
 */
import { haversine } from './math'

export interface SpotSpecies { name: string; nameEn: string; months: number[] }
export interface Spot {
  slug: string; name: string; lat: number; lon: number;
  waterType: 'salt' | 'brackish' | 'fresh';
  spotType: 'coast' | 'pier' | 'river' | 'lake';
  region: string; description: string;
  species: SpotSpecies[];
  facilities: { parking: boolean; boatRamp: boolean; wheelchair: boolean };
  bottomType: 'sand' | 'stone' | 'mixed' | 'mud';
  depth: 'shallow' | 'medium' | 'deep';
  accessNote?: string; brackishNote?: string;
}
export interface NearbySpot extends Spot { distKm: number }

export const DK_SPOTS: Spot[] = [
  {
    "slug": "fornaes-fyr",
    "name": "Fornæs Fyr",
    "lat": 56.4441, "lon": 10.9590,
    "waterType": "brackish", "spotType": "coast", "region": "Midtjylland",
    "description": "Klassisk Djursland fyrtårns-punkt med klipperev og blæretang — perfekt for havørred, hornfisk og makrel hele året.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Makrel","nameEn":"Mackerel","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Torsk","nameEn":"Cod","months":[1,2,3,10,11,12]},
      {"name":"Havbars","nameEn":"Sea Bass","months":[5,6,7,8,9,10]},
      {"name":"Skrubbe","nameEn":"Flounder","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Lubbe","nameEn":"Pollock","months":[1,2,3,4,9,10,11,12]},
      {"name":"Mørksej","nameEn":"Coalfish","months":[1,2,3,4,9,10,11,12]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "stone", "depth": "deep"
  },
  {
    "slug": "glatved",
    "name": "Glatved",
    "lat": 56.3031, "lon": 10.8664,
    "waterType": "brackish", "spotType": "coast", "region": "Midtjylland",
    "description": "Djursland kystspot berømt for fremragende fladfiskeri — pighvar, slethvar og skrubbe på blandet sand- og stenrevsbund.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Pighvar","nameEn":"Turbot","months":[4,5,6,7,8,9,10]},
      {"name":"Slethvar","nameEn":"Brill","months":[4,5,6,7,8,9,10]},
      {"name":"Rødspætte","nameEn":"Plaice","months":[3,4,5,6,7,8,9,10]},
      {"name":"Ising","nameEn":"Dab","months":[3,4,5,6,7,8,9,10,11]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]},
      {"name":"Makrel","nameEn":"Mackerel","months":[5,6,7,8,9,10]},
      {"name":"Havbars","nameEn":"Sea Bass","months":[5,6,7,8,9,10]},
      {"name":"Skrubbe","nameEn":"Flounder","months":[1,2,3,4,5,6,7,8,9,10,11,12]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "medium"
  },
  {
    "slug": "jernhatten",
    "name": "Jernhatten",
    "lat": 56.2440, "lon": 10.7919,
    "waterType": "brackish", "spotType": "coast", "region": "Midtjylland",
    "description": "Legendarisk Djursland-spot under en istidsbanke — revstrukturer, ålegræs og kraftig strøm giver ideelle betingelser for havørred og makrel.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]},
      {"name":"Makrel","nameEn":"Mackerel","months":[5,6,7,8,9,10]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "medium"
  },
  {
    "slug": "havknuden",
    "name": "Havknuden",
    "lat": 56.3455, "lon": 10.9155,
    "waterType": "brackish", "spotType": "coast", "region": "Midtjylland",
    "description": "Et af de mest produktive spots nær Grenå, hvor migrerende havørreder samles på vej mod Kolindsund-systemet over klipperev.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]},
      {"name":"Fladfisk","nameEn":"Flatfish","months":[3,4,5,6,7,8,9,10]},
      {"name":"Makrel","nameEn":"Mackerel","months":[5,6,7,8,9,10]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "stone", "depth": "deep"
  },
  {
    "slug": "sletterhage",
    "name": "Sletterhage",
    "lat": 56.0945, "lon": 10.5127,
    "waterType": "brackish", "spotType": "coast", "region": "Midtjylland",
    "description": "Velkendt Djursland-pynt med godt fiskeri hele året — dybde til ca. 50 m og varieret bund af sten, sand og ålegræs.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Skrubbe","nameEn":"Flounder","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Torsk","nameEn":"Cod","months":[1,2,3,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]},
      {"name":"Makrel","nameEn":"Mackerel","months":[5,6,7,8,9,10]},
      {"name":"Havbars","nameEn":"Sea Bass","months":[5,6,7,8,9,10]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "deep"
  },
  {
    "slug": "mageoen",
    "name": "Mageøen",
    "lat": 56.2902, "lon": 10.4159,
    "waterType": "brackish", "spotType": "coast", "region": "Midtjylland",
    "description": "Saltvandsspot i Kalø Vig med havørred hele året — topaktivet marts–april for de store fisk over leopardbundsbund.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "medium"
  },
  {
    "slug": "aarhus-havn-oestmolen",
    "name": "Aarhus Havn Østmolen",
    "lat": 56.1505, "lon": 10.2550,
    "waterType": "brackish", "spotType": "pier", "region": "Midtjylland",
    "description": "Velfaciliteret mole i Aarhus Havn — 12 m lang platform med kørestolsadgang, parkering og fiskemuligheder hele året.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Torsk","nameEn":"Cod","months":[1,2,3,10,11,12]},
      {"name":"Makrel","nameEn":"Mackerel","months":[5,6,7,8,9]},
      {"name":"Sild","nameEn":"Herring","months":[1,2,3,4,10,11,12]},
      {"name":"Fladfisk","nameEn":"Flatfish","months":[3,4,5,6,7,8,9,10]}
    ],
    "facilities": {"parking":true,"boatRamp":false,"wheelchair":true},
    "bottomType": "mixed", "depth": "deep"
  },
  {
    "slug": "vosnaes",
    "name": "Vosnæs",
    "lat": 56.2696, "lon": 10.3735,
    "waterType": "brackish", "spotType": "coast", "region": "Midtjylland",
    "description": "Populært Kalø Vig-spot med store havørreder i vinterhalvåret over klassisk leopardbundsbund.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "medium"
  },
  {
    "slug": "kysing-naes",
    "name": "Kysing Næs",
    "lat": 56.0205, "lon": 10.2821,
    "waterType": "brackish", "spotType": "coast", "region": "Midtjylland",
    "description": "Fremspringende rev i Aarhus Bugt med store sommer- og efterårshavørreder over tangskove og stenbanker.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]},
      {"name":"Fladfisk","nameEn":"Flatfish","months":[3,4,5,6,7,8,9,10]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "medium"
  },
  {
    "slug": "mariendal",
    "name": "Mariendal",
    "lat": 56.0481, "lon": 10.2714,
    "waterType": "brackish", "spotType": "coast", "region": "Midtjylland",
    "description": "Fint Aarhus Bugt-spot med fremragende havørred og hornfiskefiskeri over klassisk sand- og stenrevsbund med ålegræs.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]},
      {"name":"Fladfisk","nameEn":"Flatfish","months":[3,4,5,6,7,8,9,10]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "medium"
  },
  {
    "slug": "ballehage",
    "name": "Ballehage",
    "lat": 56.1204, "lon": 10.2275,
    "waterType": "brackish", "spotType": "coast", "region": "Midtjylland",
    "description": "Fremragende havørredspot tæt på Aarhus med sandbanker, mørke mudderpletter og stenrevsbund ved moler.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[5,6,7,8,9]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "medium"
  },
  {
    "slug": "risskov",
    "name": "Risskov",
    "lat": 56.1710, "lon": 10.2247,
    "waterType": "brackish", "spotType": "coast", "region": "Midtjylland",
    "description": "Kvalitetsspots ved Aarhus lystbådehavn med ålegræsbede og en stengrøfte der jævnligt holder på havørreder.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[5,6,7,8,9]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "medium"
  },
  {
    "slug": "kanaloen",
    "name": "Kanaløen",
    "lat": 56.5368, "lon": 10.2312,
    "waterType": "brackish", "spotType": "coast", "region": "Midtjylland",
    "description": "Kunstig ø i Randers Fjord nord for Voer-færgen med muslinger der tiltrækker havørred, sild og fladfisk.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[5,6,7,8,9]},
      {"name":"Makrel","nameEn":"Mackerel","months":[5,6,7,8,9]},
      {"name":"Sild","nameEn":"Herring","months":[1,2,3,4,10,11,12]},
      {"name":"Fladfisk","nameEn":"Flatfish","months":[3,4,5,6,7,8,9,10]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "mud", "depth": "deep"
  },
  {
    "slug": "stavns",
    "name": "Stavns",
    "lat": 55.8961, "lon": 10.5946,
    "waterType": "brackish", "spotType": "coast", "region": "Midtjylland",
    "description": "Lavvandet revkyst ved Samsø med leopardbund og tidevandsskelv — havørreder overrasker anglers forår og sommer.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "shallow"
  },
  {
    "slug": "alrodaemningen",
    "name": "Alrødæmningen",
    "lat": 55.8714, "lon": 10.1170,
    "waterType": "brackish", "spotType": "coast", "region": "Midtjylland",
    "description": "Flad, lavvandet dæmning i Horsens Fjord med sand og spredte sten — produktiv ved højvande og populær i hornfisksæsonen; familievenlig.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[5,6,7,8]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "shallow"
  },
  {
    "slug": "graerup-strand",
    "name": "Grærup Strand",
    "lat": 55.6545, "lon": 8.1313,
    "waterType": "salt", "spotType": "coast", "region": "Syddanmark",
    "description": "Vestjysk vadestrand med periodisk fremragende pighvare-fiskeri koncentreret i brædzonen.",
    "species": [
      {"name":"Pighvar","nameEn":"Turbot","months":[5,6,7,8,9]},
      {"name":"Rødspætte","nameEn":"Plaice","months":[4,5,6,7,8,9,10]},
      {"name":"Ising","nameEn":"Dab","months":[3,4,5,6,7,8,9,10,11]},
      {"name":"Skrubbe","nameEn":"Flounder","months":[3,4,5,6,7,8,9,10]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "sand", "depth": "shallow"
  },
  {
    "slug": "houens-odde",
    "name": "Houens Odde",
    "lat": 55.5175, "lon": 9.5896,
    "waterType": "brackish", "spotType": "coast", "region": "Syddanmark",
    "description": "Skovklædt sandpynt i Lillebælt med et fremragende vinterhavørrededfiskeri over muslinger og blandet bund.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,10,11,12]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "shallow"
  },
  {
    "slug": "trelde-naes",
    "name": "Trelde Næs",
    "lat": 55.6253, "lon": 9.8593,
    "waterType": "brackish", "spotType": "coast", "region": "Syddanmark",
    "description": "Berømt Vejle Fjord-pynt med et udstrakt stenrev — produktivt for havørred hele året og sæsonvis hornfisk og makrel.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]},
      {"name":"Makrel","nameEn":"Mackerel","months":[5,6,7,8,9,10]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "stone", "depth": "medium"
  },
  {
    "slug": "stenderup-hage",
    "name": "Stenderup Hage",
    "lat": 55.4620, "lon": 9.6942,
    "waterType": "brackish", "spotType": "coast", "region": "Syddanmark",
    "description": "Et af Lillebælts fineste fiskepladser — stærk strøm, dybt vand og meget varieret bund med ålegræs, sand, blæretang, sten og rev.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]},
      {"name":"Makrel","nameEn":"Mackerel","months":[5,6,7,8,9,10]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "deep"
  },
  {
    "slug": "kegnaes-fyr",
    "name": "Kegnæs Fyr",
    "lat": 54.8523, "lon": 9.9861,
    "waterType": "brackish", "spotType": "coast", "region": "Syddanmark",
    "description": "Klassisk Als-fyrtårns-pynt med alsidigt kystfiskeri — havørred hele året, sæsonvis fladfisk, hornfisk og torsk over tangklædte klipperev.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]},
      {"name":"Rødspætte","nameEn":"Plaice","months":[3,4,5,6,7,8,9,10]},
      {"name":"Ising","nameEn":"Dab","months":[3,4,5,6,7,8,9,10,11]},
      {"name":"Skrubbe","nameEn":"Flounder","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Torsk","nameEn":"Cod","months":[1,2,3,10,11,12]},
      {"name":"Lubbe","nameEn":"Pollock","months":[1,2,3,4,9,10,11,12]},
      {"name":"Mørksej","nameEn":"Coalfish","months":[1,2,3,4,9,10,11,12]}
    ],
    "facilities": {"parking":true,"boatRamp":false,"wheelchair":false},
    "bottomType": "stone", "depth": "medium"
  },
  {
    "slug": "daemningen",
    "name": "Dæmningen",
    "lat": 55.5115, "lon": 9.5774,
    "waterType": "brackish", "spotType": "coast", "region": "Syddanmark",
    "description": "Tidligere landbrugsdæmning nær Kolding Fjord gennembrudt af en storm i 1978 — nu naturområde med tidevandstrøm og muslinger der tiltrækker havørred.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "shallow"
  },
  {
    "slug": "fyns-hoved",
    "name": "Fyns Hoved",
    "lat": 55.6173, "lon": 10.5880,
    "waterType": "brackish", "spotType": "coast", "region": "Fyn",
    "description": "Klassisk Fyns nordspids med en udstrakt stenet kystlinje og rev — havørred hele året, sæsonvis hornfisk, makrel og fladfisk.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[5,6,7,8,9]},
      {"name":"Makrel","nameEn":"Mackerel","months":[5,6,7,8,9,10]},
      {"name":"Fladfisk","nameEn":"Flatfish","months":[3,4,5,6,7,8,9,10]}
    ],
    "facilities": {"parking":true,"boatRamp":false,"wheelchair":false},
    "bottomType": "stone", "depth": "medium"
  },
  {
    "slug": "enebaerodde",
    "name": "Enebærodde",
    "lat": 55.5146, "lon": 10.5584,
    "waterType": "brackish", "spotType": "coast", "region": "Fyn",
    "description": "Sandpynt ved Odense Fjords munding — vadefiskeri over sandrev og ålegræs giver havørred, hornfisk og makrel.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]},
      {"name":"Makrel","nameEn":"Mackerel","months":[5,6,7,8,9]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "shallow"
  },
  {
    "slug": "fonsskov-odde",
    "name": "Fønsskov Odde",
    "lat": 55.4732, "lon": 9.7217,
    "waterType": "brackish", "spotType": "coast", "region": "Fyn",
    "description": "Strømrig Lillebælt-pynt med naturskønne omgivelser — adgang via lang skovvandring, havørred hele året og hornfisk i sæsonen.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "medium"
  },
  {
    "slug": "svendborgsundbroen",
    "name": "Svendborgsundbroen",
    "lat": 55.0463, "lon": 10.6065,
    "waterType": "brackish", "spotType": "coast", "region": "Fyn",
    "description": "Dybt, stærkt strømmende vand under broen — havørred, hornfisk, fladfisk og makrel jager byttefisk langs strømmens kanter hele året.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]},
      {"name":"Fladfisk","nameEn":"Flatfish","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Makrel","nameEn":"Mackerel","months":[5,6,7,8,9,10]}
    ],
    "facilities": {"parking":true,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "deep"
  },
  {
    "slug": "drejet",
    "name": "Drejet",
    "lat": 54.8411, "lon": 10.4757,
    "waterType": "brackish", "spotType": "coast", "region": "Fyn",
    "description": "Lang Ærø-kyststrækning med store tidevandspuljer — varieret sten-, sand-, rev- og ålegræsbund; parkering langs vejen.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]}
    ],
    "facilities": {"parking":true,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "medium"
  },
  {
    "slug": "marstal",
    "name": "Marstal",
    "lat": 54.8466, "lon": 10.5372,
    "waterType": "brackish", "spotType": "coast", "region": "Fyn",
    "description": "Populært Ærø-kystspot med markant rev mod øst — havørred og hornfisk hele året over strømdannede sten- og grusgrev.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]}
    ],
    "facilities": {"parking":true,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "medium"
  },
  {
    "slug": "ommelshoved",
    "name": "Ommelshoved",
    "lat": 54.8918, "lon": 10.4490,
    "waterType": "brackish", "spotType": "coast", "region": "Fyn",
    "description": "Klassisk Ærø-pynt med bratte skrænter og blæretangsdækket stenrevsbund — udmærket havørredhabitat hele året.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "stone", "depth": "medium"
  },
  {
    "slug": "sonderso",
    "name": "Søndersø (Drejø)",
    "lat": 54.9624, "lon": 10.4212,
    "waterType": "brackish", "spotType": "coast", "region": "Fyn",
    "description": "Topklasse havørredested på øen Drejø med revbrud og stenbælter — hele årets fiskeri med markant forårspeak.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "stone", "depth": "medium"
  },
  {
    "slug": "hesnaes",
    "name": "Hesnæs",
    "lat": 54.8248, "lon": 12.1439,
    "waterType": "brackish", "spotType": "coast", "region": "Sjælland",
    "description": "Kystspot nær Falster med varierede sten- og blandet bundforhold — fremragende havørred efterår til forår og hornfisk om sommeren.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[5,6,7,8,9]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "stone", "depth": "medium"
  },
  {
    "slug": "stubbehage",
    "name": "Stubbehage",
    "lat": 54.8280, "lon": 12.1587,
    "waterType": "brackish", "spotType": "coast", "region": "Sjælland",
    "description": "Falster-kystpynt med store sten og revformationer — dybt vand tæt på kysten, kræver 20–25 min skovvandring fra parkeringspladsen.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]}
    ],
    "facilities": {"parking":true,"boatRamp":false,"wheelchair":false},
    "bottomType": "stone", "depth": "deep"
  },
  {
    "slug": "hyllekrog-odde",
    "name": "Hyllekrog Odde",
    "lat": 54.5973, "lon": 11.4898,
    "waterType": "brackish", "spotType": "coast", "region": "Sjælland",
    "description": "Lolland-sandpynt med stenet yderkyst — adgang kun udenfor adgangsforbud 1. marts–15. juli, havørred og hornfisk.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[7,8,9]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "stone", "depth": "medium",
    "accessNote": "⚠️ Adgangsforbud 1. marts – 15. juli"
  },
  {
    "slug": "albuen",
    "name": "Albuen",
    "lat": 54.8365, "lon": 10.9607,
    "waterType": "brackish", "spotType": "coast", "region": "Sjælland",
    "description": "7 km lang kyststrækning med varieret lavt og dybt vand — sten, sand, ålegræs og rev, bedst fisket ved systematisk afsøgning.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "medium"
  },
  {
    "slug": "skiveren-gandrup",
    "name": "Skiveren Gandrup",
    "lat": 57.0276, "lon": 10.1448,
    "waterType": "brackish", "spotType": "coast", "region": "Nordjylland",
    "description": "Limfjords-vadested langs sejlrende — fremragende efterårshavørred når fiskene migrerer mod gyde-åer.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[5,6,7,8]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "shallow"
  },
  {
    "slug": "gronlandshavn-oest",
    "name": "Grønlandshavn Øst",
    "lat": 57.0313, "lon": 10.1041,
    "waterType": "brackish", "spotType": "coast", "region": "Nordjylland",
    "description": "Klassisk fjordspot i Limfjorden med muslinger, ålegræs og åer på begge sider — bedste havørred forår og efterår.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[5,6,7,8]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "mud", "depth": "shallow"
  },
  {
    "slug": "feggeklit",
    "name": "Feggeklit",
    "lat": 56.9640, "lon": 8.9245,
    "waterType": "brackish", "spotType": "coast", "region": "Nordjylland",
    "description": "Godt havørredspot i Limfjorden bakket op af høj klint — blandet mudder, sten og ålegræsbund.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[5,6,7,8,9]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "shallow"
  },
  {
    "slug": "virksund",
    "name": "Virksund",
    "lat": 56.6219, "lon": 9.2852,
    "waterType": "brackish", "spotType": "coast", "region": "Midtjylland",
    "description": "Limfjord-kystspot nær åudløb — havørred, hornfisk og sild hele året med topaktivitet under forårs- og efterårsmigration.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]},
      {"name":"Sild","nameEn":"Herring","months":[3,4,10,11,12]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "shallow"
  },
  {
    "slug": "livo",
    "name": "Livø",
    "lat": 56.8936, "lon": 9.0682,
    "waterType": "brackish", "spotType": "coast", "region": "Nordjylland",
    "description": "Lille ø i Limfjorden tilgængelig med færge fra Rønbjerg — fiskepladser rundt hele øen med sten og tang, peak efterår og vinter.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[5,6,7,8,9]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "stone", "depth": "medium"
  },
  {
    "slug": "hasseris-bugten",
    "name": "Hasseris Bugten",
    "lat": 57.0511, "lon": 9.8629,
    "waterType": "brackish", "spotType": "coast", "region": "Nordjylland",
    "description": "Limfjords-kystbugt mod Aalborg-Egholm sejlrenden — sand og ålegræsbund med havørred; topperiode september–december.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[5,6,7,8]}
    ],
    "facilities": {"parking":false,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "shallow"
  },

  // ── Bornholm — Baltic (very brackish ~7-8 ppt) ─────────────
  // NOTE: At this low salinity, freshwater species (Pike, Perch, Zander) genuinely thrive
  // alongside saltwater species. This is biologically correct, not incidental.
  {
    "slug": "ronne-havn",
    "name": "Rønne Havn",
    "lat": 55.1010, "lon": 14.7070,
    "waterType": "brackish",
    "spotType": "pier", "region": "Bornholm",
    "description": "Bornholms største havn i Østersøen (brakvand ~7 ppt) — gedde og aborre lever naturligt her ved siden af torsk, sild og havørred.",
    "brackishNote": "Østersøen ved Bornholm er brakvand (~7-8 ppt). Ferskvandsfisk som gedde og aborre trives naturligt i dette saltindhold.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Torsk","nameEn":"Cod","months":[1,2,3,4,9,10,11,12]},
      {"name":"Sild","nameEn":"Herring","months":[3,4,10,11,12]},
      {"name":"Makrel","nameEn":"Mackerel","months":[5,6,7,8,9]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]},
      {"name":"Gedde","nameEn":"Pike","months":[1,2,3,5,6,7,8,9,10,11,12]},
      {"name":"Aborre","nameEn":"Perch","months":[4,5,6,7,8,9,10]},
      {"name":"Sandart","nameEn":"Zander","months":[3,4,6,7,8,9,10]}
    ],
    "facilities": {"parking":true,"boatRamp":true,"wheelchair":true},
    "bottomType": "mixed", "depth": "medium"
  },
  {
    "slug": "tejn-havn",
    "name": "Tejn Havn",
    "lat": 55.2530, "lon": 14.8340,
    "waterType": "brackish",
    "spotType": "pier", "region": "Bornholm",
    "description": "Charmerende fiskerhavn på Bornholms nordkyst — brakvand med blanding af Østersøens saltvandsarter og lokale ferskvandsfisk.",
    "brackishNote": "Østersøen ved Bornholm er brakvand (~7-8 ppt). Ferskvandsfisk som gedde og aborre trives naturligt her ved siden af sild og makrel.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Torsk","nameEn":"Cod","months":[1,2,3,4,9,10,11,12]},
      {"name":"Sild","nameEn":"Herring","months":[3,4,10,11,12]},
      {"name":"Makrel","nameEn":"Mackerel","months":[5,6,7,8,9]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]},
      {"name":"Aborre","nameEn":"Perch","months":[4,5,6,7,8,9,10]},
      {"name":"Gedde","nameEn":"Pike","months":[1,2,3,5,6,7,8,9,10,11,12]},
      {"name":"Sandart","nameEn":"Zander","months":[3,4,6,7,8,9,10]}
    ],
    "facilities": {"parking":true,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "medium"
  },

  // ── Sjælland & Øresund coast ───────────────
  {
    "slug": "dragor-havn",
    "name": "Dragør Havn",
    "lat": 55.5931, "lon": 12.6720,
    "waterType": "brackish", "spotType": "pier", "region": "Sjælland",
    "description": "Populær pier tæt på København med let adgang og havørred og hornfisk hele sæsonen.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]},
      {"name":"Makrel","nameEn":"Mackerel","months":[5,6,7,8,9]},
      {"name":"Rødspætte","nameEn":"Plaice","months":[3,4,5,6,7,8,9,10]},
      {"name":"Ising","nameEn":"Dab","months":[3,4,5,6,7,8,9,10,11]},
      {"name":"Skrubbe","nameEn":"Flounder","months":[1,2,3,4,5,6,7,8,9,10,11,12]}
    ],
    "facilities": {"parking":true,"boatRamp":false,"wheelchair":true},
    "bottomType": "mixed", "depth": "medium"
  },
  {
    "slug": "koge-bugt-strand",
    "name": "Køge Bugt Strand",
    "lat": 55.4850, "lon": 12.2800,
    "waterType": "brackish", "spotType": "coast", "region": "Sjælland",
    "description": "Lang sandstrand syd for København med gode muligheder for havørred og hornfisk fra kysten.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]},
      {"name":"Fladfisk","nameEn":"Flatfish","months":[3,4,5,6,7,8,9,10]}
    ],
    "facilities": {"parking":true,"boatRamp":false,"wheelchair":false},
    "bottomType": "sand", "depth": "shallow"
  },
  {
    "slug": "hundested-havn",
    "name": "Hundested Havn",
    "lat": 56.0010, "lon": 11.8480,
    "waterType": "brackish", "spotType": "pier", "region": "Sjælland",
    "description": "Nordsjællands klassiske fiskerihavn med fremragende havørred, makrel og hornfisk fra molen.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]},
      {"name":"Makrel","nameEn":"Mackerel","months":[5,6,7,8,9,10]},
      {"name":"Torsk","nameEn":"Cod","months":[1,2,3,10,11,12]}
    ],
    "facilities": {"parking":true,"boatRamp":true,"wheelchair":false},
    "bottomType": "mixed", "depth": "medium"
  },
  {
    "slug": "rorvig-strand",
    "name": "Rørvig Strand",
    "lat": 55.9440, "lon": 11.7530,
    "waterType": "brackish", "spotType": "coast", "region": "Sjælland",
    "description": "Velkendt kystnært spot ved Isefjordens munding med store havørreder, særligt om foråret og efteråret.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[5,6,7,8,9]},
      {"name":"Fladfisk","nameEn":"Flatfish","months":[4,5,6,7,8,9,10]}
    ],
    "facilities": {"parking":true,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "shallow"
  },
  {
    "slug": "helsingore-kysten",
    "name": "Helsingør Kysten",
    "lat": 56.0350, "lon": 12.5890,
    "waterType": "brackish", "spotType": "coast", "region": "Sjælland",
    "description": "Øresund-kyst med stærke strømforhold og aktive havørreder hele året — klassisk spot for fluefiskere.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]},
      {"name":"Makrel","nameEn":"Mackerel","months":[5,6,7,8,9,10]}
    ],
    "facilities": {"parking":true,"boatRamp":false,"wheelchair":false},
    "bottomType": "stone", "depth": "medium"
  },
  {
    "slug": "ishoj-strand",
    "name": "Ishøj Strand",
    "lat": 55.6150, "lon": 12.3520,
    "waterType": "brackish", "spotType": "coast", "region": "Sjælland",
    "description": "Bredt strandområde tæt på København med god havørredfiskeri fra stranden og fra Ishøj Havn.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Hornfisk","nameEn":"Garfish","months":[4,5,6,7,8,9]},
      {"name":"Fladfisk","nameEn":"Flatfish","months":[3,4,5,6,7,8,9,10]}
    ],
    "facilities": {"parking":true,"boatRamp":false,"wheelchair":true},
    "bottomType": "sand", "depth": "shallow"
  },

  // ── Freshwater & Brackish Spots ────────────
  {
    "slug": "gudenaen-tange",
    "name": "Gudenåen — Tange Sø",
    "lat": 56.3552, "lon": 9.5847,
    "waterType": "fresh", "spotType": "river", "region": "Midtjylland",
    "description": "Danmarks længste å med fremragende gedde- og sandartfiskeri. Tange Sø er hotspot for store gedder på lavvandet.",
    "species": [
      {"name":"Gedde","nameEn":"Pike","months":[1,2,3,5,6,7,8,9,10,11,12]},
      {"name":"Sandart","nameEn":"Zander","months":[1,2,3,4,6,7,8,9,10,11,12]},
      {"name":"Aborre","nameEn":"Perch","months":[4,5,6,7,8,9,10]},
      {"name":"Brasen","nameEn":"Bream","months":[5,6,7,8]}
    ],
    "facilities": {"parking":true,"boatRamp":true,"wheelchair":false},
    "bottomType": "mixed", "depth": "medium"
  },
  {
    "slug": "silkeborg-langso",
    "name": "Silkeborg Langsø",
    "lat": 56.1736, "lon": 9.5459,
    "waterType": "fresh", "spotType": "lake", "region": "Midtjylland",
    "description": "Klart, dybt søsystem midt i Silkeborg med store ørreder og gedder. Populært årsrundt fiskested.",
    "species": [
      {"name":"Gedde","nameEn":"Pike","months":[1,2,3,5,6,7,8,9,10,11,12]},
      {"name":"Aborre","nameEn":"Perch","months":[4,5,6,7,8,9,10]},
      {"name":"Bæk-/Søørred","nameEn":"Brown Trout (river/lake)","months":[3,4,5,6,9,10,11]},
      {"name":"Sandart","nameEn":"Zander","months":[3,4,6,7,8,9,10]}
    ],
    "facilities": {"parking":true,"boatRamp":true,"wheelchair":false},
    "bottomType": "mixed", "depth": "deep"
  },
  {
    "slug": "arreso",
    "name": "Arresø",
    "lat": 56.0002, "lon": 12.0858,
    "waterType": "fresh", "spotType": "lake", "region": "Sjælland",
    "description": "Danmarks største sø — lavvandet og næringsrig med store gedder og sandart. Bedst fra båd.",
    "species": [
      {"name":"Gedde","nameEn":"Pike","months":[1,2,3,5,6,7,8,9,10,11,12]},
      {"name":"Sandart","nameEn":"Zander","months":[1,2,3,4,6,7,8,9,10]},
      {"name":"Aborre","nameEn":"Perch","months":[4,5,6,7,8,9,10]},
      {"name":"Brasen","nameEn":"Bream","months":[5,6,7,8]},
      {"name":"Karpe","nameEn":"Carp","months":[5,6,7,8,9]}
    ],
    "facilities": {"parking":true,"boatRamp":true,"wheelchair":false},
    "bottomType": "mud", "depth": "shallow"
  },
  {
    "slug": "esrum-so",
    "name": "Esrum Sø",
    "lat": 55.9970, "lon": 12.3890,
    "waterType": "fresh", "spotType": "lake", "region": "Sjælland",
    "description": "Nordsjællands dybeste og reneste sø — fremragende for store ørreder og gedder hele året.",
    "species": [
      {"name":"Gedde","nameEn":"Pike","months":[1,2,3,5,6,7,8,9,10,11,12]},
      {"name":"Bæk-/Søørred","nameEn":"Brown Trout (river/lake)","months":[3,4,5,9,10,11]},
      {"name":"Aborre","nameEn":"Perch","months":[4,5,6,7,8,9,10]},
      {"name":"Sandart","nameEn":"Zander","months":[3,4,6,7,8,9,10]}
    ],
    "facilities": {"parking":true,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "deep"
  },
  {
    "slug": "julso-brassø",
    "name": "Julsø & Brassø",
    "lat": 56.0630, "lon": 9.5960,
    "waterType": "fresh", "spotType": "lake", "region": "Midtjylland",
    "description": "Dyb, klar midtjysk sø med store gedder på lavvandede bredder og aborre i struktur.",
    "species": [
      {"name":"Gedde","nameEn":"Pike","months":[1,2,3,5,6,7,8,9,10,11,12]},
      {"name":"Aborre","nameEn":"Perch","months":[4,5,6,7,8,9,10]},
      {"name":"Sandart","nameEn":"Zander","months":[3,4,6,7,8,9,10]},
      {"name":"Brasen","nameEn":"Bream","months":[5,6,7,8]}
    ],
    "facilities": {"parking":true,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "deep"
  },
  {
    "slug": "skanderborg-so",
    "name": "Skanderborg Sø",
    "lat": 56.0390, "lon": 9.9490,
    "waterType": "fresh", "spotType": "lake", "region": "Midtjylland",
    "description": "Stor midtjysk sø med god adgang fra havneanlæg og hytte. Populær for gedde og aborre.",
    "species": [
      {"name":"Gedde","nameEn":"Pike","months":[1,2,3,5,6,7,8,9,10,11,12]},
      {"name":"Aborre","nameEn":"Perch","months":[4,5,6,7,8,9,10]},
      {"name":"Sandart","nameEn":"Zander","months":[3,4,6,7,8,9,10]},
      {"name":"Brasen","nameEn":"Bream","months":[5,6,7,8]}
    ],
    "facilities": {"parking":true,"boatRamp":true,"wheelchair":true},
    "bottomType": "mixed", "depth": "medium"
  },
  {
    "slug": "mossø",
    "name": "Mossø",
    "lat": 56.0063, "lon": 9.8046,
    "waterType": "fresh", "spotType": "lake", "region": "Midtjylland",
    "description": "Danmarks 4. største sø med fremragende sandartfiskeri ved mundingen af Gudenåen og store gedder.",
    "species": [
      {"name":"Sandart","nameEn":"Zander","months":[1,2,3,4,6,7,8,9,10,11,12]},
      {"name":"Gedde","nameEn":"Pike","months":[1,2,3,5,6,7,8,9,10,11,12]},
      {"name":"Aborre","nameEn":"Perch","months":[4,5,6,7,8,9,10]},
      {"name":"Brasen","nameEn":"Bream","months":[5,6,7,8]}
    ],
    "facilities": {"parking":true,"boatRamp":true,"wheelchair":false},
    "bottomType": "mud", "depth": "medium"
  },
  {
    "slug": "gurre-so",
    "name": "Gurre Sø",
    "lat": 56.0670, "lon": 12.4010,
    "waterType": "fresh", "spotType": "lake", "region": "Sjælland",
    "description": "Nordsjællandsk sø med rigtig god aborrefiskeri og gedder. Velegnet for families- og begynderfiskeri.",
    "species": [
      {"name":"Aborre","nameEn":"Perch","months":[4,5,6,7,8,9,10]},
      {"name":"Gedde","nameEn":"Pike","months":[1,2,3,5,6,7,8,9,10,11,12]},
      {"name":"Karpe","nameEn":"Carp","months":[5,6,7,8,9]}
    ],
    "facilities": {"parking":true,"boatRamp":false,"wheelchair":false},
    "bottomType": "mixed", "depth": "shallow"
  },
  {
    "slug": "furesø",
    "name": "Furesø",
    "lat": 55.8071, "lon": 12.3774,
    "waterType": "fresh", "spotType": "lake", "region": "Sjælland",
    "description": "Danmarks dybeste sø — ren oligotrof sø med store søørreder, gedder og aborre tæt på København.",
    "species": [
      {"name":"Bæk-/Søørred","nameEn":"Brown Trout (river/lake)","months":[3,4,5,9,10,11]},
      {"name":"Gedde","nameEn":"Pike","months":[1,2,3,5,6,7,8,9,10,11,12]},
      {"name":"Aborre","nameEn":"Perch","months":[4,5,6,7,8,9,10]},
      {"name":"Sandart","nameEn":"Zander","months":[3,4,6,7,8,9,10]}
    ],
    "facilities": {"parking":true,"boatRamp":false,"wheelchair":false},
    "bottomType": "stone", "depth": "deep"
  },
  {
    "slug": "randers-fjord",
    "name": "Randers Fjord",
    "lat": 56.4607, "lon": 10.0479,
    "waterType": "brackish", "spotType": "coast", "region": "Midtjylland",
    "description": "Lange fjord med overgang fra salt- til ferskvand — fremragende for havørred og sandart ved strøm og tidevand.",
    "species": [
      {"name":"Havørred","nameEn":"Sea Trout","months":[1,2,3,4,5,6,7,8,9,10,11,12]},
      {"name":"Sandart","nameEn":"Zander","months":[3,4,6,7,8,9,10]},
      {"name":"Gedde","nameEn":"Pike","months":[1,2,3,5,6,7,8,9,10,11,12]},
      {"name":"Aborre","nameEn":"Perch","months":[4,5,6,7,8,9,10]},
      {"name":"Sild","nameEn":"Herring","months":[3,4,10,11]}
    ],
    "facilities": {"parking":true,"boatRamp":true,"wheelchair":false},
    "bottomType": "mud", "depth": "medium"
  }
]

/** Spots within radiusKm of (lat, lon), sorted by distance. */
export function findNearbySpots(lat: number, lon: number, radiusKm = 50): NearbySpot[] {
  return DK_SPOTS
    .map((s) => ({ ...s, distKm: Math.round(haversine(lat, lon, s.lat, s.lon)) }))
    .filter((s) => s.distKm <= radiusKm)
    .sort((a, b) => a.distKm - b.distKm)
}

/** Species active at a spot in month m (1-12). */
export function activeSpeciesInMonth(spot: Spot, month: number): SpotSpecies[] {
  return spot.species.filter((sp) => sp.months.includes(month))
}