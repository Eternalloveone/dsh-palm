import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const eol = '\r\n'

// 1) ChatView：可选 onOpenOutline，给了就走独立页
const C = join(PKG, 'src', 'mobile', 'views', 'ChatView.tsx')
let c = readFileSync(C, 'utf8')
if (!c.includes('onOpenOutline')) {
  c = c.replace(
    `  /** 打开单文件 diff 独立页（P6 ⑩ 屏）；不给就还走浮层预览。 */`,
    `  /** 打开回合大纲独立页（P6 ⑫ 屏）；不给就还开浮层。 */${eol}  onOpenOutline?: ((entries: readonly TurnEntry[], currentTurn: number) => void) | undefined${eol}  /** 打开单文件 diff 独立页（P6 ⑩ 屏）；不给就还走浮层预览。 */`,
  )
  c = c.replace(`  onOpenDiff,${eol}}`, `  onOpenDiff,${eol}  onOpenOutline,${eol}}`)
  c = c.replace(
    `onOpenTurnList={() => { setTurnListOpen(true) }}`,
    `onOpenTurnList={() => { if (onOpenOutline === undefined) setTurnListOpen(true); else onOpenOutline(turnEntries, shownTurn) }}`,
  )
  writeFileSync(C, c)
}

// 2) App：路由 + 渲染 + 入口
const A = join(PKG, 'src', 'mobile', 'views', 'App.tsx')
let app = readFileSync(A, 'utf8')
if (!app.includes("kind: 'outline'")) {
  app = app.replace(
    `  /** ⑭ 外观：设置页「外观」进去；返回即弹栈回设置。 */`,
    [
      `  /** ⑫ 回合大纲：对话页「轮次」进来，返回即弹栈回对话。 */`,
      `  | {`,
      `    kind: 'outline'`,
      `    session: SessionView`,
      `    workspace: WorkspaceRow`,
      `    turns: readonly TurnOutlineEntry[]`,
      `    currentTurn: number`,
      `  }`,
      `  /** ⑭ 外观：设置页「外观」进去；返回即弹栈回设置。 */`,
    ].join(eol),
  )
  app = app.replace(
    "  if (route.kind === 'appearance') return 'appearance'",
    `  if (route.kind === 'appearance') return 'appearance'${eol}  if (route.kind === 'outline') return \`outline:\${route.session.sessionId}\``,
  )
  app = app.replace('appearance: 3,', 'appearance: 3, outline: 3,')
  app = app.replace(
    /    case 'appearance':/,
    `    case 'outline':${eol}      // 兜底（栈里只有它）：大纲属于某个会话，退回对话。${eol}      return { kind: 'chat', session: route.session, workspace: route.workspace }${eol}    case 'appearance':`,
  )
  app = app.replace(
    `          : route.kind === 'appearance'`,
    [
      `          : route.kind === 'outline'`,
      `            ? <OutlineView`,
      `              entries={route.turns}`,
      `              currentTurn={route.currentTurn}`,
      `              onBack={back}`,
      `              onPick={() => { back() }}`,
      `            />`,
      `            : route.kind === 'appearance'`,
    ].join(eol),
  )
  if (!app.includes("from './OutlineView.tsx'")) {
    app = app.replace(
      "import { AppearanceView } from './AppearanceView.tsx'",
      `import { AppearanceView } from './AppearanceView.tsx'${eol}import { OutlineView } from './OutlineView.tsx'${eol}import type { TurnEntry as TurnOutlineEntry } from '../session/turn-outline.ts'`,
    )
  }
  // 入口：对话页给回调
  app = app.replace(
    `            onOpenDiff={(path) => { navigate({ kind: 'diff', session: route.session, workspace: route.workspace, path }) }}`,
    `            onOpenDiff={(path) => { navigate({ kind: 'diff', session: route.session, workspace: route.workspace, path }) }}${eol}            onOpenOutline={(turns, currentTurn) => { navigate({ kind: 'outline', session: route.session, workspace: route.workspace, turns, currentTurn }) }}`,
  )
  writeFileSync(A, app)
}

console.log('chatview:', c.includes('onOpenOutline'), '| route:', app.includes("kind: 'outline'"), '| render:', app.includes('<OutlineView'), '| entry:', app.includes('onOpenOutline='))
