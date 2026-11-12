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

/**
 * 去掉块注释与行注释（保留字符串里的内容不动，这里只判关键字，够用）。
 *
 * 判据铁律：**先剥注释再判**。`ChatView` 的注释里写着"11 个 useState → 1 个"，
 * 直接对整份源码做正则就会把说明书当成代码。
 */
function stripComments(source: string): string {
  let out = ''
  let i = 0
  let quote: string | undefined
  while (i < source.length) {
    const char = source[i]!
    const next = source[i + 1]
    if (quote !== undefined) {
      out += char
      if (char === '\\') { out += next ?? ''; i += 2; continue }
      if (char === quote) quote = undefined
      i += 1
      continue
    }
    if (char === '"' || char === "'" || char === '`') { quote = char; out += char; i += 1; continue }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      i = end === -1 ? source.length : end + 2
      continue
    }
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i)
      i = end === -1 ? source.length : end
      continue
    }
    out += char
    i += 1
  }
  return out
}

/**
 * ChatView 里允许出现的 `useState` 个数（只减不增）。
 *
 * 2026-11-10：这条断言原来写的是 `match(/useState\(/g)`，而本仓所有调用都带
 * 泛型（`useState<T>(...)`），于是它恒等于 0 —— 一个永远通过的护栏比没有更糟
 * （它让人以为"已经收到 0 个"）。改成同时匹配 `useState<` 与 `useState(`、
 * 并先剥注释后，真实基线是 24；待批/待答搬进账本后 22，W3-6 把队列改成仓的只读
 * 投影后又少一个（`useState<QueueItemView[]>` 删除），现在 21。
 */
