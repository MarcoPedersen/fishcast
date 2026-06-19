import { createRouter, createWebHashHistory } from 'vue-router'
import { useSetupStore } from '@/stores/setup'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'welcome', component: () => import('@/views/WelcomeView.vue') },
    { path: '/auth', name: 'auth', component: () => import('@/views/AuthView.vue') },
    { path: '/setup/availability', name: 'availability', component: () => import('@/views/AvailabilityView.vue') },
    { path: '/setup/locations', name: 'locations', component: () => import('@/views/LocationsView.vue') },
    { path: '/setup/map', name: 'map', component: () => import('@/views/MapView.vue') },
    { path: '/finder', name: 'finder', component: () => import('@/views/SpotFinderView.vue') },
    { path: '/log', name: 'catchlog', component: () => import('@/views/CatchLogView.vue') },
    { path: '/setup/species', name: 'species', component: () => import('@/views/SpeciesView.vue') },
    {
      path: '/dashboard', name: 'dashboard',
      component: () => import('@/views/DashboardView.vue'),
      beforeEnter: () => {
        const setup = useSetupStore()
        return setup.hasSetup() ? true : { name: 'welcome' }
      },
    },
    // Catch-all (e.g. a transient Supabase token fragment) → welcome
    { path: '/:pathMatch(.*)*', redirect: { name: 'welcome' } },
  ],
})

export default router
