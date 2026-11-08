import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'architecture.test.ts')
let text = readFileSync(P, 'utf8')
const eol = text.includes('\r\n') ? '\r\n' : '\n'

// 上一步的正则误伤了 App.tsx 那一行，变成孤零零的 `,`
const broken = `      // 2026-11-08：P3 接入 host-bridge（可选 bridge 属性 + 双路订阅回落）；回落分支删除后本值降回。${eol}      ,`
const fixed = `      // 2026-11-08：P3 接入 host-bridge（可选 bridge 属性 + 双路订阅回落）；回落分支删除后本值降回。${eol}      // 2026-11-08：P6 页面栈接入（压栈/弹栈 + routeKeyOf）；旧标记删除后回落。${eol}      'views/App.tsx': 1_286,`

if (!text.includes(broken)) {
  console.log('未找到损坏位置，请人工检查')
  process.exit(1)
}
text = text.replace(broken, fixed)
writeFileSync(P, text)
console.log('App.tsx 预算行已修复')
