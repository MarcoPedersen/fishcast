<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { t } from '@/lib/i18n'
import { confirmDialog } from '@/lib/confirm'
import { availDays, availMethods } from '@/lib/scoring'
import { availabilityBlockers, overnightEnd, timeIssue } from '@/lib/availabilityCheck'
import { useSetupStore, uid } from '@/stores/setup'
import type { FishingMethod } from '@/lib/types'

const router = useRouter()
const setup = useSetupStore()

// A zero-length window can't be scored, so don't let one leave this screen — the
// per-row warning alone was advisory and the bad row still saved and synced.
// (An end hour before the start is an overnight window and is perfectly valid.)
// Neither can a window with no days ticked; it used to pass, see availabilityCheck.
const blockers = computed(() => availabilityBlockers(setup.availability))

/**
 * The note under a window that crosses midnight, by when it ends: at
 * midnight, in the night, or the next morning (overnightEnd). Null for a
 * window that does not cross midnight.
 */
function nightNote(from: string, to: string): string | null {
  const end = overnightEnd(from, to)
  if (!end) return null
  return t(end === 'midnight' ? 'avail_midnight' : end === 'night' ? 'avail_night' : 'avail_overnight')
}

const methods: { id: FishingMethod; label: string }[] = [
  { id: 'shore', label: '🎣 ' },
  { id: 'waders', label: '🦺 ' },
  { id: 'boat', label: '🚢 ' },
]
// The window whose last method a tap could not let go. The tap used to do
// nothing and say nothing; the window now says why. Any change to the
// windows clears it: a refused tap changes none.
const methodRefused = ref<string | null>(null)
watch(() => setup.availability, () => { methodRefused.value = null }, { deep: true })

// Multi-select: a window can be fished several ways. Keep at least one selected.
function toggleMethod(id: string, m: FishingMethod) {
  const a = setup.availability.find((x) => x.id === id)
  if (!a) return
  // Legacy rows may lack `methods`; fall back to the same ['shore'] the UI
  // displays as active, so toggling behaves consistently with what's shown.
  // (availMethods also covers a garbled non-list, which `.filter` threw on.)
  const cur: FishingMethod[] = availMethods(a)
  if (cur.includes(m)) {
    // By what is left, not by the count: a method held twice (a share link
    // keeps a doubled one) counted two, and the tap stored none.
    const rest = cur.filter((x) => x !== m)
    if (rest.length) a.methods = rest
    else methodRefused.value = id
  } else {
    a.methods = [...cur, m]
  }
}

function add() {
  setup.availability.push({ id: uid(), days: [6, 0], from: '06:00', to: '12:00', methods: ['shore'] })
}
async function remove(id: string) {
  if (!(await confirmDialog(t('avail_remove_confirm')))) return
  setup.availability = setup.availability.filter((a) => a.id !== id)
}
// The days on screen, Monday first, as a Danish week is: Sunday first put
// a weekend window's Lør and Søn at the two ends of the row. A window still
// stores Date.getDay()'s numbers, Sunday 0.
const WEEK = [1, 2, 3, 4, 5, 6, 0]
function toggleDay(id: string, d: number) {
  const a = setup.availability.find((x) => x.id === id)
  if (!a) return
  // availDays: a synced row with no days list must render and be fixable here,
  // not throw from `.includes` and blank the editor that could repair it.
  const cur = availDays(a)
  a.days = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]
}
</script>

