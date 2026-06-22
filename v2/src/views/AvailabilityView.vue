<script setup lang="ts">
import { useRouter } from 'vue-router'
import { t } from '@/lib/i18n'
import { useSetupStore, uid } from '@/stores/setup'
import type { FishingMethod } from '@/lib/types'

const router = useRouter()
const setup = useSetupStore()

const methods: { id: FishingMethod; label: string }[] = [
  { id: 'shore', label: '🎣 ' },
  { id: 'waders', label: '🦺 ' },
  { id: 'boat', label: '🚢 ' },
]
function setMethod(id: string, m: FishingMethod) {
  const a = setup.availability.find((x) => x.id === id)
  if (a) a.methods = [m]
}

function add() {
  setup.availability.push({ id: uid(), days: [6, 0], from: '06:00', to: '12:00', methods: ['shore'] })
}
function remove(id: string) {
  setup.availability = setup.availability.filter((a) => a.id !== id)
}
function toggleDay(id: string, d: number) {
  const a = setup.availability.find((x) => x.id === id)
  if (!a) return
  a.days = a.days.includes(d) ? a.days.filter((x) => x !== d) : [...a.days, d]
}
</script>

<template>
  <div class="wizard">
    <h1>{{ t('avail_title') }}</h1>
    <p class="sub">{{ t('avail_sub') }}</p>

    <div v-for="(a, i) in setup.availability" :key="a.id" class="card avail">
      <div class="row between">
        <strong>{{ t('avail_window') }} {{ i + 1 }}</strong>
        <button class="btn ghost sm" @click="remove(a.id)">🗑</button>
      </div>
      <div class="days">
        <button v-for="d in [0, 1, 2, 3, 4, 5, 6]" :key="d" class="day"
          :class="{ active: a.days.includes(d) }" @click="toggleDay(a.id, d)">
          {{ t('day' + d) }}
        </button>
      </div>
      <div class="row">
        <label>{{ t('time_from') }}</label><input v-model="a.from" type="time" />
        <label>{{ t('time_to') }}</label><input v-model="a.to" type="time" />
      </div>
      <div class="method">
        <span class="method-lbl">{{ t('method_label') }}:</span>
        <button v-for="m in methods" :key="m.id" class="mbtn"
          :class="{ on: (a.methods?.[0] ?? 'shore') === m.id }" @click="setMethod(a.id, m.id)">
          {{ m.label }}{{ t('method_' + m.id) }}
        </button>
      </div>
      <p v-if="a.from >= a.to" class="warn">⚠️ {{ t('avail_time_warn') }}</p>
      <p v-else-if="!a.days.length" class="warn">⚠️ {{ t('avail_days_warn') }}</p>
    </div>

    <button class="btn ghost" @click="add">{{ t('avail_add') }}</button>
    <p v-if="!setup.availability.length" class="notice">{{ t('avail_notice') }}</p>

    <div class="nav">
      <button class="btn ghost" @click="router.push({ name: 'welcome' })">{{ t('back') }}</button>
      <button class="btn primary" :disabled="!setup.availability.length"
        @click="router.push({ name: 'locations' })">{{ t('next') }}</button>
    </div>
  </div>
</template>

<style scoped>
.avail { margin-bottom: 12px; }
.warn { font-size: 0.76rem; color: var(--gold); margin-top: 8px; }
.days { display: flex; gap: 6px; margin: 10px 0; flex-wrap: wrap; }
.day { padding: 6px 10px; border-radius: 8px; border: 1px solid var(--border); background: none; color: var(--muted); cursor: pointer; }
.day.active { background: var(--primary); color: #07111f; border-color: var(--primary); font-weight: 600; }
.row { display: flex; gap: 8px; align-items: center; }
.row.between { justify-content: space-between; }
.method { display: flex; align-items: center; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
.method-lbl { font-size: 0.76rem; color: var(--muted); }
.mbtn { padding: 5px 10px; border-radius: 8px; border: 1px solid var(--border); background: none; color: var(--muted); cursor: pointer; font-size: 0.78rem; }
.mbtn:hover { border-color: var(--primary); }
.mbtn.on { border-color: var(--primary); color: var(--text); background: rgba(56,189,248,.12); font-weight: 600; }
.nav { display: flex; justify-content: space-between; margin-top: 24px; }
.notice { color: var(--muted); font-size: 0.82rem; margin-top: 12px; }
</style>
