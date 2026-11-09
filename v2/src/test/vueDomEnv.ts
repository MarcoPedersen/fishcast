import type { Environment } from 'vitest/environments'

/**
 * Node, with the test's modules through Vite's client transform. The default
 * node environment compiles a .vue file for server rendering, which leaves
 * nothing to mount; here it gets its render function, for the in-memory DOM
 * in fakeDom.ts. A test file asks for it with `// @vitest-environment vue-dom`
 * (vitest.config.ts maps that name to this file).
 */
export default <Environment>{
  name: 'vue-dom',
  viteEnvironment: 'client',
  setup: () => ({ teardown() {} }),
}
