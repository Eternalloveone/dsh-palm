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
      // 阈值按 2026-11-16 实测收紧（stmts 79.09 / branch 72.63 / funcs 76.47 /
      // lines 82.27），统一留 2 点余量：正常改动掉不了 2 点，掉了就是真退步。
      // 上一版是 68/62/63/70 —— 那是 2026-08-31 基线（70.7/65.4/66.5/73.8）−3 点，
      // 之后覆盖率涨了近 9 点而阈值没跟，等于掉 10 点都不会红。
      thresholds: {
        statements: 77,
        branches: 70,
        functions: 74,
        lines: 80,
      },
      include: ['src/**/*.{ts,tsx}'],
    },
  },
})
