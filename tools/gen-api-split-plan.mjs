// 生成 mobile-api 拆分计划（只读探查 → 文档）。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dirname, '..')
const SRC = join(REPO, 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const OUT = join(REPO, 'docs', 'mobile-api-split-plan.md')
const text = readFileSync(SRC, 'utf8')
const total = text.split('\n').length

const names = [...new Set([...text.matchAll(/'([a-z]+\.[a-zA-Z][\w]*)'/g)].map(m => m[1]))].sort()

/** 前缀 → 目标文件（域即拆分的边界） */
const TARGET = {
  mobile: { file: 'api/mobile-fs.ts', label: '移动端文件与状态读取（listDirectory/readFile/readChat/logTail/sessionState/gitSummary…）' },
  workspace: { file: 'api/workspace.ts', label: '工作区增删查' },
  session: { file: 'api/session.ts', label: '会话生命周期与消息' },
  chat: { file: 'api/chat.ts', label: '对话发送/中断/流' },
  settings: { file: 'api/settings.ts', label: '设置与偏好' },
  model: { file: 'api/model.ts', label: '模型与思考强度' },
  theme: { file: 'api/ui.ts', label: '皮肤/外观' },
  perf: { file: 'api/perf.ts', label: '性能抓取与诊断' },
  pair: { file: 'api/pair.ts', label: '设备配对与握手' },
  push: { file: 'api/push.ts', label: '推送订阅与投递' },
  events: { file: 'api/stream.ts', label: '事件流与订阅' },
  subagent: { file: 'api/subagent.ts', label: '子代理任务' },
}

const groups = new Map()
for (const name of names) {
  const prefix = name.slice(0, name.indexOf('.'))
  if (!groups.has(prefix)) groups.set(prefix, [])
  groups.get(prefix).push(name)
}

const rows = [...groups].sort((a, b) => b[1].length - a[1].length)
const covered = rows.reduce((n, [, list]) => n + list.length, 0)

const lines = [
  '# `mobile-api.ts` 拆分计划（P2 工作底稿）',
  '',
  `> 由 \`tools/gen-api-split-plan.mjs\` 从源码实测生成，请勿手改；改完源码重跑即可。`,
  `> 现状：**${total} 行**，RPC 方法名 **${names.length} 个**，前缀 ${rows.length} 个。`,
  '',
  '## 一、按前缀分组（实测）',
  '',
  '| 前缀 | 方法数 | 目标文件 | 覆盖内容 |',
  '|---|---|---|---|',
]

for (const [prefix, list] of rows) {
  const target = TARGET[prefix]
  lines.push(`| \`${prefix}\` | ${list.length} | ${target ? `\`${target.file}\`` : '❓ 待定'} | ${target ? target.label : '未归类，需人工判定'} |`)
}
lines.push('', `合计覆盖 **${covered}/${names.length}** 个方法。`, '')

lines.push('## 二、各域方法清单', '')
for (const [prefix, list] of rows) {
  lines.push(`### \`${prefix}\`（${list.length}）`, '')
  lines.push(list.map(n => `\`${n}\``).join(' · '), '')
}

lines.push(
  '## 三、拆分顺序（每步一提交，必须全绿）',
  '',
  '1. **先立骨架**：`api/index.ts` 重导出全部现有导出，`mobile-api.ts` 改为只做 re-export——此时导出面完全不变，测试应全绿。',
  '2. **逐域搬移**（按方法数从多到少）：搬一个域 → 从 `mobile-api.ts` 删除 → 跑全量测试。',
  '3. **最后删壳**：`mobile-api.ts` 归零后删除，所有引用改指 `api/index.ts`。',
  '',
  '## 四、每步的验收',
  '',
  '- `pnpm typecheck` / `pnpm build` / `pnpm test` 全绿；',
  '- **导出面等价断言**：拆分前后 `api/index.ts` 的导出名集合必须完全一致（P2 第一步就要把这条断言写出来）；',
  '- 预算：`src/mobile-api.ts` 只降不升，`api/` 新增行数必须 ≤ 原文件减少行数。',
  '',
  '## 五、风险',
  '',
  '| 风险 | 对策 |',
  '|---|---|',
  '| 隐形共享状态（模块级变量）在拆分后被复制 | 先扫出全部模块级 `let/const` 与它们的使用位置，共享的收进 `api/context.ts` |',
  '| 循环依赖（域之间互相调用） | 已有模块图环检测；拆分每步都跑，出现环立刻拦下 |',
  '| 测试直接 import 内部函数 | 先跑一遍"仅通过 api/index.ts 使用"的检查，把越界引用记录下来 |',
)

writeFileSync(OUT, `${lines.join('\n')}\n`)
console.log(`written ${OUT}`)
console.log(`total lines ${total}, methods ${names.length}, prefixes ${rows.length}`)
for (const [prefix, list] of rows) console.log(`  ${prefix.padEnd(10)} ${String(list.length).padStart(3)}  → ${TARGET[prefix]?.file ?? '?'}`)
