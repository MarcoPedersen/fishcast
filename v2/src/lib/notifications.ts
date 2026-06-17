/** Web Notifications — permission + scheduling reminders before good windows. */
import { t } from './i18n'
import { scoreLabel } from './scoring'
import type { ScoredWindow } from './types'

const LS_KEY = 'fc2-notifs'
const timers: ReturnType<typeof setTimeout>[] = []

export function notifsEnabled(): boolean {
  return localStorage.getItem(LS_KEY) === '1' && supported() && Notification.permission === 'granted'
}
export function supported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}
export function permission(): NotificationPermission | 'unsupported' {
  return supported() ? Notification.permission : 'unsupported'
}

export async function enableNotifications(): Promise<boolean> {
  if (!supported()) return false
  const perm = await Notification.requestPermission()
  if (perm === 'granted') { localStorage.setItem(LS_KEY, '1'); return true }
  return false
}

export function disableNotifications() {
  localStorage.removeItem(LS_KEY)
  clearScheduled()
}

function clearScheduled() {
  timers.forEach(clearTimeout)
  timers.length = 0
}

/** Schedule up to 3 reminders, 30 min before windows scoring >= 55 within the next 24h. */
export function scheduleWindowNotifications(windows: ScoredWindow[]): number {
  if (!supported() || Notification.permission !== 'granted') return 0
  clearScheduled()
  const now = Date.now()
  let count = 0
  for (const w of windows) {
    if (count >= 3) break
    if (w.score < 55 || w.noData) continue
    const winMs = Date.UTC(w.date.getUTCFullYear(), w.date.getUTCMonth(), w.date.getUTCDate(), parseInt(w.from))
    const delay = winMs - now - 30 * 60000
    if (delay <= 0 || delay > 24 * 3600000) continue
    count++
    timers.push(setTimeout(() => {
      new Notification(t('notif_title'), {
        body: `${w.location.name} · ${w.from}–${w.to} · ${scoreLabel(w.score)} (${w.score})`,
        icon: '/fishcast/v2/icons/icon.svg',
        tag: 'fc-' + w.date.toISOString().slice(0, 10) + '-' + w.from,
      })
    }, delay))
  }
  return count
}
