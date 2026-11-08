import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'SessionListView.tsx')
const lines = readFileSync(P, 'utf8').split(/\r?\n/)
const kept = lines.filter(line => !/pending: rows\.filter\(row => row\.pending === true\)\.length,/.test(line))
writeFileSync(P, kept.join('\r\n'))
console.log(`删除 pending 计数行：${lines.length - kept.length}`)
