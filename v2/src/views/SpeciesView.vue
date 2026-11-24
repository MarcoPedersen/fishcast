<script setup lang="ts">
import { useRouter } from 'vue-router'
import { spName, spTip, spWarning, t } from '@/lib/i18n'
import { SPECIES_PREFS, type SpeciesPref } from '@/lib/species'
import { toggleTarget } from '@/lib/speciesToggle'
import { useSetupStore } from '@/stores/setup'
import { firstMissingStep, SETUP_STEP_LABEL } from '@/lib/setupStep'
import { useModal } from '@/lib/useModal'
import { closedIdsOn } from '@/lib/seasons'
import { localDayUTC, useNow } from '@/lib/clock'
import { computed, ref } from 'vue'

const router = useRouter()
const setup = useSetupStore()
const species = Object.values(SPECIES_PREFS)
const warningFor = ref<string | null>(null)
// Species closed today in every water they live in (pike in April): picking
// one plans trips for a fish that may not be caught. Grouped like the Seasons tab.
// Today follows the shared clock, as the Seasons tab does: read once at mount,
// a page left open across 1 Apr or 1 May kept the old answer for pike. The day
// key is a number, so this recomputes at local midnight, not every tick.
const now = useNow()
const dayKey = computed(() => localDayUTC(now.value))
const closedNow = computed(() => closedIdsOn(dayKey.value))
const { dialogRef: warnRef } = useModal(() => warningFor.value != null, () => { warningFor.value = null })
// Closed today, on its card: not on a banned species', whose ⛔ says more.
const closedShown = (sp: SpeciesPref) => closedNow.value.has(sp.id) && !sp.banned
// The species' name names its toggle; the rest of the card's text describes
// it: closed today, then the tip.
const describedBy = (sp: SpeciesPref) => [...(closedShown(sp) ? [`sp-closed-${sp.id}`] : []), `sp-tip-${sp.id}`].join(' ')

/**
 * Tilbage. Find pladser's "Skift arter" opens this page, with a setup or
 * before one, and Tilbage led into the setup, nothing back to Find pladser.
 * So come from Find pladser (any mode in its link), it steps back to it.
 * Else, with a setup, to Lokationer, the step before this one. With none,
 * the page was opened from elsewhere: it goes back where the user came
 * from, or to Find pladser when the app was opened on this page. The page
 * before is the history state's (vue-router's `back`): kept across a
 * reload, and none when a link opened the app on this page.
 */
function goBack() {
  const before = router.options.history.state.back
  const fromFinder = typeof before === 'string' && router.resolve(before).name === 'finder'
  if (fromFinder) router.back()
  else if (setup.hasSetup()) router.push({ name: 'locations' })
  else if (before) router.back()
  else router.push({ name: 'finder' })
}

/**
 * The way on. The dashboard sends a visit with no setup back to the welcome
 * page (router), and Find pladser opens this page before any setup ("Skift
 * arter"). So it goes to the first step the setup lacks (lib/setupStep),
 * Tidsvinduer, then Lokationer, as Find pladser's own button does; the
 * species picked here stay picked. A whole setup shows the fishing.
 */
const onward = computed(() => {
  const step = firstMissingStep(setup)
  return step ? { to: step, label: SETUP_STEP_LABEL[step] } : { to: 'dashboard', label: 'sp_show' }
})

function toggle(id: string) {
  // A banned species is refused only on the way IN — see toggleTarget.
  const r = toggleTarget(setup.targetSpecies, id)
  if (r.blocked) { warningFor.value = id; return }
  setup.targetSpecies = r.selected
  // Cod: selected, and its notice says where it is banned (the Baltic).
  if (r.notice) warningFor.value = id
}
</script>

