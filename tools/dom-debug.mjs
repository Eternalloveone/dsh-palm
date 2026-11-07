// 诊断：为什么 move-domain2 看不到条目。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dirname, '..')
const API = join(REPO, 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const lines = readFileSync(API, 'utf8').split('\n')
console.log('lines', lines.length)

const tableStarts = []
lines.forEach((line, index) => { if (/makeMobileDispatchTable</.test(line)) tableStarts.push(index) })
console.log('tableStarts', tableStarts.map(i => i + 1))

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
    const owner = head[1] ? head[1].slice(0, head[1].indexOf('.')) : 'CONST'
    entries.push({ start: i + 1, end: end + 1, owner })
    i = end
  }
}
console.log('entries', entries.length)
const hist = {}
for (const e of entries) hist[e.owner] = (hist[e.owner] ?? 0) + 1
console.log('owners', JSON.stringify(hist))
