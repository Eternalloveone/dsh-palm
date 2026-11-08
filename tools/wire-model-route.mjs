import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const APP = join(PKG, 'src', 'mobile', 'views', 'App.tsx')
let app = readFileSync(APP, 'utf8')
const eol = app.includes('\r\n') ? '\r\n' : '\n'

if (!app.includes("kind: 'model'")) {
  app = app.replace(
    `  /** ⑩ 单文件 diff：从对话里的文件行点进来，返回即弹栈回对话。 */`,
    [
      `  /** ⑤ 模型与思考：从对话底部 chipline 点进来，返回即弹栈回对话。 */`,
      `  | {`,
      `    kind: 'model'`,
      `    session: SessionView`,
      `    workspace: WorkspaceRow`,
      `  }`,
      `  /** ⑩ 单文件 diff：从对话里的文件行点进来，返回即弹栈回对话。 */`,
    ].join(eol),
  )
}

app = app.replace(
  "  if (route.kind === 'diff') return `diff:${route.session.sessionId}:${route.path}`",
  `  if (route.kind === 'diff') return \`diff:\${route.session.sessionId}:\${route.path}\`${eol}  if (route.kind === 'model') return \`model:\${route.session.sessionId}\``,
)

app = app.replace('approval: 3, diff: 3,', 'approval: 3, diff: 3, model: 3,')

app = app.replace(
  /    case 'diff':/,
  `    case 'model':${eol}      // 兜底（栈里只有它）：模型选择属于某个会话，退回对话。${eol}      return { kind: 'chat', session: route.session, workspace: route.workspace }${eol}    case 'diff':`,
)

app = app.replace(
  `          : route.kind === 'diff'`,
  [
    `          : route.kind === 'model'`,
    `            ? <ModelView`,
    `              sessionId={route.session.sessionId}`,
    `              onBack={back}`,
    `            />`,
    `            : route.kind === 'diff'`,
  ].join(eol),
)

if (!app.includes("from './ModelView.tsx'")) {
  app = app.replace(
    "import { DiffView } from './DiffView.tsx'",
    `import { DiffView } from './DiffView.tsx'${eol}import { ModelView } from './ModelView.tsx'`,
  )
}

writeFileSync(APP, app)
console.log('route:', app.includes("kind: 'model'"), '| render:', app.includes('<ModelView'), '| import:', app.includes("ModelView.tsx'"))
