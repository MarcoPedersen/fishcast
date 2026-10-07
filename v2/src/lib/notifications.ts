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

/**
 * Chrome for Android (installed PWA included) has no usable Notification
 * constructor — it throws "Illegal constructor" — so go through the service
 * worker when there is one. A failure is logged: thrown from a timer it only
 * vanished, while the toggle still said reminders were on.
 */
async function show(title: string, opts: NotificationOptions) {
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) await reg.showNotification(title, opts)
    else new Notification(title, opts)
  } catch (e) {
    console.warn('Reminder could not be shown:', e)
  }
}

/**
 * Schedule up to 3 reminders, 30 min before slots with a window scoring >= 55
 * within the next 24h — one per slot, naming its best spot.
 */
export function scheduleWindowNotifications(windows: ScoredWindow[]): number {
  // Clear even when we can't schedule: an empty list (sign-out, last slot
  // removed) or revoked permission must not leave the old timers armed.
  clearScheduled()
  if (!supported() || Notification.permission !== 'granted') return 0
  const now = Date.now()
  // One reminder per slot. With 18 spots the top windows are usually the same
  // slot at different spots; they shared a tag, so each replaced the last and
  // the one left on screen was the 3rd-best spot.
  const slots = new Map<string, { best: ScoredWindow; more: number; delay: number }>()
  for (const w of [...windows].sort((a, b) => b.score - a.score)) {
    if (w.score < 55 || w.noData) continue
    // w.from is local wall-clock time — anchor locally so the reminder fires
    // 30 min before the user's actual start, not the UTC-shifted one. Minutes
    // too: parseInt('05:30') announced a 05:30 start at 04:30.
    const [h, m] = w.from.split(':').map(Number)
    const winMs = new Date(w.date.getUTCFullYear(), w.date.getUTCMonth(), w.date.getUTCDate(), h, m || 0).getTime()
    const delay = winMs - now - 30 * 60000
    if (delay <= 0 || delay > 24 * 3600000) continue
    const key = w.date.toISOString().slice(0, 10) + '-' + w.from + '-' + w.to
    const slot = slots.get(key)
    if (slot) slot.more++
    else if (slots.size < 3) slots.set(key, { best: w, more: 0, delay })
  }
  for (const [key, { best: w, more, delay }] of slots) {
    const others = more ? ' · ' + t('notif_more').replace('{n}', String(more)) : ''
    timers.push(setTimeout(() => {
      void show(t('notif_title'), {
        body: `${w.location.name} · ${w.from}–${w.to} · ${scoreLabel(w.score)} (${w.score})${others}`,
        icon: '/fishcast/v2/icons/icon.svg',
        tag: 'fc-' + key,
      })
    }, delay))
  }
  return slots.size
}
