<script setup lang="ts">
import { computed, reactive } from 'vue'
import { spName, t } from '@/lib/i18n'
import { SPECIES_PREFS } from '@/lib/species'
import { useCatchStore } from '@/stores/catches'
import { useSetupStore } from '@/stores/setup'

const log = useCatchStore()
const setup = useSetupStore()

const speciesList = Object.values(SPECIES_PREFS)

function todayISO(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const form = reactive({
  date: todayISO(),
  speciesId: '',
  locationName: '',
  lengthCm: '' as number | '',
  weightKg: '' as number | '',
  notes: '',
})

// Need at least a species or a location to make an entry meaningful.
const canSave = computed(() => !!form.speciesId || !!form.locationName.trim())

function save() {
  if (!canSave.value) return
  log.add({
    date: form.date || todayISO(),
    speciesId: form.speciesId,
    locationName: form.locationName.trim(),
    lengthCm: form.lengthCm === '' ? undefined : Number(form.lengthCm),
    weightKg: form.weightKg === '' ? undefined : Number(form.weightKg),
    notes: form.notes.trim() || undefined,
  })
  // Keep the date for quick multi-entry; clear the rest.
  form.speciesId = ''
  form.locationName = ''
  form.lengthCm = ''
  form.weightKg = ''
  form.notes = ''
}

function removeEntry(id: string) {
  if (confirm(t('log_remove_confirm'))) log.remove(id)
}

function speciesLabel(id: string): string {
  const sp = SPECIES_PREFS[id]
  return sp ? `${sp.emoji} ${spName(sp)}` : `🎣 ${t('log_species_other')}`
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y) return iso
  const dt = new Date(y, (m || 1) - 1, d || 1)
  return `${t('day' + dt.getDay())} ${d}. ${t('month' + (m - 1))} ${y}`
}
</script>

<template>
  <div class="wizard">
    <div class="row between">
      <h1>{{ t('log_title') }}</h1>
      <span v-if="log.entries.length" class="total">{{ log.entries.length }} {{ t('log_total') }}</span>
    </div>

    <!-- Add form -->
    <div class="card form">
      <strong class="form-h">{{ t('log_add') }}</strong>
      <div class="grid">
        <label>
          {{ t('log_date') }}
          <input type="date" v-model="form.date" />
        </label>
        <label>
          {{ t('log_species') }}
          <select v-model="form.speciesId">
            <option value="">{{ t('log_species_other') }}</option>
            <option v-for="sp in speciesList" :key="sp.id" :value="sp.id">{{ sp.emoji }} {{ spName(sp) }}</option>
          </select>
        </label>
        <label class="wide">
          {{ t('log_location') }}
          <input v-model="form.locationName" :placeholder="t('log_location_ph')" list="loc-options" />
          <datalist id="loc-options">
            <option v-for="l in setup.locations" :key="l.id" :value="l.name" />
          </datalist>
        </label>
        <label>
          {{ t('log_length') }}
          <input type="number" min="0" inputmode="decimal" v-model="form.lengthCm" />
        </label>
        <label>
          {{ t('log_weight') }}
          <input type="number" min="0" step="0.01" inputmode="decimal" v-model="form.weightKg" />
        </label>
        <label class="wide">
          {{ t('log_notes') }}
          <textarea v-model="form.notes" :placeholder="t('log_notes_ph')" rows="2" />
        </label>
      </div>
      <button class="btn primary" :disabled="!canSave" @click="save">{{ t('log_save') }}</button>
    </div>

    <!-- History -->
    <div v-if="!log.entries.length" class="empty">
      <div class="empty-icon">📒</div>
      <strong>{{ t('log_empty_title') }}</strong>
      <span class="empty-sub">{{ t('log_empty_sub') }}</span>
    </div>

    <div v-for="c in log.sorted" :key="c.id" class="card entry">
      <div class="entry-main">
        <div class="entry-top">
          <span class="sp">{{ speciesLabel(c.speciesId) }}</span>
          <span class="sizes">
            <span v-if="c.lengthCm != null" class="size">📏 {{ c.lengthCm }} cm</span>
            <span v-if="c.weightKg != null" class="size">⚖️ {{ c.weightKg }} kg</span>
          </span>
        </div>
        <div class="entry-meta">
          🗓 {{ fmtDate(c.date) }}
          <template v-if="c.locationName"> · 📍 {{ c.locationName }}</template>
        </div>
        <p v-if="c.notes" class="entry-notes">{{ c.notes }}</p>
      </div>
      <button class="btn ghost sm del" :title="t('log_remove')" :aria-label="t('log_remove')" @click="removeEntry(c.id)">🗑</button>
    </div>
  </div>
</template>

<style scoped>
.row { display: flex; align-items: center; gap: 10px; } .row.between { justify-content: space-between; }
h1 { font-size: 1.3rem; }
.total { font-size: 0.8rem; color: var(--muted); }
.form { margin-top: 12px; }
.form-h { display: block; margin-bottom: 10px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.grid label { display: flex; flex-direction: column; gap: 4px; font-size: 0.78rem; color: var(--muted); }
.grid label.wide { grid-column: 1 / -1; }
.grid input, .grid select, .grid textarea { font-size: 0.9rem; }
.form .btn { margin-top: 12px; }
.entry { margin-top: 8px; display: flex; gap: 10px; align-items: flex-start; }
.entry-main { flex: 1; min-width: 0; }
.entry-top { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.sp { font-weight: 700; font-size: 0.95rem; }
.sizes { display: flex; gap: 8px; }
.size { font-size: 0.78rem; color: var(--cyan); white-space: nowrap; }
.entry-meta { font-size: 0.78rem; color: var(--muted); margin-top: 4px; }
.entry-notes { font-size: 0.82rem; margin-top: 6px; white-space: pre-wrap; }
.del { flex-shrink: 0; }
.empty {
  display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px;
  margin-top: 16px; padding: 28px 18px; border-radius: 12px;
  border: 1px dashed var(--border); color: var(--muted);
}
.empty-icon { font-size: 2rem; opacity: 0.7; margin-bottom: 4px; }
.empty strong { color: var(--text); font-size: 0.95rem; }
.empty-sub { font-size: 0.8rem; max-width: 280px; }
@media (max-width: 640px) { .grid { grid-template-columns: 1fr; } }
</style>
