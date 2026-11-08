import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CSS = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'styles', '490-artifacts-page.css')
let css = readFileSync(CSS, 'utf8')

if (css.includes('.artifacts-row-badge-deliverable')) {
  console.log('already')
} else {
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
  console.log('appended')
}
