import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'App.tsx')
const text = readFileSync(P, 'utf8')
const eol = text.includes('\r\n') ? '\r\n' : ''
const lines = text.split('\n')

const declared = lines.some(line => line.includes('const bridgeRef = useRef'))
if (declared) {
  console.log('已声明，无需修改')
  process.exit(0)
}
const at = lines.findIndex(line => line.includes('const muxRef = useRef'))
if (at < 0) { console.log('未找到 muxRef'); process.exit(1) }
const indent = lines[at].match(/^\s*/)[0]
lines.splice(at + 1, 0, `${indent}const bridgeRef = useRef<ReturnType<typeof createHostBridge> | undefined>(undefined)${eol}`)
writeFileSync(P, lines.join('\n'))
console.log('bridgeRef 声明已补在 L' + (at + 2))
