<script setup lang="ts">
import { watch } from 'vue'
import { useRouter } from 'vue-router'
import { lang, setLang, t } from '@/lib/i18n'
import { useAuthStore } from '@/stores/auth'
import { useSetupStore } from '@/stores/setup'

const router = useRouter()
const auth = useAuthStore()
const setup = useSetupStore()

// When a reset-email link is opened, Supabase fires PASSWORD_RECOVERY (and clears
// the token from the URL) — send the user to the auth screen to set a new password.
watch(() => auth.recovering, (v) => { if (v) router.push({ name: 'auth' }) }, { immediate: true })

async function logout() {
  await auth.signOut()
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
      </nav>
      <div class="topbar-right">
        <button class="btn ghost sm" :class="{ active: lang === 'da' }" @click="setLang('da')">🇩🇰</button>
        <button class="btn ghost sm" :class="{ active: lang === 'en' }" @click="setLang('en')">🇬🇧</button>
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
</style>
