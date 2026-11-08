import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')

// 1) App.test.tsx：backTargetOf 只剩"栈里没有事实"时的兜底，两个分支标志的断言改到栈上
const T = join(PKG, 'src', 'mobile', 'views', 'App.test.tsx')
let t = readFileSync(T, 'utf8')
const eol = t.includes('\r\n') ? '\r\n' : '\n'

t = t.replace(
  `  it('会话页的三个分支：搜索定位 / 从运行中进入 / 独立会话 / 普通进入', () => {${eol}` +
  `    expect(backTargetOf(route({ kind: 'chat', session: sessionRow, workspace: workspaceRow }), { fromLocate: true }))${eol}` +
  `      .toEqual({ kind: 'workspaces' })${eol}` +
  `    expect(backTargetOf(route({ kind: 'chat', session: sessionRow, workspace: workspaceRow, fromRunOverview: true })))${eol}` +
  `      .toEqual({ kind: 'run-overview' })${eol}`,
  `  it('会话页的兜底分支：独立会话 / 普通进入（搜索定位与运行中进入已由页面栈覆盖）', () => {${eol}`,
)

writeFileSync(T, t)

// 2) App.page-stack.test.ts：路由类型里已经没有 fromRunOverview 了
const S = join(PKG, 'src', 'mobile', 'views', 'App.page-stack.test.ts')
let s = readFileSync(S, 'utf8')
s = s.replace(/, fromRunOverview: true \}/, ' }')
writeFileSync(S, s)

console.log('测试已对齐：', !t.includes('fromLocate: true'), !s.includes('fromRunOverview'))
