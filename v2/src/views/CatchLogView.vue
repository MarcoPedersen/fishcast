<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { spName, t } from '@/lib/i18n'
import { SPECIES_PREFS } from '@/lib/species'
import { useCatchStore } from '@/stores/catches'
import { useSetupStore } from '@/stores/setup'
import { confirmDialog } from '@/lib/confirm'
import type { CatchEntry } from '@/lib/types'

const log = useCatchStore()
const setup = useSetupStore()

const speciesList = Object.values(SPECIES_PREFS)

function todayISO(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function blankForm() {
  return { date: todayISO(), speciesId: '', locationName: '', lengthCm: '' as number | '', weightKg: '' as number | '', released: null as boolean | null, notes: '' }
}

// Open the native date picker when the field is clicked/focused (not just the
// tiny calendar icon). showPicker isn't in older browsers — guard it.
function openPicker(e: Event) {
  const el = e.target as HTMLInputElement & { showPicker?: () => void }
  try { el.showPicker?.() } catch { /* not allowed in this context — ignore */ }
}
const form = reactive(blankForm())
// null = adding a new catch; otherwise the id of the entry being edited.
const editingId = ref<string | null>(null)

// Need at least a species or a location to make an entry meaningful.
const canSave = computed(() => !!form.speciesId || !!form.locationName.trim())

function resetForm() {
  Object.assign(form, blankForm())
  editingId.value = null
}

function save() {
  if (!canSave.value) return
  const payload = {
    date: form.date || todayISO(),
    speciesId: form.speciesId,
    locationName: form.locationName.trim(),
    lengthCm: form.lengthCm === '' ? undefined : Number(form.lengthCm),
    weightKg: form.weightKg === '' ? undefined : Number(form.weightKg),
    released: form.released === null ? undefined : form.released,
    notes: form.notes.trim() || undefined,
  }
  if (editingId.value) log.update(editingId.value, payload)
  else log.add(payload)
  resetForm()
}

function edit(c: CatchEntry) {
  editingId.value = c.id
  Object.assign(form, {
    date: c.date,
    speciesId: c.speciesId,
    locationName: c.locationName,
    lengthCm: c.lengthCm ?? '',
    weightKg: c.weightKg ?? '',
    released: c.released ?? null,
    notes: c.notes ?? '',
  })
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

async function removeEntry(id: string) {
  if (await confirmDialog(t('log_remove_confirm'))) {
    if (editingId.value === id) resetForm()
    log.remove(id)
  }
}

function speciesLabel(id: string): string {
  const sp = SPECIES_PREFS[id]
  return sp ? `${sp.emoji} ${spName(sp)}` : `🎣 ${t('log_species_other')}`
}

// Summary stats over the whole log.
const stats = computed(() => {
  const es = log.entries
  if (!es.length) return null
  let longest: CatchEntry | null = null
  let heaviest: CatchEntry | null = null
  const counts: Record<string, number> = {}
  for (const e of es) {
    if (e.lengthCm != null && (!longest || e.lengthCm > longest.lengthCm!)) longest = e
    if (e.weightKg != null && (!heaviest || e.weightKg > heaviest.weightKg!)) heaviest = e
    if (e.speciesId) counts[e.speciesId] = (counts[e.speciesId] || 0) + 1
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  const released = es.filter((e) => e.released === true).length
  return { count: es.length, longest, heaviest, topSpeciesId: top?.[0] ?? null, topCount: top?.[1] ?? 0, released }
})

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

    <!-- Stats -->
    <div v-if="stats" class="stats">
      <div class="stat">
        <span class="stat-val">{{ stats.count }}</span>
        <span class="stat-lbl">{{ t('log_stat_catches') }}</span>
      </div>
      <div v-if="stats.longest" class="stat">
        <span class="stat-val">{{ stats.longest.lengthCm }} cm</span>
        <span class="stat-lbl">📏 {{ t('log_stat_longest') }}</span>
      </div>
      <div v-if="stats.heaviest" class="stat">
        <span class="stat-val">{{ stats.heaviest.weightKg }} kg</span>
        <span class="stat-lbl">⚖️ {{ t('log_stat_heaviest') }}</span>
      </div>
      <div v-if="stats.topSpeciesId" class="stat">
        <span class="stat-val">{{ speciesLabel(stats.topSpeciesId) }} <small>×{{ stats.topCount }}</small></span>
        <span class="stat-lbl">{{ t('log_stat_top') }}</span>
      </div>
      <div v-if="stats.released" class="stat">
        <span class="stat-val">{{ stats.released }}<small> / {{ stats.count }}</small></span>
        <span class="stat-lbl">🌊 {{ t('log_stat_released') }}</span>
      </div>
    </div>

    <!-- Add / edit form -->
    <div class="card form" :class="{ editing: editingId }">
      <strong class="form-h">{{ editingId ? t('log_edit_h') : t('log_add') }}</strong>
      <div class="grid">
        <label>
          {{ t('log_date') }}
          <input type="date" v-model="form.date" @click="openPicker" @focus="openPicker" />
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
        <div class="wide outcome">
          <span class="outcome-lbl">{{ t('log_outcome') }}</span>
          <div class="seg">
            <button type="button" class="seg-btn" :class="{ on: form.released === false }"
              @click="form.released = form.released === false ? null : false">🪣 {{ t('log_kept') }}</button>
            <button type="button" class="seg-btn" :class="{ on: form.released === true }"
              @click="form.released = form.released === true ? null : true">🌊 {{ t('log_released') }}</button>
          </div>
        </div>
        <label class="wide">
          {{ t('log_notes') }}
          <textarea v-model="form.notes" :placeholder="t('log_notes_ph')" rows="2" />
        </label>
      </div>
      <div class="form-actions">
        <button class="btn primary" :disabled="!canSave" @click="save">{{ editingId ? t('log_update') : t('log_save') }}</button>
        <button v-if="editingId" class="btn ghost" @click="resetForm">{{ t('log_cancel') }}</button>
      </div>
    </div>

    <!-- History -->
    <div v-if="!log.entries.length" class="empty">
      <div class="empty-icon">📒</div>
      <strong>{{ t('log_empty_title') }}</strong>
      <span class="empty-sub">{{ t('log_empty_sub') }}</span>
    </div>

    <div v-for="c in log.sorted" :key="c.id" class="card entry" :class="{ active: editingId === c.id }">
      <div class="entry-main">
        <div class="entry-top">
          <span class="sp">
            {{ speciesLabel(c.speciesId) }}
            <span v-if="c.released === true" class="rel released">🌊 {{ t('log_released') }}</span>
            <span v-else-if="c.released === false" class="rel kept">🪣 {{ t('log_kept') }}</span>
          </span>
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
      <div class="entry-actions">
        <button class="btn ghost sm" :title="t('log_edit')" :aria-label="t('log_edit')" @click="edit(c)">✎</button>
        <button class="btn ghost sm del" :title="t('log_remove')" :aria-label="t('log_remove')" @click="removeEntry(c.id)">🗑</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.row { display: flex; align-items: center; gap: 10px; } .row.between { justify-content: space-between; }
h1 { font-size: 1.3rem; }
.total { font-size: 0.8rem; color: var(--muted); }
.stats { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
.stat {
  flex: 1 1 0; min-width: 90px; display: flex; flex-direction: column; gap: 2px;
  padding: 10px 12px; border-radius: 10px; background: var(--bg-card); border: 1px solid var(--border);
}
.stat-val { font-weight: 800; font-size: 1.05rem; }
.stat-val small { font-weight: 600; color: var(--muted); font-size: 0.78rem; }
.stat-lbl { font-size: 0.72rem; color: var(--muted); }
.form { margin-top: 12px; }
.form.editing { border-color: var(--primary); }
.form-h { display: block; margin-bottom: 10px; }
.outcome { display: flex; flex-direction: column; gap: 4px; }
.outcome-lbl { font-size: 0.78rem; color: var(--muted); }
.seg { display: flex; gap: 6px; }
.seg-btn {
  flex: 1; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border);
  background: none; color: var(--muted); cursor: pointer; font-size: 0.84rem;
}
.seg-btn:hover { border-color: var(--primary); }
.seg-btn.on { border-color: var(--primary); color: var(--text); background: rgba(56,189,248,.12); font-weight: 600; }
.rel { font-size: 0.7rem; font-weight: 600; padding: 1px 7px; border-radius: 10px; border: 1px solid var(--border); margin-left: 6px; white-space: nowrap; }
.rel.released { color: var(--primary); border-color: rgba(56,189,248,.4); }
.rel.kept { color: var(--gold); border-color: rgba(245,158,11,.4); }
.form-actions { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
.form-actions .btn { margin-top: 0; }
.entry.active { border-color: var(--primary); }
.entry-actions { display: flex; gap: 4px; flex-shrink: 0; }
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
