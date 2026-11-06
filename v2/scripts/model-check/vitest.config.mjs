// The model check (model-spec §11.2) runs under its own config, so it is not
// part of `npm test`: it scores ~50 000 windows against a recorded fixture and
// writes files. Run from v2/:
//   OUT=after npx vitest run --config scripts/model-check/vitest.config.mjs record
//   REPORT=<file> npx vitest run --config scripts/model-check/vitest.config.mjs compare
// (OUT=before re-records the baseline — only from the model at ed34b06;
// OUT=v3 the onshore-wind baseline — only from the model at 71d2038.)
//   REPORT=<file> npx vitest run --config scripts/model-check/vitest.config.mjs onshore
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
