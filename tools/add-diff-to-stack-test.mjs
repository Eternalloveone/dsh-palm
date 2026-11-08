import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'App.page-stack.test.ts')
let text = readFileSync(P, 'utf8')
const eol = text.includes('\r\n') ? '\r\n' : '\n'

if (!text.includes("  diff: {")) {
  text = text.replace(
    `  approval: { kind: 'chat', session, workspace },`,
    `  approval: { kind: 'chat', session, workspace },${eol}  // diff 也是"会话内的一层"：上一页同样是那个对话${eol}  diff: { kind: 'chat', session, workspace },`,
  )
}

if (!text.includes("kind: 'diff'")) {
  text = text.replace(
    `  { kind: 'approval', session, workspace, approval: approvalRow },`,
    `  { kind: 'approval', session, workspace, approval: approvalRow },${eol}  { kind: 'diff', session, workspace, path: 'src/a.ts' },`,
  )
}

writeFileSync(P, text)
console.log('diff 已加入等价性表：', text.includes("diff: {") && text.includes("kind: 'diff'"))
