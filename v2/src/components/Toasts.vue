<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, type ComponentPublicInstance } from 'vue'
import { toasts, shownToasts, dismissToast, runToastAction, showNextWaiting, toastSpace } from '@/lib/toast'
import { t } from '@/lib/i18n'

// The stack's height, as room the page leaves at its end (--toast-space;
// style.css .shell): standing toasts covered the page's last buttons, and
// the page couldn't scroll them clear. Measured as it changes (a toast
// comes or goes, a sentence wraps, a language switch).
const stack = ref<ComponentPublicInstance | null>(null)
let watcher: ResizeObserver | undefined
onMounted(() => {
  const el = stack.value?.$el as HTMLElement | undefined
  if (!el || typeof ResizeObserver === 'undefined') return
  watcher = new ResizeObserver(() => document.documentElement.style.setProperty('--toast-space', toastSpace(el.offsetHeight)))
  watcher.observe(el)
})
onBeforeUnmount(() => watcher?.disconnect())

// Over the cap, a toast that stays waits out of sight for room (lib/toast).
// With nothing to see, a spot's Fortryd that waited read as lost: a short
// line over the stack says how many wait. It is a button: a tap brings the
// next one forward, and the oldest shown waits in its place (showNextWaiting).
// Its name starts with what it shows, then says what a tap does.
const waiting = computed(() => toasts.value.length - shownToasts.value.length)

// A tap is a swap, and the group goes by 'toast-swap' for its render only.
// The toast sent to wait fades where it stood, out of the stack's flow (pin,
// .toast-swap-leave-active), while the one brought forward fades in. Left in
// the flow, the stack held both for the 0.25 s of the fade, grew upwards,
// and the line jumped up a toast's height and back.
const swapping = ref(false)
async function tap() {
  swapping.value = true
  showNextWaiting()
  await nextTick()
  swapping.value = false
}
// Holds a toast leaving in a swap where it stood: its class takes it out of
// the flow, and these keep its place and width meanwhile. Its place is
// measured from the stack's bottom edge, which stays put on screen while
// the stack's height changes (one brought forward as an extra, or a
// sentence that wraps to another line).
function pin(el: Element) {
  const height = (stack.value?.$el as HTMLElement | undefined)?.offsetHeight
  if (!swapping.value || height === undefined) return
  const box = el as HTMLElement
  Object.assign(box.style, {
    bottom: `${height - box.offsetTop - box.offsetHeight}px`, left: `${box.offsetLeft}px`, width: `${box.offsetWidth}px`,
  })
}
</script>

<template>
  <!-- A live region, so "couldn't sync / fetch" is actually spoken — it used to
       appear and vanish again without a screen reader saying a word. It must
       already be in the page when a toast arrives, hence on the container;
       errors interrupt (role=alert) rather than wait their turn. -->
  <TransitionGroup ref="stack" tag="div" class="toasts" :name="swapping ? 'toast-swap' : 'toast'" aria-live="polite"
    @before-leave="pin">
    <button v-if="waiting" key="waiting" type="button" class="toasts-waiting"
      :aria-label="t('toast_waiting_label').replace('{n}', String(waiting))"
      :title="t('toast_waiting_label').replace('{n}', String(waiting))"
      @click="tap()">{{ t('toast_waiting').replace('{n}', String(waiting)) }}</button>
    <div v-for="toast in shownToasts" :key="toast.id" class="toast" :class="toast.type"
      :role="toast.type === 'error' ? 'alert' : undefined">
      <span class="msg">{{ toast.message }}</span>
      <button v-if="toast.action" class="act" @click="runToastAction(toast.id)">{{ toast.action.label }}</button>
      <button class="x" :aria-label="t('close')" :title="t('close')" @click="dismissToast(toast.id)">✕</button>
    </div>
  </TransitionGroup>
</template>

<style scoped>
/* The stack is a toast wide: only what it shows takes a tap, so a tap in the
   gaps between toasts, or beside the waiting line, reaches the page. */
.toasts { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 2000; display: flex; flex-direction: column; gap: 8px; width: min(440px, calc(100vw - 24px)); pointer-events: none; }
.toast, .toasts-waiting { pointer-events: auto; }
.toast { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.4); font-size: 0.84rem; border: 1px solid var(--border); }
.toast.info { background: var(--bg-card); color: var(--text); }
.toast.error { background: #2a0f12; border-color: rgba(239,68,68,.5); color: #fecaca; }
.msg { flex: 1; }
/* A line, not a toast: about 30 px of the stack, where a toast is 100 on a phone.
   A button, as small: one line of text, so its height follows from these. */
.toasts-waiting { align-self: center; padding: 2px 10px; border-radius: 999px; background: var(--bg-card); border: 1px solid var(--border); color: var(--muted); font: inherit; font-size: 0.72rem; line-height: 16px; box-shadow: 0 2px 8px rgba(0,0,0,.3); cursor: pointer; }
@media (hover: hover) { .toasts-waiting:hover { color: var(--text); } }
.act { background: var(--primary); color: #07111f; border: none; border-radius: 6px; padding: 4px 10px; font-weight: 700; cursor: pointer; font-size: 0.78rem; }
.x { background: none; border: none; color: var(--muted); cursor: pointer; font-size: 0.8rem; }
/* At the toast's bottom edge, which stays put (the stack grows up from the
   bottom): Fortryd steps back through a spot's changes in the same toast,
   and centred it moved whenever the older sentence was shorter. */
.act, .x { align-self: flex-end; }
/* Fortryd and ✕ were 64x22 and 23x19 px for a finger. On touch screens an
   invisible area makes each 40 px tall inside the toast's own 10 px padding:
   the toast keeps its look, and no area reaches the other button (10 px
   apart) or the next toast. */
@media (pointer: coarse) {
  .act, .x { position: relative; }
  .act::after { content: ''; position: absolute; inset: -9px 0; }
  .x::after { content: ''; position: absolute; inset: -11px -9px; }
  /* The line over the stack: 26 px tall here, and 40 to a finger. Its area
     reaches 7 px up and down: short of the toast 8 px under it, and of the
     page, which ends 8 px over the stack (lib/toast toastSpace). */
  .toasts-waiting { position: relative; line-height: 20px; }
  .toasts-waiting::after { content: ''; position: absolute; inset: -8px 0; }
}
.toast-enter-active, .toast-leave-active { transition: opacity .25s ease, transform .25s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(12px); }
/* A tap's swap (tap): the toast sent to wait fades where it stood, out of the
   flow (pin keeps its place), and takes no tap meant for the one fading in.
   Those whose place on screen changes slide to it. */
.toast-swap-enter-active, .toast-swap-leave-active { transition: opacity .25s ease; }
.toast-swap-enter-from, .toast-swap-leave-to { opacity: 0; }
.toast-swap-leave-active { position: absolute; pointer-events: none; }
.toast-swap-move { transition: transform .25s ease; }
</style>
