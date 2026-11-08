import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const TSX = join(PKG, 'src', 'mobile', 'message-row', 'process.tsx')
const CSS = join(PKG, 'src', 'mobile', 'styles', '190-disclosures.css')

/* 1) 把 outcome 落到 DOM：过程标题行带 data-state，CSS 按状态上色 */
let tsx = readFileSync(TSX, 'utf8')
if (!tsx.includes('data-state={outcome}')) {
  tsx = tsx.replace(
    '<div className="chat-proc-head chat-proc-head-static" role="status" aria-label={headLabel}>',
    '<div\n        className="chat-proc-head chat-proc-head-static"\n        role="status"\n        aria-label={headLabel}\n        data-state={outcome}\n      >',
  )
  writeFileSync(TSX, tsx)
}

/* 2) 三态色条：成功绿、失败红、运行中蓝；跳过/中止保持中性 */
let css = readFileSync(CSS, 'utf8')
if (!css.includes("chat-proc-head[data-state='ok']")) {
  css = css.trimEnd() + `

/* ── 过程行三态色条（定版图：绿=成功 / 红=失败 / 蓝=运行中）──────── */
.chat-proc-head[data-state='ok'] {
  border-left: 2px solid var(--palm-ok);
}

.chat-proc-head[data-state='failed'] {
  border-left: 2px solid var(--palm-danger);
}

.chat-proc-head[data-state='running'] {
  border-left: 2px solid var(--palm-accent);
}

.chat-proc-head[data-state='ok'],
.chat-proc-head[data-state='failed'],
.chat-proc-head[data-state='running'] {
  padding-left: var(--palm-s2);
}
`
  writeFileSync(CSS, css)
}

console.log(JSON.stringify({
  组件: readFileSync(TSX, 'utf8').includes('data-state={outcome}'),
  样式: readFileSync(CSS, 'utf8').includes("data-state='failed'"),
}))
