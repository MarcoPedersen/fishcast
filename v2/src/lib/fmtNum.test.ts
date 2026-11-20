/**
 * Decimals as the language shown writes them: "2,5 kg" in Danish, "2.5 kg"
 * in English. The Danish screens wrote them with a full stop: "⚖️ 2.5 kg" on
 * a catch's card, "4.0 m/s" in a window's breakdown, "0.20m" in its wave tag.
 * Only the Modeltjek's points table wrote a comma, with a formatter of its own.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { fmtNum, langReady, setLang } from './i18n'
import { STRINGS_DA } from './strings'
import { STRINGS_EN } from './strings.en'
import { SPECIES_PREFS } from './species'
import { DK_SPOTS } from './spots'

afterEach(() => setLang('da'))

describe('fmtNum', () => {
  it('writes a decimal comma in Danish, the language by default', () => {
    expect(fmtNum(2.5)).toBe('2,5')
    expect(fmtNum(45.5)).toBe('45,5')
    expect(fmtNum(4.2, 1)).toBe('4,2')
  })

  it('keeps the decimals a place asks for, as toFixed does', () => {
    expect(fmtNum(6, 1)).toBe('6,0')
    expect(fmtNum(0.2, 2)).toBe('0,20')
    expect(fmtNum(1.456, 2)).toBe('1,46')
    expect(fmtNum(8.4, 0)).toBe('8')
  })

  it('without a count keeps the number’s own decimals, and a whole number has none', () => {
    expect(fmtNum(30)).toBe('30')
    expect(fmtNum(0.75)).toBe('0,75')
    expect(fmtNum(0)).toBe('0')
  })

  // Danish groups thousands with a full stop: "1.015 hPa" would read as a decimal.
  it('groups no thousands', () => {
    expect(fmtNum(1015, 0)).toBe('1015')
    expect(fmtNum(10234.5, 1)).toBe('10234,5')
    expect(fmtNum(1015)).toBe('1015')
  })

  it('keeps the sign', () => {
    expect(fmtNum(-1.5, 1)).toBe('-1,5')
    expect(fmtNum(-3)).toBe('-3')
  })

  it('writes a decimal point in English, and a comma again after a switch back', async () => {
    setLang('en')
    expect(await langReady()).toBe(true)
    expect(fmtNum(2.5)).toBe('2.5')
    expect(fmtNum(6, 1)).toBe('6.0')
    expect(fmtNum(0.2, 2)).toBe('0.20')
    expect(fmtNum(1015, 0)).toBe('1015')
    expect(fmtNum(10234.5, 1)).toBe('10234.5')
    setLang('da')
    expect(fmtNum(2.5)).toBe('2,5')
  })
})

/**
 * The tables' own text, written by hand: a Danish line said "0.5–1.5 m over
 * bunden". A digit, a full stop and a digit is a decimal in the Danish text
 * (dates there are written "16. sep."), and a digit, a comma and a digit
 * one in the English (it writes no thousands).
 */
describe('the text written by hand', () => {
  const decimalPoint = /\d\.\d/
  const decimalComma = /\d,\d/
  const offenders = (texts: [string, string | undefined][], re: RegExp) =>
    texts.filter(([, s]) => s != null && re.test(s)).map(([k, s]) => `${k}: ${s}`)

  it('Danish writes its decimals with a comma', () => {
    expect(offenders(Object.entries(STRINGS_DA), decimalPoint)).toEqual([])
    expect(offenders(Object.values(SPECIES_PREFS).flatMap((s) => [
      [s.id + '.name', s.name], [s.id + '.tip', s.tip], [s.id + '.warningText', s.warningText],
    ] as [string, string | undefined][]), decimalPoint)).toEqual([])
    expect(offenders(DK_SPOTS.map((s) => [s.name, s.description]), decimalPoint)).toEqual([])
  })

  it('English writes its decimals with a point', () => {
    expect(offenders(Object.entries(STRINGS_EN), decimalComma)).toEqual([])
    expect(offenders(Object.values(SPECIES_PREFS).flatMap((s) => [
      [s.id + '.nameEn', s.nameEn], [s.id + '.tipEn', s.tipEn], [s.id + '.warningTextEn', s.warningTextEn],
    ] as [string, string | undefined][]), decimalComma)).toEqual([])
  })
})
