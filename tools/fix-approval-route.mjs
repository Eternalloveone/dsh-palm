import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const APP = join(PKG, 'src', 'mobile', 'views', 'App.tsx')
let app = readFileSync(APP, 'utf8')
const eol = app.includes('\r\n') ? '\r\n' : '\n'

// 1) ApprovalView 的 import（锚点换成一个确定存在的）
if (!app.includes("from './ApprovalView.tsx'")) {
  const anchor = "import { SettingsForm } from './SettingsForm.tsx'"
  if (app.includes(anchor)) {
    app = app.replace(anchor, `${anchor}${eol}import { ApprovalView } from './ApprovalView.tsx'`)
  } else {
    // 兜底：放在最后一个 import 之后
    const lines = app.split('\n')
    const last = lines.reduce((acc, line, i) => (line.startsWith('import ') ? i : acc), -1)
    lines.splice(last + 1, 0, `import { ApprovalView } from './ApprovalView.tsx'${eol}`)
    app = lines.join('\n')
  }
}

// 2) 页面深度：审批详情与对话同级（都是"会话内的一层"）
app = app.replace(
  "const ROUTE_DEPTH = { workspaces: 0, 'run-overview': 1, sessions: 1, settings: 2, chat: 2, 'sub-chat': 2 } as const",
  "const ROUTE_DEPTH = { workspaces: 0, 'run-overview': 1, sessions: 1, settings: 2, chat: 2, approval: 3, 'sub-chat': 2 } as const",
)

// 3) backTargetOf 兜底分支要覆盖 approval（栈里只有它时退回对话）
app = app.replace(
  /(\n\s*case 'sub-chat':\r?\n\s*\/\/ 只读子会话只有一个入口：运行中页。\r?\n\s*return \{ kind: 'run-overview' \})/,
  `${eol}    case 'approval':${eol}      // 兜底（栈里只有它）：审批一定属于某个会话，退回对话。${eol}      return { kind: 'chat', session: route.session, workspace: route.workspace }`,
)

writeFileSync(APP, app)
console.log('import:', app.includes("ApprovalView.tsx'"), '| depth:', app.includes('approval: 3'), '| back:', app.includes("case 'approval'"))
