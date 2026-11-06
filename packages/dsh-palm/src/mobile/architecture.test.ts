/**
 * Architecture guardrails for the mobile client.
 *
 * These are the "safety net" gates from the refactor plan: they do not test
 * behaviour, they stop the two known debt patterns from growing while the view
 * layer is being split.
 *
 * - views must not import `App.tsx` beyond a shrinking whitelist (App is the
 *   router shell; importing it from a lazily-loaded view is the cycle that
 *   blocks the split);
 * - no new import cycles;
 * - file budgets (ChatView is split in S2–S6; the number only goes down);
 * - shared helpers have exactly one definition.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, '..', '..')
const REPO_ROOT = join(PACKAGE_ROOT, '..', '..')

/** Every production source file under src/mobile. */
function mobileSources(dir = HERE): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules') out.push(...mobileSources(full))
      continue
    }
    if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const SOURCES = mobileSources()

/** Relative POSIX path from src/mobile. */
const rel = (file: string): string => relative(HERE, file).replace(/\\/g, '/')

/**
 * Views allowed to import App.tsx right now (S1 baseline).
 * S5 emptied it: no view may import the router shell any more.
 */
const APP_IMPORTER_WHITELIST = new Set<string>([])

describe('architecture guardrails', () => {
  it('views do not add new App.tsx imports (whitelist may only shrink)', () => {
    const importers = new Set<string>()
    for (const file of SOURCES) {
      if (!file.includes(`${join('mobile', 'views')}`)) continue
      const text = readFileSync(file, 'utf8')
      if (/from\s+['"]\.\/App\.tsx['"]/.test(text)) importers.add(rel(file))
    }
    // Exact equality on purpose: adding a view requires an explicit whitelist
    // edit, and removing one requires deleting its line (visible progress).
    expect([...importers].sort()).toEqual([...APP_IMPORTER_WHITELIST].sort())
  })

  it('keeps the largest view files inside their budget', () => {
    const budgets: Record<string, number> = {
      'views/ChatView.tsx': 6_651,
      'views/SettingsView.tsx': 2_080,
      'views/SessionListView.tsx': 1_645,
      'views/App.tsx': 1_121,
      'views/WorkspaceView.tsx': 1_300,
    }
    for (const [file, budget] of Object.entries(budgets)) {
      const lines = readFileSync(join(HERE, file), 'utf8').split('\n').length
      expect(lines, `${file} grew past its budget (${lines} > ${budget})`).toBeLessThanOrEqual(budget)
    }
  })

  it('has exactly one definition of each shared helper', () => {
    const definitions: Record<string, RegExp> = {
      formatTime: /export function formatTime\(/,
      formatFullTime: /export function formatFullTime\(/,
      formatDuration: /export function formatDuration\(/,
      truncate: /export function truncate\(/,
      sanitizeFileName: /export function sanitizeFileName\(/,
      isRowRunning: /export function isRowRunning\(/,
      resolveSessionRunning: /export function resolveSessionRunning\(/,
    }
    for (const [name, pattern] of Object.entries(definitions)) {
      const hits = SOURCES.filter(file => pattern.test(readFileSync(file, 'utf8')))
      expect(hits.map(rel), `${name} must have exactly one definition`).toHaveLength(1)
    }
  })

  it('does not add new import cycles', () => {
    const script = join(REPO_ROOT, 'tools', 'dep-cycles.mjs')
    const output = execFileSync(process.execPath, [script, '--json'], { cwd: REPO_ROOT, encoding: 'utf8' })
    const cycles = (JSON.parse(output) as { cycles: string[][] }).cycles
    // Baseline (2026-11-06, S5 之后): 只剩一条与视图无关的已知环
    // （api-proxy-types ↔ shared/mux-frames）。App↔视图那条已在 S5 拆掉；
    // 再多一条就是新债，直接失败。
    expect(cycles.length, `unexpected cycles: ${JSON.stringify(cycles)}`).toBeLessThanOrEqual(1)
    const knownPair = ['api-proxy-types.ts', 'shared/mux-frames.ts']
    for (const cycle of cycles) {
      const isKnownPair = cycle.length === 2 && knownPair.every(name => cycle.includes(name))
      expect(isKnownPair, `new cycle: ${cycle.join(' -> ')}`).toBe(true)
    }
  })
})
