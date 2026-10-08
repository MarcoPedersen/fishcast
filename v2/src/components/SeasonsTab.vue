<script setup lang="ts">
import { computed } from 'vue'
import { lang, t } from '@/lib/i18n'
import { DK_REGULATIONS } from '@/lib/regulations'

const today = new Date()
const month = today.getMonth() + 1

interface Reg {
  id: string; name: string; nameEn: string; emoji: string
  sizes?: { area: string; minCm: number; areaNote?: string; waterNote?: string }[]
  bagLimit?: string; bagLimitEn?: string; closedSeasons?: any[]
  restrictions?: { note: string; noteEn?: string; year?: number | number[] }[]
  bestMonths?: number[]; status: string; venom?: boolean; venomWarning?: string; venomWarningEn?: string; notes?: string
}

const name = (s: Reg) => (lang.value === 'en' ? s.nameEn : s.name)
// Bans, bag limits, areas and the weever's first aid were rendered in Danish
// whatever the language — only the name switched. Each text now has an *En
// twin in regulations.ts, picked the same way as the name.
const en = () => lang.value === 'en'
const bag = (s: Reg) => (en() && s.bagLimitEn) || s.bagLimit || ''
const bagShort = (s: Reg) => (bag(s).length > 26 ? bag(s).slice(0, 26) + '…' : bag(s))
const noteText = (r: { note: string; noteEn?: string }) => (en() && r.noteEn) || r.note
const venomText = (s: Reg) => (en() && s.venomWarningEn) || s.venomWarning || ''
// The range across areas — sizes[0] alone showed mackerel as "Min. 30 cm",
// the North Sea figure, although Kattegat's is 20 cm.
const minSize = (s: Reg): string | null => {
  const r = DK_REGULATIONS.sizeRange(s)
  return r ? (r.min === r.max ? String(r.min) : `${r.min}–${r.max}`) : null
}
const inSeason = (s: Reg) => DK_REGULATIONS.isInSeason(s, today)
// A closure in one named area (perch off South Zealand in March) no longer
// closes the species nationwide — but it still belongs under "restrictions",
// where its dates are listed, rather than vanishing into "in season".
const regionalNow = (s: Reg) => DK_REGULATIONS.regionalClosuresOn(s, today).length > 0

const species = DK_REGULATIONS.species as Reg[]
const open = computed(() => species.filter((s) => s.status === 'open' && inSeason(s) && !regionalNow(s)))
const restricted = computed(() => species.filter((s) => s.status === 'restricted' || (s.status === 'open' && (!inSeason(s) || regionalNow(s)))))
const closed = computed(() => species.filter((s) => s.status === 'closed'))

// Year-pinned rows (the 2026 cod ban, grayling's 2026-only protection) only
// describe their own year — listing them later would show rules that ended.
const year = today.getFullYear()
const inYear = (r: { year?: number | number[] }) =>
  r.year == null || (Array.isArray(r.year) ? r.year.includes(year) : r.year === year)
const restrictions = (s: Reg) => (s.restrictions || []).filter(inYear)

// "1. jan" in Danish, "1 Jan" in English.
function dayMonth(d: number, m: number): string {
  const mon = t('month' + (m - 1))
  return en() ? `${d} ${mon}` : `${d}. ${mon.toLowerCase()}`
}
function closedText(s: Reg): string {
  const rows = DK_REGULATIONS.closuresInYear(s, year)
  if (!rows.length) return ''
  return rows
    .map((c: any) => {
      const where = (en() && c.whereEn) || c.where
      return `${dayMonth(c.startDay, c.startMonth)} – ${dayMonth(c.endDay, c.endMonth)}${where ? ' (' + where + ')' : ''}`
    })
    .join(' · ')
}
</script>

<template>
  <div class="seasons">
    <p class="disclaimer">{{ t('sp_regs_note') }}
      <a :href="DK_REGULATIONS.officialUrl" target="_blank" rel="noopener">lfst.dk</a>
    </p>

    <p class="section">{{ t('sp_in_season') }} ({{ open.length }})</p>
    <div class="grid">
      <div v-for="s in open" :key="s.id" class="sp card">
        <div class="sp-head">{{ s.emoji }} <strong>{{ name(s) }}</strong>
          <span v-if="s.venom" class="venom-tag">☠️</span>
        </div>
        <div class="badges">
          <span v-if="minSize(s)" class="badge size">{{ t('sp_min_size') }} {{ minSize(s) }} cm</span>
          <span v-if="s.bagLimit" class="badge bag" :title="bag(s)">{{ t('sp_bag_limit') }} {{ bagShort(s) }}</span>
          <span v-if="s.bestMonths?.includes(month)" class="badge season">{{ t('sp_high_season') }}</span>
        </div>
        <!-- The weever is in season all year, and this section never showed its
             venom/first-aid text — it only rendered under restrictions. -->
        <p v-if="s.venomWarning" class="note venom">{{ venomText(s) }}</p>
      </div>
    </div>

    <template v-if="restricted.length">
      <p class="section">{{ t('sp_restricted') }} ({{ restricted.length }})</p>
      <div class="grid">
        <div v-for="s in restricted" :key="s.id" class="sp card caution">
          <div class="sp-head">{{ s.emoji }} <strong>{{ name(s) }}</strong>
            <span v-if="s.venom" class="venom-tag">☠️</span>
          </div>
          <div class="badges">
            <span v-if="minSize(s)" class="badge size">{{ t('sp_min_size') }} {{ minSize(s) }} cm</span>
            <span v-if="s.bagLimit" class="badge bag" :title="bag(s)">{{ bagShort(s) }}</span>
          </div>
          <p v-if="closedText(s)" class="note">🚫 {{ closedText(s) }}</p>
          <p v-for="(r, i) in restrictions(s)" :key="i" class="note">{{ noteText(r) }}</p>
          <p v-if="s.venomWarning" class="note venom">{{ venomText(s) }}</p>
        </div>
      </div>
    </template>

    <template v-if="closed.length">
      <p class="section">{{ t('sp_closed') }} ({{ closed.length }})</p>
      <div class="grid">
        <div v-for="s in closed" :key="s.id" class="sp card closed">
          <div class="sp-head">{{ s.emoji }} <strong>{{ name(s) }}</strong></div>
          <p v-for="(r, i) in restrictions(s)" :key="i" class="note">{{ noteText(r) }}</p>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.disclaimer { font-size: 0.74rem; color: var(--muted); margin-bottom: 14px; }
.disclaimer a { color: var(--gold); margin-left: 4px; }
.section { font-size: 0.8rem; color: var(--muted); font-weight: 700; margin: 16px 0 8px; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
@media (max-width: 540px) { .grid { grid-template-columns: 1fr; } }
.sp { padding: 12px; }
.sp.caution { border-color: rgba(245,158,11,.4); }
.sp.closed { opacity: 0.7; }
.sp-head { font-size: 0.95rem; }
.venom-tag { margin-left: 4px; }
.badges { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
.badge { font-size: 0.7rem; padding: 2px 7px; border-radius: 10px; border: 1px solid var(--border); color: var(--muted); }
.badge.size { color: var(--primary); }
.badge.season { color: var(--green); border-color: rgba(34,197,94,.4); }
.note { font-size: 0.72rem; color: var(--gold); margin-top: 5px; line-height: 1.4; }
.note.venom { color: var(--red); }
</style>
