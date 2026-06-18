<script setup lang="ts">
import { toasts, dismissToast } from '@/lib/toast'
</script>

<template>
  <div class="toasts">
    <div v-for="t in toasts" :key="t.id" class="toast" :class="t.type">
      <span class="msg">{{ t.message }}</span>
      <button v-if="t.action" class="act" @click="t.action.run(); dismissToast(t.id)">{{ t.action.label }}</button>
      <button class="x" aria-label="Dismiss" @click="dismissToast(t.id)">✕</button>
    </div>
  </div>
</template>

<style scoped>
.toasts { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 2000; display: flex; flex-direction: column; gap: 8px; width: min(440px, calc(100vw - 24px)); }
.toast { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.4); font-size: 0.84rem; border: 1px solid var(--border); }
.toast.info { background: var(--bg-card); color: var(--text); }
.toast.error { background: #2a0f12; border-color: rgba(239,68,68,.5); color: #fecaca; }
.msg { flex: 1; }
.act { background: var(--primary); color: #07111f; border: none; border-radius: 6px; padding: 4px 10px; font-weight: 700; cursor: pointer; font-size: 0.78rem; }
.x { background: none; border: none; color: var(--muted); cursor: pointer; font-size: 0.8rem; }
</style>
