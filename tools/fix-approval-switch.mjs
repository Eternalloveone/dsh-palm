import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const eol = '\r\n'

// 1) 等价性测试：PUSHED_FROM 与 SAMPLES 都要覆盖 approval
const S = join(PKG, 'src', 'mobile', 'views', 'App.page-stack.test.ts')
let s = readFileSync(S, 'utf8')
if (!s.includes("  approval: {")) {
  s = s.replace(
    `  'sub-chat': { kind: 'run-overview' },`,
    `  'sub-chat': { kind: 'run-overview' },${eol}  // 审批详情是"会话内的一层"：上一页就是那个对话`,
  )
  s = s.replace(
    `  'sub-chat': { kind: 'run-overview' },` + eol,
    `  'sub-chat': { kind: 'run-overview' },` + eol + `  approval: { kind: 'chat', session, workspace },` + eol,
  )
}
if (!s.includes("kind: 'approval'")) {
  s = s.replace(
    `  { kind: 'sub-chat', sessionId: 'c-1' },`,
    `  { kind: 'sub-chat', sessionId: 'c-1' },${eol}  { kind: 'approval', session, workspace, approval: approvalRow },`,
  )
  s = s.replace(
    `const session = { sessionId: 's-1' } as never`,
    `const session = { sessionId: 's-1' } as never${eol}const approvalRow = { approvalId: 'ap-1', callId: 'c-1', tool: 'write_file', risk: 'write' } as never`,
  )
}
writeFileSync(S, s)

// 2) backTargetOf：approval 分支插在了 sessions 的 return 之前，导致 switch 没闭合
const APP = join(PKG, 'src', 'mobile', 'views', 'App.tsx')
let app = readFileSync(APP, 'utf8')
const bad = `    case 'sessions':${eol}      return { kind: 'workspaces' }${eol}    case 'approval':`
if (app.includes(bad)) {
  app = app.replace(
    bad,
    `    case 'sessions':${eol}      return { kind: 'workspaces' }${eol}`,
  )
  // 把 approval 分支挪到 workspaces 之前
  app = app.replace(
    `    case 'workspaces':`,
    `    case 'approval':${eol}      // 兜底（栈里只有它）：审批属于某个会话，退回对话。${eol}      return { kind: 'chat', session: route.session, workspace: route.workspace }${eol}    case 'workspaces':`,
  )
  // 清掉重复的那份（原插入点残留）
  const dup = `    case 'approval':${eol}      // 兜底（栈里只有它）：审批一定属于某个会话，退回对话。${eol}      return { kind: 'chat', session: route.session, workspace: route.workspace }${eol}`
  const idxFirst = app.indexOf(dup)
  const idxSecond = app.indexOf(dup, idxFirst + 1)
  if (idxFirst >= 0 && idxSecond > idxFirst) {
    app = app.slice(0, idxSecond) + app.slice(idxSecond + dup.length)
  }
}
writeFileSync(APP, app)
console.log('app 分支数:', (app.match(/case 'approval'/g) ?? []).length)
