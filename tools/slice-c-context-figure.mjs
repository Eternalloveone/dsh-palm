import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const VIEW = join(PKG, 'src', 'mobile', 'views', 'ContextView.tsx')
const CSS = join(PKG, 'src', 'mobile', 'styles', '480-context-page.css')

/* 1) 大号数字：已占用 token 提到 xl 档，放在进度条上方（定版图口径） */
let view = readFileSync(VIEW, 'utf8')
if (!view.includes('context-page-figure')) {
  view = view.replace(
    '                {ratio === undefined ? null : (',
    [
      '                {used === undefined ? null : (',
      '                  <p className="context-page-figure">',
      '                    <span className="context-page-figure-value">{formatTokens(used)}</span>',
      '                    <span className="context-page-figure-unit">已占用</span>',
      '                  </p>',
      '                )}',
      '                {ratio === undefined ? null : (',
    ].join('\r\n'),
  )
  writeFileSync(VIEW, view)
}

/* 2) 样式：大号数字 + 双色条（已用强调 / 剩余中性） */
let css = ''
try {
  css = readFileSync(CSS, 'utf8')
} catch {
  css = ''
}
if (!css.includes('.context-page-figure')) {
  appendFileSync(CSS === '' ? join(PKG, 'src', 'mobile', 'styles', '480-context-page.css') : CSS, `

/* ── 上下文页大号数字（定版图：数字是这页的主角）────────────────── */
.context-page-figure {
  margin: 0 0 var(--palm-s2);
  display: flex;
  align-items: baseline;
  gap: var(--palm-s2);
}

.context-page-figure-value {
  font-size: var(--palm-t-2xl);
  font-weight: var(--palm-w-bold);
  line-height: var(--palm-lh-head);
  color: var(--palm-fg);
  font-variant-numeric: tabular-nums;
}

.context-page-figure-unit {
  font-size: var(--palm-t-s);
  color: var(--palm-fg-3);
}

/* 双色条：已用段用强调色，剩余段用中性底色，一眼看出比例 */
.context-bar {
  position: relative;
  height: 8px;
  border-radius: var(--palm-r-full);
  background: var(--palm-sur-2);
  overflow: hidden;
}

.context-bar-fill {
  display: block;
  height: 100%;
  border-radius: var(--palm-r-full);
  background: var(--palm-accent);
}
`)
}

console.log(JSON.stringify({ 视图: readFileSync(VIEW, 'utf8').includes('context-page-figure') }))
