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
