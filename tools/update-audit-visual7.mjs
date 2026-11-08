import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'docs', 'objective-audit.md')
let text = readFileSync(P, 'utf8')

const before = '`node tools/mobile-visual/run.mjs` → 会话列表 0% / 首页 0.01% / 设置 2.1% / 聊天输入区 0%，全部 PASS'
const after = '`node tools/mobile-visual/run.mjs` → **7 屏全 PASS**：会话列表 0% / 首页 0.01% / 设置 0% / 聊天输入区 0% / **外观页 0% / 产物页 0% / 模型页 0%**'

text = text.replace(before, after)
writeFileSync(P, text)
console.log('更新成功:', text.includes('7 屏全 PASS'))
