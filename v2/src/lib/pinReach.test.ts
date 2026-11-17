import { afterEach, describe, expect, it, vi } from 'vitest'
import { PIN_REACH_PX, coarsePointer, hiddenUnder, pinInReach, tapPointers } from './pinReach'

// A flat screen for these: one degree is 100 px, north up.
const toScreen = (lat: number, lon: number) => ({ x: lon * 100, y: -lat * 100 })
const pin = (name: string, x: number, y: number) => ({ lat: -y / 100, lon: x / 100, pin: name })

describe('a tap within reach of a pin', () => {
  it('reaches 20 px from the centre: a 40 px target, as the app gives a finger elsewhere', () => {
    expect(PIN_REACH_PX * 2).toBe(40)
    const pins = [pin('a', 100, 100)]
    expect(pinInReach({ x: 100, y: 100 }, pins, toScreen)).toBe('a')
    expect(pinInReach({ x: 112, y: 116 }, pins, toScreen)).toBe('a') // 20 px off
    expect(pinInReach({ x: 121, y: 100 }, pins, toScreen)).toBeNull()
    expect(pinInReach({ x: 100, y: 100 }, [], toScreen)).toBeNull()
  })

  // A larger area on each pin is hit by stacking order: the one drawn last
  // would take a tap meant for the one under it.
  it('goes to the nearest pin, wherever it comes in the list', () => {
    const pins = [pin('a', 100, 100), pin('b', 130, 100), pin('c', 160, 100)]
    expect(pinInReach({ x: 112, y: 100 }, pins, toScreen)).toBe('a')
    expect(pinInReach({ x: 118, y: 100 }, pins, toScreen)).toBe('b')
    expect(pinInReach({ x: 146, y: 104 }, pins, toScreen)).toBe('c')
    expect(pinInReach({ x: 146, y: 104 }, [...pins].reverse(), toScreen)).toBe('c')
  })

  it('of pins as near, goes to the first: your spot over the official one it was added from', () => {
    const pins = [pin('yours', 100, 100), pin('official', 100, 100)]
    expect(pinInReach({ x: 108, y: 100 }, pins, toScreen)).toBe('yours')
  })
})

// Review (round G): a 13.5 px dot under a 26 px pin of your spot.
describe('a pin hidden under another', () => {
  const yours = [{ at: { x: 100, y: 100 }, r: 13 }]

  it('is one wholly inside a pin drawn over it', () => {
    expect(hiddenUnder({ x: 100, y: 100 }, 6.75, yours)).toBe(true)
    expect(hiddenUnder({ x: 106.25, y: 100 }, 6.75, yours)).toBe(true) // its edge on the pin's
    expect(hiddenUnder({ x: 103, y: 104 }, 6.75, [{ at: { x: 0, y: 0 }, r: 8 }, ...yours])).toBe(true)
  })

  it('is not one that shows past the edge, or with nothing over it', () => {
    expect(hiddenUnder({ x: 107, y: 100 }, 6.75, yours)).toBe(false)
    expect(hiddenUnder({ x: 100, y: 100 }, 6.75, [{ at: { x: 100, y: 100 }, r: 6 }])).toBe(false)
    expect(hiddenUnder({ x: 100, y: 100 }, 6.75, [])).toBe(false)
  })
})

describe('a finger, not a mouse', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('is the CSS\'s (pointer: coarse)', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(pointer: coarse)' }))
    expect(coarsePointer()).toBe(true)
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    expect(coarsePointer()).toBe(false)
  })

  it('is a mouse where the screen cannot say', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(coarsePointer()).toBe(false)
    vi.stubGlobal('matchMedia', () => { throw new Error('no') })
    expect(coarsePointer()).toBe(false)
  })
})

/**
 * Review (round G): (pointer: coarse) describes the screen's primary
 * pointer only. A touchscreen laptop's finger got no reach, and a phone's
 * mouse got it. Each tap goes by the pointer that made it.
 */
describe('the pointer that made a tap on a map', () => {
  afterEach(() => vi.unstubAllGlobals())
  const screen = (coarse: boolean) => vi.stubGlobal('matchMedia', (q: string) => ({ matches: coarse && q === '(pointer: coarse)' }))
  const up = (pointerType: string) => ({ pointerType })
  const click = (pointerType?: string) => (pointerType === undefined ? {} : { pointerType }) as unknown as Event

  it("a finger or a pen gets the reach and a mouse does not, whatever the screen's own pointer", () => {
    for (const coarse of [false, true]) {
      screen(coarse)
      const taps = tapPointers()
      for (const [type, reach] of [['touch', true], ['pen', true], ['mouse', false]] as const) {
        taps.up(up(type))
        expect(taps.reach(click(type))).toBe(reach)
      }
    }
  })

  // WebKit bug 282988: from Safari 18.2 a finger's click says 'mouse', while
  // the pointerup before it says 'touch'.
  it("goes by the pointer let go on the map before the click's own: Safari's finger click says mouse", () => {
    screen(false)
    const taps = tapPointers()
    taps.up(up('touch'))
    expect(taps.reach(click('mouse'))).toBe(true)
    screen(true)
    taps.up(up('mouse'))
    expect(taps.reach(click('touch'))).toBe(false)
  })

  it("with no pointer let go on the map, goes by the click's own", () => {
    screen(false)
    const taps = tapPointers()
    expect(taps.reach(click('touch'))).toBe(true)
    expect(taps.reach(click('pen'))).toBe(true)
    screen(true)
    expect(taps.reach(click('mouse'))).toBe(false)
  })

  // Safari before 18.2 gives a click as a MouseEvent, with no pointerType.
  // A pointer the browser can't name is '' (MDN, PointerEvent.pointerType).
  it('where neither names a pointer, goes by the screen: (pointer: coarse)', () => {
    for (const coarse of [false, true]) {
      screen(coarse)
      const taps = tapPointers()
      expect(taps.reach(click())).toBe(coarse)
      expect(taps.reach(undefined)).toBe(coarse)
      taps.up(up(''))
      expect(taps.reach(click(''))).toBe(coarse)
      taps.up(up('x-vendor-wand'))
      expect(taps.reach(click())).toBe(coarse)
    }
  })

  it('forgets the pointer at each click, so a click that follows none reads its own', () => {
    screen(false)
    const taps = tapPointers()
    taps.up(up('touch'))
    expect(taps.reach(click('mouse'))).toBe(true)
    expect(taps.reach(click('mouse'))).toBe(false)
    expect(taps.reach(click())).toBe(false)
  })
})
