import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Keep Vite's transform cache outside node_modules. Some Windows setups
  // mark the pnpm store/link tree read-only, which makes Vitest fail before
  // it can collect any tests.
  cacheDir: '.vitest-cache',
  plugins: [tsconfigPaths({
    projects: [
      './tsconfig.vitest.json',
    ],
  })],
  // npm SDK packages reference sourcemaps that are not published (files
  // exclude *.map); do not attempt to load them during transform.
  server: {
    sourcemapIgnoreList: () => true,
  },
  test: {
    include: [
      'tests/**/*.spec.ts', 'tests/**/*.spec.tsx',
      'src/**/*.spec.ts', 'src/**/*.spec.tsx',
      'src/**/*.test.ts', 'src/**/*.test.tsx',
    ],
    pool: 'forks',
    setupFiles: ['./vitest.setup.ts'],
    // @deepseek-ai SDK packages ship browser bundles (CSS imports included);
    // keep them vite-transformed instead of node-externalized.
    server: {
      deps: {
        inline: [/@deepseek-ai\//],
      },
    },
    coverage: {
      provider: 'v8',
      // Thresholds sit ~3 points under the measured baseline (2026-08-31:
      // stmts 70.7 / branch 65.4 / funcs 66.5 / lines 73.8) so the gate
      // catches regressions without blocking normal progress.
      thresholds: {
        statements: 68,
        branches: 62,
        functions: 63,
        lines: 70,
      },
      include: ['src/**/*.{ts,tsx}'],
    },
  },
})
