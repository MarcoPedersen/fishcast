import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from './auth'
import { lang } from '@/lib/i18n'
import type { Availability, Location } from '@/lib/types'

const LS_KEY = 'fc2-setup'
export const uid = () => Math.random().toString(36).slice(2, 10)

export const useSetupStore = defineStore('setup', () => {
  const locations = ref<Location[]>([])
  const targetSpecies = ref<string[]>([])
  const availability = ref<Availability[]>([])
  const syncing = ref(false)

  function loadLocal() {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (!raw) return
      const s = JSON.parse(raw)
      locations.value = s.locations ?? []
      targetSpecies.value = s.targetSpecies ?? []
      availability.value = s.availability ?? []
    } catch { /* corrupt local state — start fresh */ }
  }

  function saveLocal() {
    localStorage.setItem(LS_KEY, JSON.stringify({
      locations: locations.value,
      targetSpecies: targetSpecies.value,
      availability: availability.value,
    }))
  }

  /** Pull the setup stored for the logged-in user; falls back to local. */
  async function pullRemote() {
    const auth = useAuthStore()
    if (!supabase || !auth.user) return
    const { data } = await supabase
      .from('setups')
      .select('setup')
      .eq('user_id', auth.user.id)
      .maybeSingle()
    if (data?.setup) {
      const s = data.setup
      locations.value = s.locations ?? []
      targetSpecies.value = s.targetSpecies ?? []
      availability.value = s.availability ?? []
      if (s.lang) lang.value = s.lang
      saveLocal()
    }
  }

  /** Push the current setup to Supabase (upsert keyed by user). */
  async function pushRemote() {
    const auth = useAuthStore()
    if (!supabase || !auth.user) return
    syncing.value = true
    await supabase.from('setups').upsert({
      user_id: auth.user.id,
      setup: {
        locations: locations.value,
        targetSpecies: targetSpecies.value,
        availability: availability.value,
        lang: lang.value,
      },
      updated_at: new Date().toISOString(),
    })
    syncing.value = false
  }

  let pushTimer: ReturnType<typeof setTimeout> | undefined
  watch([locations, targetSpecies, availability], () => {
    saveLocal()
    clearTimeout(pushTimer)
    pushTimer = setTimeout(pushRemote, 1500) // debounce remote sync
  }, { deep: true })

  const hasSetup = () => locations.value.length > 0 && availability.value.length > 0

  // Reset target species + time slots, keep locations
  function resetChoices() {
    targetSpecies.value = []
    availability.value = []
  }

  return {
    locations, targetSpecies, availability, syncing,
    loadLocal, pullRemote, pushRemote, hasSetup, resetChoices,
  }
})
