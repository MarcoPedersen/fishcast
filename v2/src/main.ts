import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { useAuthStore } from './stores/auth'
import { useSetupStore } from './stores/setup'
import './style.css'

const app = createApp(App)
app.use(createPinia())

// Load local state BEFORE the router's initial navigation runs its guards
const setup = useSetupStore()
setup.loadLocal()

app.use(router)

const auth = useAuthStore()
auth.init().then(() => setup.pullRemote())

app.mount('#app')
