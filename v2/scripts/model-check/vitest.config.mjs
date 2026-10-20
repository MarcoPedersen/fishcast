// The model check (model-spec §11.2) runs under its own config, so it is not
// part of `npm test`: it scores ~50 000 windows against a recorded fixture and
// writes files. Run from v2/:
//   npx vitest run --config scripts/model-check/vitest.config.mjs record   (OUT=before|after)
//   npx vitest run --config scripts/model-check/vitest.config.mjs compare
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['*.check.ts'],
    environment: 'node',
    // The app's own setup: Europe/Copenhagen (window hours are local) and the
    // in-memory Supabase stub, so nothing here can reach the real project.
    setupFiles: [fileURLToPath(new URL('../../src/test-setup.ts', import.meta.url))],
    testTimeout: 600_000,
  },
})
