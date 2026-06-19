/**
 * Calendar export — turn a scored fishing window into a downloadable .ics
 * event (RFC 5545). Times are written as "floating" local time (no TZID/Z) so
 * the event lands at the stated wall-clock hour in whatever calendar imports it.
 */
import { t } from './i18n'
import { scoreLabel } from './scoring'
import type { ScoredWindow } from './types'

const pad = (n: number) => String(n).padStart(2, '0')

/** Local Y/M/D from the window date + 'HH:MM' → 'YYYYMMDDTHHMMSS' (floating). */
function floatingStamp(date: Date, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `T${pad(h || 0)}${pad(m || 0)}00`
  )
}

/** UTC stamp 'YYYYMMDDTHHMMSSZ' for DTSTAMP. */
function utcStamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  )
}

/** Escape per RFC 5545: backslash, comma, semicolon, newline. */
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/[,;]/g, (c) => '\\' + c).replace(/\n/g, '\\n')
}

export function windowToIcs(w: ScoredWindow, stamp: Date = new Date()): string {
  const title = `🎣 ${t('cal_title')}: ${w.location.name}`
  const descParts = [`${t('cal_score')}: ${w.score} · ${scoreLabel(w.score)}`]
  if (w.bestHourStr) descParts.push(`${t('best_hour')} ${w.bestHourStr}`)
  if (w.lure?.colors.length) descParts.push(`${t('lure_label')} ${w.lure.colors.map((c) => c.name).join(', ')}`)

  // Stable UID from coords + slot, so re-importing updates rather than duplicates.
  const uid = `fc-${w.location.lat.toFixed(4)}_${w.location.lon.toFixed(4)}-${floatingStamp(w.date, w.from)}@fishcast`

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//FishCast//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${utcStamp(stamp)}`,
    `DTSTART:${floatingStamp(w.date, w.from)}`,
    `DTEND:${floatingStamp(w.date, w.to)}`,
    `SUMMARY:${esc(title)}`,
    `DESCRIPTION:${esc(descParts.join('\n'))}`,
    `LOCATION:${esc(w.location.name)}`,
    `GEO:${w.location.lat};${w.location.lon}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  // RFC 5545 line endings are CRLF.
  return lines.join('\r\n')
}

/** Trigger a browser download of the window as an .ics file. */
export function downloadWindowIcs(w: ScoredWindow): void {
  const ics = windowToIcs(w)
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const day = `${w.date.getFullYear()}-${pad(w.date.getMonth() + 1)}-${pad(w.date.getDate())}`
  a.href = url
  a.download = `fishcast-${day}.ics`
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Release the object URL on the next tick so the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
