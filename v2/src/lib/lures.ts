/**
 * Lure colour recommendation — pure port of v1 suggestLure.
 * Picks up to 3 colours from water-clarity / light conditions, plus
 * species-specific tackle tips. Translated lazily via t() at call time.
 */
import { t } from './i18n'
import { STRINGS } from './strings'
import type { LureColor, LureRec } from './types'

interface LureColorDef { hex: string; nameKey: string; reasonKey: string }

const LURE_COLORS: Record<string, LureColorDef> = {
  silver: { hex: '#C0C0C0', nameKey: 'lure_silver', reasonKey: 'lure_reason_silver' },
  pearl: { hex: '#F0EEE0', nameKey: 'lure_pearl', reasonKey: 'lure_reason_pearl' },
  gold: { hex: '#FFD700', nameKey: 'lure_gold', reasonKey: 'lure_reason_gold' },
  chartreuse: { hex: '#7FFF00', nameKey: 'lure_chartreuse', reasonKey: 'lure_reason_chartreuse' },
  orange: { hex: '#FF6A00', nameKey: 'lure_orange', reasonKey: 'lure_reason_orange' },
  red: { hex: '#E8001E', nameKey: 'lure_red', reasonKey: 'lure_reason_red' },
  firetiger: { hex: '#FF4500', nameKey: 'lure_firetiger', reasonKey: 'lure_reason_firetiger' },
  uvwhite: { hex: '#F8F0FF', nameKey: 'lure_uvwhite', reasonKey: 'lure_reason_uvwhite' },
  green: { hex: '#3CB371', nameKey: 'lure_green', reasonKey: 'lure_reason_green' },
  black: { hex: '#1A1A1A', nameKey: 'lure_black', reasonKey: 'lure_reason_black' },
  pink: { hex: '#FF69B4', nameKey: 'lure_pink', reasonKey: 'lure_reason_pink' },
}

interface LureConditions {
  cloud: number; waveM: number; windMs: number; precipPct: number
  isDawn: boolean; isDusk: boolean
}

function entry(c: LureColorDef): LureColor {
  return { hex: c.hex, name: t(c.nameKey), reason: t(c.reasonKey) }
}

export function suggestLure(cond: LureConditions, targetSpecies: string[]): LureRec {
  const { cloud, waveM, windMs, isDawn, isDusk } = cond
  const isCalm = windMs < 3 && waveM < 0.2
  const isMurky = waveM > 0.6 || windMs > 7
  const isLowLight = isDawn || isDusk || cloud > 80
  const isClear = cloud < 30 && !isMurky
  const isOvercast = cloud > 65

  const colors: LureColor[] = []
  const tips: string[] = []

  if (isMurky) {
    colors.push(entry(LURE_COLORS.firetiger), entry(LURE_COLORS.orange), entry(LURE_COLORS.red))
    tips.push(t('lure_tip_murky'))
  } else if (isLowLight) {
    colors.push(entry(LURE_COLORS.uvwhite), entry(LURE_COLORS.chartreuse), entry(LURE_COLORS.orange))
    tips.push(t('lure_tip_lowlight'))
  } else if (isClear && isCalm) {
    colors.push(entry(LURE_COLORS.silver), entry(LURE_COLORS.pearl), entry(LURE_COLORS.pink))
    tips.push(t('lure_tip_clear'))
  } else if (isOvercast) {
    colors.push(entry(LURE_COLORS.chartreuse), entry(LURE_COLORS.gold), entry(LURE_COLORS.orange))
    tips.push(t('lure_tip_overcast'))
  } else {
    colors.push(entry(LURE_COLORS.gold), entry(LURE_COLORS.silver), entry(LURE_COLORS.chartreuse))
  }

  for (const id of targetSpecies) {
    const tipKey = 'tip_' + id
    if (STRINGS.da[tipKey]) tips.push(t(tipKey))
  }

  return { colors: colors.slice(0, 3), tips }
}
