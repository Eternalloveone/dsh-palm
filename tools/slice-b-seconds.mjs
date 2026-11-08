import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const TSX = join(PKG, 'src', 'mobile', 'ui', 'verdict-card.tsx')
const CSS = join(PKG, 'src', 'mobile', 'styles', '430-verdict-card.css')

let tsx = readFileSync(TSX, 'utf8')

// 秒数不再拼进字符串：单独一块放大渲染，其余脚注照旧（定版图把耗时当第二眼信息）
tsx = tsx.replace(
  '  if (footnote.seconds !== undefined) parts.push(`${footnote.seconds} 秒`)',
  '  // 秒数由 VerdictCard 单独渲染成大字，这里不再拼进脚注字符串',
)
tsx = tsx.replace(
  "{footnoteCaption === '' ? null : <span className=\"verdict-footnote\">{footnoteCaption}</span>}",
  [
    '{footnote?.seconds === undefined ? null : (',
    '        <span className="verdict-seconds">{footnote.seconds}s</span>',
    '      )}',
    "      {footnoteCaption === '' ? null : <span className=\"verdict-footnote\">{footnoteCaption}</span>}",
  ].join('\r\n'),
)
writeFileSync(TSX, tsx)

let css = readFileSync(CSS, 'utf8')
if (!css.includes('.verdict-seconds')) {
  css += `

/* 定版图：耗时（秒）是结论卡的第二眼信息，独立一行、xl 档。 */
.verdict-seconds {
  font-size: var(--palm-t-xl);
  font-weight: var(--palm-w-bold);
  line-height: var(--palm-lh-head);
  color: var(--palm-fg);
}
`
  writeFileSync(CSS, css)
}

console.log(JSON.stringify({
  组件: tsx.includes('verdict-seconds'),
  不再拼串: !tsx.includes('parts.push(`${footnote.seconds} 秒`)'),
  样式: css.includes('.verdict-seconds'),
}))
