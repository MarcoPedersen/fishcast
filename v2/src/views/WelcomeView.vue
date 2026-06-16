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

    <div class="or">{{ t('or') }} · {{ t('welcome_no_setup') }}</div>
    <div class="options">
      <button class="option" @click="router.push({ name: 'finder', query: { mode: 'lucky' } })">
        <span class="option-title">{{ t('sf_lucky_badge') }}</span>
        <span class="option-sub">{{ t('sf_lucky_sub') }}</span>
      </button>
      <button class="option" @click="router.push({ name: 'finder', query: { mode: 'nearby' } })">
        <span class="option-title">{{ t('sf_nearby_badge') }}</span>
        <span class="option-sub">{{ t('sf_nearby_sub') }}</span>
      </button>
    </div>

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
.or { color: var(--muted); font-size: 0.8rem; margin: 20px 0 12px; }
.options { display: flex; gap: 10px; max-width: 520px; margin: 0 auto; }
.option {
  flex: 1; display: flex; flex-direction: column; gap: 3px; padding: 16px 14px;
  border-radius: 12px; cursor: pointer; text-align: left; color: var(--text);
  background: var(--bg-card); border: 1px solid var(--border);
}
.option:hover { border-color: var(--primary); background: rgba(56,189,248,.08); }
.option-title { font-weight: 700; font-size: 0.95rem; }
.option-sub { font-size: 0.76rem; color: var(--muted); }
@media (max-width: 480px) { .options { flex-direction: column; } }
</style>
