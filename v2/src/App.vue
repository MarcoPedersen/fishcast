<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { lang, setLang, t } from '@/lib/i18n'
import { useAuthStore } from '@/stores/auth'
import { useSetupStore } from '@/stores/setup'
import { useCatchStore } from '@/stores/catches'
import { useForecastStore } from '@/stores/forecast'
import { showToast } from '@/lib/toast'
import Toasts from '@/components/Toasts.vue'
import ConfirmDialog from '@/components/ConfirmDialog.vue'

const router = useRouter()
const auth = useAuthStore()
const setup = useSetupStore()
const catches = useCatchStore()
const fc = useForecastStore()

// Refresh forecasts that have gone stale (>3h) when the tab regains focus or
// the connection comes back — so a long-open app never shows yesterday's data.
const STALE_MS = 3 * 60 * 60 * 1000
function autoRefresh(reasonKey: string) {
  if (!setup.locations.length) return
  const now = Date.now()
  const stale = setup.locations.filter((l) => {
    const f = fc.forecasts[l.id]
    return f && now - f.fetched > STALE_MS
  })
  if (!stale.length) return
  showToast('⟳ ' + t(reasonKey), { type: 'info', ttl: 3000 })
  stale.forEach((l) => fc.fetchFor(l))
}
function onVisible() { if (!document.hidden) autoRefresh('toast_refreshing_stale') }
function onOnline() { autoRefresh('toast_back_online') }
onMounted(() => {
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', onOnline)
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisible)
  window.removeEventListener('online', onOnline)
})

// When a reset-email link is opened, Supabase fires PASSWORD_RECOVERY (and clears
// the token from the URL) — send the user to the auth screen to set a new password.
watch(() => auth.recovering, (v) => { if (v) router.push({ name: 'auth' }) }, { immediate: true })

async function logout() {
  await auth.signOut()
  // Wipe this account's data locally so the next user on this device doesn't
  // inherit it (and can't accidentally push it into their own account).
  setup.clear()
  catches.clear()
  router.push({ name: 'welcome' })
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="logo" @click="router.push({ name: 'welcome' })">🎣 <span>FishCast</span></div>
      <nav class="actions">
        <template v-if="setup.hasSetup()">
          <button class="btn ghost sm" @click="router.push({ name: 'dashboard' })">📊 Dashboard</button>
          <button class="btn ghost sm badged" @click="router.push({ name: 'species' })">
            {{ t('topbar_species') }}
            <span v-if="setup.targetSpecies.length" class="count">{{ setup.targetSpecies.length }}</span>
          </button>
          <button class="btn ghost sm" @click="router.push({ name: 'locations' })">{{ t('topbar_locations') }}</button>
          <button class="btn ghost sm badged" @click="router.push({ name: 'availability' })">
            {{ t('topbar_times') }}
            <span v-if="setup.availability.length" class="count">{{ setup.availability.length }}</span>
          </button>
        </template>
        <button class="btn ghost sm" @click="router.push({ name: 'finder' })">{{ t('topbar_finder') }}</button>
        <button class="btn ghost sm" @click="router.push({ name: 'catchlog' })">{{ t('topbar_log') }}</button>
      </nav>
      <div class="topbar-right">
        <button class="btn ghost sm" :class="{ active: lang === 'da' }" aria-label="Dansk" @click="setLang('da')">🇩🇰</button>
        <button class="btn ghost sm" :class="{ active: lang === 'en' }" aria-label="English" @click="setLang('en')">🇬🇧</button>
        <template v-if="auth.supabaseConfigured">
          <button v-if="!auth.isLoggedIn" class="btn primary sm" @click="router.push({ name: 'auth' })">
            {{ t('auth_login') }}
          </button>
          <button v-else class="btn ghost sm" :title="auth.user?.email" @click="logout">
            {{ t('auth_logout') }}
          </button>
        </template>
      </div>
    </header>
    <main class="main">
      <RouterView />
    </main>
    <Toasts />
    <ConfirmDialog />
  </div>
</template>

<style scoped>
.topbar { align-items: center; gap: 10px; }
.logo { display: inline-flex; align-items: center; gap: 6px; line-height: 1; flex-shrink: 0; }
.actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; flex: 1 1 auto; }
.topbar-right { display: flex; align-items: center; gap: 6px; margin-left: auto; flex-shrink: 0; }
.actions .btn, .topbar-right .btn { white-space: nowrap; line-height: 1.1; }
.badged { position: relative; }
.count {
  position: absolute; top: -6px; right: -6px;
  min-width: 17px; height: 17px; padding: 0 4px;
  display: inline-flex; align-items: center; justify-content: center;
  background: var(--red); color: #fff; font-size: 0.66rem; font-weight: 700;
  border-radius: 9px; border: 1.5px solid var(--bg);
}

/* Mobile: logo + language/login on the top row, nav tabs as a single
   horizontally-scrollable strip — keeps the header short instead of a
   9-button stack. */
@media (max-width: 640px) {
  .topbar { flex-wrap: wrap; row-gap: 8px; }
  .logo { order: 1; }
  .topbar-right { order: 2; margin-left: auto; }
  .actions {
    order: 3; flex-basis: 100%; flex-wrap: nowrap; overflow-x: auto;
    -webkit-overflow-scrolling: touch; scrollbar-width: none; padding-bottom: 2px;
  }
  .actions::-webkit-scrollbar { display: none; }
  .actions .btn { flex: 0 0 auto; }
  .count { top: -4px; }
}
</style>
