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
</style>
