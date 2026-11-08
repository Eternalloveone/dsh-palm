import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const VIEWS = join(PKG, 'src', 'mobile', 'views')
const ROSTER = join(VIEWS, 'list', 'session-list-roster.tsx')
const LIST = join(VIEWS, 'SessionListView.tsx')

/* 1) roster 接收 pendingIds，并渲染琥珀胶囊 */
let roster = readFileSync(ROSTER, 'utf8')
if (!roster.includes('pendingIds')) {
  roster = roster.replace(
    /export interface SessionListRosterProps \{/,
    'export interface SessionListRosterProps {\n  /** 正在等用户批准/回答的会话 id：行上会显示「待确认」胶囊。 */\n  pendingIds?: ReadonlySet<string> | undefined',
  )
  roster = roster.replace(
    /export function SessionListRoster\(\{([^}]*?)\}: SessionListRosterProps\)/,
    (m, props) => `export function SessionListRoster({${props.trimEnd()}, pendingIds }: SessionListRosterProps)`,
  )
  roster = roster.replace(
    '{row.running && <span className="sess-status sess-status-ok">进行中</span>}',
    '{row.running && <span className="sess-status sess-status-ok">进行中</span>}\r\n                            {pendingIds?.has(row.sessionId) === true && <span className="sess-status sess-status-warn">待确认</span>}',
  )
  writeFileSync(ROSTER, roster)
}

/* 2) 列表页把 pendingIds 传下去，并把它算进筛选计数 */
let list = readFileSync(LIST, 'utf8')
if (!list.includes('pendingIds={pendingIds}')) {
  list = list.replace(
    '      <SessionListRoster\r\n        loading={loading}',
    '      <SessionListRoster\r\n        pendingIds={pendingIds}\r\n        loading={loading}',
  )
  if (!list.includes('pendingIds={pendingIds}')) {
    list = list.replace(
      '      <SessionListRoster\n        loading={loading}',
      '      <SessionListRoster\n        pendingIds={pendingIds}\n        loading={loading}',
    )
  }
  list = list.replace(
    /\n(\s*)running: rows\.filter\(row => row\.running\)\.length,/,
    '\n$1running: rows.filter(row => row.running).length,\n$1pending: rows.filter(row => pendingIds.has(row.sessionId)).length,',
  )
  writeFileSync(LIST, list)
}

console.log(JSON.stringify({
  roster: readFileSync(ROSTER, 'utf8').includes('sess-status-warn'),
  传入: readFileSync(LIST, 'utf8').includes('pendingIds={pendingIds}'),
  计数: readFileSync(LIST, 'utf8').includes('pending: rows.filter'),
}))
