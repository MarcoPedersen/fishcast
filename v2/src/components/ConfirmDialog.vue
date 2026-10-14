<script setup lang="ts">
import { watch } from 'vue'
import { t } from '@/lib/i18n'
import { confirmState, confirmAccept, confirmCancel } from '@/lib/confirm'
import { useModal } from '@/lib/useModal'

// Focus has to move into the dialog: every prompt is raised by a button click,
// which leaves that button focused behind the overlay — so Enter clicked it
// again, re-raising the prompt instead of confirming, and Tab walked the whole
// page before reaching the dialog. useModal focuses Cancel (data-autofocus),
// traps Tab, closes on Escape and hands focus back to the trigger afterwards.
// Cancel, not Confirm: every prompt here guards something destructive (delete
// a spot, reset choices, replace the setup from a link, log out with unsynced
// edits), so a stray Enter after 🗑 must not be the thing that deletes.
const { dialogRef } = useModal(() => confirmState.open, confirmCancel)

// Enter accepts — unless a button has focus, in which case the button's own
// (native Enter→click) action must win, otherwise tabbing to "Cancel" and
// pressing Enter would confirm the destructive action.
function onKey(e: KeyboardEvent) {
  if (!confirmState.open) return
  if (e.key === 'Enter' && !(document.activeElement instanceof HTMLButtonElement)) confirmAccept()
}
watch(() => confirmState.open, (open) => {
  if (open) document.addEventListener('keydown', onKey)
  else document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div v-if="confirmState.open" class="overlay" @click.self="confirmCancel">
    <div ref="dialogRef" class="card dlg" role="alertdialog" aria-modal="true" tabindex="-1"
      aria-labelledby="confirm-dlg-title" aria-describedby="confirm-dlg-msg">
      <strong id="confirm-dlg-title" class="dlg-title">🎣 FishCast</strong>
      <p id="confirm-dlg-msg" class="dlg-msg">{{ confirmState.message }}</p>
      <div class="dlg-actions">
        <button class="btn ghost" data-autofocus @click="confirmCancel">{{ t('dlg_cancel') }}</button>
        <button class="btn primary" @click="confirmAccept">{{ t('dlg_confirm') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: grid; place-items: center; z-index: 3000; padding: 16px; }
.dlg { max-width: 360px; width: 100%; }
.dlg-title { display: block; font-size: 0.95rem; }
.dlg-msg { margin: 10px 0 16px; font-size: 0.9rem; color: var(--text); }
.dlg-actions { display: flex; gap: 8px; justify-content: flex-end; }
</style>
