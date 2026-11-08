import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const P = join(import.meta.dirname, '..', 'packages', 'dsh-palm', 'src', 'mobile', 'views', 'list', 'session-list-roster.tsx')
let text = readFileSync(P, 'utf8')

text = text.replace(
  /<span className="sess-status">新<\/span>/,
  '<span className="sess-status sess-status-info">新</span>',
)
text = text.replace(
  /<span className="sess-status">进行中<\/span>/,
  [
    '<span className="sess-status sess-status-ok">进行中</span>',
    '                            {pendingIds?.has(row.sessionId) === true && (',
    '                              <span className="sess-status sess-status-warn">待确认</span>',
    '                            )}',
  ].join('\r\n'),
)
text = text.replace(
  /<span className="sess-status" title=\{row\.error\}>出错<\/span>/,
  '<span className="sess-status sess-status-danger" title={row.error}>出错</span>',
)

writeFileSync(P, text)
console.log(JSON.stringify({
  新: text.includes('sess-status-info'),
  待确认: text.includes('sess-status-warn'),
  出错: text.includes('sess-status-danger'),
}))
