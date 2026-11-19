import { afterEach, describe, it, expect, vi } from 'vitest'
import { downloadWindowIcs, windowToIcs } from './calendar'
import type { ScoredWindow } from './types'
import { STRINGS } from '@/test/strings'

const STAMP = new Date(Date.UTC(2026, 5, 15, 9, 0, 0))

function win(from: string, to: string): ScoredWindow {
  return {
    location: { id: 'l1', name: 'Nordmolen', lat: 55.25, lon: 14.83 },
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

/**
 * RFC 5545 3.1: a content line is at most 75 octets, longer ones folded
 * (CRLF, then a space), and every line ends in CRLF, the last one too.
 * Unfolded, a window with its lure colours had a 90-octet DESCRIPTION, and
 * a long spot name a long SUMMARY; the file ended without its CRLF.
 */
describe('windowToIcs content lines', () => {
  const octets = (s: string) => new TextEncoder().encode(s).length
  // An emoji where the SUMMARY's 75th octet falls: two UTF-16 units, four octets.
  const NAME = 'a'.repeat(50) + '🎣 Molen, nord; syd'
  function lured(): ScoredWindow {
    const w = win('05:30', '09:00')
    w.location = { ...w.location, name: NAME }
    w.lure = { colors: ['Sølv', 'Blå/hvid', 'Grøn/gul'].map((name) => ({ hex: '#000000', name, reason: '' })), tips: [] }
    return w
  }
  const unfold = (ics: string) => ics.replace(/\r\n /g, '')

  it('keeps every line within 75 octets', () => {
    const lines = windowToIcs(lured(), STAMP).split('\r\n')
    expect(lines.filter((l) => octets(l) > 75)).toEqual([])
    expect(lines.some((l) => l.startsWith(' '))).toBe(true) // folded, not cut
  })

  it('folds between characters, and unfolds to the whole text', () => {
    const ics = windowToIcs(lured(), STAMP)
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    for (const l of ics.split('\r\n')) expect(l).not.toMatch(lone)
    expect(field(unfold(ics), 'SUMMARY')).toBe(`🎣 ${STRINGS.da.cal_title}: ${'a'.repeat(50)}🎣 Molen\\, nord\\; syd`)
    expect(field(unfold(ics), 'DESCRIPTION')).toMatch(/\\n🎨 [^\\]+: Sølv\\, Blå\/hvid\\, Grøn\/gul$/)
  })

  // A name long enough for several continuation lines: each begins with its
  // space, so it holds 74 octets of the text, not 75. The emojis start at
  // every offset, so one of them meets a fold whichever way the count falls.
  it('keeps continuation lines within 75 octets too, wherever an emoji meets a fold', () => {
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    for (let k = 0; k < 8; k++) {
      const w = win('06:00', '10:00')
      w.location = { ...w.location, name: 'a'.repeat(k) + '🎣'.repeat(30) + 'b'.repeat(200) }
      const ics = windowToIcs(w, STAMP)
      const lines = ics.split('\r\n')
      expect(lines.filter((l) => octets(l) > 75)).toEqual([])
      expect(lines.filter((l) => lone.test(l))).toEqual([])
      expect(field(unfold(ics), 'LOCATION')).toBe(w.location.name)
    }
  })

  it('ends every line in CRLF, the last one too, and leaves short lines whole', () => {
    const ics = windowToIcs(win('06:00', '10:00'), STAMP)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics.split('\r\n').some((l) => l.startsWith(' '))).toBe(false)
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
