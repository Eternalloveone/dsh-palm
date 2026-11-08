import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const APP = join(PKG, 'src', 'mobile', 'views', 'App.tsx')
let app = readFileSync(APP, 'utf8')
const eol = app.includes('\r\n') ? '\r\n' : '\n'

// 1) Route
if (!app.includes("kind: 'diff'")) {
  app = app.replace(
    `  /** ④ 审批详情：从对话正文的审批面板点"详情"进来，返回即弹栈回对话。 */`,
    [
      `  /** ⑩ 单文件 diff：从对话里的文件行点进来，返回即弹栈回对话。 */`,
      `  | {`,
      `    kind: 'diff'`,
      `    session: SessionView`,
      `    workspace: WorkspaceRow`,
      `    path: string`,
      `  }`,
      `  /** ④ 审批详情：从对话正文的审批面板点"详情"进来，返回即弹栈回对话。 */`,
    ].join(eol),
  )
}

// 2) routeKeyOf
app = app.replace(
  "  if (route.kind === 'approval') return `approval:${route.approval.approvalId}`",
  `  if (route.kind === 'approval') return \`approval:\${route.approval.approvalId}\`${eol}  if (route.kind === 'diff') return \`diff:\${route.session.sessionId}:\${route.path}\``,
)

// 3) 深度
app = app.replace("approval: 3,", "approval: 3, diff: 3,")

// 4) backTargetOf 兜底
app = app.replace(
  /    case 'approval':/,
  `    case 'diff':${eol}      // 兜底（栈里只有它）：diff 属于某个会话，退回对话。${eol}      return { kind: 'chat', session: route.session, workspace: route.workspace }${eol}    case 'approval':`,
)

// 5) 渲染
app = app.replace(
  `          : route.kind === 'approval'`,
  [
    `          : route.kind === 'diff'`,
    `            ? <DiffView`,
    `              path={route.path}`,
    `              sessionId={route.session.sessionId}`,
    `              onBack={back}`,
    `            />`,
    `            : route.kind === 'approval'`,
  ].join(eol),
)

// 6) import
if (!app.includes("from './DiffView.tsx'")) {
  app = app.replace(
    "import { ApprovalView } from './ApprovalView.tsx'",
    `import { ApprovalView } from './ApprovalView.tsx'${eol}import { DiffView } from './DiffView.tsx'`,
  )
}

writeFileSync(APP, app)
console.log('route:', app.includes("kind: 'diff'"), '| render:', app.includes('<DiffView'), '| import:', app.includes("DiffView.tsx'"))
