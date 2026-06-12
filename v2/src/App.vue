<script setup lang="ts">
import { useRouter } from 'vue-router'
import { lang, setLang, t } from '@/lib/i18n'
import { useAuthStore } from '@/stores/auth'
import { useSetupStore } from '@/stores/setup'

const router = useRouter()
const auth = useAuthStore()
const setup = useSetupStore()

async function logout() {
  await auth.signOut()
  router.push({ name: 'welcome' })
}
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="logo" @click="router.push({ name: 'welcome' })">🎣 <span>FishCast</span> <small>v2</small></div>
      <nav class="actions">
        <template v-if="setup.hasSetup()">
          <button class="btn ghost sm" @click="router.push({ name: 'dashboard' })">📊 Dashboard</button>
          <button class="btn ghost sm" @click="router.push({ name: 'species' })">
            {{ t('topbar_species') }}<template v-if="setup.targetSpecies.length"> ({{ setup.targetSpecies.length }})</template>
          </button>
          <button class="btn ghost sm" @click="router.push({ name: 'locations' })">{{ t('topbar_locations') }}</button>
          <button class="btn ghost sm" @click="router.push({ name: 'availability' })">
            {{ t('topbar_times') }}<template v-if="setup.availability.length"> ({{ setup.availability.length }})</template>
          </button>
        </template>
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
      </nav>
    </header>
    <main class="main">
      <RouterView />
    </main>
  </div>
</template>
