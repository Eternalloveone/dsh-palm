import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'tools', 'budget.json')
const text = readFileSync(P, 'utf8')

// 这次 views 上调是为了「入口归属」纯函数 + 单测（⑥⑦ 曾经接了回调却仍走浮层）。
// 把真实原因写进去，别让下一个人只看到数字变大。
const marker = '"src/mobile/views": {\r\n      "reason": "'
const start = text.indexOf(marker)
if (start === -1) {
  console.log('没有找到 views 的 raised 段，跳过')
} else {
  const reasonStart = start + marker.length
  const reasonEnd = text.indexOf('"', reasonStart)
  const reason = text.slice(reasonStart, reasonEnd)
  if (!reason.includes('entry-routing')) {
    const next = `${reason}；2026-11-08 追加 chat/state/entry-routing.ts（⑥⑦ 入口归属纯函数 + 5 条单测）：页面接通后仍走旧浮层的缺陷就靠它钉住`
    const updated = text.slice(0, reasonStart) + next + text.slice(reasonEnd)
    writeFileSync(P, updated)
    console.log('reason 已补充')
  } else {
    console.log('reason 已含 entry-routing')
  }
}
