import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const lines = readFileSync(API, 'utf8').split('\n')

// 方法常量 → 真实方法名
const constToMethod = new Map()
for (const line of lines) {
  const m = /^const ([A-Z][A-Z0-9_]*) = '([a-z][\w]*\.[\w]+)'/.exec(line.replace(/\r$/, ''))
  if (m) constToMethod.set(m[1], m[2])
}

const targets = process.argv.slice(2)
for (const target of targets) {
  let start = lines.findIndex(line => line.includes(`['${target}', async (ctx) => {`))
  if (start < 0) {
    for (const [key, method] of constToMethod) {
      if (method !== target) continue
      start = lines.findIndex(line => line.includes(`[${key}, async (ctx) => {`))
      break
    }
  }
  if (start < 0) { console.log(`### ${target} NOT FOUND`); continue }
  let end = start
  for (let i = start; i < lines.length; i += 1) {
    if (lines[i].trim() === '}],') { end = i; break }
  }
  console.log(`### ${target}  L${start + 1}-${end + 1} (${end - start + 1} 行)`)
  console.log(lines.slice(start, end + 1).join('\n'))
}
