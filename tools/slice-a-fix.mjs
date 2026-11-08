import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const VIEWS = join(PKG, 'src', 'mobile', 'views', 'list')
const STYLES = join(PKG, 'src', 'mobile', 'styles')

/* 1) 接口补 counts（用正则吃 CRLF） */
const partsPath = join(VIEWS, 'session-list-parts.tsx')
let parts = readFileSync(partsPath, 'utf8')
if (!/counts\?:/.test(parts)) {
  parts = parts.replace(
    /(export interface SessionListFiltersProps \{[\s\S]*?onSelect\(folderId: string\): void)/,
    '$1\r\n  /** 每个筛选键下的会话条数（定版图：「全部 40 / 进行中 1」）。缺省就不显示数字。 */\r\n  counts?: Readonly<Record<string, number>> | undefined',
  )
  const hasDestructure = /export function SessionListFilters\(\{ folderFilter, folders, onSelect(, counts)? \}: SessionListFiltersProps\)/.test(parts)
  if (!hasDestructure || !parts.includes('onSelect, counts')) {
    parts = parts.replace(
      'export function SessionListFilters({ folderFilter, folders, onSelect }: SessionListFiltersProps) {',
      'export function SessionListFilters({ folderFilter, folders, onSelect, counts }: SessionListFiltersProps) {',
    )
  }
  writeFileSync(partsPath, parts)
}

/* 2) 找到定义 .sess-status 的样式文件 */
const target = readdirSync(STYLES)
  .filter(name => name.endsWith('.css'))
  .find(name => readFileSync(join(STYLES, name), 'utf8').includes('.sess-status'))

if (target === undefined) {
  console.log('没找到 .sess-status 所在样式文件')
} else {
  const cssPath = join(STYLES, target)
  let css = readFileSync(cssPath, 'utf8')
  if (!css.includes('.sess-status-ok')) {
    css += `

/* ── 会话行状态胶囊与计数（定版图：绿=进行中 / 琥珀=待确认 / 红=出错）── */
.sess-status {
  display: inline-flex;
  align-items: center;
  padding: 0 var(--palm-s2);
  height: 18px;
  border-radius: var(--palm-r-full);
  font-size: var(--palm-t-s);
  line-height: 1;
  background: var(--palm-sur-2);
  color: var(--palm-fg-2);
}

.sess-status-ok {
  background: color-mix(in srgb, var(--palm-ok) 18%, transparent);
  color: var(--palm-ok);
}

.sess-status-warn {
  background: color-mix(in srgb, var(--palm-warn) 18%, transparent);
  color: var(--palm-warn);
}

.sess-status-danger {
  background: color-mix(in srgb, var(--palm-danger) 18%, transparent);
  color: var(--palm-danger);
}

.sess-status-info {
  background: color-mix(in srgb, var(--palm-accent) 18%, transparent);
  color: var(--palm-accent);
}

.mobile-groupCount {
  color: var(--palm-fg-3);
  font-weight: var(--palm-w-normal);
}

.sess-chipCount {
  margin-left: var(--palm-s1);
  color: var(--palm-fg-3);
  font-size: var(--palm-t-s);
}
`
    writeFileSync(cssPath, css)
  }
  console.log(JSON.stringify({ counts: /counts\?:/.test(parts), css: target, applied: css.includes('.sess-status-ok') }))
}
