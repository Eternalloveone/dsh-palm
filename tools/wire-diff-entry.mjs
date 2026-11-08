import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const eol = '\r\n'

// ChatView：点文件行时若给了 onOpenDiff 就走独立页，否则保持原浮层（老行为不变）
const C = join(PKG, 'src', 'mobile', 'views', 'ChatView.tsx')
let c = readFileSync(C, 'utf8')

if (!c.includes('onOpenDiff')) {
  c = c.replace(
    `  /** 打开「模型与思考」页（P6 ⑤ 屏）；不给就不显示入口。 */`,
    `  /** 打开单文件 diff 独立页（P6 ⑩ 屏）；不给就还走浮层预览。 */${eol}  onOpenDiff?: ((path: string) => void) | undefined${eol}  /** 打开「模型与思考」页（P6 ⑤ 屏）；不给就不显示入口。 */`,
  )
  c = c.replace(`  onOpenModel,${eol}}`, `  onOpenModel,${eol}  onOpenDiff,${eol}}`)
  c = c.replace(
    `onOpenFile={(path) => { setPreviewPath(path) }}`,
    `onOpenFile={(path) => { if (onOpenDiff === undefined) setPreviewPath(path); else onOpenDiff(path) }}`,
  )
  writeFileSync(C, c)
}

// App：把 onOpenDiff 接上 diff 路由
const A = join(PKG, 'src', 'mobile', 'views', 'App.tsx')
let a = readFileSync(A, 'utf8')
if (!a.includes('onOpenDiff=')) {
  a = a.replace(
    `            onOpenModel={() => { navigate({ kind: 'model', session: route.session, workspace: route.workspace }) }}`,
    `            onOpenModel={() => { navigate({ kind: 'model', session: route.session, workspace: route.workspace }) }}${eol}            onOpenDiff={(path) => { navigate({ kind: 'diff', session: route.session, workspace: route.workspace, path }) }}`,
  )
  writeFileSync(A, a)
}

console.log('chatview:', c.includes('onOpenDiff'), '| app:', a.includes('onOpenDiff='))
