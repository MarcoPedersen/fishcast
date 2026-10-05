import { createApp, watch } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { supabase } from './lib/supabase'
import { useAuthStore } from './stores/auth'
import { useSetupStore } from './stores/setup'
import { useCatchStore } from './stores/catches'
import { session } from './stores/session'
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

  // A resumed tab or PWA and a returning connection re-pull; another tab's save
  // is reloaded — instead of a stale in-memory copy overwriting newer data.
  session.listen(window, document)

  // Signing in mid-session is NOT a page load, and this used to be the only
  // place that pulled — so after logging in you saw an empty profile with sync
  // already armed, and the next edit pushed that blank over your real rows.
  // Re-hydrate whenever the signed-in identity changes. Registered before
  // auth.init(): when the boot hydration threw, it was never registered at all.
  watch(() => auth.user?.id ?? null, (id) => { session.hydrateFor(id) })

  await auth.init()
  await session.hydrateFor(auth.user?.id ?? null)
}

bootstrap()
