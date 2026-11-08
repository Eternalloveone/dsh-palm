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

  it('ChatView 的 useState 数量只减不增（比行数更能反映结构）', () => {
    // 行数预算可以被 useMemo / 内联函数骗过去，useState 骗不了：每一个都代表一处
    // 散落在组件里的界面状态。S1 把它从 30 收到 0；之后只许更少。
    // 想加回去？先想清楚它能不能进 chat-machine 的某个切片。
    const text = readFileSync(join(PACKAGE_ROOT, 'src', 'mobile', 'views', 'ChatView.tsx'), 'utf8')
    const count = (text.match(/useState\(/g) ?? []).length
    expect(count, `ChatView 里又出现了 ${count} 个 useState（预算 0）`).toBeLessThanOrEqual(0)
  })

  it('views/chat 必须分区（顶层不许再放文件）', () => {
    // 62 个模块平铺过一次，代价是「找东西要翻 62 个文件名」。分好之后必须有东西守着，
    // 否则下一个搬文件的人顺手往顶层一丢，两个月后又是一坨。
    const chatDir = join(PACKAGE_ROOT, 'src', 'mobile', 'views', 'chat')
    const topLevel = readdirSync(chatDir)
    const looseFiles = topLevel.filter(name => statSync(join(chatDir, name)).isFile())
    expect(looseFiles, `views/chat/ 顶层出现了散文件：${looseFiles.join(', ')}；请放进 components/hooks/state/lib 之一`).toEqual([])

    // 四个分区都要有东西，否则"分区"名存实亡。
    for (const dir of ['components', 'hooks', 'state', 'lib']) {
      const entries = readdirSync(join(chatDir, dir)).filter(name => /\.(ts|tsx)$/.test(name))
      expect(entries.length, `views/chat/${dir} 是空的`).toBeGreaterThan(0)
    }
  })

  it('keeps the largest view files inside their current budget (only goes down)', () => {
    const budgets: Record<string, number> = {
      'views/ChatView.tsx': 4_138,
      'views/SettingsView.tsx': 783,
      // 2026-11-08：P3 接入 host-bridge 单一订阅点（新增可选 bridge 属性 + 双路订阅回落，
      // 单测仍走 mux 直连）。视图改接完成后回落分支删除，此值回落。
      'views/SessionListView.tsx': 1_134,
      // 2026-11-07：P1 会话位置写回 URL + 首帧直达会话（刷新/重启回原会话）是**功能新增**，
      // 不是重构漏量；1121 → 1265 已按实测收紧，之后只许降。
      'views/App.tsx': 1_264,
      'views/WorkspaceView.tsx': 1_063,
      // W2-6 补登记：这两屏此前没有预算，等于可以无声长大。
      // 2026-11-08：P3 接入 host-bridge（可选 bridge 属性 + 双路订阅回落）；回落分支删除后本值降回。
      'views/RunOverviewView.tsx': 987,
      'views/SubChatView.tsx': 177,
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

  /*
   * 依赖方向（W1-6）：内核（ui/）与设计令牌（design/）是被所有人依赖的底层，
   * 它们一旦反过来 import 数据层或视图，分层就名存实亡——而且这种依赖会让
   * 内核没法在灯箱/菜单这种孤立场景里复用。
   */
  it('ui 内核与 design 只向下依赖：不 import 数据层、视图与业务 store', () => {
    const forbidden = [
      /(?:^|\/)views\//,
      /(?:^|\/)api\.ts$/,
      /(?:^|\/)mux\.ts$/,
      /(?:^|\/)store(?:-[a-z-]+)?\.ts$/,
      /(?:^|\/)App\.tsx$/,
    ]
    const kernel = SOURCES.filter(file => {
      const path = rel(file)
      return path.startsWith('ui/') || path.startsWith('design/')
    })
    expect(kernel.length, 'ui/ 与 design/ 应该有文件').toBeGreaterThan(0)

    const violations: string[] = []
    for (const file of kernel) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const spec = match[1] ?? ''
        if (forbidden.some(pattern => pattern.test(spec))) violations.push(`${rel(file)} → ${spec}`)
      }
    }
    expect(violations, `内核不得反向依赖：\n${violations.join('\n')}`).toEqual([])
  })

  it('design/tokens.ts 是纯数据，不 import 任何模块', () => {
    const text = readFileSync(join(HERE, 'design', 'tokens.ts'), 'utf8')
    expect(text.match(/^\s*import\s/m)).toBeNull()
  })

  /*
   * CSP 收紧（W1-8）的另一半：`style-src 'self'` 只有在页面真的不再产出内联样式时
   * 才成立。以后谁再手写 `style="..."` 或往 DOM 里塞 `<style>`，CSP 不会在测试里
   * 报错（浏览器只在真机上拒绝），所以这里先拦一道。
   *
   * 例外：`export.ts` 生成的是**下载到本地打开的独立 HTML**，不经 /m/ 的 CSP，
   * 里面的 `<style>` 是有意的（导出件要能离线自洽）。
   */
  it('shipped mobile code emits no inline style attributes or <style> blocks', () => {
    const violations: string[] = []
    for (const file of SOURCES) {
      const path = rel(file)
      // 导出件（platform/export.ts）里的 <style> 是有意的：导出的 HTML 要能离线自洽。
    if ((path.split('/').pop() ?? '') === 'export.ts') continue
      const text = readFileSync(file, 'utf8')
      // 去掉注释再扫：文档里提到 `<style>` 不算违规。
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      for (const pattern of [/<style\b/, /\bstyle="/]) {
        const hit = pattern.exec(code)
        if (hit !== null) violations.push(`${path}: ${hit[0]}`)
      }
    }
    expect(violations, `内联样式会让 CSP 的 style-src 'self' 形同虚设：\n${violations.join('\n')}`).toEqual([])
  })

  /*
   * W2-4：输入区原本吃 29 个扁平 props —— 加一个附件动作要同时改 ChatView、
   * 接口、解构三处，而且看不出它到底依赖哪几类东西。现在按语义收成 6 组；
   * 这里钉住上限，防止又慢慢长回一长串。
   */
  it('ComposerSection 的 props 不超过 8 组', () => {
    const text = readFileSync(join(HERE, 'views', 'chat', 'components', 'composer-section.tsx'), 'utf8')
    const block = /export interface ComposerSectionProps \{([\s\S]*?)\n\}/.exec(text)?.[1] ?? ''
    const fields = block.split('\n').filter(line => /^ {2}\w+\??:/.test(line))
    expect(fields.length, `ComposerSectionProps 现有 ${fields.length} 组：${fields.map(f => f.trim()).join(' / ')}`)
      .toBeLessThanOrEqual(8)
  })

  /*
   * W3-2：Chat Store 必须能脱离 React 回放 —— 不 import React 是"纯 reducer"的
   * 唯一硬约束。一旦它开始用 useState，迁移就又变回"把 state 从组件搬到组件"。
   */
  it('Chat Store 不 import React（纯 reducer，可离线回放）', () => {
    const text = readFileSync(join(HERE, 'runtime', 'chat', 'store.ts'), 'utf8')
    expect(/from\s+['"]react['"]/.test(text), 'Chat Store 里出现了 React 依赖').toBe(false)
  })

  /*
   * W2-1：Identity 内核是六个内核里最底层的一个，必须保持"纯"——
   * 只能有 `import type`（类型在编译期擦除），不能有运行时依赖。
   * 一旦它开始 import 运行时代码，messages.ts → kernels → messages.ts 就会成环。
   */
  it('Identity 内核只有类型依赖（无运行时 import）', () => {
    const text = readFileSync(join(HERE, 'kernels', 'identity.ts'), 'utf8')
    const valueImports = [...text.matchAll(/^import\s+(?!type\b)[^\n]*from\s+['"]([^'"]+)['"]/gm)]
      .map(match => match[1] ?? '')
    expect(valueImports, `Identity 内核出现了运行时依赖：${valueImports.join(', ')}`).toEqual([])
  })

  /*
   * W4-3：视图不再直接从 `api.ts` 取数。
   *
   * 直连的代价不是多写一行 import，而是"数据从哪来"这件事散在 18 个视图里：想加缓存、
   * 想改重试、想换传输，都得挨个视图改。类型导入不算直连——那是两端的 wire 契约，
   * 本来就该直接引用。这条断言是 W4-3 的护栏：迁完就不许再长回去。
   */
  it('views/ 不直接 import api.ts 的取数函数（只允许 import type）', () => {
    const violations: string[] = []
    const walk = (dir: string): string[] => {
      const out: string[] = []
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) out.push(...walk(full))
        else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full)
      }
      return out
    }
    for (const file of walk(join(HERE, 'views'))) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/^import\s+(\{[^}]*\})\s+from\s+['"][^'"]*api\.ts['"]/gm)) {
        const specifiers = (match[1] ?? '').slice(1, -1).split(',').map(item => item.trim()).filter(Boolean)
        const values = specifiers.filter(item => !item.startsWith('type '))
        if (values.length > 0) violations.push(`${rel(file)}: ${values.join(', ')}`)
      }
    }
    expect(violations, `视图仍在直连 api.ts：\n${violations.join('\n')}`).toEqual([])
  })
})
