import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const eol = '\r\n'

/* 1) ChatHeader：加「产物」入口 */
const H = join(PKG, 'src', 'mobile', 'views', 'chat', 'components', 'chat-header.tsx')
let h = readFileSync(H, 'utf8')
if (!h.includes('onOpenArtifacts')) {
  h = h.replace(
    `  onMore: () => void`,
    `  onMore: () => void${eol}  /** 打开产物列表页（P6 ⑧ 屏）；不给就不渲染入口。 */${eol}  onOpenArtifacts?: (() => void) | undefined`,
  )
  h = h.replace(
    'export function ChatHeader({ title, onBack, onToggleSearch, onMore, onOpenModel }: ChatHeaderProps) {',
    'export function ChatHeader({ title, onBack, onToggleSearch, onMore, onOpenModel, onOpenArtifacts }: ChatHeaderProps) {',
  )
  h = h.replace(
    `        {onOpenModel === undefined ? null : (`,
    `        {onOpenArtifacts === undefined ? null : (${eol}          <Button${eol}            type="button"${eol}            className="mobile-iconbtn"${eol}            aria-label="产物"${eol}            onClick={onOpenArtifacts}${eol}          >${eol}            ▤${eol}          </Button>${eol}        )}${eol}        {onOpenModel === undefined ? null : (`,
  )
  writeFileSync(H, h)
}

/* 2) ChatView：可选回调用当前消息算出产物 */
const C = join(PKG, 'src', 'mobile', 'views', 'ChatView.tsx')
let c = readFileSync(C, 'utf8')
if (!c.includes('onOpenArtifacts')) {
  c = c.replace(
    `  /** 打开回合大纲独立页（P6 ⑫ 屏）；不给就还开浮层。 */`,
    `  /** 打开产物列表页（P6 ⑧ 屏）；不给就不显示入口。 */${eol}  onOpenArtifacts?: ((turns: readonly ArtifactTurn[]) => void) | undefined${eol}  /** 打开回合大纲独立页（P6 ⑫ 屏）；不给就还开浮层。 */`,
  )
  c = c.replace(`  onOpenOutline,${eol}}`, `  onOpenOutline,${eol}  onOpenArtifacts,${eol}}`)
  c = c.replace(
    /import \{ mergeTurnEntries, parseTurnOutline, localTurnEntries, readingTurnAt, scrubTurnIndex, seqRowIndex, turnPromptRowIndex, turnRowIndex, type TurnEntry \} from '\.\.\/session\/turn-outline\.ts'/,
    (match) => `${match}${eol}import { collectArtifacts, type ArtifactTurn } from '../session/artifacts.ts'`,
  )
  c = c.replace(
    `<ChatHeader${eol}        onOpenModel={onOpenModel}`,
    `<ChatHeader${eol}        onOpenArtifacts={onOpenArtifacts === undefined ? undefined : () => { onOpenArtifacts(collectArtifacts(messages)) }}${eol}        onOpenModel={onOpenModel}`,
  )
  writeFileSync(C, c)
}

/* 3) App：路由 + 渲染 + 入口 */
const A = join(PKG, 'src', 'mobile', 'views', 'App.tsx')
let app = readFileSync(A, 'utf8')
if (!app.includes("kind: 'artifacts'")) {
  app = app.replace(
    `  /** ⑫ 回合大纲：对话页「轮次」进来，返回即弹栈回对话。 */`,
    [
      `  /** ⑧ 产物列表：对话页「▤」进来，返回即弹栈回对话。 */`,
      `  | {`,
      `    kind: 'artifacts'`,
      `    session: SessionView`,
      `    workspace: WorkspaceRow`,
      `    turns: readonly ArtifactTurnPayload[]`,
      `  }`,
      `  /** ⑫ 回合大纲：对话页「轮次」进来，返回即弹栈回对话。 */`,
    ].join(eol),
  )
  app = app.replace(
    "  if (route.kind === 'outline') return `outline:${route.session.sessionId}`",
    `  if (route.kind === 'outline') return \`outline:\${route.session.sessionId}\`${eol}  if (route.kind === 'artifacts') return \`artifacts:\${route.session.sessionId}\``,
  )
  app = app.replace('outline: 3,', 'outline: 3, artifacts: 3,')
  app = app.replace(
    /    case 'outline':/,
    `    case 'artifacts':${eol}      // 兜底（栈里只有它）：产物属于某个会话，退回对话。${eol}      return { kind: 'chat', session: route.session, workspace: route.workspace }${eol}    case 'outline':`,
  )
  app = app.replace(
    `          : route.kind === 'outline'`,
    [
      `          : route.kind === 'artifacts'`,
      `            ? <ArtifactsView`,
      `              turns={route.turns}`,
      `              onBack={back}`,
      `              onOpenFile={(path) => { navigate({ kind: 'diff', session: route.session, workspace: route.workspace, path }) }}`,
      `            />`,
      `            : route.kind === 'outline'`,
    ].join(eol),
  )
  app = app.replace(
    "import { OutlineView } from './OutlineView.tsx'",
    `import { OutlineView } from './OutlineView.tsx'${eol}import { ArtifactsView } from './ArtifactsView.tsx'${eol}import type { ArtifactTurn as ArtifactTurnPayload } from '../session/artifacts.ts'`,
  )
  app = app.replace(
    `            onOpenOutline={(turns, currentTurn) => { navigate({ kind: 'outline', session: route.session, workspace: route.workspace, turns, currentTurn }) }}`,
    `            onOpenOutline={(turns, currentTurn) => { navigate({ kind: 'outline', session: route.session, workspace: route.workspace, turns, currentTurn }) }}${eol}            onOpenArtifacts={(turns) => { navigate({ kind: 'artifacts', session: route.session, workspace: route.workspace, turns }) }}`,
  )
  writeFileSync(A, app)
}

console.log('header:', h.includes('onOpenArtifacts'), '| chat:', c.includes('onOpenArtifacts'), '| route:', app.includes("kind: 'artifacts'"), '| entry:', app.includes('onOpenArtifacts='))
