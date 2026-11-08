import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')

/* App.tsx：补 sendCommand 导入 */
const A = join(PKG, 'src', 'mobile', 'views', 'App.tsx')
let app = readFileSync(A, 'utf8')
if (!/import \{[^}]*\bsendCommand\b/.test(app)) {
  const match = /import \{([\s\S]*?)\} from '\.\.\/data\/session\.ts'/.exec(app)
  if (match !== null) {
    app = app.replace(match[0], `import {${match[1].replace(/\s*$/, '')}\n  sendCommand,\n} from '../data/session.ts'`)
  } else {
    app = app.replace(
      "import { ApprovalModeView } from './ApprovalModeView.tsx'",
      `import { ApprovalModeView } from './ApprovalModeView.tsx'\nimport { sendCommand } from '../data/session.ts'`,
    )
  }
}
writeFileSync(A, app)

/* 测试等价性表 */
const T = join(PKG, 'src', 'mobile', 'views', 'App.page-stack.test.ts')
let text = readFileSync(T, 'utf8')
const eol = text.includes('\r\n') ? '\r\n' : '\n'
const anchorA = "  context: { kind: 'chat', session, workspace },"
if (!text.includes("'approval-mode': {")) {
  text = text.replace(anchorA, anchorA + eol + "  'approval-mode': { kind: 'chat', session, workspace },")
}
const anchorB = "  { kind: 'context', session, workspace, usage: {} },"
if (!text.includes("kind: 'approval-mode'")) {
  text = text.replace(
    anchorB,
    anchorB + eol + "  { kind: 'approval-mode', session, workspace, permissions: { currentValue: 'ask', options: [] } },",
  )
}
writeFileSync(T, text)

console.log('sendCommand:', /import \{[^}]*sendCommand/.test(app), '| fixture:', text.includes("'approval-mode': {"))
