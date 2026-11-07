/**
 * W2-6 证据生成：六屏的"行数 + 原语使用 + 裸件残留"清单。
 *
 * 输出到 ui-refactor/w2-6-screen-inventory.md，供出口门禁留档。
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'

const ROOT = 'packages/dsh-palm/src/mobile'
/** [名称, 屏文件, 预算, 同屏子目录（这些子目录里的原语也算这一屏用的）] */
const SCREENS = [
  ['设置', 'views/SettingsView.tsx', 783, ['views/settings']],
  ['会话列表', 'views/SessionListView.tsx', 1124, ['views/list']],
  ['工作区', 'views/WorkspaceView.tsx', 1063, []],
  ['运行总览', 'views/RunOverviewView.tsx', 981, []],
  ['聊天', 'views/ChatView.tsx', 5250, ['views/chat']],
  ['子会话', 'views/SubChatView.tsx', 177, []],
]

const PRIMITIVES = ['Button', 'IconButton', 'Field', 'Chip', 'Badge', 'StatusDot', 'Skeleton', 'ListRow', 'Card', 'EmptyState', 'ErrorState']

const count = (text, re) => (text.match(re) ?? []).length

const rows = []
for (const [name, file, budget, dirs] of SCREENS) {
  const text = readFileSync(`${ROOT}/${file}`, 'utf8')
  /** 同屏子目录里的源码（不含测试）。 */
  const extra = []
  for (const dir of dirs) {
    for (const entry of readdirSync(`${ROOT}/${dir}`)) {
      if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue
      if (entry.includes('.test.')) continue
      extra.push(readFileSync(`${ROOT}/${dir}/${entry}`, 'utf8'))
    }
  }
  const surface = [text, ...extra].join('\n')
  const lines = text.split('\n').length
  const uses = PRIMITIVES.filter((primitive) => count(surface, new RegExp(`<${primitive}[\\s>/]`, 'g')) > 0)
  rows.push({
    name,
    file,
    lines,
    budget,
    headroom: budget - lines,
    parts: 1 + extra.length,
    uses,
    rawButtons: count(surface, /<button[\s>]/g),
    inlineStyles: count(surface, /style=\{\{/g),
  })
}

const header = [
  '# W2-6 六屏清单（出口证据）',
  '',
  `生成时间：${new Date().toISOString()}`,
  '',
  '| 屏幕 | 文件 | 行数 | 预算 | 余量 | 分片 | 原语 | 裸 button | 内联 style |',
  '|---|---|---:|---:|---:|---:|---|---:|---:|',
]
const body = rows.map((row) => `| ${row.name} | \`${row.file}\` | ${row.lines} | ${row.budget} | ${row.headroom} | ${row.parts} | ${row.uses.join(' / ') || '—'} | ${row.rawButtons} | ${row.inlineStyles} |`)

const tail = [
  '',
  '## 读数说明',
  '',
  '- **行数**用 `split(\'\\n\').length`（与 `architecture.test.ts` 的行数预算同口径），不是编辑器显示行数。',
  '- **预算**即 `architecture.test.ts` 里 `keeps the largest view files inside their current budget` 的上限；W2-6 起 RunOverview / SubChat 也纳入（此前可以无声长大）。',
  '- **原语**只统计真的用了哪些 `ui/primitives`，不代表穷尽；裸 button 全站已为 0（`quality-budget.ts` 的 `rawButtons` 咬到 0，新写即红）。',
  '- 聊天屏远超其余五屏，是 W3 Pres/Clock/Intent 三个内核要接管的协调器；拆它属于 W9 目标（≤900 行），不在 W2 范围。',
  '',
]

writeFileSync('D:/work/dsh-palm/ui-refactor/w2-6-screen-inventory.md', header.concat(body, tail).join('\n'), 'utf8')
console.log(header.concat(body).join('\n'))
