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
