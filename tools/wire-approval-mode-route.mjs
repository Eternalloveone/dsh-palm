import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const eol = '\r\n'

/* 1) ChatView：给了回调就把「批准方式」开成页面 */
const C = join(PKG, 'src', 'mobile', 'views', 'ChatView.tsx')
let c = readFileSync(C, 'utf8')
if (!c.includes('onOpenApprovalMode')) {
  c = c.replace(
    `  /** 打开上下文占用页（P6 ⑦ 屏）；不给就还是原来的浮层。 */`,
    `  /** 打开批准方式页（P6 ⑥ 屏）；不给就还是原来的选择器。 */${eol}  onOpenApprovalMode?: ((permissions: { currentValue: string; options: readonly { value: string; name: string; description?: string }[] }) => void) | undefined${eol}  /** 打开上下文占用页（P6 ⑦ 屏）；不给就还是原来的浮层。 */`,
  )
  c = c.replace(`  onOpenContext,${eol}}`, `  onOpenContext,${eol}  onOpenApprovalMode,${eol}}`)
  c = c.replace(
    `  const openPermissionPicker = (): void => {
    setContextOpen(false)`,
    `  const openPermissionPicker = (): void => {
    if (onOpenApprovalMode !== undefined && permissions !== undefined) {${eol}      setContextOpen(false)${eol}      onOpenApprovalMode(permissions)${eol}      return${eol}    }${eol}    setContextOpen(false)`,
  )
  writeFileSync(C, c)
}

/* 2) App：路由 + 渲染 + 入口 + 应用（走宿主斜杠命令） */
const A = join(PKG, 'src', 'mobile', 'views', 'App.tsx')
let app = readFileSync(A, 'utf8')
if (!app.includes("kind: 'approval-mode'")) {
  app = app.replace(
    `  /** ⑦ 上下文占用：对话页点占用环进来，返回即弹栈回对话。 */`,
    [
      `  /** ⑥ 批准方式：对话页权限芯片进来，返回即弹栈回对话。 */`,
      `  | {`,
      `    kind: 'approval-mode'`,
      `    session: SessionView`,
      `    workspace: WorkspaceRow`,
      `    permissions: { currentValue: string; options: readonly { value: string; name: string; description?: string }[] }`,
      `  }`,
      `  /** ⑦ 上下文占用：对话页点占用环进来，返回即弹栈回对话。 */`,
    ].join(eol),
  )
  app = app.replace(
    "  if (route.kind === 'context') return `context:${route.session.sessionId}`",
    `  if (route.kind === 'context') return \`context:\${route.session.sessionId}\`${eol}  if (route.kind === 'approval-mode') return \`approval-mode:\${route.session.sessionId}\``,
  )
  app = app.replace('context: 3,', 'context: 3, \'approval-mode\': 3,')
  app = app.replace(
    /    case 'context':/,
    `    case 'approval-mode':${eol}      // 兜底（栈里只有它）：批准方式属于会话，退回对话。${eol}      return { kind: 'chat', session: route.session, workspace: route.workspace }${eol}    case 'context':`,
  )
  app = app.replace(
    `          : route.kind === 'context'`,
    [
      `          : route.kind === 'approval-mode'`,
      `            ? <ApprovalModeView`,
      `              currentValue={route.permissions.currentValue}`,
      `              options={route.permissions.options}`,
      `              onBack={back}`,
      `              onApply={(value) => {`,
      `                void sendCommand(route.session.sessionId, \`/permission \${value}\`).then(`,
      `                  (outcome) => { if (outcome.matched) back() },`,
      `                  () => {},`,
      `                )`,
      `              }}`,
      `            />`,
      `            : route.kind === 'context'`,
    ].join(eol),
  )
  app = app.replace(
    "import { ContextView } from './ContextView.tsx'",
    `import { ContextView } from './ContextView.tsx'${eol}import { ApprovalModeView } from './ApprovalModeView.tsx'`,
  )
  app = app.replace(
    `            onOpenContext={(usage) => { navigate({ kind: 'context', session: route.session, workspace: route.workspace, usage }) }}`,
    `            onOpenContext={(usage) => { navigate({ kind: 'context', session: route.session, workspace: route.workspace, usage }) }}${eol}            onOpenApprovalMode={(permissions) => { navigate({ kind: 'approval-mode', session: route.session, workspace: route.workspace, permissions }) }}`,
  )
  writeFileSync(A, app)
}

console.log('chat:', c.includes('onOpenApprovalMode'), '| route:', app.includes("kind: 'approval-mode'"), '| render:', app.includes('<ApprovalModeView'), '| entry:', app.includes('onOpenApprovalMode='))
