<script setup lang="ts">
import { toasts, dismissToast, runToastAction } from '@/lib/toast'
import { t } from '@/lib/i18n'
</script>

<template>
  <!-- A live region, so "couldn't sync / fetch" is actually spoken — it used to
       appear and vanish again without a screen reader saying a word. It must
       already be in the page when a toast arrives, hence on the container;
       errors interrupt (role=alert) rather than wait their turn. -->
  <TransitionGroup tag="div" class="toasts" name="toast" aria-live="polite">
    <div v-for="toast in toasts" :key="toast.id" class="toast" :class="toast.type"
      :role="toast.type === 'error' ? 'alert' : undefined">
      <span class="msg">{{ toast.message }}</span>
      <button v-if="toast.action" class="act" @click="runToastAction(toast.id)">{{ toast.action.label }}</button>
      <button class="x" :aria-label="t('close')" :title="t('close')" @click="dismissToast(toast.id)">✕</button>
    </div>
  </TransitionGroup>
</template>

<style scoped>
.toasts { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 2000; display: flex; flex-direction: column; gap: 8px; width: min(440px, calc(100vw - 24px)); }
.toast { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.4); font-size: 0.84rem; border: 1px solid var(--border); }
.toast.info { background: var(--bg-card); color: var(--text); }
.toast.error { background: #2a0f12; border-color: rgba(239,68,68,.5); color: #fecaca; }
.msg { flex: 1; }
.act { background: var(--primary); color: #07111f; border: none; border-radius: 6px; padding: 4px 10px; font-weight: 700; cursor: pointer; font-size: 0.78rem; }
.x { background: none; border: none; color: var(--muted); cursor: pointer; font-size: 0.8rem; }
.toast-enter-active, .toast-leave-active { transition: opacity .25s ease, transform .25s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(12px); }
</style>