<template>
  <div class="wizard">
    <h1>{{ t('sp_title') }}</h1>
    <p class="sub">{{ t('sp_sub') }}</p>

    <!-- A card is a frame. Its toggle is a button that holds the card's text
         and fills the card, so a tap anywhere on it still picks; Enter and
         Space are the button's own. The card used to be the toggle, a div
         with aria-pressed and no role, which a screen reader may not take
         for a toggle; and it held the ⚠️, which role="button" on it would
         have hidden (a button's contents are presentational). The ⚠️ sits
         beside the toggle, after it (Tab: the toggle, then the ⚠️), held
         over its top right corner where it stood. -->
    <div class="grid">
      <div v-for="sp in species" :key="sp.id" class="card sp"
        :class="{ selected: setup.targetSpecies.includes(sp.id), banned: sp.banned }">
        <button type="button" class="pick" :aria-label="spName(sp)" :aria-pressed="setup.targetSpecies.includes(sp.id)"
          :aria-describedby="describedBy(sp)" @click="toggle(sp.id)">
          <span class="emoji">{{ sp.emoji }}</span>
          <span class="name">{{ spName(sp) }}</span>
          <span v-if="closedShown(sp)" :id="`sp-closed-${sp.id}`" class="closed-now">🚫 {{ t('season_closed_now') }}</span>
          <span :id="`sp-tip-${sp.id}`" class="tip">{{ spTip(sp) }}</span>
        </button>
        <button v-if="sp.restricted || sp.venom || sp.banned" type="button" class="warn"
          :title="`${spName(sp)} — ${t('warn_hint')}`"
          :aria-label="`${spName(sp)} — ${t('warn_hint')}`" @click="warningFor = sp.id">
          {{ sp.banned ? '⛔' : '⚠️' }}
        </button>
      </div>
    </div>

    <div class="nav">
      <button class="btn ghost" @click="goBack">{{ t('back') }}</button>
      <!-- To the first step the setup lacks, or the dashboard (onward). -->
      <button class="btn primary" @click="router.push({ name: onward.to })">
        {{ t(onward.label) }}
      </button>
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
/* The card is the frame. Its toggle fills it and takes over the card's
   padding (style.css .card, 16 px), so the whole card still picks. */
.sp { position: relative; display: flex; padding: 0; }
.sp.selected { border-color: var(--primary); background: rgba(56, 189, 248, 0.08); }
.sp.banned { opacity: 0.55; }
.pick {
  flex: 1; min-width: 0; display: flex; flex-direction: column; padding: 16px;
  text-align: left; background: none; border: none; border-radius: inherit; color: inherit; font: inherit; cursor: pointer;
}
/* Spans, as a button holds phrasing content only: each its own line, as the
   divs were. */
.pick > * { display: block; }
/* Around the card, 2 px out from its 1 px border, as before. */
.pick:focus-visible { outline: 2px solid var(--primary); outline-offset: 3px; }
/* A line of its own height, which the ⚠️ beside it shares (.warn height). */
.emoji { font-size: 1.4rem; line-height: 26px; }
/* Over the toggle's top right corner, on the emoji's line: where it stood
   in the card's top row, the sign centred in the line's height. */
.warn { position: absolute; top: 16px; right: 16px; height: 26px; cursor: pointer; background: none; border: none; padding: 0; font-size: 1rem; line-height: 1; }
.warn:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; border-radius: 4px; }
/* Touch screens: the ⚠️ was 16 px wide, so a tap beside it picked the
   species instead. A 40 px box, held to the emoji's line by negative
   margins: it reaches into the card's padding, up and to the right, and
   the sign stays where it was. */
@media (pointer: coarse) { .warn { min-width: 40px; min-height: 40px; margin: -7px -12px -7px 0; } }
.name { font-weight: 700; margin: 6px 0 4px; }
.tip { font-size: 0.72rem; color: var(--muted); line-height: 1.4; }
.closed-now { font-size: 0.72rem; color: var(--red); font-weight: 600; margin-bottom: 4px; }
.nav { display: flex; justify-content: space-between; margin-top: 24px; }
/* Above the toasts (2000), below the confirm dialog (3000): see MapView's .sheet. */
.overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); display: grid; place-items: center; z-index: 2500; }
.modal { max-width: 420px; }
.warning { white-space: pre-wrap; font-family: inherit; font-size: 0.82rem; line-height: 1.5; background: rgba(0, 0, 0, 0.25); padding: 12px; border-radius: 8px; border-left: 3px solid var(--gold); }
</style>
