import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const APP = join(PKG, 'src', 'mobile', 'views', 'App.tsx')
let app = readFileSync(APP, 'utf8')
const eol = app.includes('\r\n') ? '\r\n' : '\n'

if (!app.includes("kind: 'appearance'")) {
  app = app.replace(
    `  /** ⑤ 模型与思考：从对话底部 chipline 点进来，返回即弹栈回对话。 */`,
    [
      `  /** ⑭ 外观：设置页「外观」进去；返回即弹栈回设置。 */`,
      `  | {`,
      `    kind: 'appearance'`,
      `    workspace: WorkspaceRow`,
      `  }`,
      `  /** ⑤ 模型与思考：从对话底部 chipline 点进来，返回即弹栈回对话。 */`,
    ].join(eol),
  )
  app = app.replace(
    "  if (route.kind === 'model') return `model:${route.session.sessionId}`",
    `  if (route.kind === 'model') return \`model:\${route.session.sessionId}\`${eol}  if (route.kind === 'appearance') return 'appearance'`,
  )
  app = app.replace("approval: 3, diff: 3, model: 3,", "approval: 3, diff: 3, model: 3, appearance: 3,")
  app = app.replace(
    /    case 'model':/,
    `    case 'appearance':${eol}      // 兜底（栈里只有它）：外观属于设置，退回设置页。${eol}      return { kind: 'settings', workspace: route.workspace }${eol}    case 'model':`,
  )
  app = app.replace(
    `          : route.kind === 'model'`,
    [
      `          : route.kind === 'appearance'`,
      `            ? <AppearanceView onBack={back} />`,
      `            : route.kind === 'model'`,
    ].join(eol),
  )
  if (!app.includes("from './AppearanceView.tsx'")) {
    app = app.replace(
      "import { ModelView } from './ModelView.tsx'",
      `import { ModelView } from './ModelView.tsx'${eol}import { AppearanceView } from './AppearanceView.tsx'`,
    )
  }
  // 设置页进入外观
  app = app.replace(
    `        ? <SettingsView${eol}          onBack={back}`,
    `        ? <SettingsView${eol}          onBack={back}${eol}          onOpenAppearance={() => { navigate({ kind: 'appearance', workspace: route.workspace }) }}`,
  )
  writeFileSync(APP, app)
}

console.log('route:', app.includes("kind: 'appearance'"), '| render:', app.includes('<AppearanceView'), '| entry:', app.includes('onOpenAppearance='))
