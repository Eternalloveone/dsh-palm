// 只读探查：列出 mobile-api.ts 两张分发表里的方法名，按域分组，为拆分定边界。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FILE = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const lines = readFileSync(FILE, 'utf8').split('\n')

/** 从 startLine 开始，靠花括号配平截出一个对象字面量的行区间。 */
function block(startLine) {
  let depth = 0
  let started = false
  let end = startLine
  for (let i = startLine; i < lines.length; i += 1) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth += 1; started = true }
      else if (ch === '}') depth -= 1
    }
    if (started && depth <= 0) { end = i; break }
  }
  return [startLine, end]
}

const find = needle => lines.findIndex(line => line.includes(needle))
const tables = [
  { name: 'localHandlers', at: find('const localHandlers') },
  { name: 'methods', at: find('const methods') },
].filter(t => t.at >= 0)

const DOMAIN = [
  [/^(session|sessions)/i, 'sessions'],
  [/^(chat|message|send|turn|steer|abort|interrupt)/i, 'chat'],
  [/^(workspace|workspaces|dir|folder)/i, 'workspaces'],
  [/^(settings?|config|prefs?)/i, 'settings'],
  [/^(search|find|grep)/i, 'search'],
  [/^(file|files|tree|readFile|writeFile|artifact)/i, 'files'],
  [/^(model|models|provider)/i, 'models'],
  [/^(auth|login|token|key)/i, 'auth'],
  [/^(mux|stream|event|sse|subscribe)/i, 'stream'],
  [/^(theme|skin|ui)/i, 'ui'],
]

const report = []
for (const table of tables) {
  const [start, end] = block(table.at)
  const entries = []
  for (let i = start; i <= end; i += 1) {
    const m = /^ {2}([A-Za-z_$][\w$]*)\s*[:(]/.exec(lines[i])
    if (m) entries.push({ name: m[1], line: i + 1 })
  }
  const buckets = new Map(DOMAIN.map(([, label]) => [label, []]))
  buckets.set('other', [])
  for (const entry of entries) {
    const hit = DOMAIN.find(([re]) => re.test(entry.name))
    buckets.get(hit ? hit[1] : 'other').push(entry.name)
  }
  report.push({ table: table.name, start: start + 1, end: end + 1, count: entries.length, buckets })
}

for (const r of report) {
  console.log(`\n== ${r.table}  L${r.start}-L${r.end}  (${r.end - r.start + 1} 行, ${r.count} 个方法)`)
  for (const [domain, names] of [...r.buckets].sort((a, b) => b[1].length - a[1].length)) {
    if (names.length === 0) continue
    console.log(`  ${domain.padEnd(11)} ${String(names.length).padStart(3)}  ${names.slice(0, 8).join(', ')}${names.length > 8 ? ' …' : ''}`)
  }
}
console.log(`\n文件总行数: ${lines.length}`)
