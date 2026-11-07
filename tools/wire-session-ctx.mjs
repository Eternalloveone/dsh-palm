// 给 9 个 session 调用点补上两个闭包缓存失效函数（经 ctx 传入，避免反向依赖）。
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile-api.ts')
const raw = readFileSync(API, 'utf8')
const FNS = [
  'sessionCreate', 'sessionHistory', 'sessionSearch', 'sessionPrompt', 'sessionModels',
  'sessionSelectModel', 'sessionRename', 'sessionCancel', 'sessionUpdateQueue',
]
let text = raw
let count = 0
for (const fn of FNS) {
  const before = `${fn}(ctx)`
  const after = `${fn}({ ...ctx, invalidateRosterCaches, invalidateSessionSearch })`
  if (text.includes(before)) { text = text.split(before).join(after); count += 1 }
}
writeFileSync(API, text)
console.log(`补参数 ${count} 处`)
