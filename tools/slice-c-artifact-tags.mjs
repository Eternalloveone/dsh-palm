import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const VIEW = join(PKG, 'src', 'mobile', 'views', 'ArtifactsView.tsx')
const CSS = join(PKG, 'src', 'mobile', 'styles', '510-artifacts-page.css')

/* 1) 两类文件各给一枚彩色标签（定版图：交付物/产物用颜色区分，不再只有一枚） */
let view = readFileSync(VIEW, 'utf8')
view = view.replace(
  `                      {file.kind === 'deliverable' ? (
                        <span className="artifacts-row-badge">交付物</span>
                      ) : null}`,
  [
    "                      {file.kind === 'deliverable' ? (",
    '                        <span className="artifacts-row-badge artifacts-row-badge-deliverable">交付物</span>',
    '                      ) : (',
    '                        <span className="artifacts-row-badge artifacts-row-badge-produced">产物</span>',
    '                      )}',
  ].join('\r\n'),
)
writeFileSync(VIEW, view)

/* 2) 样式：绿=交付物、蓝=产物（沿用语义色，18% 底 + 彩字） */
let css = ''
try {
  css = readFileSync(CSS, 'utf8')
} catch {
  console.log('CSS 文件不存在：' + CSS)
  process.exit(1)
}
if (!css.includes('.artifacts-row-badge-deliverable')) {
  css = css.trimEnd() + `

/* ── 产物标签配色（定版图：交付物绿 / 产物蓝）────────────────────── */
.artifacts-row-badge {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 var(--palm-s2);
  border-radius: var(--palm-r-full);
  font-size: var(--palm-t-s);
  line-height: 1;
}

.artifacts-row-badge-deliverable {
  background: color-mix(in srgb, var(--palm-ok) 18%, transparent);
  color: var(--palm-ok);
}

.artifacts-row-badge-produced {
  background: color-mix(in srgb, var(--palm-accent) 18%, transparent);
  color: var(--palm-accent);
}
`
  writeFileSync(CSS, css)
}

console.log(JSON.stringify({ 组件: view.includes('artifacts-row-badge-produced'), 样式: css.includes('badge-deliverable') }))
