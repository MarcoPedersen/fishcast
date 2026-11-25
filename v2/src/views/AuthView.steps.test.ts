// @vitest-environment vue-dom
/**
 * Where signing in leads, and a new password saved, as mounted on the app's
 * own router (its routes and the dashboard's guard: no setup, back to the
 * welcome page), over a memory history, with the in-memory Supabase fake.
 * Both went to Tidsvinduer (step 1) whenever the setup was not whole: a
 * setup with time windows and no spot yet went back to step 1, where Find
 * pladser's and Målarter's way on leads to the first step missing
 * (lib/setupStep).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('vue-router', async (orig) => {
  const real = await orig<typeof import('vue-router')>()
  return { ...real, createWebHashHistory: () => real.createMemoryHistory() }
})

import router from '@/router'
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'
import { fakeDb } from '@/test/fakeSupabase'
import { DK_SPOTS, locationFromSpot } from '@/lib/spots'
import type { Availability, Location } from '@/lib/types'
import { useAuthStore } from '@/stores/auth'
import { useSetupStore } from '@/stores/setup'
import AuthView from './AuthView.vue'
// The pages it leads to, loaded up front: the router loads a page before it
// goes there, and the first load of one is slow.
import './AvailabilityView.vue'
import './LocationsView.vue'
import './DashboardView.vue'

const SPOT: Location = { id: 'l1', ...locationFromSpot(DK_SPOTS[0]) }
const WINDOW: Availability = { id: 'a1', days: [6], from: '06:00', to: '10:00', methods: ['shore'] }

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined

beforeEach(() => { restoreDocument = installDocument() })
afterEach(() => {
  view?.unmount()
  view = undefined
  fakeDb.session = null
  vi.useRealTimers()
  restoreDocument()
})

/** The sign-in form (or, `recovering`, the new-password one) over this setup. */
async function openAuth(own: { locations?: Location[]; availability?: Availability[] }, recovering = false) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const setup = useSetupStore()
  setup.locations = (own.locations ?? []).map((l) => ({ ...l }))
  setup.availability = (own.availability ?? []).map((a) => ({ ...a }))
  if (recovering) useAuthStore().recovering = true
  await router.push({ name: 'auth' })
  view = mount(AuthView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
  await nextTick()
  return view.root
}
/** The next navigation, ended: the page loaded, the dashboard's guard run. */
const navigated = () => new Promise<void>((resolve) => { const off = router.afterEach(() => { off(); resolve() }) })
const routeName = () => router.currentRoute.value.name

/** Signs in on the form, and waits for the page it goes on to. */
async function signIn(root: FakeNode) {
  const [email, password] = root.byTag('input')
  email.input('a@b.dk')
  password.input('secret1')
  const done = navigated()
  root.byTag('form')[0].dispatch('submit')
  await done
}

describe('signing in goes to the first step the setup lacks', () => {
  it('with time windows but no spot yet: Lokationer', async () => {
    await signIn(await openAuth({ availability: [WINDOW] }))
    expect(routeName()).toBe('locations')
  })

  it('with nothing set up: Tidsvinduer, step 1', async () => {
    await signIn(await openAuth({}))
    expect(routeName()).toBe('availability')
  })

  it('with a spot but no time windows: Tidsvinduer', async () => {
    await signIn(await openAuth({ locations: [SPOT] }))
    expect(routeName()).toBe('availability')
  })

  it('with a whole setup: the dashboard', async () => {
    await signIn(await openAuth({ locations: [SPOT], availability: [WINDOW] }))
    expect(routeName()).toBe('dashboard')
  })
})

/** A new password saved, from a reset link: the page goes on 1.2 s later. */
describe('a new password saved goes to the first step the setup lacks', () => {
  async function saveNewPassword(own: { locations?: Location[]; availability?: Availability[] }) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const root = await openAuth(own, true)
    root.byTag('input')[0].input('secret1')
    const done = navigated()
    root.byTag('form')[0].dispatch('submit')
    await vi.advanceTimersByTimeAsync(1200)
    await done
  }

  it('with time windows but no spot yet: Lokationer', async () => {
    await saveNewPassword({ availability: [WINDOW] })
    expect(routeName()).toBe('locations')
  })

  it('with nothing set up: Tidsvinduer', async () => {
    await saveNewPassword({})
    expect(routeName()).toBe('availability')
  })

  it('with a whole setup: the dashboard', async () => {
    await saveNewPassword({ locations: [SPOT], availability: [WINDOW] })
    expect(routeName()).toBe('dashboard')
  })
})
