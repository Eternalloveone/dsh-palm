import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const VIEWS = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'list')
const cssPath = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'styles', '150-session-list.css')

/* ── 1) 行右侧彩色状态胶囊（片 A-1）─────────────────────────────────── */
const rosterPath = join(VIEWS, 'session-list-roster.tsx')
let roster = readFileSync(rosterPath, 'utf8')

roster = roster.replace(
  `                            {row.blank && <span className="sess-status">新</span>}
                            {row.running && <span className="sess-status">进行中</span>}
                            {row.error !== undefined && <span className="sess-status" title={row.error}>出错</span>}`,
  [
    '                            {row.blank && <span className="sess-status sess-status-info">新</span>}',
    '                            {row.running && <span className="sess-status sess-status-ok">进行中</span>}',
    '                            {row.pending === true && <span className="sess-status sess-status-warn">待确认</span>}',
    '                            {row.error !== undefined && <span className="sess-status sess-status-danger" title={row.error}>出错</span>}',
  ].join('\r\n'),
)

/* 分组标题带计数：今天 · 3 */
roster = roster.replace(
  '<div className="mobile-groupTitle">{group.bucket}</div>',
  '<div className="mobile-groupTitle">{group.bucket}<span className="mobile-groupCount"> · {group.rows.length}</span></div>',
)

writeFileSync(rosterPath, roster)

/* ── 2) 筛选胶囊带计数（片 A-2）────────────────────────────────────── */
const partsPath = join(VIEWS, 'session-list-parts.tsx')
let parts = readFileSync(partsPath, 'utf8')

if (!parts.includes('counts')) {
  parts = parts.replace(
    `export interface SessionListFiltersProps {
  folderFilter: string
  folders: SessionFoldersView | undefined
  onSelect(folderId: string): void
}`,
    `export interface SessionListFiltersProps {
  folderFilter: string
  folders: SessionFoldersView | undefined
  onSelect(folderId: string): void
  /** 每个筛选键下的会话条数（定版图：「全部 40 / 进行中 1」）。缺省就不显示数字。 */
  counts?: Readonly<Record<string, number>> | undefined
}`,
  )
  parts = parts.replace(
    'export function SessionListFilters({ folderFilter, folders, onSelect }: SessionListFiltersProps) {',
    'export function SessionListFilters({ folderFilter, folders, onSelect, counts }: SessionListFiltersProps) {',
  )
  parts = parts.replace(
    `            {entry.label}
          </Button>`,
    `            {entry.label}
            {counts?.[entry.id] === undefined ? null : (
              <span className="sess-chipCount">{counts[entry.id]}</span>
            )}
          </Button>`,
  )
  writeFileSync(partsPath, parts)
}

/* ── 3) 样式：胶囊三色 + 计数 ────────────────────────────────────────── */
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

console.log(JSON.stringify({
  状态胶囊: roster.includes('sess-status-ok'),
  分组计数: roster.includes('mobile-groupCount'),
  筛选计数: parts.includes('sess-chipCount'),
  样式: css.includes('.sess-status-ok'),
}))
