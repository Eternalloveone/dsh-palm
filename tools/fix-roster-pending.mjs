import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'list', 'session-list-roster.tsx')
const lines = readFileSync(P, 'utf8').split(/\r?\n/)

// 118–121 行被替换掉了「进行中」那行的闭合花括号，按正确结构重写这 3 行
const start = lines.findIndex(line => line.includes('sess-status-ok'))
const pendingStart = lines.findIndex(line => line.includes('pendingIds?.has(row.sessionId)'))

if (start !== -1 && pendingStart !== -1) {
  // 找到 pending 块的结束（'}}' 或 ')}'）
  let end = pendingStart
  while (end < lines.length && !lines[end].trim().endsWith('}}')) end += 1
  lines.splice(start, end - start + 1,
    '                            {row.running && <span className="sess-status sess-status-ok">进行中</span>}',
    '                            {pendingIds?.has(row.sessionId) === true && (',
    '                              <span className="sess-status sess-status-warn">待确认</span>',
    '                            )}',
  )
  writeFileSync(P, lines.join('\r\n'))
  console.log('rewrote', start, end)
} else {
  console.log('not found')
}
