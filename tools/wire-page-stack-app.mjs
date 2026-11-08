import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'App.tsx')
let text = readFileSync(P, 'utf8')
const eol = text.includes('\r\n') ? '\r\n' : '\n'

// 1) 导入页面栈内核
if (!text.includes('kernels/page-stack.ts')) {
  text = text.replace(
    /^(import .*from '\.\.\/kernels\/[^']+')\r?$/m,
    match => `${match}${eol}import { createPageStack, currentOf, popPage, pushPage } from '../kernels/page-stack.ts'`,
  )
}

// 2) routeRef 之后建 stackRef（同一个位置，紧跟着当前路由）
const anchor = '  routeRef.current = route'
if (!text.includes('stackRef')) {
  text = text.replace(
    anchor,
    `${anchor}${eol}  /** P6 页面栈：真实记录"我来过哪几页"，返回 = 弹栈（不再是猜）。 */${eol}  const stackRef = useRef(createPageStack(routeKeyOf(route), route))`,
  )
}

// 3) 路由 key 计算（同 key 视为同一页）
if (!text.includes('function routeKeyOf')) {
  const helper = [
    '/** 路由的稳定 key：同 key 视为"同一页"（用于页面栈去重）。 */',
    'function routeKeyOf(route: Route): string {',
    "  if (route.kind === 'chat') return `chat:${route.session.sessionId}`",
    "  if (route.kind === 'sub-chat') return `sub-chat:${route.sessionId}`",
    "  if (route.kind === 'sessions') return `sessions:${String(route.workspace.workspaceId)}`",
    "  if (route.kind === 'settings') return `settings:${String(route.workspace.workspaceId)}`",
    '  return route.kind',
    '}',
    '',
  ].join(eol)
  // 放在 Route 类型之后（STANDALONE_WORKSPACE 常量之前）
  const marker = '/** Placeholder workspace for standalone search hits'
  text = text.replace(marker, `${helper}${marker}`)
}

writeFileSync(P, text)
console.log('stackRef:', text.includes('stackRef'), '| routeKeyOf:', text.includes('function routeKeyOf'))
