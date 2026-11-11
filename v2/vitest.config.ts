import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// Standalone unit-test config — no PWA plugin; the pure-logic modules
// (scoring, sync) run as plain node. The Vue plugin only compiles the .vue
// files a component test mounts (src/test/fakeDom.ts): such a file asks for
// the vue-dom environment, which the alias below names (src/test/vueDomEnv.ts).
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'vitest-environment-vue-dom': fileURLToPath(new URL('./src/test/vueDomEnv.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['src/test-setup.ts'],
  },
})
