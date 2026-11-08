import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const eol = '\r\n'

// 1) ChatHeader：加一个可选的「模型」入口（不给就不渲染）
const H = join(PKG, 'src', 'mobile', 'views', 'chat', 'components', 'chat-header.tsx')
let h = readFileSync(H, 'utf8')
if (!h.includes('onOpenModel')) {
  h = h.replace(
    `  onMore: () => void`,
    `  onMore: () => void${eol}  /** 打开「模型与思考」页（P6 ⑤ 屏）；不给就不渲染入口。 */${eol}  onOpenModel?: (() => void) | undefined`,
  )
  h = h.replace(
    `export function ChatHeader({ title, onBack, onToggleSearch, onMore }: ChatHeaderProps) {`,
    `export function ChatHeader({ title, onBack, onToggleSearch, onMore, onOpenModel }: ChatHeaderProps) {`,
  )
  // 插在「搜索本会话」按钮之前
  h = h.replace(
    `        <Button${eol}          type="button"${eol}          className="mobile-iconbtn"${eol}          aria-label="搜索本会话"`,
    `        {onOpenModel === undefined ? null : (${eol}          <Button${eol}            type="button"${eol}            className="mobile-iconbtn"${eol}            aria-label="模型与思考"${eol}            onClick={onOpenModel}${eol}          >${eol}            ⚙${eol}          </Button>${eol}        )}${eol}        <Button${eol}          type="button"${eol}          className="mobile-iconbtn"${eol}          aria-label="搜索本会话"`,
  )
  writeFileSync(H, h)
}

// 2) ChatView：可选 prop → 头部
const C = join(PKG, 'src', 'mobile', 'views', 'ChatView.tsx')
let c = readFileSync(C, 'utf8')
if (!c.includes('onOpenModel')) {
  c = c.replace(
    `  /** 打开审批详情独立页（P6 ④ 屏）；不给就不显示入口。 */`,
    `  /** 打开「模型与思考」页（P6 ⑤ 屏）；不给就不显示入口。 */${eol}  onOpenModel?: (() => void) | undefined${eol}  /** 打开审批详情独立页（P6 ④ 屏）；不给就不显示入口。 */`,
  )
  c = c.replace(
    `  onOpenApproval,${eol}}`,
    `  onOpenApproval,${eol}  onOpenModel,${eol}}`,
  )
  c = c.replace(`<ChatHeader`, `<ChatHeader${eol}        onOpenModel={onOpenModel}`)
  writeFileSync(C, c)
}

// 3) App：把回调接上
const A = join(PKG, 'src', 'mobile', 'views', 'App.tsx')
let a = readFileSync(A, 'utf8')
if (!a.includes('onOpenModel=')) {
  a = a.replace(
    `            onOpenApproval={(approval, preview, argsText) => {`,
    `            onOpenModel={() => { navigate({ kind: 'model', session: route.session, workspace: route.workspace }) }}${eol}            onOpenApproval={(approval, preview, argsText) => {`,
  )
  writeFileSync(A, a)
}

console.log('header:', h.includes('onOpenModel'), '| chatview:', c.includes('onOpenModel'), '| app:', a.includes('onOpenModel='))
