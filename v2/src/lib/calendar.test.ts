import { afterEach, describe, it, expect, vi } from 'vitest'
import { downloadWindowIcs, windowToIcs } from './calendar'
import type { ScoredWindow } from './types'

const STAMP = new Date(Date.UTC(2026, 5, 15, 9, 0, 0))

function win(from: string, to: string): ScoredWindow {
  return {
    location: { id: 'l1', name: 'Tejn mole', lat: 55.25, lon: 14.83 },
    // Local midnight, matching how the dashboard hands dates to the exporter.
    date: new Date(2026, 5, 15),
    from, to, score: 62, noData: false, bestHourStr: '23:00', tags: [],
  }
}
const field = (ics: string, name: string) =>
  ics.split('\r\n').find((l) => l.startsWith(name + ':'))!.slice(name.length + 1)

describe('windowToIcs', () => {
  it('keeps an ordinary window on one day', () => {
    const ics = windowToIcs(win('06:00', '10:00'), STAMP)
    expect(field(ics, 'DTSTART')).toBe('20260615T060000')
    expect(field(ics, 'DTEND')).toBe('20260615T100000')
  })

  /**
   * Regression: DTEND used the window's own date, so an overnight window ended
   * before it started — an invalid VEVENT that calendars either reject or
   * silently import as a 22-hour backwards event.
   */
  it('rolls DTEND to the next day for an overnight window', () => {
    const ics = windowToIcs(win('22:00', '02:00'), STAMP)
    expect(field(ics, 'DTSTART')).toBe('20260615T220000')
    expect(field(ics, 'DTEND')).toBe('20260616T020000')
    expect(field(ics, 'DTEND') > field(ics, 'DTSTART')).toBe(true)
  })

  // "Every day 06:00–09:00" and "Sat+Sun 06:00–14:00" both list a Saturday
  // card. Keyed on the start alone, the second import replaced the first event
  // instead of adding its own.
  it('gives two windows with the same start different UIDs', () => {
    const short = field(windowToIcs(win('06:00', '09:00'), STAMP), 'UID')
    const long = field(windowToIcs(win('06:00', '14:00'), STAMP), 'UID')
    expect(short).not.toBe(long)
    expect(field(windowToIcs(win('06:00', '09:00'), STAMP), 'UID')).toBe(short) // still stable
  })

  it('rolls across a month boundary too', () => {
    const w = win('23:00', '01:00')
    w.date = new Date(2026, 5, 30) // 30 June → 1 July
    expect(field(windowToIcs(w, STAMP), 'DTEND')).toBe('20260701T010000')
  })
})

describe('downloadWindowIcs', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /**
   * Regression: the blob URL was revoked on the next tick. iOS Safari reads it
   * only after the user answers its download / add-to-calendar sheet, by which
   * point the URL was gone ("WebKitBlobResource error 1") and nothing was added.
   */
  it('keeps the blob URL alive long enough for a confirm sheet', () => {
    vi.useFakeTimers()
    const click = vi.fn()
    vi.stubGlobal('document', {
      createElement: () => ({ href: '', download: '', click, remove: () => {} }),
      body: { appendChild: () => {} },
    })
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fc-1')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    downloadWindowIcs(win('06:00', '10:00'))
    expect(create).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()

    // A user reading the sheet takes seconds, not a tick.
    vi.advanceTimersByTime(10_000)
    expect(revoke).not.toHaveBeenCalled()

    // …but the URL is still released eventually rather than leaking.
    vi.advanceTimersByTime(60_000)
    expect(revoke).toHaveBeenCalledWith('blob:fc-1')
  })
})
