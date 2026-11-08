import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const STYLES = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'styles')

const emptyCss = join(STYLES, '055-empty-state.css')
let a = readFileSync(emptyCss, 'utf8')
if (!a.includes('.empty-state-icon')) {
  appendFileSync(emptyCss, `

/* 图标槽位（定版图：空态 = 图标 + 标题 + 主按钮） */
.empty-state-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin-bottom: var(--palm-s2);
  border-radius: var(--palm-r-full);
  background: var(--palm-sur-2);
  color: var(--palm-fg-2);
}

.empty-state-icon > svg {
  width: 16px;
  height: 16px;
}
`)
  a = readFileSync(emptyCss, 'utf8')
}

const errorCss = join(STYLES, '056-error-note.css')
let b = readFileSync(errorCss, 'utf8')
if (!b.includes('.error-note-icon')) {
  appendFileSync(errorCss, `

/* 失败态图标：和空态同一套 32/16 规格，保持节奏一致 */
.error-note-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 20px;
  height: 20px;
  color: var(--palm-danger);
}

.error-note-icon > svg {
  width: 16px;
  height: 16px;
}
`)
  b = readFileSync(errorCss, 'utf8')
}

console.log(JSON.stringify({ empty: a.includes('.empty-state-icon'), error: b.includes('.error-note-icon') }))
