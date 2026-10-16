import { describe, it, expect } from 'vitest'
import { decidePull, type PullState } from './sync'

/**
 * The pull decision. It used to be last-write-wins on wall-clock stamps: a
 * local edit stamped after the row's updated_at pushed the whole local
 * document, so a phone's offline catch on a Saturday-morning copy replaced
 * the 8-catch row with its 6. Now the store remembers which row version its
 * copy was built on (the base) and asks only "has the row moved since?".
 */
const own = (over: Partial<PullState> = {}): PullState => ({
  remote: 'base', localEmpty: false, owner: 'own', dirty: false, hasBase: true, ...over,
})

describe('decidePull — the account has a row', () => {
  it('has nothing to do when the row is still our base and nothing is unsynced', () => {
    expect(decidePull(own())).toBe('none')
  })

  it('pushes unsynced edits made on top of exactly what the row holds', () => {
    expect(decidePull(own({ dirty: true }))).toBe('push')
  })

  it('adopts a row another device moved on, when nothing here is unsynced', () => {
    expect(decidePull(own({ remote: 'moved' }))).toBe('take-remote')
  })

  /**
   * The confirmed failure: both sides changed since the base. Last-write-wins
   * picked one whole document; a three-way merge keeps both sides' work.
   */
  it('merges when the row moved on AND this document has unsynced edits', () => {
    expect(decidePull(own({ remote: 'moved', dirty: true }))).toBe('merge')
  })

  it('unions a legacy document (no base) that has unsynced edits — nothing can be told apart, so nothing is dropped', () => {
    expect(decidePull(own({ remote: 'moved', dirty: true, hasBase: false }))).toBe('union')
  })

  it('adopts the row over a legacy document with nothing unsynced', () => {
    expect(decidePull(own({ remote: 'moved', hasBase: false }))).toBe('take-remote')
  })
})

/**
 * Regression — guest data replacing an account. An 18-location account was
 * opened on a device where 3 spots had been added as a guest; guest data is
 * always "newer", so last-write-wins pushed the 3 over the 18. Local data that
 * isn't the account's own never wins, and is never merged into it either.
 */
describe('decidePull — local data that is not the account’s', () => {
  it('takes the row over a guest document, however unsynced', () => {
    expect(decidePull(own({ owner: 'guest', dirty: true, hasBase: false, remote: 'moved' }))).toBe('take-remote')
  })

  it("takes the row over another account's leftovers", () => {
    expect(decidePull(own({ owner: 'foreign', dirty: true, remote: 'moved' }))).toBe('take-remote')
  })
})

/**
 * Regression: signing out wiped local state, and the watcher then stamped
 * the empty result as the newest edit; on the next login it overwrote the
 * account. An empty local document is a wipe or a fresh install, never an
 * intentional deletion, so it never reaches the row — base or no base.
 */
describe('decidePull — an empty local document', () => {
  it('always takes the row', () => {
    for (const remote of ['base', 'moved'] as const) {
      for (const dirty of [false, true]) {
        for (const hasBase of [false, true]) {
          expect(decidePull(own({ localEmpty: true, remote, dirty, hasBase }))).toBe('take-remote')
        }
      }
    }
  })
})

describe('decidePull — the account has no row yet', () => {
  it('claims a guest document (new-account onboarding) or the account’s own', () => {
    expect(decidePull(own({ remote: 'none', owner: 'guest', hasBase: false }))).toBe('claim')
    expect(decidePull(own({ remote: 'none', owner: 'own', dirty: true }))).toBe('claim')
    expect(decidePull(own({ remote: 'none', owner: 'own', localEmpty: true }))).toBe('claim')
  })

  it("leaves another account's leftovers alone", () => {
    expect(decidePull(own({ remote: 'none', owner: 'foreign' }))).toBe('ignore')
  })
})
