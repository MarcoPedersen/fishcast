<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import { spName, t } from '@/lib/i18n'
import { SPECIES_PREFS } from '@/lib/species'
import { useCatchStore } from '@/stores/catches'
import { useSetupStore } from '@/stores/setup'
import { useCoastStore } from '@/stores/coast'
import { confirmDialog } from '@/lib/confirm'
import {
  catchPlaceName, fishlessOutings, isEmptyTrip, linkCatchLocation, spotKey, tripFormIssues, tripNeighbours, tripsContaining,
} from '@/lib/catchScore'
import { tripPrefill } from '@/lib/tripPrefill'
import { catchWarnings } from '@/lib/catchGuard'
import { showToast } from '@/lib/toast'
import { pruneResults } from '@/lib/insightRun'
import { FISHING_METHODS, speciesLabel } from '@/lib/catchLabels'
import { localDayUTC, useNow } from '@/lib/clock'
import { clearCatchDraft, draftEpoch, keepCatchDraft, readCatchDraft } from '@/lib/catchDraft'
import { useAuthStore } from '@/stores/auth'
import ModelCheckPanel from '@/components/ModelCheckPanel.vue'
import CatchEntryCard from '@/components/CatchEntryCard.vue'
import type { CatchEntry, FishingMethod } from '@/lib/types'

const log = useCatchStore()
const setup = useSetupStore()
const coast = useCoastStore()
const auth = useAuthStore()
const route = useRoute()

const speciesList = Object.values(SPECIES_PREFS)

// Bite-scores live in insightRun's store, which each entry's card reads
// (CatchEntryCard). When the entries array is replaced under us (remote
// pull, delete), forget results for ids that no longer exist — and on
// opening the log: the store is kept on the device (insightSaved), and an
// entry deleted while the log was closed (a pull, another tab) left its score.
watch(() => log.entries, (es) => pruneResults(new Set(es.map((e) => e.id))), { immediate: true })

