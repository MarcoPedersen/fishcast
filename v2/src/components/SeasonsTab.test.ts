// @vitest-environment vue-dom
/**
 * The Seasons tab's bag limits, as mounted. The badge cut each one at 26
 * characters ("Max 1 fedtfinneklippet lak…") and kept the full rule in its
 * title, which a touch screen never shows: salmon's "per day (Østersøen)",
 * the part that says where the limit holds, was lost on a phone. The full
 * rule is now a note line under the badges, as the restrictions are, and
 * the badges stay short enough to sit side by side on a 375 px screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'
import { STRINGS } from '@/test/strings'
import { langReady, setLang } from '@/lib/i18n'
import { DK_REGULATIONS } from '@/lib/regulations'
import type { SeasonReg } from '@/lib/seasons'
import SeasonsTab from './SeasonsTab.vue'

const BAGGED = (DK_REGULATIONS.species as SeasonReg[]).filter((s) => s.bagLimit)

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined

beforeEach(() => { restoreDocument = installDocument() })
afterEach(() => {
  view?.unmount()
  view = undefined
  vi.useRealTimers()
  setLang('da')
  restoreDocument()
})

/** The Seasons tab on this local day, at noon. */
async function open(y: number, m: number, d: number): Promise<FakeNode> {
  vi.useFakeTimers({ now: new Date(y, m - 1, d, 12), toFake: ['Date'] })
  view = mount(SeasonsTab)
  await nextTick()
  return view.root
}
/** The card of the species with this name. */
const card = (root: FakeNode, name: string) =>
  root.byClass('sp card').find((c) => c.byTag('strong')[0]?.textContent === name)

describe('SeasonsTab: a bag limit', () => {
  it('is there to check', () => {
    expect(BAGGED.map((s) => s.id).sort()).toEqual(['havbars', 'laks'])
  })

  // Both are 'restricted' species: in November and in July alike their cards
  // are in the restricted section. The in-season section is tested below.
  for (const [y, m, d] of [[2026, 11, 20], [2026, 7, 15]]) {
    it(`is shown in full, with its label, on ${y}-${m}-${d}`, async () => {
      const root = await open(y, m, d)
      for (const s of BAGGED) {
        const c = card(root, s.name)
        expect(c, s.name).toBeDefined()
        const notes = c!.byClass('note').map((n) => n.textContent)
        expect(notes).toContain(`${STRINGS.da.sp_bag_limit} ${s.bagLimit}`)
        expect(c!.textContent).not.toContain('…')
      }
    })
  }

  it('is shown in full in English too', async () => {
    const root = await open(2026, 11, 20)
    setLang('en')
    await langReady() // the English table is a chunk of its own
    await nextTick()
    for (const s of BAGGED) {
      const c = card(root, s.nameEn!)
      expect(c, s.nameEn).toBeDefined()
      expect(c!.byClass('note').map((n) => n.textContent)).toContain(`${STRINGS.en.sp_bag_limit} ${s.bagLimitEn}`)
    }
  })

  // No species with a bag limit reaches the in-season section today, so its
  // note line went untested. Sea bass in July, read as an 'open' species,
  // shows it there: in full, with its label, and no long badge beside it.
  it('is shown in full in the in-season section too', async () => {
    const bass = BAGGED.find((s) => s.id === 'havbars')!
    const status = bass.status
    bass.status = 'open'
    try {
      const root = await open(2026, 7, 15)
      const c = card(root, bass.name)
      expect(c, bass.name).toBeDefined()
      expect(c!.hasClass('caution')).toBe(false)
      expect(c!.byClass('note').map((n) => n.textContent)).toContain(`${STRINGS.da.sp_bag_limit} ${bass.bagLimit}`)
      expect(c!.byClass('badge').map((b) => b.textContent).filter((t) => t.length > 26)).toEqual([])
    } finally {
      bass.status = status
    }
  })

  // A badge does not wrap: one longer than this ran off a 375 px card.
  it('leaves only short badges, in every month', async () => {
    for (let m = 1; m <= 12; m++) {
      const root = await open(2026, m, 15)
      const long = root.byClass('badge').map((b) => b.textContent).filter((t) => t.length > 26)
      expect(long, `month ${m}`).toEqual([])
      view!.unmount()
      view = undefined
      vi.useRealTimers()
    }
  })
})
