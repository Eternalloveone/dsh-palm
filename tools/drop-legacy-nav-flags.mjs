import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const APP = join(PKG, 'src', 'mobile', 'views', 'App.tsx')
let app = readFileSync(APP, 'utf8')

// 1) backTargetOf 去掉 fromLocate 选项（页面栈已经能给出真实上一页）
app = app.replace(
  /export function backTargetOf\(route: Route, options: \{ fromLocate\?: boolean \} = \{\}\): Route \{/,
  'export function backTargetOf(route: Route): Route {',
)
app = app.replace(
  /\s*if \(options\.fromLocate === true\) \{\r?\n\s*\/\/ Reached from a workspace-search locate:[\s\S]*?return \{ kind: 'workspaces' \}\r?\n\s*\}\r?\n/,
  '\n',
)
// 2) fromRunOverview 分支（栈已记录来源，不再需要标记）
app = app.replace(
  /\s*if \(route\.fromRunOverview === true\) \{\r?\n\s*\/\/ Opened from the run-overview page:[\s\S]*?return \{ kind: 'run-overview' \}\r?\n\s*\}\r?\n/,
  '\n',
)
// 3) 路由字段本身也没有读者了
app = app.replace(
  /\s*\/\*\* Opened from the run-overview page: back returns there, not to a list\. \*\/\r?\n\s*fromRunOverview\?: boolean/,
  '',
)
app = app.replace(/\s*fromRunOverview: true,/, '')

writeFileSync(APP, app)
console.log('App.tsx 残留标记：', /fromRunOverview|fromLocate/.test(app) ? '仍有' : '已清空')
