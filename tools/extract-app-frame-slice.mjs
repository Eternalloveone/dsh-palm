import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'App.tsx')
const text = readFileSync(P, 'utf8')
const eol = text.includes('\r\n') ? '\r\n' : '\n'
const lines = text.split('\n')

// 1) 用切片替换内联回调体
const start = lines.findIndex(line => line.includes('const unsubscribe = bridge.onFrame((frame) => {'))
if (start < 0) { console.log('未找到 onFrame 接线'); process.exit(1) }
let end = -1
for (let i = start + 1; i < lines.length; i += 1) {
  if (lines[i].replace(/\r$/, '').trim() === '})') { end = i; break }
}
if (end < 0) { console.log('未找到回调结尾'); process.exit(1) }
const indent = lines[start].match(/^\s*/)[0]
const replacement = [
  `${indent}const unsubscribe = bridge.onFrame(frame => handleAppFrame(frame, {`,
  `${indent}  recomputeActive,`,
  `${indent}  collectFinished: (sessionId, event) => collectFinished(sessionId, event as TurnEndEvent),`,
  `${indent}}))${eol}`,
]
lines.splice(start, end - start + 1, ...replacement)

// 2) 加 import
let out = lines.join('\n')
if (!out.includes('app-frame-slice.ts')) {
  out = out.replace(
    "import { createHostBridge } from '../kernels/host-bridge.ts'",
    `import { handleAppFrame } from '../kernels/app-frame-slice.ts'${eol}import { createHostBridge } from '../kernels/host-bridge.ts'`,
  )
}

writeFileSync(P, out)
writeFileSync(join(import.meta.dirname, 'tmp-app-lines.txt'), String(out.split('\n').length))
console.log('App.tsx 行数:', out.split('\n').length)
