import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const eol = '\r\n'

/* 1) ChatView：可选 onOpenContext */
const C = join(PKG, 'src', 'mobile', 'views', 'ChatView.tsx')
let c = readFileSync(C, 'utf8')
if (!c.includes('onOpenContext')) {
  c = c.replace(
    `  /** 打开产物列表页（P6 ⑧ 屏）；不给就不显示入口。 */`,
    `  /** 打开上下文占用页（P6 ⑦ 屏）；不给就还是原来的浮层。 */${eol}  onOpenContext?: ((usage: { contextWindow?: number; pressureTokens?: number; projectedTokens?: number }) => void) | undefined${eol}  /** 打开产物列表页（P6 ⑧ 屏）；不给就不显示入口。 */`,
  )
  c = c.replace(`  onOpenArtifacts,${eol}}`, `  onOpenArtifacts,${eol}  onOpenContext,${eol}}`)
  // 点占用环：给了回调就走页面，否则原浮层
  c = c.replace(
    `  const toggleContextPop = (): void => {
    if (contextUsage === undefined) return`,
    `  const toggleContextPop = (): void => {
    if (contextUsage === undefined) return${eol}    if (onOpenContext !== undefined) {${eol}      onOpenContext({${eol}        ...(contextPressure?.contextWindow === undefined ? {} : { contextWindow: contextPressure.contextWindow }),${eol}        ...(contextPressure?.pressureTokens === undefined ? {} : { pressureTokens: contextPressure.pressureTokens }),${eol}        ...(contextPressure?.projectedTokens === undefined ? {} : { projectedTokens: contextPressure.projectedTokens }),${eol}      })${eol}      return${eol}    }`,
  )
  writeFileSync(C, c)
}

/* 2) App：路由 + 渲染 + 入口 */
const A = join(PKG, 'src', 'mobile', 'views', 'App.tsx')
let app = readFileSync(A, 'utf8')
if (!app.includes("kind: 'context'")) {
  app = app.replace(
    `  /** ⑧ 产物列表：对话页「▤」进来，返回即弹栈回对话。 */`,
    [
      `  /** ⑦ 上下文占用：对话页点占用环进来，返回即弹栈回对话。 */`,
      `  | {`,
      `    kind: 'context'`,
      `    session: SessionView`,
      `    workspace: WorkspaceRow`,
      `    usage: { contextWindow?: number; pressureTokens?: number; projectedTokens?: number }`,
      `  }`,
      `  /** ⑧ 产物列表：对话页「▤」进来，返回即弹栈回对话。 */`,
    ].join(eol),
  )
  app = app.replace(
    "  if (route.kind === 'artifacts') return `artifacts:${route.session.sessionId}`",
    `  if (route.kind === 'artifacts') return \`artifacts:\${route.session.sessionId}\`${eol}  if (route.kind === 'context') return \`context:\${route.session.sessionId}\``,
  )
  app = app.replace('artifacts: 3,', 'artifacts: 3, context: 3,')
  app = app.replace(
    /    case 'artifacts':/,
    `    case 'context':${eol}      // 兜底（栈里只有它）：占用属于某个会话，退回对话。${eol}      return { kind: 'chat', session: route.session, workspace: route.workspace }${eol}    case 'artifacts':`,
  )
  app = app.replace(
    `          : route.kind === 'artifacts'`,
    [
      `          : route.kind === 'context'`,
      `            ? <ContextView`,
      `              {...route.usage}`,
      `              onBack={back}`,
      `            />`,
      `            : route.kind === 'artifacts'`,
    ].join(eol),
  )
  app = app.replace(
    "import { ArtifactsView } from './ArtifactsView.tsx'",
    `import { ArtifactsView } from './ArtifactsView.tsx'${eol}import { ContextView } from './ContextView.tsx'`,
  )
  app = app.replace(
    `            onOpenArtifacts={(turns) => { navigate({ kind: 'artifacts', session: route.session, workspace: route.workspace, turns }) }}`,
    `            onOpenArtifacts={(turns) => { navigate({ kind: 'artifacts', session: route.session, workspace: route.workspace, turns }) }}${eol}            onOpenContext={(usage) => { navigate({ kind: 'context', session: route.session, workspace: route.workspace, usage }) }}`,
  )
  writeFileSync(A, app)
}

console.log('chat:', c.includes('onOpenContext'), '| route:', app.includes("kind: 'context'"), '| render:', app.includes('<ContextView'), '| entry:', app.includes('onOpenContext='))
