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
