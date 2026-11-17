import { afterEach, describe, expect, it, vi } from 'vitest'
import { PIN_REACH_PX, coarsePointer, pinInReach } from './pinReach'

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
