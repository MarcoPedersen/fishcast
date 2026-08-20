<script setup lang="ts">
import { useRouter } from 'vue-router'
import { spName, spTip, spWarning, t } from '@/lib/i18n'
import { SPECIES_PREFS } from '@/lib/species'
import { useSetupStore } from '@/stores/setup'
import { useModal } from '@/lib/useModal'
import { ref } from 'vue'

const router = useRouter()
const setup = useSetupStore()
const species = Object.values(SPECIES_PREFS)
const warningFor = ref<string | null>(null)
const { dialogRef: warnRef } = useModal(() => warningFor.value != null, () => { warningFor.value = null })

function toggle(id: string) {
  const sp = SPECIES_PREFS[id]
  if (sp?.banned) { warningFor.value = id; return }
  setup.targetSpecies = setup.targetSpecies.includes(id)
    ? setup.targetSpecies.filter((x) => x !== id)
    : [...setup.targetSpecies, id]
}
</script>

<template>
  <div class="wizard">
    <h1>{{ t('sp_title') }}</h1>
    <p class="sub">{{ t('sp_sub') }}</p>

    <div class="grid">
      <div v-for="sp in species" :key="sp.id" class="card sp"
        :class="{ selected: setup.targetSpecies.includes(sp.id), banned: sp.banned }"
        tabindex="0" :aria-label="spName(sp)" :aria-pressed="setup.targetSpecies.includes(sp.id)"
        @click="toggle(sp.id)" @keydown.enter.prevent="toggle(sp.id)" @keydown.space.prevent="toggle(sp.id)">
        <div class="row between">
          <span class="emoji">{{ sp.emoji }}</span>
          <button v-if="sp.restricted || sp.venom || sp.banned" type="button" class="warn"
            :title="`${spName(sp)} — ${t('warn_hint')}`"
            :aria-label="`${spName(sp)} — ${t('warn_hint')}`" @click.stop="warningFor = sp.id"
            @keydown.enter.stop @keydown.space.stop>
            {{ sp.banned ? '⛔' : '⚠️' }}
          </button>
        </div>
        <div class="name">{{ spName(sp) }}</div>
        <div class="tip">{{ spTip(sp) }}</div>
      </div>
    </div>

    <div class="nav">
      <button class="btn ghost" @click="router.push({ name: 'locations' })">{{ t('back') }}</button>
      <button class="btn primary" @click="router.push({ name: 'dashboard' })">{{ t('sp_show') }}</button>
    </div>

    <div v-if="warningFor" class="overlay" @click.self="warningFor = null">
      <div class="card modal" ref="warnRef" role="dialog" aria-modal="true" tabindex="-1"
        :aria-label="spName(SPECIES_PREFS[warningFor])">
        <h3>{{ SPECIES_PREFS[warningFor]?.emoji }} {{ spName(SPECIES_PREFS[warningFor]) }}</h3>
        <pre class="warning">{{ spWarning(SPECIES_PREFS[warningFor]) }}</pre>
        <button class="btn primary" @click="warningFor = null">{{ t('understood') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
.sp { cursor: pointer; }
.sp.selected { border-color: var(--primary); background: rgba(56, 189, 248, 0.08); }
.sp.banned { opacity: 0.55; }
.sp:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
.emoji { font-size: 1.4rem; }
.warn { cursor: pointer; background: none; border: none; padding: 0; font-size: 1rem; line-height: 1; }
.warn:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; border-radius: 4px; }
.name { font-weight: 700; margin: 6px 0 4px; }
.tip { font-size: 0.72rem; color: var(--muted); line-height: 1.4; }
.row { display: flex; } .row.between { justify-content: space-between; }
.nav { display: flex; justify-content: space-between; margin-top: 24px; }
.overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); display: grid; place-items: center; z-index: 100; }
.modal { max-width: 420px; }
.warning { white-space: pre-wrap; font-family: inherit; font-size: 0.82rem; line-height: 1.5; background: rgba(0, 0, 0, 0.25); padding: 12px; border-radius: 8px; border-left: 3px solid var(--gold); }
</style>
