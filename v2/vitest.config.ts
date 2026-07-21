import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

// Standalone unit-test config — no Vue/PWA plugins needed for the pure-logic
// modules (scoring, sync). Keeps the run fast and side-effect free.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['src/test-setup.ts'],
  },
})