const CHAT_VIEW_USE_STATE_BUDGET = 22

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
    //
    // 计数必须覆盖泛型写法（`useState<T>(`）：只匹配 `useState(` 会让断言恒真
    // （实测漏掉 24 个），这正是 2026-11-10 修掉的那个假护栏。
    const text = stripComments(readFileSync(join(PACKAGE_ROOT, 'src', 'mobile', 'views', 'ChatView.tsx'), 'utf8'))
    const count = (text.match(/useState[<(]/g) ?? []).length
    expect(count, `ChatView 里有 ${count} 个 useState（预算 ${CHAT_VIEW_USE_STATE_BUDGET}）`)
      .toBeLessThanOrEqual(CHAT_VIEW_USE_STATE_BUDGET)
  })

  /*
   * W3-2 第二步：待批审批 / 待答问题只能有一份所有者。
   *
   * 这两份事实曾经是 ChatView 的两个 useState，于是 SSE 帧、弱网轮询、审批页
   * 各写一份，换会话靠"进会话清空"挡串写（代价：切回来卡片没了）。现在事实在
   * runtime/chat/pending-store.ts 里按会话分桶。这条断言钉住"不许搬回组件"。
   */
  it('待批/待答事实不在 ChatView 里另存一份', () => {
    const text = stripComments(readFileSync(join(PACKAGE_ROOT, 'src', 'mobile', 'views', 'ChatView.tsx'), 'utf8'))
    const localArrays = [...text.matchAll(/useState<[^>\n]*>\s*\(/g)]
      .map(match => match[0])
      .filter(declaration => /PendingApproval|PendingQuestionItem/.test(declaration))
    expect(localArrays, `ChatView 又自己存了待处理事实：${localArrays.join(' / ')}`).toEqual([])
    expect(/useSessionPending\(/.test(text), 'ChatView 没有从会话账本读待处理事实').toBe(true)
  })

  /*
   * W3-2 第二步收口：审批详情页不许吃"导航快照"。
   *
   * 路由曾经把整条审批对象抄进 `Route.approval`，于是页面与对话面板各有一份
   * 事实：别处答完之后，详情页还在请你批准一个已经不存在的调用。现在路由只存
   * `approvalId`（导航身份），页面按 id 从会话账本读（views/approval-route.tsx）。
   */
  it('审批路由只存 approvalId（内容归会话账本）', () => {
    const text = stripComments(readFileSync(join(PACKAGE_ROOT, 'src', 'mobile', 'views', 'App.tsx'), 'utf8'))
    const block = /kind: 'approval'([\s\S]{0,800}?)\n  \}/.exec(text)?.[1] ?? ''
    expect(block, 'App.tsx 里找不到 approval 路由定义').not.toBe('')
    expect(/approvalId: string/.test(block), 'approval 路由没有 approvalId').toBe(true)
    expect(/\bapproval:/.test(block), 'approval 路由又把审批内容抄了一份').toBe(false)
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
    // 单一真相：文件上限只在 tools/budget.json 维护；这里不再维护第二张表。
    // 2026-11-11：原表与 CLI 的 budget.json 数值不一致（App 1325 vs 1308），
    // 两处各自红/绿；合并后 architecture / budget.test / check-budget 三处同源。
    const budget = JSON.parse(readFileSync(join(REPO_ROOT, 'tools', 'budget.json'), 'utf8')) as {
      files: Record<string, number>
    }
    const budgets = Object.fromEntries(
      Object.entries(budget.files)
        .filter(([rel]) => rel.startsWith('src/mobile/views/'))
        .map(([rel, cap]) => [rel.slice('src/mobile/'.length), cap]),
    )
    for (const [file, budget] of Object.entries(budgets)) {
      const lines = readFileSync(join(HERE, file), 'utf8').split('\n').length
      expect(lines, `${file} grew past its budget (${lines} > ${budget})`).toBeLessThanOrEqual(budget)
    }
  })

  /*
   * 2026-11-11：原「目标线」用 `it.fails` 表达（ChatView ≤2500、单文件 ≤1200）。
   * 但预期失败会把永久违规计成通过，达标反而变红——那不是门禁，是记账。
   * 目标线改由 tools/budget.json 的实测基准承担（只降不升 + 反向虚高断言）；
   * 这条 expected-fail 随之删除。
   */

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
   * 队列 / outbox 账本的所有权（2026-11-10 复核结论，写成护栏防回退）。
   *
   * - 「排队消息」是宿主侧的队列：账本在 `stream/session-store.ts`，视图只经
   *   `useSessionQueue` 读版本号，**不许再抄一份数组**（抄一份就会出现"界面显示 3 条、
   *   宿主实际 2 条"这种对不上的状态）。
   * - 「离线待发」是本地 IndexedDB 里的一条队列：账本在 `platform/offline.ts`，
   *   只有它写 `outbox` 这个 store；视图侧只许经两个钩子（入队 / 冲队列）触达，
   *   不许第三处直接摸存储。
   */
  it('待发队列只有一份账本：视图不许再抄队列数组', () => {
    const offenders: string[] = []
    for (const file of SOURCES) {
      const path = rel(file)
      if (!path.startsWith('views/')) continue
      const code = stripComments(readFileSync(file, 'utf8'))
      // useState<QueueItemView[]> / useReducer 里自己攒队列 = 第二份事实。
      if (/useState<\s*QueueItemView\[\]/.test(code)) offenders.push(path)
    }
    expect(offenders, `views 里出现了第二份队列数组: ${offenders.join(', ')}`).toEqual([])
  })

  it('outbox 存储只有 platform/offline.ts 写，视图只能经两个钩子触达', () => {
    // 1) 谁直接写这个 store：只允许账本自己 + 建表（history-cache 负责 schema）。
    const touchStore = SOURCES
      .filter((file) => /'outbox'/.test(stripComments(readFileSync(file, 'utf8'))))
      .map(rel)
      .filter(path => path !== 'platform/offline.ts' && path !== 'session/history-cache.ts')
    expect(touchStore, `除账本与建表外还有人碰 outbox store: ${touchStore.join(', ')}`).toEqual([])

    // 2) 视图侧谁 import 了 offline.ts：只许这两个钩子（其余一律经它们）。
    const allowed = new Set([
      'views/chat/hooks/use-chat-composer.ts',
      'views/chat/hooks/use-chat-outbox-flush.ts',
    ])
    const importers = SOURCES
      .filter((file) => /platform\/offline\.ts/.test(stripComments(readFileSync(file, 'utf8'))))
      .map(rel)
      .filter(path => path !== 'platform/offline.ts' && !allowed.has(path))
    expect(importers, `绕过钩子直接摸 outbox: ${importers.join(', ')}`).toEqual([])
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
