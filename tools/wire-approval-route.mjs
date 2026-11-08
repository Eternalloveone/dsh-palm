import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const APP = join(PKG, 'src', 'mobile', 'views', 'App.tsx')
let app = readFileSync(APP, 'utf8')
const eol = app.includes('\r\n') ? '\r\n' : '\n'

// 1) Route 增加审批详情（独立页面）
app = app.replace(
  `  /** 子代理自己的会话（只读）：从"运行中"页的子代理行点进来。 */`,
  [
    `  /** ④ 审批详情：从对话正文的审批面板点"详情"进来，返回即弹栈回对话。 */`,
    `  | {`,
    `    kind: 'approval'`,
    `    session: SessionView`,
    `    workspace: WorkspaceRow`,
    `    approval: PendingApproval`,
    `    preview?: string`,
    `    argsText?: string`,
    `  }`,
    `  /** 子代理自己的会话（只读）：从"运行中"页的子代理行点进来。 */`,
  ].join(eol),
)

// 2) routeKeyOf
app = app.replace(
  "  if (route.kind === 'sub-chat') return `sub-chat:${route.sessionId}`",
  `  if (route.kind === 'sub-chat') return \`sub-chat:\${route.sessionId}\`${eol}  if (route.kind === 'approval') return \`approval:\${route.approval.approvalId}\``,
)

// 3) 渲染：插在 sub-chat 分支之后、chat 兜底之前
app = app.replace(
  `          : <ChatView`,
  [
    `          : route.kind === 'approval'`,
    `            ? <ApprovalView`,
    `              sessionId={route.session.sessionId}`,
    `              sessionTitle={route.session.title}`,
    `              approval={route.approval}`,
    `              {...(route.preview === undefined ? {} : { preview: route.preview })}`,
    `              {...(route.argsText === undefined ? {} : { argsText: route.argsText })}`,
    `              onBack={back}`,
    `              onResolved={() => { back() }}`,
    `            />`,
    `            : <ChatView`,
  ].join(eol),
)

// 4) ChatView 拿到"打开审批详情"的回调
app = app.replace(
  `            onDismissFinished={() => { setChatFinished(undefined) }}
          />`,
  [
    `            onDismissFinished={() => { setChatFinished(undefined) }}`,
    `            onOpenApproval={(approval, preview, argsText) => {`,
    `              navigate({`,
    `                kind: 'approval',`,
    `                session: route.session,`,
    `                workspace: route.workspace,`,
    `                approval,`,
    `                ...(preview === undefined ? {} : { preview }),`,
    `                ...(argsText === undefined ? {} : { argsText }),`,
    `              })`,
    `            }}`,
    `          />`,
  ].join(eol),
)

// 5) 懒加载视图表里补 ApprovalView（与其它页面同样走 warm）
if (!app.includes("import { ApprovalView }")) {
  app = app.replace(
    /^import \{ SettingsView \} from '\.\/SettingsView\.tsx'\r?$/m,
    match => `${match}${eol}import { ApprovalView } from './ApprovalView.tsx'`,
  )
}

writeFileSync(APP, app)
console.log('route:', app.includes("kind: 'approval'"), '| render:', app.includes('<ApprovalView'), '| entry:', app.includes('onOpenApproval'))
