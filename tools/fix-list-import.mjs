import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'SessionListView.tsx')
const eol = readFileSync(P, 'utf8').includes('\r\n') ? '\r' : ''
const lines = readFileSync(P, 'utf8').split('\n')

const IMPORT = `import type { HostBridge } from '../kernels/host-bridge.ts'${eol}`

// 删除错位的 import（以及它可能带出的空行）
for (let i = lines.length - 1; i >= 0; i -= 1) {
  if (lines[i].includes('import type { HostBridge }')) lines.splice(i, 1)
}
// 放在 roster 导入之后
const at = lines.findIndex(line => line.startsWith('import { SessionListRoster'))
if (at < 0) { console.log('未找到 roster 导入'); process.exit(1) }
lines.splice(at + 1, 0, IMPORT)

// 若第 59 行留下裸的 `import {` 就补回原内容（原为多行导入 CreateFolderDialog 等）
const dangling = lines.findIndex((line, i) => line.trim() === 'import {' && lines[i + 1]?.includes('CreateFolderDialog'))
if (dangling >= 0) {
  // 已正常，无需处理
}

writeFileSync(P, lines.join('\n'))
console.log('import 已归位')
