<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { t } from '@/lib/i18n'
import { useAuthStore } from '@/stores/auth'
import { useSetupStore } from '@/stores/setup'

const router = useRouter()
const auth = useAuthStore()
const setup = useSetupStore()

const mode = ref<'login' | 'signup'>('login')
const email = ref('')
const password = ref('')
const busy = ref(false)
const signupDone = ref(false)

async function submit() {
  busy.value = true
  if (mode.value === 'signup') {
    const ok = await auth.signUp(email.value, password.value)
    if (ok) signupDone.value = true
  } else {
    const ok = await auth.signIn(email.value, password.value)
    if (ok) {
      await setup.pullRemote()
      router.push({ name: setup.hasSetup() ? 'dashboard' : 'availability' })
    }
  }
  busy.value = false
}
</script>

<template>
  <div class="auth card">
    <h2>{{ mode === 'login' ? t('auth_login') : t('auth_signup') }}</h2>
    <p class="why">{{ t('auth_why') }}</p>

    <div v-if="signupDone" class="notice ok">{{ t('auth_check_email') }}</div>

    <form v-else @submit.prevent="submit">
      <label>{{ t('auth_email') }}</label>
      <input v-model="email" type="email" required autocomplete="email" />
      <label>{{ t('auth_password') }}</label>
      <input v-model="password" type="password" required minlength="6"
        :autocomplete="mode === 'signup' ? 'new-password' : 'current-password'" />
      <div v-if="auth.error" class="notice err">{{ auth.error }}</div>
      <button class="btn primary" type="submit" :disabled="busy">
        {{ busy ? '…' : mode === 'login' ? t('auth_login') : t('auth_signup') }}
      </button>
    </form>

    <p class="switch">
      {{ mode === 'login' ? t('auth_no_account') : t('auth_have_account') }}
      <a @click="mode = mode === 'login' ? 'signup' : 'login'; signupDone = false">
        {{ mode === 'login' ? t('auth_signup') : t('auth_login') }}
      </a>
    </p>
  </div>
</template>

<style scoped>
.auth { max-width: 380px; margin: 40px auto; }
.why { font-size: 0.8rem; color: var(--muted); margin-bottom: 16px; }
form { display: flex; flex-direction: column; gap: 8px; }
label { font-size: 0.78rem; color: var(--muted); }
.switch { margin-top: 16px; font-size: 0.82rem; color: var(--muted); }
.switch a { color: var(--primary); cursor: pointer; margin-left: 6px; }
.notice.ok  { color: var(--green); font-size: 0.85rem; margin: 10px 0; }
.notice.err { color: var(--red);   font-size: 0.8rem; }
</style>
