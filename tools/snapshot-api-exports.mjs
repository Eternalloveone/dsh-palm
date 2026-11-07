// 生成 mobile-api.ts 的导出面快照（拆分安全绳）。
// 用法：node tools/snapshot-api-exports.mjs
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dirname, '..')
const SRC = join(REPO, 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const OUT = join(REPO, 'packages', 'dsh-palm', 'tests', 'golden', 'api-exports.json')

const lines = readFileSync(SRC, 'utf8')
  .split('\n')
  .filter(line => line.startsWith('export '))
  .map(line => line.trim().replace(/\s+/g, ' '))
  .sort()

const snapshot = {
  $comment: '拆分安全绳：mobile-api.ts 的导出面必须与这里完全一致。改导出面 = 有意为之，必须同 commit 更新本文件并说明理由。',
  source: 'src/mobile-api.ts',
  count: lines.length,
  hash: createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16),
  lines,
}

writeFileSync(OUT, `${JSON.stringify(snapshot, null, 2)}\n`)
console.log(`written ${OUT}`)
console.log(`exports ${snapshot.count}, hash ${snapshot.hash}`)
