<script setup lang="ts">
import { computed } from 'vue'
import { lang, t } from '@/lib/i18n'
import { DK_REGULATIONS } from '@/lib/regulations'

const today = new Date()
const month = today.getMonth() + 1

interface Reg {
  id: string; name: string; nameEn: string; emoji: string
  sizes?: { area: string; minCm: number; areaNote?: string; waterNote?: string }[]
  bagLimit?: string; closedSeasons?: any[]; restrictions?: { note: string }[]
  bestMonths?: number[]; status: string; venom?: boolean; venomWarning?: string; notes?: string
}

const name = (s: Reg) => (lang.value === 'en' ? s.nameEn : s.name)
const minSize = (s: Reg) => DK_REGULATIONS.getPrimarySize(s)
const inSeason = (s: Reg) => DK_REGULATIONS.isInSeason(s, today)

const species = DK_REGULATIONS.species as Reg[]
const open = computed(() => species.filter((s) => s.status === 'open' && inSeason(s)))
const restricted = computed(() => species.filter((s) => s.status === 'restricted' || (s.status === 'open' && !inSeason(s))))
const closed = computed(() => species.filter((s) => s.status === 'closed'))

const MONTHS_DA = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec']
function closedText(s: Reg): string {
  if (!s.closedSeasons?.length) return ''
  return s.closedSeasons
    .map((c: any) => `${c.startDay}. ${MONTHS_DA[c.startMonth - 1]} – ${c.endDay}. ${MONTHS_DA[c.endMonth - 1]}${c.where ? ' (' + c.where + ')' : ''}`)
    .join(' · ')
}
</script>

<template>
  <div class="seasons">
    <p class="disclaimer">{{ DK_REGULATIONS.disclaimer }}
      <a :href="DK_REGULATIONS.officialUrl" target="_blank" rel="noopener">lfst.dk</a>
    </p>

    <p class="section">{{ t('sp_in_season') }} ({{ open.length }})</p>
    <div class="grid">
      <div v-for="s in open" :key="s.id" class="sp card">
        <div class="sp-head">{{ s.emoji }} <strong>{{ name(s) }}</strong></div>
        <div class="badges">
          <span v-if="minSize(s)" class="badge size">{{ t('sp_min_size') }} {{ minSize(s) }} cm</span>
          <span v-if="s.bagLimit" class="badge bag" :title="s.bagLimit">{{ t('sp_bag_limit') }} {{ s.bagLimit.length > 26 ? s.bagLimit.slice(0, 26) + '…' : s.bagLimit }}</span>
          <span v-if="s.bestMonths?.includes(month)" class="badge season">{{ t('sp_high_season') }}</span>
        </div>
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
            <span v-if="s.bagLimit" class="badge bag">{{ s.bagLimit.length > 26 ? s.bagLimit.slice(0, 26) + '…' : s.bagLimit }}</span>
          </div>
          <p v-if="closedText(s)" class="note">🚫 {{ closedText(s) }}</p>
          <p v-for="(r, i) in s.restrictions || []" :key="i" class="note">{{ r.note }}</p>
          <p v-if="s.venomWarning" class="note venom">{{ s.venomWarning }}</p>
        </div>
      </div>
    </template>

    <template v-if="closed.length">
      <p class="section">{{ t('sp_closed') }} ({{ closed.length }})</p>
      <div class="grid">
        <div v-for="s in closed" :key="s.id" class="sp card closed">
          <div class="sp-head">{{ s.emoji }} <strong>{{ name(s) }}</strong></div>
          <p v-for="(r, i) in s.restrictions || []" :key="i" class="note">{{ r.note }}</p>
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
