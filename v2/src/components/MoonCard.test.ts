// @vitest-environment vue-dom
/**
 * The dashboard's moon card, as mounted. Its percentage was the phase drawn
 * as a straight line, 0 at new moon to 100 at full and back, under the label
 * "Fase:". The lit part of the disc does not grow in a straight line: three
 * days after a new moon about 9 % of it is lit, and the card said 20 %. It
 * is the lit share now, (1 − cos)/2 of the moon's elongation from the sun,
 * and says so.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'
import { langReady, setLang, t } from '@/lib/i18n'
import { Solunar } from '@/lib/solunar'
import { STRINGS } from '@/test/strings'
import { useSetupStore } from '@/stores/setup'
import MoonCard from './MoonCard.vue'

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined
let pinia: Pinia

beforeEach(() => { restoreDocument = installDocument() })
afterEach(() => {
  view?.unmount()
  view = undefined
  vi.useRealTimers()
  setLang('da')
  restoreDocument()
})

/** The card at 09:00 on this local day, for a spot at Hornbæk. */
async function open(y: number, m: number, d: number): Promise<FakeNode> {
  vi.useFakeTimers({ now: new Date(y, m - 1, d, 9), toFake: ['Date', 'setInterval', 'clearInterval'] })
  pinia = createPinia()
  setActivePinia(pinia)
  useSetupStore().locations = [{ id: 'h', name: 'Hornbæk', lat: 56.09027, lon: 12.45693 }]
  view = mount(MoonCard, (app) => { app.use(pinia) })
  await nextTick()
  return view.root
}
/** The moon's phase at local noon of that day, as the card reads it: 0 new, 0.5 full. */
const phaseOn = (y: number, m: number, d: number) => Solunar.getMoonPhase(new Date(y, m - 1, d, 12))
/** The lit share of the disc, in whole per cent. */
const lit = (phase: number) => Math.round(((1 - Math.cos(2 * Math.PI * phase)) / 2) * 100)
const pctLine = (root: FakeNode) => root.byClass('pct')[0].textContent

describe('the moon card', () => {
  // 12 November 2026: three days after the new moon of 9 November.
  it('gives the lit share of the disc, not the phase as a straight line', async () => {
    const phase = phaseOn(2026, 11, 12)
    expect(phase).toBeGreaterThan(0.06)
    expect(phase).toBeLessThan(0.14)
    const line = Math.round(phase * 2 * 100) // what the card used to show
    expect(line - lit(phase)).toBeGreaterThanOrEqual(5) // a day where the two differ
    expect(pctLine(await open(2026, 11, 12))).toBe(`${t('moon_lit')} ${lit(phase)}%`)
  })

  // A quarter is half lit either way; two days from full, a gibbous moon is
  // more lit than the line said (93 %; it said 83 %).
  it('half lit at a quarter, nearly all of it two days from full', async () => {
    for (const [d, lo, hi] of [[17, 40, 60], [22, 90, 99]] as const) {
      const phase = phaseOn(2026, 11, d)
      const shown = pctLine(await open(2026, 11, d))
      expect(shown).toBe(`${t('moon_lit')} ${lit(phase)}%`)
      expect(lit(phase), `${d} Nov`).toBeGreaterThanOrEqual(lo)
      expect(lit(phase), `${d} Nov`).toBeLessThanOrEqual(hi)
      view!.unmount()
      view = undefined
    }
  })

  it('names the number in English too, switched while it is open', async () => {
    const root = await open(2026, 11, 12)
    setLang('en')
    expect(await langReady()).toBe(true)
    setActivePinia(pinia)
    await nextTick()
    expect(pctLine(root)).toBe(`${STRINGS.en.moon_lit} ${lit(phaseOn(2026, 11, 12))}%`)
  })
})
