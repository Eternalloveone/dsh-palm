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

  it('keeps the largest view files inside their current budget (only goes down)', () => {
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

  /**
   * 目标线（2026-11-06 用户拍板改判据）。
   *
   * 原来是「ChatView ≤ 600、最大文件 ≤ 1200」。600 行是按"ChatView 只剩壳"反推的，
   * 而它里面还有约 4000 行是会话逻辑本体（SSE 折叠、缺口回填、轮次裁决、定位搜索、
   * 队列对账），不是拆组件能消掉的 —— 追 600 只会堆出巨型 deps 的 hook。改判：
   *
   * - `views/ChatView.tsx` ≤ 2500 行（壳 + 协调器）；
   * - 任何 `src/mobile` 下的生产文件 ≤ 1200 行（当前违规：ChatView / SettingsView /
   *   SessionListView，靠后续拆分区解决）；
   * - 单个 hook / 组件 ≤ 400 行。
   *
   * 用 `it.fails` 表达"目标尚未达成"：现在这条断言必然失败，所以它以"预期失败"计通过；
   * 一旦真的达标，它会变绿并让本用例失败 —— 那时把 `it.fails` 改成 `it` 并把这条注释
   * 删掉，就是把目标线升格成硬门禁的时刻。
   */
  it.fails('reaches the target budgets (see comment: flip to it() once green)', () => {
    const violations: string[] = []
    for (const file of SOURCES) {
      const relPath = rel(file)
      if (!/^(views|data|shared|chat)\//.test(relPath.replace(/^mobile\//, ''))) continue
      const lines = readFileSync(file, 'utf8').split('\n').length
      if (lines > 1_200) violations.push(`${relPath} = ${lines} > 1200`)
      if (relPath === 'views/ChatView.tsx' && lines > 2_500) violations.push(`ChatView = ${lines} > 2500`)
    }
    expect(violations).toEqual([])
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
