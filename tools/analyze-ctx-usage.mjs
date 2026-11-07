// 只读探查：makeMobileApiRoutes 用了 ctx 的哪些字段、各用多少次。
// 目的：按域整块搬处理器时，先知道它依赖 ctx 的哪几块。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dirname, '..')
const SRC = join(REPO, 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const OUT = join(REPO, 'docs', 'api-ctx-usage.md')

const lines = readFileSync(SRC, 'utf8').split('\n')
const start = lines.findIndex(line => /^(?:export )?function makeMobileApiRoutes\b/.test(line))
if (start < 0) throw new Error('没找到 makeMobileApiRoutes')

let depth = 0
let started = false
let end = start
for (let i = start; i < lines.length; i += 1) {
  for (const ch of lines[i]) {
    if (ch === '{') { depth += 1; started = true }
    else if (ch === '}') depth -= 1
  }
  if (started && depth <= 0) { end = i; break }
}

const body = lines.slice(start, end + 1)
const counts = new Map()
for (const line of body) {
  for (const match of line.matchAll(/\bctx\.([A-Za-z_$][\w$]*)/g)) {
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1)
  }
}

// 顺带看闭包里定义了多少函数（搬移的搬运单位）
const inner = body.filter(line => /^ {2}(?:const|function|async function) [A-Za-z_$]/.test(line)).length
const total = [...counts.values()].reduce((a, b) => a + b, 0)
const sorted = [...counts].sort((a, b) => b[1] - a[1])

const md = [
  '# `makeMobileApiRoutes` 的 ctx 依赖表（P2 工作底稿）',
  '',
  '> 由 `tools/analyze-ctx-usage.mjs` 从源码实测生成，勿手改。',
  '',
  `- 闭包范围：**L${start + 1}–L${end + 1}**（${end - start + 1} 行）`,
  `- 闭包内定义的局部函数/常量：**${inner}** 个`,
  `- ctx 字段引用：**${total}** 次，涉及 **${counts.size}** 个字段`,
  '',
  '## 一、按引用次数排序',
  '',
  '| # | 字段 | 次数 | 搬移影响 |',
  '|---|---|---|---|',
  ...sorted.map(([name, count], index) => `| ${index + 1} | \`${name}\` | ${count} | ${count >= 8 ? '**跨域共享，先抽接口**' : count >= 3 ? '局部共用' : '单域独占，可随域走'} |`),
  '',
  '## 二、结论',
  '',
  '1. **前 5 个字段占了大部分引用**——它们是跨域共享的核心（依赖注入、代理、日志、预算），',
  '   应当先固化成 `api/api-deps.ts` 的接口，处理器搬出去时只依赖这个接口。',
  '2. **引用 ≤2 次的字段**基本是单域独占，随处理器一起搬走即可，不需要进共享接口。',
  '3. 搬移单位 = **一个域的处理器 + 它独占的字段 + 它独占的局部函数**，一起进 `api/<域>.ts`。',
  '',
  '## 三、下一步',
  '',
  '按上面的"搬移影响"列，先做 `api/api-deps.ts`（只放前 5 个字段的类型），',
  '然后搬第一个中等规模的域（`workspace`，5 个方法），验证整块搬移是否成立。',
]

writeFileSync(OUT, `${md.join('\n')}\n`)
console.log(`闭包 L${start + 1}-L${end + 1}（${end - start + 1} 行），局部定义 ${inner} 个`)
console.log(`ctx 引用 ${total} 次 / ${counts.size} 个字段`)
for (const [name, count] of sorted.slice(0, 12)) console.log(`  ${name.padEnd(26)} ${count}`)
