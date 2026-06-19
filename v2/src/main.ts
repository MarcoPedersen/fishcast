import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { supabase } from './lib/supabase'
import { useAuthStore } from './stores/auth'
import { useSetupStore } from './stores/setup'
import { useCatchStore } from './stores/catches'
import './style.css'

const app = createApp(App)
app.use(createPinia())

// Load local state BEFORE the router's initial navigation runs its guards
const setup = useSetupStore()
setup.loadLocal()
const catches = useCatchStore()
catches.loadLocal()
const auth = useAuthStore()

async function bootstrap() {
  // Handle a Supabase password-recovery token in the URL fragment BEFORE the
  // hash router initialises (otherwise the catch-all route clears it first).
  const h = window.location.hash
  if (supabase && h.includes('access_token') && h.includes('type=recovery')) {
    // Strip leading "#" and any "/" the hash router prepended, then parse params
    const p = new URLSearchParams(h.replace(/^#\/?/, ''))
    const access_token = p.get('access_token')
    const refresh_token = p.get('refresh_token') ?? ''
    if (access_token) {
      try { await supabase.auth.setSession({ access_token, refresh_token }) } catch { /* token invalid/expired */ }
      auth.recovering = true
      window.location.hash = '#/auth'
    }
  }

  app.use(router)
  app.mount('#app')

  await auth.init()
  if (!auth.recovering) {
    await setup.pullRemote()
    await catches.pullRemote()
  }
  setup.markReady() // from here on, local edits sync to Supabase
  catches.markReady()
}

bootstrap()
