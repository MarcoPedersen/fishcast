<script setup lang="ts">
import { useRouter } from 'vue-router'
import { t } from '@/lib/i18n'
import { useSetupStore } from '@/stores/setup'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const setup = useSetupStore()
const auth = useAuthStore()
</script>

<template>
  <div class="welcome">
    <div class="hero-emoji">🎣</div>
    <h1>FishCast</h1>
    <p class="sub">{{ t('welcome_v2_sub') }}</p>

    <button class="btn primary lg" @click="router.push({ name: setup.hasSetup() ? 'dashboard' : 'availability' })">
      {{ setup.hasSetup() ? t('goto_dash') : t('setup_start') }}
    </button>

    <p v-if="auth.supabaseConfigured && !auth.isLoggedIn" class="auth-hint">
      {{ t('auth_why') }}
      <a @click="router.push({ name: 'auth' })">{{ t('auth_login') }} / {{ t('auth_signup') }}</a>
    </p>
    <p v-else-if="!auth.supabaseConfigured" class="auth-hint muted">{{ t('auth_local_note') }}</p>
  </div>
</template>

<style scoped>
.welcome { text-align: center; padding: 60px 20px; }
.hero-emoji { font-size: 3rem; }
h1 { color: var(--primary); margin: 10px 0 6px; }
.sub { color: var(--muted); margin-bottom: 28px; }
.auth-hint { margin-top: 24px; font-size: 0.82rem; color: var(--muted); max-width: 420px; margin-inline: auto; }
.auth-hint a { color: var(--primary); cursor: pointer; margin-left: 6px; }
</style>
