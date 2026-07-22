import { describe, it, expect } from 'vitest'
import { STRINGS } from './strings'

// Guards the real maintenance risk in the i18n table: a key added to one
// language but not the other (silent Danish fallback), or an empty value.
describe('STRINGS i18n table', () => {
  const langs = Object.keys(STRINGS)

  it('provides both da and en', () => {
    expect(langs).toContain('da')
    expect(langs).toContain('en')
  })

  it('da and en cover exactly the same keys', () => {
    const da = new Set(Object.keys(STRINGS.da))
    const en = new Set(Object.keys(STRINGS.en))
    const missingInEn = [...da].filter((k) => !en.has(k)).sort()
    const missingInDa = [...en].filter((k) => !da.has(k)).sort()
    expect({ missingInEn, missingInDa }).toEqual({ missingInEn: [], missingInDa: [] })
  })

  it('has no empty values', () => {
    const empties: string[] = []
    for (const l of langs) {
      for (const [k, v] of Object.entries(STRINGS[l])) {
        if (typeof v !== 'string' || v.trim() === '') empties.push(`${l}.${k}`)
      }
    }
    expect(empties).toEqual([])
  })
})
