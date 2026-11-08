import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'list', 'session-list-roster.tsx')
let text = readFileSync(P, 'utf8')

// 手拼的多行签名留下了 ",, "，改成正常写法
text = text.replace(
  /export function SessionListRoster\(\{[\s\S]*?\}: SessionListRosterProps\) \{/,
  [
    'export function SessionListRoster({',
    '  loading,',
    '  rows,',
    '  groups,',
    '  hasMore,',
    '  openSwipeId,',
    '  previewCache,',
    '  sentinelRef,',
    '  rowHandlers,',
    '  keepBottom,',
    '  onLoadMore,',
    '  onDeleteRow,',
    '  pendingIds,',
    '}: SessionListRosterProps) {',
  ].join('\r\n'),
)

// 补上「待确认」胶囊（上一次替换没匹配到 running 那一行）
if (!text.includes('sess-status-warn')) {
  text = text.replace(
    '{row.running && <span className="sess-status sess-status-ok">进行中</span>}',
    [
      '{row.running && <span className="sess-status sess-status-ok">进行中</span>}',
      '                            {pendingIds?.has(row.sessionId) === true && (',
      '                              <span className="sess-status sess-status-warn">待确认</span>',
      '                            )}',
    ].join('\r\n'),
  )
}

writeFileSync(P, text)
console.log(JSON.stringify({ 签名干净: !text.includes(',, pendingIds'), 胶囊: text.includes('sess-status-warn') }))
