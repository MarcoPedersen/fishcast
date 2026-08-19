import { describe, it, expect } from 'vitest'
import { reconcile } from './sync'

describe('reconcile (last-write-wins)', () => {
  it('adopts remote when there is no local edit history', () => {
    expect(reconcile(0, { data: { x: 1 }, updatedAt: 1000 })).toBe('take-remote')
  })

  it('adopts remote when it is strictly newer than local', () => {
    expect(reconcile(1000, { data: { x: 1 }, updatedAt: 2000 })).toBe('take-remote')
  })

  it('keeps local when local has newer un-synced edits', () => {
    expect(reconcile(2000, { data: { x: 1 }, updatedAt: 1000 })).toBe('keep-local')
  })

  it('prefers remote on an exact tie (already in sync — no-op adopt)', () => {
    expect(reconcile(1500, { data: { x: 1 }, updatedAt: 1500 })).toBe('take-remote')
  })

  it('does nothing when there is no remote document', () => {
    expect(reconcile(0, { data: null, updatedAt: 0 })).toBe('noop')
    expect(reconcile(5000, { data: null, updatedAt: 0 })).toBe('noop')
  })

  // Regression: signing out wiped local state, and the store's watcher then
  // stamped a fresh updatedAt onto the empty result. On the next login that
  // "newest" empty document won and overwrote the account's real data.
  it('never lets an empty local document beat real remote data, however new', () => {
    const remote = { data: { locations: ['a', 'b'] }, updatedAt: 1000 }
    expect(reconcile(Date.now(), remote, true)).toBe('take-remote')
    expect(reconcile(9_999_999_999, remote, true)).toBe('take-remote')
  })

  it('still keeps newer local edits when local actually has content', () => {
    const remote = { data: { locations: ['a'] }, updatedAt: 1000 }
    expect(reconcile(2000, remote, false)).toBe('keep-local')
  })

  it('reports noop for an empty local side when there is no remote data either', () => {
    expect(reconcile(Date.now(), { data: null, updatedAt: 0 }, true)).toBe('noop')
  })
})

/**
 * Regression — guest data replacing an account.
 *
 * Real incident: an 18-location account was opened on a device where the user
 * had already added 3 spots as a guest (login wasn't available in that build).
 * Guest data is always "newer" simply because it was just created, so plain
 * last-write-wins returned keep-local and the caller pushed 3 locations over
 * the 18. Local data that isn't the account's own must never win that compare.
 */
describe('reconcile — foreign local document', () => {
  const remote = { data: { locations: new Array(18) }, updatedAt: 1_000 }

  it('prefers remote when local belongs to nobody (guest data), however new', () => {
    expect(reconcile(9_999_999, remote, false, true)).toBe('take-remote')
  })

  it('still lets the account own newer offline edits win', () => {
    expect(reconcile(9_999_999, remote, false, false)).toBe('keep-local')
  })

  it('defers to remote when the account has no newer local work', () => {
    expect(reconcile(500, remote, false, false)).toBe('take-remote')
  })

  it('keeps guest data when the account has no row yet (new-account onboarding)', () => {
    expect(reconcile(9_999_999, { data: null, updatedAt: 0 }, false, true)).toBe('noop')
  })

  it('empty local never wins, foreign or not', () => {
    expect(reconcile(9_999_999, remote, true, false)).toBe('take-remote')
    expect(reconcile(9_999_999, remote, true, true)).toBe('take-remote')
  })
})
