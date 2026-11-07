/**
 * W3-1 状态分类：把 ChatView 的 useState 抽成清单（名称 / 类型 / 初值形态）。
 *
 * 只做**抽取**，分类靠人（见 ui-refactor/w3-1-state-inventory.md 的规则表）：
 * 机器状态和 UI 局部状态长得太像，机器判不准，硬猜反而误导。
 */
import { readFileSync, writeFileSync } from 'node:fs'

const file = process.argv[2] ?? 'packages/dsh-palm/src/mobile/views/ChatView.tsx'
const source = readFileSync(file, 'utf8')

/** `const [name, setter] = useState<Type>(init)` —— 允许跨行与泛型缺省。 */
const PATTERN = /const\s+\[(\w+),\s*(\w+)\]\s*=\s*useState(?:\s*<([^>]*(?:<[^>]*>)?[^>]*)>)?\s*\(/g

const items = []
for (const match of source.matchAll(PATTERN)) {
  const [, name, setter, type] = match
  const index = match.index ?? 0
  const line = source.slice(0, index).split('\n').length
  // 初值：从 `(` 之后取到同层 `)` 前 40 字，够看出是字面量/undefined/函数。
  const open = index + match[0].length
  let depth = 1
  let cursor = open
  while (cursor < source.length && depth > 0) {
    const char = source[cursor]
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    cursor += 1
  }
  const init = source.slice(open, Math.max(open, cursor - 1)).trim().split('\n')[0]?.slice(0, 46) ?? ''
  items.push({ line, name, setter, type: (type ?? '').trim(), init })
}

const counts = new Map()
for (const item of items) {
  const type = item.type === '' ? '(推断)' : item.type
  counts.set(type, (counts.get(type) ?? 0) + 1)
}

const lines = [
  `# ${file} 状态抽取`,
  '',
  `共 ${items.length} 个 useState。`,
  '',
  '| 行 | 变量 | setter | 类型 | 初值（截断） |',
  '|---:|---|---|---|---|',
  ...items.map((item) => `| ${item.line} | \`${item.name}\` | \`${item.setter}\` | \`${item.type || '—'}\` | \`${item.init.replace(/\|/g, '\\|')}\` |`),
  '',
  '## 类型分布',
  '',
  '| 类型 | 个数 |',
  '|---|---:|',
  ...[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([type, count]) => `| \`${type}\` | ${count} |`),
  '',
]

writeFileSync('D:/work/dsh-palm/ui-refactor/w3-1-chatview-usestate.md', lines.join('\n'), 'utf8')
console.log(`抽取 ${items.length} 个 useState → ui-refactor/w3-1-chatview-usestate.md`)
for (const item of items) console.log(`${String(item.line).padStart(5)} ${item.name.padEnd(22)} ${item.type || '—'}`)
