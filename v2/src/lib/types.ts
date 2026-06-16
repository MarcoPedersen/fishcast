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
}

export interface Availability {
  id: string
  days: number[]          // 0 (Sun) – 6 (Sat)
  from: string            // 'HH:MM'
  to: string
  methods: FishingMethod[]
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
export interface BreakdownItem { icon: string; factor: string; label: string; points: number }

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
