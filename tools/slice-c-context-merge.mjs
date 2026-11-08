import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const STYLES = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'styles')
const MINE = join(STYLES, '480-context-page.css')
const TARGET = join(STYLES, '500-context-page.css')

// 我把新样式写进了一个新建的 480 文件，但样式区块表是有序固定清单（freshness 测试会拦）。
// 正确做法：并进已有上下文页区块，删掉新建文件。
const mine = readFileSync(MINE, 'utf8')
const target = readFileSync(TARGET, 'utf8')

const block = `

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
`

if (!target.includes('.context-page-figure')) {
  writeFileSync(TARGET, target.trimEnd() + block)
}
rmSync(MINE)

console.log(JSON.stringify({
  并回目标: readFileSync(TARGET, 'utf8').includes('.context-page-figure'),
  旧文件已删: !readFileSync(STYLES + '\\500-context-page.css', 'utf8').includes('480'),
  mineLength: mine.length,
}))
