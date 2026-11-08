import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const EMPTY = join(PKG, 'src', 'mobile', 'ui', 'empty-state.tsx')
const ERROR = join(PKG, 'src', 'mobile', 'ui', 'error-note.tsx')

/* EmptyState：加可选图标槽位（定版图：空态是「图标 + 标题 + 主按钮」） */
let empty = readFileSync(EMPTY, 'utf8')
empty = empty.replace(
  '  /** 可选动作：真的能点的一步（没动作就别给按钮）。 */\n  action?: ReactNode',
  '  /** 可选动作：真的能点的一步（没动作就别给按钮）。 */\n  action?: ReactNode\n  /** 可选图标：16px 线性 SVG，给空态一个视觉锚点。 */\n  icon?: ReactNode',
)
empty = empty.replace(
  'export function EmptyState({ title, hint, action }: EmptyStateProps) {',
  'export function EmptyState({ title, hint, action, icon }: EmptyStateProps) {',
)
empty = empty.replace(
  '    <div className="empty-state" role="status">\n      <p className="empty-state-title">{title}</p>',
  '    <div className="empty-state" role="status">\n      {icon === undefined ? null : <span className="empty-state-icon" aria-hidden>{icon}</span>}\n      <p className="empty-state-title">{title}</p>',
)
writeFileSync(EMPTY, empty)

/* ErrorNote：同样加图标槽位 */
let error = readFileSync(ERROR, 'utf8')
if (!error.includes('icon?: ReactNode')) {
  error = error.replace(
    /(\n\s*action\?: ReactNode)/,
    '$1\n  /** 可选图标：16px 线性 SVG。 */\n  icon?: ReactNode',
  )
  error = error.replace(
    /export function ErrorNote\(\{([^}]+)\}: ErrorNoteProps\)/,
    (m, props) => `export function ErrorNote({${props.trimEnd()}, icon }: ErrorNoteProps)`,
  )
  error = error.replace(
    /(<div className="error-note"[^>]*>)/,
    '$1\n      {icon === undefined ? null : <span className="error-note-icon" aria-hidden>{icon}</span>}',
  )
  writeFileSync(ERROR, error)
}

console.log(JSON.stringify({
  空态图标: readFileSync(EMPTY, 'utf8').includes('empty-state-icon'),
  错误图标: readFileSync(ERROR, 'utf8').includes('error-note-icon'),
}))
