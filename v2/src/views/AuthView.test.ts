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
import { installDocument, mount, type FakeNode } from '@/test/fakeDom'
import { fakeSupabase } from '@/test/fakeSupabase'
import { STRINGS } from '@/test/strings'
import { langReady, setLang, t } from '@/lib/i18n'
import { useAuthStore } from '@/stores/auth'
import AuthView from './AuthView.vue'

let restoreDocument: () => void
let view: ReturnType<typeof mount> | undefined

beforeEach(() => { restoreDocument = installDocument() })
afterEach(() => {
  view?.unmount()
  view = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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

/**
 * The labels sat above the fields, tied to neither: a screen reader named
 * them "edit text" and "secure edit text", and which one took the e-mail was
 * left to guess. A refused sign-in's error, and the "check your e-mail" that
 * takes the form's place, appeared without a word to it either.
 */
describe('AuthView to a screen reader', () => {
  async function open(recovering = false) {
    const pinia = createPinia()
    setActivePinia(pinia)
    if (recovering) useAuthStore().recovering = true
    const page = { render: () => null }
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/auth', name: 'auth', component: page },
      { path: '/dashboard', name: 'dashboard', component: page },
      { path: '/availability', name: 'availability', component: page },
    ] })
    await router.push('/auth')
    view = mount(AuthView, (app) => { app.use(pinia); app.use(router); app.config.warnHandler = () => {} })
    await nextTick()
    return view.root
  }
  /** Each field's name: the text of the label whose `for` is its id. */
  const names = (root: FakeNode) => root.byTag('input').map((i) =>
    (i.attrs.id ? root.byTag('label').find((l) => l.attrs.for === i.attrs.id)?.textContent : undefined) ?? null)
  const link = (root: FakeNode, key: string) => root.byClass('linkbtn').find((b) => b.textContent.includes(STRINGS.da[key]))!

  it('names each field by its label: signing in, signing up and asking for a reset link', async () => {
    const root = await open()
    expect(names(root)).toEqual([STRINGS.da.auth_email, STRINGS.da.auth_password])
    link(root, 'auth_signup').click()
    await nextTick()
    expect(names(root)).toEqual([STRINGS.da.auth_email, STRINGS.da.auth_password])
    link(root, 'auth_login').click()
    await nextTick()
    link(root, 'auth_forgot').click()
    await nextTick()
    expect(names(root)).toEqual([STRINGS.da.auth_email])
  })

  it('names the new password field, arriving from a reset link', async () => {
    expect(names(await open(true))).toEqual([STRINGS.da.auth_new_password])
  })

  it('says a refused sign-in as it appears', async () => {
    vi.spyOn(fakeSupabase.auth, 'signInWithPassword').mockResolvedValue(
      { data: { user: null, session: null }, error: { message: 'Invalid login credentials', status: 400 } } as never)
    const root = await open()
    const [email, password] = root.byTag('input')
    email.input('a@b.dk')
    password.input('secret1')
    root.byTag('form')[0].dispatch('submit')
    await settle()
    const err = root.byClass('notice err')
    expect(err).toHaveLength(1)
    expect(err[0].attrs.role).toBe('alert')
  })

  it('says the reset link was sent, where the form was', async () => {
    vi.stubGlobal('location', { origin: 'https://example.test', pathname: '/fishcast/v2/' }) // the link's way back
    const root = await open()
    link(root, 'auth_forgot').click()
    await nextTick()
    root.byTag('input')[0].input('a@b.dk')
    root.byTag('form')[0].dispatch('submit')
    await settle()
    const ok = root.byClass('notice ok')
    expect(ok.map((n) => n.textContent)).toEqual([STRINGS.da.auth_reset_sent])
    expect(ok[0].attrs.role).toBe('status')
  })

  it('says the sign-up went through, where the form was', async () => {
    const root = await open()
    link(root, 'auth_signup').click()
    await nextTick()
    const [email, password] = root.byTag('input')
    email.input('a@b.dk')
    password.input('secret1')
    root.byTag('form')[0].dispatch('submit')
    await settle()
    const ok = root.byClass('notice ok')
    expect(ok.map((n) => n.textContent)).toEqual([STRINGS.da.auth_check_email])
    expect(ok[0].attrs.role).toBe('status')
  })

  it('says a refused new password as it appears', async () => {
    vi.spyOn(fakeSupabase.auth, 'updateUser').mockResolvedValue(
      { data: { user: null }, error: { message: 'Password should be at least 6 characters.', status: 422 } } as never)
    const root = await open(true)
    root.byTag('input')[0].input('secret1')
    root.byTag('form')[0].dispatch('submit')
    await settle()
    const err = root.byClass('notice err')
    expect(err).toHaveLength(1)
    expect(err[0].attrs.role).toBe('alert')
  })

  // A saved password ends the recovery (auth.recovering false) before the
  // form hears of it, and the card that holds "Adgangskode opdateret" went
  // with it: the sign-in form took its place, the new password in its
  // field, until the page moved on 1.2 s later.
  it('says the new password is saved, where its form was', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const root = await open(true)
      root.byTag('input')[0].input('secret1')
      root.byTag('form')[0].dispatch('submit')
      await vi.advanceTimersByTimeAsync(0)
      await nextTick()
      const ok = root.byClass('notice ok')
      expect(ok.map((n) => n.textContent)).toEqual([STRINGS.da.auth_password_updated])
      expect(ok[0].attrs.role).toBe('status')
      expect(root.byTag('h2').map((h) => h.textContent)).toEqual([STRINGS.da.auth_new_password_title])
      expect(root.byTag('input')).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})
