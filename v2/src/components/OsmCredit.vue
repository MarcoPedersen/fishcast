<script setup lang="ts">
/**
 * A translated OpenStreetMap credit with "OpenStreetMap" linked to its
 * copyright page, where the ODbL is (lib/osmCredit.ts). The link is markup
 * here, around the text's {osm} placeholder: no translated string is
 * rendered as HTML.
 */
import { computed } from 'vue'
import { OSM_COPYRIGHT_URL, osmCreditParts } from '@/lib/osmCredit'

const props = defineProps<{ text: string }>()
const parts = computed(() => osmCreditParts(props.text))
</script>

<!-- One line: a line break inside would put a space before the link. -->
<template>
  <span class="osm-credit">{{ parts.before }}<a :href="OSM_COPYRIGHT_URL" target="_blank" rel="noopener">OpenStreetMap</a>{{ parts.after }}</span>
</template>

<style scoped>
.osm-credit a { color: inherit; text-decoration: underline; }
/* Touch screens: "OpenStreetMap" was a link about 14 px tall in a line of
   small text, under the dashboard, the spot list and the coast picker. A
   40 px box, its text centred, and its line grows with it. */
@media (pointer: coarse) { .osm-credit a { display: inline-flex; align-items: center; min-height: 40px; } }
</style>