function todayISO(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Current local time as 'HH:MM' — the date is prefilled, so the time should be too. */
function nowHHMM(): string {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function blankForm() {
  return { date: todayISO(), time: nowHHMM(), from: '', to: '', speciesId: '', locationName: '', count: '' as number | '', lengthCm: '' as number | '', weightKg: '' as number | '', released: null as boolean | null, method: null as FishingMethod | null, notes: '' }
}

// Open the native date picker when the field is clicked/focused (not just the
// tiny calendar icon). showPicker isn't in older browsers — guard it.
function openPicker(e: Event) {
  const el = e.target as HTMLInputElement & { showPicker?: () => void }
  try { el.showPicker?.() } catch { /* not allowed in this context — ignore */ }
}
// ── The unsaved form, kept (lib/catchDraft) ───────────────────────────
// Half a catch typed in, then off to Lokationer to add the spot: the view
// started afresh on coming back, and the form was blank. It is kept for the
// tab as the view is left or the page hidden (keepDraft below), and comes
// back as it was left: mode, fields, the entry being edited — the prefill
// (today's date, the time now) doesn't run over it (restoreDraft, below).

const form = reactive(blankForm())
// What the form logs: a catch, or a trip that caught nothing. `?log=empty`
// opens it on the latter, so another screen can link straight to it — unless
// a draft brings its own.
const mode = ref<'catch' | 'empty'>(route.query.log === 'empty' ? 'empty' : 'catch')
// null = adding a new entry; otherwise the id of the entry being edited.
const editingId = ref<string | null>(null)
// The entry as the form copied it on opening (a copy: a pull or a rename can
// change the entry itself under the form). save() sends every field the form
// shows; against this copy the store tells the ones the user changed from the
// ones a pull changed meanwhile — without it, saving a length wrote the
// form's stale note over the phone's new one (see catches.update). A draft
// keeps the copy it opened on, for the same reason.
const editingOpened = shallowRef<CatchEntry | undefined>()
// The saved spot the form's location resolves to, as save() will link it:
// an edited entry keeps its link while its name is left alone. Judged against
// what the form opened on, like every other field: against the entry as a
// pull left it — the spot renamed on the desktop meanwhile — the unchanged
// name no longer matched, the link was dropped, and the catch detached.
const formLocationId = computed(() => linkCatchLocation(form.locationName, setup.locations, editingOpened.value))

// The values the form was last prefilled with. The prefill was taken only
// at mount and after each save, so during a night session the always-visible
// form kept yesterday's date past midnight: the owner changed just the time
// to 00:20 and the catch was stored nearly 24 h early — sorted under the
// 23:40 one, backtested against the wrong day's weather, checked against the
// wrong day's closures. While they are untouched, they roll over with the day.
// (Not on every minute: a field changing while you fill in the rest is worse.)
// A draft brings the prefill it was typed against.
let prefill = { date: form.date, time: form.time, from: '', to: '', loc: '', method: null as FishingMethod | null }
// The date kept over midnight, moved since by a time typed (onTime, onSpan):
// still the form's, it goes on following. Moved to today, it stayed there,
// and a time put right after it, or typed a part at a time as a desktop
// browser takes it (02:45 on the way from 23:45 to 21:45), was refused as
// later than now. Not kept with a draft: put back, the date is as put in.
let dateFollows = false
const now = useNow()
// The day, for the prefill below and the cards' "too old to score". A
// computed of the minute tick that changes once a day, so only then does
// anything that reads it run again.
const today = computed(() => localDayUTC(now.value))

/**
 * An empty trip's prefill (lib/tripPrefill): the time window just fished,
 * the spot of the newest entry today where that makes a trip it can save,
 * and a method. Fields the user has changed since the last prefill are left
 * alone. `withSpot` false leaves the place empty.
 */
function prefillTrip(withSpot = true) {
  // The date and the span are one moment (stores/catches CATCH_WHEN): a span
  // put in by hand keeps its date. Rolled on at midnight, an evening's
  // 19:00–22:00 became tomorrow's, and the form refused it as not yet over.
  // The place and method it was prefilled with belong to that trip as well:
  // with the span kept, they rolled on to the new day's, with no place yet.
  if (form.from !== prefill.from || form.to !== prefill.to) return
  const p = tripPrefill(setup.availability, log.sorted, setup.locations, Date.now(), withSpot)
  // Only what is written here is the prefill: taken from every field, a
  // span or place typed in read as untouched after midnight, and went with
  // the next visit to another screen.
  if (form.date === prefill.date) { prefill.date = form.date = p.date; dateFollows = false }
  prefill.from = form.from = p.from
  prefill.to = form.to = p.to
  if (!form.locationName.trim() || form.locationName === prefill.loc) prefill.loc = form.locationName = p.loc
  if (form.method === prefill.method) prefill.method = form.method = p.method
}
function prefillCatch() {
  // Likewise the date and the time: a time put in by hand keeps its date.
  // Rolled on alone, a catch at 23:40, its time typed at 23:50 and saved
  // after midnight, was stored at 23:40 the next day: a day late, in the future.
  if (form.time !== prefill.time) return
  if (form.date === prefill.date) { prefill.date = form.date = todayISO(); dateFollows = false }
  prefill.time = form.time = nowHHMM()
}
if (mode.value === 'empty') prefillTrip()

function setMode(m: 'catch' | 'empty') {
  // An entry's kind can't change: delete it and log it again instead.
  if (editingId.value || mode.value === m) return
  mode.value = m
  if (m === 'empty') prefillTrip()
  else prefillCatch()
}

watch(today, () => {
  if (editingId.value) return
  if (mode.value === 'empty') prefillTrip()
  else prefillCatch()
})

// The date kept over midnight is no date set by hand: for the 23:40 catch
// it was right, but it stayed for the next fish too, and one caught at 00:15
// and typed in at 00:20 was stored at 00:15 the day before. While the date
// is one the form put in on an earlier day, a time or span typed in moves it
// to the last time that came round, and a note by the date says it isn't today.
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const dayBefore = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return isoDay(Date.UTC(y, m - 1, d - 1))
}
/** A new entry's date that the form put in on a day before `todayIs`, or that has followed a time since (dateFollows), and nobody changed since. */
function dateKept(todayIs: string): boolean {
  return !editingId.value && !!form.date && form.date === prefill.date && (form.date < todayIs || dateFollows)
}
/** What the date says while it is kept from an earlier day: "i går", or "ikke i dag" further back. */
function dateNote(): string {
  const day = isoDay(today.value)
  if (!dateKept(day) || form.date >= day) return ''
  return t(form.date === isoDay(today.value - 86_400_000) ? 'log_date_yesterday' : 'log_date_earlier')
}
/** The catch's time typed in: a kept date goes to today, unless that time is later than now. */
function onTime(e: Event) {
  form.time = (e.target as HTMLInputElement).value
  const day = todayISO()
  if (!form.time || !dateKept(day)) return
  prefill.date = form.date = form.time <= nowHHMM() ? day : dayBefore(day)
  dateFollows = true
}
/** The trip's span typed in: a kept date goes to today if the span has ended by now, else to yesterday (a span over midnight ends the day after its date). */
function onSpan(end: 'from' | 'to', e: Event) {
  form[end] = (e.target as HTMLInputElement).value
  const day = todayISO()
  if (!form.from || !form.to || !dateKept(day)) return
  prefill.date = form.date = form.from < form.to && form.to <= nowHHMM() ? day : dayBefore(day)
  dateFollows = true
}

// Need at least a species or a location to make an entry meaningful.
// Native max= is advisory only, and Save wasn't gated on validity — so a typo
// like 9999999999 cm saved verbatim and skewed the "longest fish" stat forever.
// Bounds are deliberately generous: a 400 cm / 500 kg fish is a typo, not a catch.
// And above 0, a count in whole fish: a length of 0 cm was saved and shown as
// '📏 0 cm', the longest fish in the stats too, and a count of 2.5 saved as 2.
const LIMITS = { count: 9999, lengthCm: 400, weightKg: 500 }
function inRange(v: string | number, max: number, whole = false): boolean {
  if (v === '') return true
  const n = Number(v)
  return Number.isFinite(n) && n > 0 && n <= max && (!whole || Number.isInteger(n))
}
const numbersSane = computed(() =>
  inRange(form.count, LIMITS.count, true)
  && inRange(form.lengthCm, LIMITS.lengthCm)
  && inRange(form.weightKg, LIMITS.weightKg)
  && (!form.date || form.date <= todayISO()),
)
// A catch can't be later than now. Only the date was checked, and right
// after midnight the form says today: a catch at 23:40 last night, its time
// put right and its date not, was stored nearly a day ahead, first in the
// log and scored from a forecast. A date after today is the check above.
// The form's clock ticks once a minute (useNow): a time inside the current
// minute is allowed, as for a trip (catchScore tripFormIssues).
const laterThanNow = computed(() => {
  const date = form.date || todayISO()
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = form.time.split(':').map(Number)
  if (!y || !form.time || !Number.isFinite(hh) || date > todayISO()) return false
  return new Date(y, (m || 1) - 1, d || 1, hh, mm || 0).getTime() > now.value + 60_000
})
const canSave = computed(() =>
  (!!form.speciesId || !!form.locationName.trim()) && numbersSane.value && !laterThanNow.value,
)

// ── An empty trip's checks ───────────────────────────────────────────
// The trip the form would save, judged by the rules in tripFormIssues: a
// place, a date, a span that has ended, no catch and no other trip inside it.
// Judged against the entries near it only (tripNeighbours, built when the log
// or the spots change): against the whole log, a keystroke in the place, date
// or time cost a pass over every entry.
const neighbours = computed(() => tripNeighbours(log.entries, setup.locations))
const tripIssues = computed(() => {
  const trip: CatchEntry = { id: editingId.value ?? '', outcome: 'empty', date: form.date, from: form.from, to: form.to, speciesId: '', locationName: form.locationName, locationId: formLocationId.value }
  return tripFormIssues(trip, neighbours.value(trip), setup.locations, now.value)
})
const canSaveTrip = computed(() => tripIssues.value.length === 0)

// Regulation warnings (undersize / closed season) — live in the form + per entry
// (CatchEntryCard). When the location resolves to a saved spot, its water
// type picks the right rules (salmon: 40 cm fresh vs 60 cm salt; the pike
// closure differs too). Its position places it for the area rules (sea trout
// around Bornholm, the size columns, the Baltic cod ban). On the date save()
// stores: today's when the field is cleared, which had no warnings at all.
const formLoc = computed(() => setup.locations.find((l) => l.id === formLocationId.value))
const formWarnings = computed(() =>
  catchWarnings(form.speciesId, form.lengthCm === '' ? undefined : Number(form.lengthCm), form.date || isoDay(today.value), form.released ?? undefined, formLoc.value?.waterType, formLoc.value),
)

function resetForm(opts: { tripSaved?: boolean } = {}) {
  Object.assign(form, blankForm())
  prefill = { date: form.date, time: form.time, from: '', to: '', loc: '', method: null }
  dateFollows = false
  editingId.value = null
  editingOpened.value = undefined
  // A second spot is the likely next trip: stay in trip mode, freshly
  // prefilled — but not with the spot just logged. Refilled with it, the form
  // looked exactly as before saving (no toast, the list below the fold on a
  // phone), and a second tap on Save stored the same trip twice.
  if (mode.value === 'empty') prefillTrip(!opts.tripSaved)
  // Saved, cancelled, or the entry it edited deleted: nothing to come back to.
  clearCatchDraft()
}

/** Nothing typed: every field holds what it was prefilled with, or nothing, and no entry is open. */
function untouched(): boolean {
  return !editingId.value && form.date === prefill.date && form.time === prefill.time && form.from === prefill.from
    && form.to === prefill.to && form.locationName === prefill.loc && form.method === prefill.method && !form.speciesId
    && form.count === '' && form.lengthCm === '' && form.weightKg === '' && form.released === null && !form.notes
}
// Something typed into a new entry: the form keeps it over visits and
// reloads, so Annullér lets it go (resetForm), as it does an edit.
// (`prefill` is no ref: it changes only alongside the form, which re-runs this.)
const typed = computed(() => !untouched())

/**
 * The tab's draft, put back in the form if it is `who`'s to see (lib/catchDraft:
 * another account's goes; `who` not known yet, only a guest's shows). A draft
 * editing an entry deleted meanwhile (a pull, another tab) is dropped: saved,
 * the edit would put the entry back (catches.update adds an entry it can't
 * find). `onlyIfUntouched`: what was typed meanwhile stays. True when put back.
 */
function restoreDraft(who: string | null | undefined, onlyIfUntouched = false): boolean {
  const d = readCatchDraft(who)
  if (!d || (onlyIfUntouched && !untouched())) return false
  if (d.editing && !log.entries.some((e) => e.id === d.editing!.id)) { clearCatchDraft(); return false }
  // Only trip mode was kept: the form opens on it, freshly prefilled.
  if (!d.form || !d.prefill) { setMode(d.mode); return true }
  mode.value = d.mode
  Object.assign(form, d.form)
  prefill = { ...d.prefill }
  dateFollows = false
  editingId.value = d.editing?.id ?? null
  editingOpened.value = d.editing?.opened
  return true
}

// The account whose catch log the page holds: the form is typed for it, and
// its draft kept for it. Signed in, that account. Signed out, the one the log
// on the device belongs to (stores/catches): a token refresh the server
// refused leaves the account's log there, and so does a start before
// auth.init has read the session (main.ts mounts the app first), which
// offline with an expired token takes auth-js some 50 s. The draft waited
// for the session then, unsaved, and read signed out it was deleted. Before
// the session is read with a guest's log on the device, it is not known
// (undefined): an account may be signed in whose log no pull has brought
// here yet. Only a guest's draft shows then, and an account's waits.
const logWho = (): string | null | undefined =>
  auth.user ? auth.user.id : log.account !== null || !auth.loading ? log.account : undefined
let formWho = logWho()
// A guest's draft put back before that is known: the form is a guest's.
if (restoreDraft(formWho) && formWho === undefined) formWho = null
watch(logWho, (who) => {
  if (who === formWho) return
  if (formWho === undefined) {
    formWho = who
    restoreDraft(who, true)
    return
  }
  // A guest's form goes on into a sign-in, and into the log of whichever
  // account it turns out to be.
  if (formWho === null) {
    if (who !== undefined) formWho = who
    return
  }
  // The log on screen is the account's no longer: another tab's logout took
  // it, another account's took its place, or another account signed in.
  // The form stayed: saved, it put one account's catch, or its edit of an
  // entry, into another account's log, or into the log signed out, which the
  // next sign-in took into its account; and the next person at the page read
  // it. It starts over, its draft gone, typed for the log on screen.
  resetForm()
  formWho = who
})

// Kept as the view is left (another screen), and as the page is hidden or
// left (a reload, the app switched away from on a phone) — not per
// keystroke. A form with nothing typed keeps only trip mode, and opens
// freshly prefilled: a time of hours ago is no help. While whose log the
// page holds is not known (logWho), nothing typed, nothing is kept: the
// draft the tab holds may be an account's, waiting for it. Typed into, the
// form is the page's, on a guest's log: a guest's, which goes on into
// whichever account the page turns out to be. Kept for nobody, it went as
// the page was left, and a session read that never ends kept nothing.
const openedAt = draftEpoch()
function keepDraft() {
  if (formWho === undefined && typed.value) formWho = null
  const who = formWho
  if (who === undefined) return
  keepCatchDraft(untouched()
    ? (mode.value === 'empty' ? { who, mode: 'empty', editing: null, form: null, prefill: null } : null)
    : {
      who,
      mode: mode.value,
      editing: editingId.value && editingOpened.value ? { id: editingId.value, opened: editingOpened.value } : null,
      form: { ...form },
      prefill: { ...prefill },
    }, openedAt)
}
const onVisibility = () => { if (document.visibilityState === 'hidden') keepDraft() }
if (typeof window !== 'undefined') window.addEventListener('pagehide', keepDraft)
document.addEventListener('visibilitychange', onVisibility)
onBeforeUnmount(() => {
  keepDraft()
  if (typeof window !== 'undefined') window.removeEventListener('pagehide', keepDraft)
  document.removeEventListener('visibilitychange', onVisibility)
})

const fill = (s: string, params: Record<string, string | number>) =>
  Object.entries(params).reduce((out, [k, v]) => out.replace(`{${k}}`, String(v)), s)

async function save() {
  if (mode.value === 'empty') return saveTrip()
  if (!canSave.value) return
  const payload = {
    date: form.date || todayISO(),
    time: form.time || undefined,
    speciesId: form.speciesId,
    locationName: form.locationName.trim(),
    // The saved spot's id as well as its name: linked by name only, a spot
    // renamed on another device detached its catches here until the rename's
    // rewrite of the log arrived. Kept in step with the chosen name on edit.
    locationId: formLocationId.value,
    count: form.count === '' || Number(form.count) <= 1 ? undefined : Number(form.count),
    lengthCm: form.lengthCm === '' ? undefined : Number(form.lengthCm),
    weightKg: form.weightKg === '' ? undefined : Number(form.weightKg),
    released: form.released === null ? undefined : form.released,
    method: form.method ?? undefined,
    notes: form.notes.trim() || undefined,
  }
  const id = editingId.value
  const opened = editingOpened.value
  // Only a catch that lands somewhere new can land inside a trip: a new one,
  // or an edit of its date, time or place. The place as a spot: by its stored
  // name, a catch saved before its spot was renamed read as moved at every
  // edit, and asked again to delete a trip it was left in.
  const moved = !opened || opened.date !== payload.date || opened.time !== payload.time
    || spotKey(opened, setup.locations) !== spotKey(payload, setup.locations)
  if (id) log.update(id, payload, opened)
  else log.add(payload)
  resetForm()
  // A catch inside a trip logged as "uden fangst": offer to delete the trip,
  // now that it did catch something. Either way the catch is saved.
  const saved = id ? log.entries.find((e) => e.id === id) : log.entries[0]
  if (!moved || !saved) return
  for (const trip of tripsContaining(saved, log.entries, setup.locations)) {
    const ask = fill(t('log_trip_replace_confirm'), { loc: catchPlaceName(trip, setup.locations), from: trip.from ?? '', to: trip.to ?? '' })
    if (await confirmDialog(ask)) log.remove(trip.id)
  }
}

function saveTrip() {
  if (!canSaveTrip.value) return
  // count 0, no time and no species: an app version from before trips counts
  // no fish for it, leaves it out of its model check and can't save its edit.
  const payload = {
    outcome: 'empty' as const,
    date: form.date,
    from: form.from,
    to: form.to,
    speciesId: '',
    count: 0,
    locationName: form.locationName.trim(),
    locationId: formLocationId.value,
    method: form.method ?? undefined,
    notes: form.notes.trim() || undefined,
  }
  if (editingId.value) log.update(editingId.value, payload, editingOpened.value)
  else log.add(payload)
  resetForm({ tripSaved: true })
  // The form now asks for a place again and the list is below the fold on a
  // phone: without a word, the save looked like it hadn't happened.
  showToast('✓ ' + t('log_trip_saved'))
}

/** The form's fields for entry `c`, as ✎ opens it. */
function formFor(c: CatchEntry): ReturnType<typeof blankForm> {
  return {
    date: c.date,
    time: c.time ?? '',
    from: c.from ?? '',
    to: c.to ?? '',
    speciesId: c.speciesId,
    // The linked spot's current name, as the list shows it; saving it keeps
    // the link (linkCatchLocation) and brings an out-of-date stored name along.
    locationName: catchPlaceName(c, setup.locations),
    count: isEmptyTrip(c) ? '' : c.count ?? '',
    lengthCm: c.lengthCm ?? '',
    weightKg: c.weightKg ?? '',
    released: c.released ?? null,
    method: c.method ?? null,
    notes: c.notes ?? '',
  }
}

/** Something saving would keep: a new entry typed into, or the entry being edited changed from how it opened. */
function changed(): boolean {
  if (!editingId.value) return !untouched()
  const was = editingOpened.value ? formFor(editingOpened.value) : null
  return !was || (Object.keys(was) as (keyof typeof was)[]).some((k) => form[k] !== was[k])
}

const formEl = ref<HTMLElement | null>(null)
async function edit(c: CatchEntry) {
  // ✎ on the entry already open offered to drop its changes and open it
  // again, as it was: it only shows the form.
  if (editingId.value === c.id) return showForm()
  // ✎ put the entry over whatever the form held: a new catch half typed, or
  // changes to another entry, were gone, and Annullér left a blank form.
  if (changed()) {
    if (!(await confirmDialog(t('log_edit_drop_confirm')))) return
    // The log can change while it asks: a pull deletes the entry, or another
    // tab's sign-in puts another account's log here and the form starts over.
    // Opened anyway, saving put the entry into that log. Opened as it is now.
    const current = log.entries.find((e) => e.id === c.id)
    if (!current) return
    c = current
  }
  editingId.value = c.id
  editingOpened.value = JSON.parse(JSON.stringify(c))
  mode.value = isEmptyTrip(c) ? 'empty' : 'catch'
  Object.assign(form, formFor(c))
  showForm()
}
// To the form, not the page top: an open Modeltjek panel sits between the
// two and pushed the form below the fold, so ✎ looked like it did nothing.
function showForm() {
  formEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

async function removeEntry(c: CatchEntry) {
  if (await confirmDialog(t(isEmptyTrip(c) ? 'log_trip_remove_confirm' : 'log_remove_confirm'))) {
    if (editingId.value === c.id) resetForm()
    log.remove(c.id)
  }
}

// Summary stats over the fish in the log. Fish-counted (each entry can be a
// haul of N), while longest/heaviest stay per-single-fish. Empty trips are
// not fish: they get a tile of their own, shown even before the first catch.
const qty = (e: CatchEntry) => e.count ?? 1
// One per outing, and none that may hold a catch — as Modeltjek counts them.
const tripCount = computed(() => fishlessOutings(log.entries, log.entries, setup.locations).length)
const stats = computed(() => {
  const es = log.entries.filter((e) => !isEmptyTrip(e))
  if (!es.length) return null
  let longest: CatchEntry | null = null
  let heaviest: CatchEntry | null = null
  const counts: Record<string, number> = {}
  let total = 0, released = 0
  for (const e of es) {
    total += qty(e)
    if (e.released === true) released += qty(e)
    if (e.lengthCm != null && (!longest || e.lengthCm > longest.lengthCm!)) longest = e
    if (e.weightKg != null && (!heaviest || e.weightKg > heaviest.weightKg!)) heaviest = e
    if (e.speciesId) counts[e.speciesId] = (counts[e.speciesId] || 0) + qty(e)
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return { count: total, longest, heaviest, topSpeciesId: top?.[0] ?? null, topCount: top?.[1] ?? 0, released }
})
</script>

<template>
  <div class="wizard">
    <div class="row between">
      <h1>{{ t('log_title') }}</h1>
      <span v-if="stats" class="total">{{ stats.count }} {{ t(stats.count === 1 ? 'log_total_one' : 'log_total') }}</span>
    </div>

    <!-- Stats -->
    <div v-if="stats || tripCount" class="stats">
      <template v-if="stats">
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
      </template>
      <div v-if="tripCount" class="stat">
        <span class="stat-val">{{ tripCount }}</span>
        <span class="stat-lbl">∅ {{ t('log_stat_trips') }}</span>
      </div>
    </div>

    <ModelCheckPanel :entries="log.entries" :locations="setup.locations" :availability="setup.availability" :target-species="setup.targetSpecies" :shores="coast.shoreById" />

    <!-- Add / edit form -->
    <div ref="formEl" class="card form" :class="{ editing: editingId }">
      <div class="seg mode" role="group" :aria-label="t('log_mode_label')">
        <button type="button" class="seg-btn" :class="{ on: mode === 'catch' }" :disabled="!!editingId && mode !== 'catch'"
          :aria-pressed="mode === 'catch'" @click="setMode('catch')">{{ t('log_mode_catch') }}</button>
        <button type="button" class="seg-btn" :class="{ on: mode === 'empty' }" :disabled="!!editingId && mode !== 'empty'"
          :aria-pressed="mode === 'empty'" @click="setMode('empty')">{{ t('log_mode_empty') }}</button>
      </div>
      <strong class="form-h">{{ mode === 'empty'
        ? (editingId ? t('log_trip_edit_h') : t('log_trip_h'))
        : (editingId ? t('log_edit_h') : t('log_add')) }}</strong>

      <!-- An empty trip: when, where, how -->
      <div v-if="mode === 'empty'" class="grid">
        <label class="wide">
          {{ t('log_date') }} <small v-if="dateNote()" class="date-note">{{ dateNote() }}</small>
          <input type="date" :max="todayISO()" v-model="form.date" @click="openPicker" @focus="openPicker" />
        </label>
        <label>
          {{ t('log_from') }}
          <input type="time" :value="form.from" @input="onSpan('from', $event)" @click="openPicker" @focus="openPicker" />
        </label>
        <label>
          {{ t('log_to') }}
          <input type="time" :value="form.to" @input="onSpan('to', $event)" @click="openPicker" @focus="openPicker" />
        </label>
        <label class="wide">
          {{ t('log_location') }}
          <input v-model="form.locationName" :placeholder="t('log_trip_loc_ph')" list="loc-options" />
        </label>
        <div class="wide outcome">
          <span id="log-method-lbl" class="outcome-lbl">{{ t('method_label') }}</span>
          <div class="seg" role="group" aria-labelledby="log-method-lbl">
            <button v-for="m in FISHING_METHODS" :key="m.id" type="button" class="seg-btn"
              :class="{ on: form.method === m.id }" :aria-pressed="form.method === m.id"
              @click="form.method = form.method === m.id ? null : m.id">{{ m.emoji }} {{ t('method_' + m.id) }}</button>
          </div>
        </div>
        <label class="wide">
          {{ t('log_notes') }}
          <textarea v-model="form.notes" :placeholder="t('log_notes_ph')" rows="2" />
        </label>
      </div>

      <!-- A catch -->
      <div v-else class="grid">
        <label>
          {{ t('log_date') }} <small v-if="dateNote()" class="date-note">{{ dateNote() }}</small>
          <input type="date" :max="todayISO()" v-model="form.date" @click="openPicker" @focus="openPicker" />
        </label>
        <label>
          {{ t('log_time') }}
          <input type="time" :value="form.time" @input="onTime" @click="openPicker" @focus="openPicker" />
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
        </label>
        <label>
          {{ t('log_count') }} <small class="opt">{{ t('log_optional') }}</small>
          <input type="number" min="1" max="9999" step="1" inputmode="numeric" v-model="form.count" placeholder="1" />
        </label>
        <label>
          {{ t('log_length') }} <small class="opt">{{ t('log_optional') }}</small>
          <input type="number" min="0" max="400" inputmode="decimal" v-model="form.lengthCm" :placeholder="t('log_not_measured')" />
        </label>
        <label>
          {{ t('log_weight') }} <small class="opt">{{ t('log_optional') }}</small>
          <input type="number" min="0" max="500" step="0.01" inputmode="decimal" v-model="form.weightKg" :placeholder="t('log_not_measured')" />
        </label>
        <div class="wide outcome">
          <span id="log-outcome-lbl" class="outcome-lbl">{{ t('log_outcome') }}</span>
          <div class="seg" role="group" aria-labelledby="log-outcome-lbl">
            <button type="button" class="seg-btn" :class="{ on: form.released === false }" :aria-pressed="form.released === false"
              @click="form.released = form.released === false ? null : false">🧺 {{ t('log_kept') }}</button>
            <button type="button" class="seg-btn" :class="{ on: form.released === true }" :aria-pressed="form.released === true"
              @click="form.released = form.released === true ? null : true">🌊 {{ t('log_released') }}</button>
          </div>
        </div>
        <div class="wide outcome">
          <span id="log-method-lbl" class="outcome-lbl">{{ t('method_label') }}</span>
          <div class="seg" role="group" aria-labelledby="log-method-lbl">
            <button v-for="m in FISHING_METHODS" :key="m.id" type="button" class="seg-btn"
              :class="{ on: form.method === m.id }" :aria-pressed="form.method === m.id"
              @click="form.method = form.method === m.id ? null : m.id">{{ m.emoji }} {{ t('method_' + m.id) }}</button>
          </div>
        </div>
        <label class="wide">
          {{ t('log_notes') }}
          <textarea v-model="form.notes" :placeholder="t('log_notes_ph')" rows="2" />
        </label>
      </div>
      <datalist id="loc-options">
        <option v-for="l in setup.locations" :key="l.id" :value="l.name" />
      </datalist>

      <div v-if="mode === 'empty'" class="guard">
        <div v-if="tripIssues.includes('location')" class="hint">{{ t('log_trip_need_loc') }}</div>
        <div v-else-if="!formLocationId" class="hint">{{ t('log_trip_unsaved_loc') }}</div>
        <div v-if="tripIssues.includes('date')" class="hint">{{ t('log_trip_need_date') }}</div>
        <div v-if="tripIssues.includes('times')" class="hint">{{ t('log_trip_need_times') }}</div>
        <div v-else-if="tripIssues.includes('same')">⚠️ {{ t('avail_time_warn') }}</div>
        <div v-else-if="tripIssues.includes('future')">⚠️ {{ t('log_trip_future') }}</div>
        <div v-if="tripIssues.includes('catch')">⚠️ {{ t('log_trip_overlap') }}</div>
        <div v-if="tripIssues.includes('trip')">⚠️ {{ t('log_trip_dup') }}</div>
      </div>
      <div v-else-if="formWarnings.length || !numbersSane || laterThanNow" class="guard">
        <div v-if="!numbersSane">⚠️ {{ t('log_range_warn') }}</div>
        <div v-if="laterThanNow">⚠️ {{ t('log_future_warn') }}</div>
        <div v-for="(g, k) in formWarnings" :key="k">⚠️ {{ g }}</div>
      </div>
      <div class="form-actions">
        <button v-if="mode === 'empty'" class="btn primary" :disabled="!canSaveTrip" @click="save">{{ editingId ? t('log_trip_update') : t('log_trip_save') }}</button>
        <button v-else class="btn primary" :disabled="!canSave" @click="save">{{ editingId ? t('log_update') : t('log_save') }}</button>
        <button v-if="editingId || typed" class="btn ghost" @click="resetForm()">{{ t('log_cancel') }}</button>
      </div>
    </div>

    <!-- History -->
    <div v-if="!log.entries.length" class="empty">
      <div class="empty-icon">📒</div>
      <strong>{{ t('log_empty_title') }}</strong>
      <span class="empty-sub">{{ t('log_empty_sub') }}</span>
    </div>

    <CatchEntryCard v-for="c in log.sorted" :key="c.id" :entry="c" :locations="setup.locations" :targets="setup.targetSpecies"
      :shores="coast.shoreById" :today="today" :active="editingId === c.id" @edit="edit" @remove="removeEntry" />
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
.seg.mode { margin-bottom: 12px; }
.seg-btn:disabled { opacity: 0.45; cursor: default; }
.outcome { display: flex; flex-direction: column; gap: 4px; }
.outcome-lbl { font-size: 0.78rem; color: var(--muted); }
.seg { display: flex; gap: 6px; }
.seg-btn {
  flex: 1; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--border);
  background: none; color: var(--muted); cursor: pointer; font-size: 0.84rem;
}
.seg-btn:hover:not(:disabled) { border-color: var(--primary); }
.seg-btn.on { border-color: var(--primary); color: var(--text); background: rgba(56,189,248,.12); font-weight: 600; }
/* ~34 px tall: too small for a finger. Touch screens only. */
@media (pointer: coarse) { .seg-btn { min-height: 40px; } }
.form-actions { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
.form-actions .btn { margin-top: 0; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.grid label { display: flex; flex-direction: column; gap: 4px; font-size: 0.78rem; color: var(--muted); }
.grid label.wide { grid-column: 1 / -1; }
.opt { color: var(--muted); font-weight: 400; font-size: 0.72rem; }
.date-note { color: var(--gold); font-weight: 600; font-size: 0.72rem; }
.grid input, .grid select, .grid textarea { font-size: 0.9rem; }
.form .btn { margin-top: 12px; }
.guard { margin-top: 8px; font-size: 0.76rem; line-height: 1.5; color: var(--gold); }
.guard .hint { color: var(--muted); }
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
