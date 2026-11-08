import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'App.page-stack.test.ts')
let text = readFileSync(P, 'utf8')
const eol = text.includes('\r\n') ? '\r\n' : '\n'

if (!text.includes('  model: {')) {
  text = text.replace(
    `  diff: { kind: 'chat', session, workspace },`,
    `  diff: { kind: 'chat', session, workspace },${eol}  model: { kind: 'chat', session, workspace },`,
  )
}
if (!text.includes("kind: 'model'")) {
  text = text.replace(
    `  { kind: 'diff', session, workspace, path: 'src/a.ts' },`,
    `  { kind: 'diff', session, workspace, path: 'src/a.ts' },${eol}  { kind: 'model', session, workspace },`,
  )
}
writeFileSync(P, text)
console.log('model 已加入等价性表:', text.includes('  model: {') && text.includes("kind: 'model'"))
