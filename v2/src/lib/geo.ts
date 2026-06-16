/**
 * Geo helpers ported from v1: reverse geocoding + smart inference of
 * species / water type / bottom type from nearby official spots.
 */
import { lang } from './i18n'
import type { NearbySpot, SpotSpecies } from './spots'

export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  const fallback = `${lat.toFixed(4)}, ${lng.toFixed(4)}`
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=17&addressdetails=1&accept-language=${lang.value === 'en' ? 'en' : 'da'}`
    const res = await fetch(url)
    const data = await res.json()
    const a = data.address || {}
    const specific = a.amenity || a.tourism || a.leisure || a.natural || a.man_made
    const road = a.road || a.path || a.footway
    const place = a.hamlet || a.quarter || a.suburb || a.village || a.town || a.city
    if (specific && place) return `${specific}, ${place}`
    if (specific) return specific
    if (road && place) return `${road}, ${place}`
    if (place) return place
    return fallback
  } catch {
    return fallback
  }
}

export interface InferredSpecies extends SpotSpecies {
  score: number
}

/** Distance-weighted species inference from nearby spots, boosted by current month. */
export function inferSpecies(nearby: NearbySpot[]): InferredSpecies[] {
  const month = new Date().getMonth() + 1
  const map = new Map<string, InferredSpecies>()
  for (const spot of nearby) {
    const weight = 1 / (spot.distKm + 0.5)
    for (const sp of spot.species || []) {
      if (!map.has(sp.name)) map.set(sp.name, { ...sp, score: 0 })
      const e = map.get(sp.name)!
      e.score += weight
      if (sp.months.includes(month)) e.score += weight * 0.6
    }
  }
  return [...map.values()].sort((a, b) => b.score - a.score)
}

export type WaterType = 'salt' | 'brackish' | 'fresh'

/** 4-tier water-type detection: close spots → name keywords → geo zones → brackish default. */
export function smartDetectWaterType(
  lat: number, lon: number, placeName: string, nearby: NearbySpot[],
): WaterType {
  const name = (placeName || '').toLowerCase()
  const nameIsCoastal = /fjord|vig|bugt|havn|strand|odde|næs|holm|rev|kyst|klint|mole|pynt/.test(name)
  const nameIsFresh = /\b(sø|søen|lake|dam|mose|kanal)\b/.test(name) || /(?<![a-z])å(?![a-z])|aaen|vandl|river/.test(name)

  if (nearby.length) {
    const close = nearby.filter((s) => {
      if (s.distKm > 8) return false
      if (nameIsCoastal && s.waterType === 'fresh') return false
      if (nameIsFresh && s.waterType !== 'fresh') return false
      return true
    })
    if (close.length) {
      const weighted: Record<string, number> = {}
      close.forEach((s) => { weighted[s.waterType] = (weighted[s.waterType] || 0) + 1 / (s.distKm + 0.5) })
      return Object.entries(weighted).sort((a, b) => b[1] - a[1])[0][0] as WaterType
    }
  }

  if (nameIsFresh) return 'fresh'
  if (nameIsCoastal) return lon < 8.6 && lat > 54.5 && lat < 58.0 ? 'salt' : 'brackish'
  if (lon < 8.6 && lat > 54.5 && lat < 58.0) return 'salt'
  if (lat > 54.9 && lat < 55.35 && lon > 14.4 && lon < 15.25) return 'brackish'
  if (lat > 55.8 && lat < 56.8 && lon > 9.0 && lon < 10.8) {
    if (nameIsCoastal) return 'brackish'
    if (nameIsFresh) return 'fresh'
    return lon < 9.8 ? 'brackish' : 'fresh'
  }
  return 'brackish'
}

export function inferBottomType(nearby: NearbySpot[]): string {
  const counts: Record<string, number> = {}
  nearby.forEach((s) => { if (s.bottomType) counts[s.bottomType] = (counts[s.bottomType] || 0) + 1 })
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'mixed'
}
