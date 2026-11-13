import { defineStore } from 'pinia'
import { supabase, supabaseConfigured } from '@/lib/supabase'
import { storageBlocked, writeOwn } from '@/lib/safeStorage'
import { dismissToast, showToast } from '@/lib/toast'
import { t } from '@/lib/i18n'
import { useAuthStore } from './auth'

/**
 * The words that tell the user a save on the device was refused. Signed in,
 * the push still carries the edit from memory, so only closing the app
 * before it reaches the account loses it. A guest has no other copy. With
 * the storage full, making room saves it; signing in would not, since
 * auth-js needs room for the session as well. With site data blocked,
 * auth-js keeps the session in memory, so where this build has accounts,
 * signing in keeps the edits.
 */
export function refusedKey(o: { account: boolean; blocked: boolean; canSignIn: boolean }): string {
  if (o.account) return 'toast_save_account'
  if (o.blocked) return o.canSignIn ? 'toast_save_blocked_login' : 'toast_save_blocked'
  return 'toast_save_full'
}

/**
 * The saves of the user's own documents on the device — the spots
 * (stores/setup) and the catch log (stores/catches) — that the storage
 * refused. writeOwn says false when a document doesn't fit even after the
 * derived data gave way, or the storage is blocked. The stores ignored it,
 * so a guest's edit showed on screen and was gone after a reload, unsaid.
 *
 * Now the user is told once per failure streak: each keystroke saves, and
 * would toast again. The streak ends when every refused document has been
 * saved. With site data blocked no save ever works: once per visit, then.
 *
 * A Pinia store, so each app has its own: the tests open several at once.
 */
export const useLocalSaveStore = defineStore('localSave', () => {
  /** Each refused document: how to save it again, and whether it held an edit no account has. */
  const refused = new Map<string, { again: () => void; unsynced: boolean }>()
  let told = false
  let toastId: number | null = null

  /**
   * An edit no account has lives only in memory: the device refused it. Any
   * reload loses it, so the app makes none by itself then (lib/swUpdate).
   */
  const atRisk = () => [...refused.values()].some((r) => r.unsynced)

  /**
   * Save `value` under `key` (writeOwn). `unsynced`: the document holds an
   * edit no account has yet (a guest's, or one not pushed), so a refusal
   * loses it. A refused save of what the account already has is not news.
   * `again` saves the document anew, as it is by then.
   */
  function save(key: string, value: string, unsynced: boolean, again: () => void): boolean {
    if (writeOwn(key, value)) {
      saved(key)
      return true
    }
    refused.set(key, { again, unsynced })
    if (unsynced) { if (!told) tell() }
    // The push landed (or the edit was never this device's alone): nothing
    // is at risk now, so the warning comes down. The streak goes on.
    else if (!atRisk()) takeDown()
    return false
  }

  function saved(key: string) {
    refused.delete(key)
    // Room was made: what else was refused is saved now. So "delete
    // something" works whichever list the user deletes from.
    for (const [k, r] of [...refused]) if (refused.get(k) === r) r.again()
    if (!refused.size) endStreak()
  }

  function tell() {
    told = true
    const account = !!supabase && !!useAuthStore().user
    const key = refusedKey({ account, blocked: storageBlocked(), canSignIn: supabaseConfigured })
    // A guest's edit stays at risk until room is made, so the toast stays
    // until it is closed or the streak ends. Signed in, the push carries the
    // edit within seconds, and says so itself when it can't (syncFailed).
    toastId = showToast(() => '⚠️ ' + t(key), { type: 'error', ttl: account ? undefined : 0 })
  }

  function takeDown() {
    if (toastId !== null) dismissToast(toastId)
    toastId = null
  }

  function endStreak() {
    told = false
    takeDown()
  }

  /** The document was wiped (sign-out): nothing of it is left to save. */
  function forget(key: string) {
    refused.delete(key)
    if (!refused.size) endStreak()
  }

  /**
   * A sync failed. "Changes are saved locally" is untrue while the device
   * refuses a document that holds an edit: it is in memory only, until a
   * sync works (the next pull pushes it: focus, reconnect, the re-pull).
   */
  function syncFailed() {
    showToast('⚠️ ' + t(atRisk() ? 'toast_sync_failed_unsaved' : 'toast_sync_failed'), { type: 'error' })
  }

  return { save, forget, syncFailed, atRisk }
})
