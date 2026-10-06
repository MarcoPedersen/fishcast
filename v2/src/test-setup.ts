// Pin the zone the app is used in. The deploy gate runs on a UTC runner, where
// local time equals UTC, so a regression to Date.UTC hour anchoring (which once
// shifted every Danish window by 1–2 h) would pass there unnoticed.
// @ts-ignore — no @types/node in this project; Node's process exists under vitest
process.env.TZ = 'Europe/Copenhagen'

// Minimal localStorage for the node test env — i18n.ts reads it at import time.
const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k)! : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: (k) => { store.delete(k) },
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size },
} as Storage

// Every test gets the in-memory Supabase fake instead of a real client. Vitest
// loads v2/.env, so locally the real module built a live client for the
// production project — any store test that signed a user in would have hit it
// (and in CI, with no .env, the same test silently took the null-client path).
import { vi } from 'vitest'
vi.mock('@/lib/supabase', async () => {
  const { fakeSupabase } = await import('./test/fakeSupabase')
  return { supabase: fakeSupabase, supabaseConfigured: true }
})
