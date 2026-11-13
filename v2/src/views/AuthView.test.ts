// @vitest-environment vue-dom
/**
 * The sign-in form, as mounted: the real view, auth store and router on the
 * in-memory DOM, with the in-memory Supabase fake. auth-js returns auth
 * errors but rethrows the rest, as a full device's storage did before
 * lib/authStorage. The form awaited the call with no catch: its button stayed
 * on "…" for good and nothing was said.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { installDocument, mount } from '@/test/fakeDom'
import { fakeSupabase } from '@/test/fakeSupabase'
import { STRINGS } from '@/test/strings'
import { langReady, setLang, t } from '@/lib/i18n'
import AuthView from './AuthView.vue'

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined

beforeEach(() => { restoreDocument = installDocument() })
afterEach(() => {
  view?.unmount()
  view = undefined
  vi.restoreAllMocks()
  setLang('da')
  restoreDocument()
})

/** Lets the form's submit run to its end: the call's answer, then the render. */
async function settle() {
  await new Promise((r) => setTimeout(r, 0))
  await nextTick()
}

describe('AuthView: a sign-in call that throws', () => {
  it('gives the button back and says something went wrong, in both languages', async () => {
    let fail!: (e: unknown) => void
    vi.spyOn(fakeSupabase.auth, 'signInWithPassword').mockImplementation(() => new Promise((_, reject) => { fail = reject }))
    const pinia = createPinia()
    setActivePinia(pinia)
    const page = { render: () => null }
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/auth', name: 'auth', component: page },
      { path: '/dashboard', name: 'dashboard', component: page },
      { path: '/availability', name: 'availability', component: page },
    ] })
    await router.push('/auth')
    view = mount(AuthView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
    await nextTick()
    const root = view.root
    const [email, password] = root.byTag('input')
    email.input('a@b.dk')
    password.input('secret1')
    const button = () => root.byTag('button').find((b) => b.attrs.type === 'submit')!
    root.byTag('form')[0].dispatch('submit')
    await nextTick()
    expect(button().textContent).toBe('…')

    fail(new DOMException('The quota has been exceeded.', 'QuotaExceededError'))
    await settle()
    expect(button().textContent).toBe(t('auth_login'))
    expect(button().attrs.disabled).toBe(false)
    expect(root.byClass('notice err').map((n) => n.textContent)).toEqual([STRINGS.da.auth_err_generic])
    expect(router.currentRoute.value.name).toBe('auth')

    setLang('en')
    await langReady() // the English table is a chunk of its own
    await nextTick()
    expect(root.byClass('notice err').map((n) => n.textContent)).toEqual([STRINGS.en.auth_err_generic])
  })
})
