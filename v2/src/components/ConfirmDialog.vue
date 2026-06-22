<script setup lang="ts">
import { watch } from 'vue'
import { t } from '@/lib/i18n'
import { confirmState, confirmAccept, confirmCancel } from '@/lib/confirm'

// Esc cancels, Enter accepts while the dialog is open.
function onKey(e: KeyboardEvent) {
  if (!confirmState.open) return
  if (e.key === 'Escape') confirmCancel()
  if (e.key === 'Enter') confirmAccept()
}
watch(() => confirmState.open, (open) => {
  if (open) document.addEventListener('keydown', onKey)
  else document.removeEventListener('keydown', onKey)
})
</script>

<template>
  <div v-if="confirmState.open" class="overlay" @click.self="confirmCancel">
    <div class="card dlg" role="alertdialog" aria-modal="true">
      <strong class="dlg-title">🎣 FishCast</strong>
      <p class="dlg-msg">{{ confirmState.message }}</p>
      <div class="dlg-actions">
        <button class="btn ghost" @click="confirmCancel">{{ t('dlg_cancel') }}</button>
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
