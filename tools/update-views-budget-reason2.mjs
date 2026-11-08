import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'tools', 'budget.json')
const text = readFileSync(P, 'utf8')

// budget.json 是 LF：别按 CRLF 拼 marker（上一次就是这么跳过的）
const pattern = /("src\/mobile\/views": \{\s*"reason": ")([^"]*)(")/
const match = pattern.exec(text)
if (match === null) {
  console.log('仍然没匹配到 views 段')
} else if (match[2].includes('entry-routing')) {
  console.log('已有 entry-routing 说明')
} else {
  const next = `${match[2]}；2026-11-08 追加 chat/state/entry-routing.ts（⑥⑦ 入口归属纯函数 + 5 条单测）：页面接通后仍走旧浮层的缺陷靠它钉住`
  writeFileSync(P, text.replace(pattern, `$1${next}$3`))
  console.log('reason 已补充')
}
