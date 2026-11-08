import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const CSS = join(PKG, 'src', 'mobile', 'styles', '430-verdict-card.css')
const TSX = join(PKG, 'src', 'mobile', 'ui', 'verdict-card.tsx')

/* ── 1) 左侧色条 → 顶部状态色带（定版图：卡片顶上 3px 一条）────────── */
let css = readFileSync(CSS, 'utf8')
css = css.replace(
  /\.verdict-card\[data-state='(conclusion|decision|working|failed)'\] \{ border-left: 3px solid var\(--palm-(ok|warn|accent|danger)\); \}/g,
  (_, state, color) => `.verdict-card[data-state='${state}'] { border-top: 3px solid var(--palm-${color}); }`,
)
// 卡片本体：去掉左边框的圆角断裂（top 色带要贴着圆角）
css = css.replace(
  '  border: 1px solid var(--palm-line);',
  '  border: 1px solid var(--palm-line);\n  border-top-width: 3px;',
)

/* ── 2) 大号耗时数字：脚注里的「N 秒」单独放大 ──────────────────────── */
if (!css.includes('.verdict-seconds')) {
  css += `

/* 定版图：耗时数字是这张卡片的「第二眼信息」，给到 xl 档而不是正文档。 */
.verdict-seconds {
  font-size: var(--palm-t-xl);
  font-weight: var(--palm-w-bold);
  line-height: var(--palm-lh-head);
  color: var(--palm-fg);
}
`
}

writeFileSync(CSS, css)

/* 组件：脚注里把秒数包一层（没有秒数时整段保持原样） */
let tsx = readFileSync(TSX, 'utf8')
if (!tsx.includes('verdict-seconds') && tsx.includes('footnote.seconds !== undefined')) {
  tsx = tsx.replace(
    '    if (footnote.seconds !== undefined) parts.push(`${footnote.seconds} 秒`)',
    '    if (footnote.seconds !== undefined) parts.push(`<span class="verdict-seconds">${footnote.seconds}s</span>`)',
  )
  writeFileSync(TSX, tsx)
}

console.log(JSON.stringify({
  顶部色带: css.includes("border-top: 3px solid var(--palm-ok)"),
  大号秒: css.includes('.verdict-seconds'),
  组件接入: tsx.includes('verdict-seconds'),
}))
