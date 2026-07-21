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
})