<template>
  <div class="wizard">
    <h1>{{ t('avail_title') }}</h1>
    <p class="sub">{{ t('avail_sub') }}</p>

    <!-- A group named by its heading: the fields read "Fra, Til, Fra, Til"
         and the days the same in every window, and only the 🗑 said which
         window it was in. A screen reader says the name entering the card. -->
    <div v-for="(a, i) in setup.availability" :key="a.id" class="card avail"
      role="group" :aria-labelledby="`win-${a.id}`">
      <div class="row between">
        <strong :id="`win-${a.id}`">{{ t('avail_window') }} {{ i + 1 }}</strong>
        <!-- Icon-only: without a name a screen reader announced just "button"
             (or the emoji's name), with no hint which window it deletes. -->
        <button class="btn ghost sm" :aria-label="`${t('avail_remove')} ${i + 1}`"
          :title="t('avail_remove')" @click="remove(a.id)">🗑</button>
      </div>
      <!-- On or off said by colour alone, a screen reader heard "Lør" and
           nothing of whether it was ticked: aria-pressed, as the dashboard's
           toggles. The labels were for no field, so neither time field had
           a name; each is now its label's. -->
      <div class="days">
        <button v-for="d in WEEK" :key="d" class="day"
          :class="{ active: availDays(a).includes(d) }" :aria-pressed="availDays(a).includes(d)" @click="toggleDay(a.id, d)">
          {{ t('day' + d) }}
        </button>
      </div>
      <div class="row">
        <label :for="`from-${a.id}`">{{ t('time_from') }}</label><input :id="`from-${a.id}`" v-model="a.from" type="time" />
        <label :for="`to-${a.id}`">{{ t('time_to') }}</label><input :id="`to-${a.id}`" v-model="a.to" type="time" />
      </div>
      <div class="method">
        <span class="method-lbl">{{ t('method_label') }}:</span>
        <button v-for="m in methods" :key="m.id" class="mbtn"
          :class="{ on: availMethods(a).includes(m.id) }" :aria-pressed="availMethods(a).includes(m.id)" @click="toggleMethod(a.id, m.id)">
          {{ m.label }}{{ t('method_' + m.id) }}
        </button>
      </div>
      <!-- A tap on the last method is refused. The line is there from the
           start, empty, so a screen reader reads it as it fills. -->
      <p class="method-note" role="status"><template v-if="methodRefused === a.id">⚠️ {{ t('method_required') }}</template></p>
      <!-- A time cleared (or one a synced row holds that reads as none) is
           not the same time twice: it says so in its own words. -->
      <p v-if="timeIssue(a.from, a.to) === 'missing'" class="warn">⚠️ {{ t('avail_time_missing') }}</p>
      <p v-else-if="timeIssue(a.from, a.to) === 'same'" class="warn">⚠️ {{ t('avail_time_warn') }}</p>
      <!-- Crossing midnight is legitimate (night fishing) — say so, so it doesn't
           look like the mistake the old "end must be after start" warning implied.
           It says when the window ends: 00:00 is midnight, 01:00 is not morning. -->
      <p v-else-if="nightNote(a.from, a.to)" class="note-overnight">🌙 {{ nightNote(a.from, a.to) }}</p>
      <!-- Its own line, not the end of the chain above: as a branch, an
           overnight window showed "That's fine" and hid that no day was ticked. -->
      <p v-if="!availDays(a).length" class="warn">⚠️ {{ t('avail_days_warn') }}</p>
    </div>

    <button class="btn ghost" @click="add">{{ t('avail_add') }}</button>
    <p v-if="!setup.availability.length" class="notice">{{ t('avail_notice') }}</p>

    <p v-if="blockers.sameTime" class="warn blocker">⚠️ {{ t('avail_fix_before_next') }}</p>
    <p v-if="blockers.noTime" class="warn blocker">⚠️ {{ t('avail_missing_fix_before_next') }}</p>
    <p v-if="blockers.noDays" class="warn blocker">⚠️ {{ t('avail_days_fix_before_next') }}</p>

    <div class="nav">
      <button class="btn ghost" @click="router.push({ name: 'welcome' })">{{ t('back') }}</button>
      <button class="btn primary" :disabled="!setup.availability.length || blockers.sameTime > 0 || blockers.noTime > 0 || blockers.noDays > 0"
        @click="router.push({ name: 'locations' })">{{ t('next') }}</button>
    </div>
  </div>
</template>

<style scoped>
.avail { margin-bottom: 12px; }
.warn { font-size: 0.76rem; color: var(--gold); margin-top: 8px; }
.warn.blocker { margin-top: 16px; font-weight: 600; }
.note-overnight { font-size: 0.76rem; color: var(--primary); margin-top: 8px; }
/* Seven columns: the week stays on one row at phone width (touchTargets.test.ts). */
.days { display: grid; grid-template-columns: repeat(7, minmax(0, 52px)); gap: 4px; margin: 10px 0; }
.day { padding: 6px 0; border-radius: 8px; border: 1px solid var(--border); background: none; color: var(--muted); cursor: pointer; }
.day.active { background: var(--primary); color: #07111f; border-color: var(--primary); font-weight: 600; }
/* ~29 px tall: too small for a finger. Touch screens only. */
@media (pointer: coarse) { .day { min-height: 40px; } }
.row { display: flex; gap: 8px; align-items: center; }
.row.between { justify-content: space-between; }
.method { display: flex; align-items: center; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
.method-lbl { font-size: 0.76rem; color: var(--muted); }
.mbtn { padding: 5px 10px; border-radius: 8px; border: 1px solid var(--border); background: none; color: var(--muted); cursor: pointer; font-size: 0.78rem; }
.mbtn:hover { border-color: var(--primary); }
.mbtn.on { border-color: var(--primary); color: var(--text); background: rgba(56,189,248,.12); font-weight: 600; }
/* Empty, it takes no room; not display: none, which a screen reader may not
   read as it fills. */
.method-note { font-size: 0.76rem; color: var(--gold); margin: 0; }
.method-note:not(:empty) { margin-top: 8px; }
/* 28 px tall, under day buttons of 40. Touch screens only. */
@media (pointer: coarse) { .mbtn { min-height: 40px; } }
.nav { display: flex; justify-content: space-between; margin-top: 24px; }
.notice { color: var(--muted); font-size: 0.82rem; margin-top: 12px; }
</style>
