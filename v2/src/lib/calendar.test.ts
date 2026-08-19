import { describe, it, expect } from 'vitest'
import { windowToIcs } from './calendar'
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

  it('rolls across a month boundary too', () => {
    const w = win('23:00', '01:00')
    w.date = new Date(2026, 5, 30) // 30 June → 1 July
    expect(field(windowToIcs(w, STAMP), 'DTEND')).toBe('20260701T010000')
  })
})
