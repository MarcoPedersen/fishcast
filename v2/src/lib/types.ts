export type Lang = 'da' | 'en'
export type WaterType = 'salt' | 'brackish' | 'fresh' | 'both'
export type FishingMethod = 'shore' | 'boat' | 'waders'

export interface Location {
  id: string
  name: string
  lat: number
  lon: number
  waterType?: WaterType
  bottomType?: string
  spotSlug?: string
  species?: { nameEn: string; months: number[] }[]
  fav?: boolean
  note?: string
}

export interface Availability {
  id: string
  days: number[]          // 0 (Sun) – 6 (Sat)
  from: string            // 'HH:MM'
  to: string
  methods: FishingMethod[]
}

export interface CatchEntry {
  id: string
  date: string            // 'YYYY-MM-DD'
  time?: string           // 'HH:MM' — enables a retrospective bite-score
  speciesId: string       // key into SPECIES_PREFS, or '' for unspecified
  locationName: string    // chosen saved location or free text
  lengthCm?: number
  weightKg?: number
  released?: boolean      // true = released, false = kept, undefined = unspecified
  method?: FishingMethod  // how it was caught (also feeds the bite-score)
  notes?: string
}

export interface UserSetup {
  locations: Location[]
  targetSpecies: string[]
  availability: Availability[]
  lang: Lang
}

export interface HourData {
  time: number
  temp: number | null
  windMs: number | null
  windDir: number | null
  gustMs: number | null
  cloud: number
  precipPct: number
  pressure: number | null
}

export interface MarineHour {
  time: number
  waveM: number | null
  wavePeriod: number | null
}

export interface TidePrediction { time: number; value: number }
export interface TideData { stationName: string; distKm: number; predictions: TidePrediction[] }

export type LightningLevel = 'clear' | 'caution' | 'warning' | 'danger'
export interface LightningStatus { level: LightningLevel; closestKm: number | null }

export interface Forecast {
  fetched: number
  hourly: HourData[]
  marine: MarineHour[] | null
  tides: TideData | null
}

export interface LureColor { hex: string; name: string; reason: string }
export interface LureRec { colors: LureColor[]; tips: string[] }
export interface BreakdownItem { icon: string; factor: string; label: string; points: number; key?: string }

export interface ScoredWindow {
  location: Location
  date: Date
  from: string
  to: string
  score: number
  noData: boolean
  bestHourStr: string | null
  tags: { label: string; cls: string; hint?: string }[]
  lure?: LureRec
  lightning?: LightningStatus
  breakdown?: BreakdownItem[]
}
