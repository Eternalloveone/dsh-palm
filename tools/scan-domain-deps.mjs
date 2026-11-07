// 扫描：每个域的处理器用到了哪些「闭包内的非导入符号」。
// 结论决定「哪个域可以整块搬走」。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dirname, '..')
const API = join(REPO, 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const text = readFileSync(API, 'utf8')
const lines = text.split('\n')

const tableStarts = []
lines.forEach((line, index) => { if (/makeMobileDispatchTable</.test(line)) tableStarts.push(index) })

// 导入符号
const imported = new Set()
for (const line of lines) {
  const m = /^import (?:type )?\{([^}]+)\} from/.exec(line)
  if (!m) continue
  for (const raw of m[1].split(',')) {
    const name = raw.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim()
    if (name) imported.add(name)
  }
}

// 模块级定义（function / const / let / class / type / interface）
const defined = new Set()
for (const line of lines) {
  const m = /^(?:export )?(?:async )?(?:function|const|let|var|class|type|interface) ([A-Za-z_$][\w$]*)/.exec(line)
  if (m) defined.add(m[1])
}

const BUILTIN = new Set([
  'Object', 'Array', 'Map', 'Set', 'Promise', 'String', 'Number', 'Boolean', 'JSON', 'Date', 'Math',
  'Error', 'RegExp', 'Buffer', 'encodeURIComponent', 'decodeURIComponent', 'parseInt', 'parseFloat',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'structuredClone', 'Symbol', 'URL',
  'console', 'require', 'await', 'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'new',
  'function', 'async', 'const', 'let', 'var', 'throw', 'else', 'try', 'finally', 'do', 'case', 'of', 'in',
])

const entries = []
for (let t = 0; t < tableStarts.length; t += 1) {
  const from = tableStarts[t]
  const to = t + 1 < tableStarts.length ? tableStarts[t + 1] : lines.length
  for (let i = from; i < to; i += 1) {
    const head = /^\s*\[(?:'([a-z]+)\.[A-Za-z]+'|([A-Z][A-Z0-9_]*)),/.exec(lines[i])
    if (!head) continue
    let depth = 0
    let started = false
    let end = i
    for (let j = i; j < to; j += 1) {
      for (const ch of lines[j]) {
        if (ch === '[' || ch === '{' || ch === '(') { depth += 1; started = true }
        else if (ch === ']' || ch === '}' || ch === ')') depth -= 1
      }
      if (started && depth <= 0) { end = j; break }
    }
    entries.push({ owner: head[1] ?? `CONST:${head[2]}`, body: lines.slice(i, end + 1).join('\n') })
    i = end
  }
}

const byOwner = new Map()
for (const entry of entries) {
  // 只统计「裸调用」：前面不是点、不是标识符字符（排除 obj.method( / arr.filter( ）
  const calls = new Set([...entry.body.matchAll(/(?<![.\w$])([a-zA-Z_$][\w$]*)\s*\(/g)].map(m => m[1]))
  const missing = [...calls].filter(name => !imported.has(name) && !defined.has(name) && !BUILTIN.has(name))
  const list = byOwner.get(entry.owner) ?? []
  list.push({ missing, size: entry.body.split('\n').length })
  byOwner.set(entry.owner, list)
}

console.log('域                 条目  行数  外部依赖（闭包内符号）')
for (const [owner, list] of [...byOwner].sort((a, b) => b[1].length - a[1].length)) {
  const allMissing = [...new Set(list.flatMap(item => item.missing))]
  const size = list.reduce((n, item) => n + item.size, 0)
  console.log(`${owner.padEnd(18)} ${String(list.length).padStart(3)} ${String(size).padStart(5)}  ${allMissing.slice(0, 6).join(', ') || '（无）'}`)
}
