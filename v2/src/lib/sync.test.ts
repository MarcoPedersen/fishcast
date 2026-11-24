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

  /**
   * The catch log is the exception: it only ever holds what the user caught,
   * so a guest log taken over by the row was catches lost — logged on a new
   * phone before signing in, or after "Log ud". It joins the row instead.
   */
  it('joins a guest document that asks for it (the catch log) to the row', () => {
    for (const dirty of [false, true]) {
      expect(decidePull(own({ owner: 'guest', dirty, hasBase: false, remote: 'moved', guest: 'join' }))).toBe('join')
    }
  })

  it('never joins an empty guest document, or another account’s leftovers', () => {
    expect(decidePull(own({ owner: 'guest', localEmpty: true, hasBase: false, remote: 'moved', guest: 'join' }))).toBe('take-remote')
    expect(decidePull(own({ owner: 'foreign', dirty: true, remote: 'moved', guest: 'join' }))).toBe('take-remote')
  })
})

/**
 * Regression: signing out wiped local state, and the watcher then stamped
 * the empty result as the newest edit; on the next login it overwrote the
 * account. An empty document that can be a wipe or a fresh install — a
 * guest's, another account's, one with no base, or one with nothing unsynced
 * — never reaches the row.
 */
describe('decidePull — an empty local document', () => {
  it('takes the row unless it is the account’s own unsynced edit on a known base', () => {
    for (const remote of ['base', 'moved'] as const) {
      for (const whose of ['own', 'guest', 'foreign'] as const) {
        for (const dirty of [false, true]) {
          for (const hasBase of [false, true]) {
            for (const guest of [undefined, 'replace', 'join'] as const) {
              if (whose === 'own' && dirty && hasBase) continue
              expect(decidePull(own({ localEmpty: true, remote, owner: whose, dirty, hasBase, guest })), `${remote} ${whose} ${dirty} ${hasBase} ${guest}`).toBe('take-remote')
            }
          }
        }
      }
    }
  })

  /**
   * The account's own document, with unsynced edits on top of a row version
   * it knows, was emptied by those edits. Taken for a wipe, the last time
   * window removed offline in a setup of windows only came back on the next
   * sync. It is an edit like any other.
   *
   * Merged with the row, even one still at its base: against a base that
   * holds what the row holds, the merge is the emptied document, sent as a
   * push would send it. Against a base that claims the row's version but
   * holds less of it, a push emptied the account; the merge can only delete
   * what the base held, and keeps the rest of the row.
   */
  it('merges the account’s own edit that emptied it, made on top of exactly what the row holds', () => {
    expect(decidePull(own({ localEmpty: true, dirty: true }))).toBe('merge')
  })

  it('merges that edit when the row moved on meanwhile, as any other edit', () => {
    expect(decidePull(own({ localEmpty: true, dirty: true, remote: 'moved' }))).toBe('merge')
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
