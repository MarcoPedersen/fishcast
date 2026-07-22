<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { t } from '@/lib/i18n'
import { useAuthStore } from '@/stores/auth'
import { useSetupStore } from '@/stores/setup'
import { useCatchStore } from '@/stores/catches'

const router = useRouter()
const auth = useAuthStore()
const setup = useSetupStore()
const catches = useCatchStore()

const mode = ref<'login' | 'signup' | 'reset'>('login')
const email = ref('')
const password = ref('')
const busy = ref(false)
const signupDone = ref(false)
const resetSent = ref(false)
const updated = ref(false)

async function submit() {
  busy.value = true
  if (auth.recovering) {
    if (await auth.updatePassword(password.value)) {
      updated.value = true
      setTimeout(() => router.push({ name: setup.hasSetup() ? 'dashboard' : 'availability' }), 1200)
    }
  } else if (mode.value === 'reset') {
    if (await auth.resetPassword(email.value)) resetSent.value = true
  } else if (mode.value === 'signup') {
    if (await auth.signUp(email.value, password.value)) signupDone.value = true
  } else {
    if (await auth.signIn(email.value, password.value)) {
      // Hydrate BOTH stores from the account before any local edit can push —
      // otherwise the stale local state overwrites the remote rows.
      await Promise.all([setup.pullRemote(), catches.pullRemote()])
      router.push({ name: setup.hasSetup() ? 'dashboard' : 'availability' })
    }
  }
  busy.value = false
}

function switchMode(m: 'login' | 'signup' | 'reset') {
  mode.value = m
  signupDone.value = false
  resetSent.value = false
  auth.error = null
}
</script>

<template>
  <!-- Password recovery: user arrived from the reset email link -->
  <div v-if="auth.recovering" class="auth card">
    <h2>{{ t('auth_new_password_title') }}</h2>
    <div v-if="updated" class="notice ok">{{ t('auth_password_updated') }}</div>
    <form v-else @submit.prevent="submit">
      <label>{{ t('auth_new_password') }}</label>
      <input v-model="password" type="password" required minlength="6" autocomplete="new-password" />
      <div v-if="auth.error" class="notice err">{{ auth.error }}</div>
      <button class="btn primary" type="submit" :disabled="busy">{{ busy ? '…' : t('auth_update_password') }}</button>
    </form>
  </div>

  <div v-else class="auth card">
    <h2>{{ mode === 'signup' ? t('auth_signup') : mode === 'reset' ? t('auth_reset_title') : t('auth_login') }}</h2>
    <p class="why">{{ mode === 'reset' ? t('auth_reset_intro') : t('auth_why') }}</p>

    <div v-if="signupDone" class="notice ok">{{ t('auth_check_email') }}</div>
    <div v-else-if="resetSent" class="notice ok">{{ t('auth_reset_sent') }}</div>

    <form v-else @submit.prevent="submit">
      <label>{{ t('auth_email') }}</label>
      <input v-model="email" type="email" required autocomplete="email" />
      <template v-if="mode !== 'reset'">
        <label>{{ t('auth_password') }}</label>
        <input v-model="password" type="password" required minlength="6"
          :autocomplete="mode === 'signup' ? 'new-password' : 'current-password'" />
      </template>
      <div v-if="auth.error" class="notice err">{{ auth.error }}</div>
      <button class="btn primary" type="submit" :disabled="busy">
        {{ busy ? '…' : mode === 'signup' ? t('auth_signup') : mode === 'reset' ? t('auth_reset_send') : t('auth_login') }}
      </button>
    </form>

    <p v-if="mode === 'login'" class="forgot">
      <button type="button" class="linkbtn" @click="switchMode('reset')">{{ t('auth_forgot') }}</button>
    </p>

    <p class="switch">
      <template v-if="mode === 'reset'">
        <button type="button" class="linkbtn" @click="switchMode('login')">← {{ t('auth_back_login') }}</button>
      </template>
      <template v-else>
        {{ mode === 'login' ? t('auth_no_account') : t('auth_have_account') }}
        <button type="button" class="linkbtn" @click="switchMode(mode === 'login' ? 'signup' : 'login')">
          {{ mode === 'login' ? t('auth_signup') : t('auth_login') }}
        </button>
      </template>
    </p>
  </div>
</template>

<style scoped>
.auth { max-width: 380px; margin: 40px auto; }
.why { font-size: 0.8rem; color: var(--muted); margin-bottom: 16px; }
form { display: flex; flex-direction: column; gap: 8px; }
label { font-size: 0.78rem; color: var(--muted); }
.forgot { margin-top: 12px; font-size: 0.82rem; }
.switch { margin-top: 10px; font-size: 0.82rem; color: var(--muted); }
.linkbtn { background: none; border: none; padding: 0; font: inherit; color: var(--primary); cursor: pointer; }
.switch .linkbtn { margin-left: 6px; }
.linkbtn:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; border-radius: 3px; }
.notice.ok  { color: var(--green); font-size: 0.85rem; margin: 10px 0; }
.notice.err { color: var(--red);   font-size: 0.8rem; }
</style>
