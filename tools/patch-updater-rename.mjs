import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'updater.ts')
let text = readFileSync(P, 'utf8')
const eol = text.includes('\r\n') ? '\r\n' : '\n'

// 两处"目录改名"（备份旧安装 / 回滚）在 Windows 上会因占用瞬时 EPERM，走重试版。
text = text.replace(
  '    fsOps.renameSync(installedDir, retiredDir)',
  '    renameWithRetry(installedDir, retiredDir)',
)
text = text.replace(
  '    fsOps.renameSync(retiredDir, installedDir)',
  '    renameWithRetry(retiredDir, installedDir)',
)

if (!text.includes("from './atomic-write.ts'")) {
  const lines = text.split('\n')
  const lastImport = lines.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
  lines.splice(lastImport + 1, 0, `import { renameWithRetry } from './atomic-write.ts'${eol}`)
  text = lines.join('\n')
}

writeFileSync(P, text)
console.log('updater 已改用 renameWithRetry')
