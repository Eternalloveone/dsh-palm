import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const eol = '\r\n'

/* 1) 内核：把 forward 时长对齐 CSS 实际动画（260ms），成为唯一来源 */
const K = join(PKG, 'src', 'mobile', 'kernels', 'transition.ts')
let k = readFileSync(K, 'utf8')
k = k.replace('  forward: 220,\n  back: 200,\n  replace: 140,', '  forward: 260,\n  back: 260,\n  replace: 160,')
writeFileSync(K, k)

/* 2) App：用内核判定方向，常量从内核来（不再各写一份） */
const A = join(PKG, 'src', 'mobile', 'views', 'App.tsx')
let app = readFileSync(A, 'utf8')

app = app.replace(
  'const nextForward = ROUTE_DEPTH[next.kind] >= ROUTE_DEPTH[previous.current.route.kind]',
  'const nextForward = transitionOf(ROUTE_DEPTH[previous.current.route.kind], ROUTE_DEPTH[next.kind]) !== \'back\'',
)

app = app.replace(
  '/** How long the parallax transition runs (matches the CSS animation). */\r\nconst PAGE_TRANSITION_MS = 260',
  "/** How long the parallax transition runs (matches the CSS animation; 时长只有内核一份)。 */\r\nconst PAGE_TRANSITION_MS = TRANSITION_MS.forward",
)

if (!app.includes("from '../kernels/transition.ts'")) {
  app = app.replace(
    "import { createPageStack, currentOf, popPage, pushPage } from '../kernels/page-stack.ts'",
    `import { createPageStack, currentOf, popPage, pushPage } from '../kernels/page-stack.ts'${eol}import { transitionOf, TRANSITION_MS } from '../kernels/transition.ts'`,
  )
}

writeFileSync(A, app)

console.log('kernel 260:', k.includes('forward: 260'), '| app uses kernel:', app.includes('transitionOf(ROUTE_DEPTH'), '| const from kernel:', app.includes('TRANSITION_MS.forward'))
