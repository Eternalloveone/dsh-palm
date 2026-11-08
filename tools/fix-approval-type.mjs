import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const APP = join(PKG, 'src', 'mobile', 'views', 'App.tsx')
let app = readFileSync(APP, 'utf8')
const eol = app.includes('\r\n') ? '\r\n' : '\n'

// 1) App 还没有 PendingApproval 的类型导入：从 ApprovalView 推导，避免视图层直连数据层
app = app.replace(
  `  /** ④ 审批详情：从对话正文的审批面板点"详情"进来，返回即弹栈回对话。 */`,
  [
    `  /** ④ 审批详情：从对话正文的审批面板点"详情"进来，返回即弹栈回对话。 */`,
  ].join(eol),
)
if (!app.includes("type ApprovalPayload")) {
  app = app.replace(
    `type Route =`,
    `/** 审批载荷类型：从视图组件的 props 推导（视图/路由层都不直接依赖数据层）。 */${eol}type ApprovalPayload = Parameters<typeof ApprovalView>[0]['approval']${eol}${eol}type Route =`,
  )
}
app = app.replace('    approval: PendingApproval', '    approval: ApprovalPayload')

writeFileSync(APP, app)

// 2) 页面栈等价性测试：补 approval 的"上一页"
const S = join(PKG, 'src', 'mobile', 'views', 'App.page-stack.test.ts')
let s = readFileSync(S, 'utf8')
if (!s.includes("approval:")) {
  s = s.replace(
    `  'sub-chat': { kind: 'run-overview' },`,
    `  'sub-chat': { kind: 'run-overview' },${eol}  // 审批详情是"会话内的一层"：上一页就是那个对话`,
  )
  s = s.replace(
    `const SAMPLES: Route[] = [`,
    `const SAMPLES: Route[] = [`,
  )
}
writeFileSync(S, s)
console.log('ApprovalPayload:', app.includes('type ApprovalPayload'))
