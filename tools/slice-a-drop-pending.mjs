import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const rosterPath = join(PKG, 'src', 'mobile', 'views', 'list', 'session-list-roster.tsx')
const viewPath = join(PKG, 'src', 'mobile', 'views', 'SessionListView.tsx')

/* 「待确认」目前没有行级数据源（SessionView 只有 running/error），
   先不渲染这一枚胶囊，等审批数据接上再开——避免显示一个永远为 0 的假状态。 */
let roster = readFileSync(rosterPath, 'utf8')
roster = roster.replace(/\r?\n\s*\{row\.pending === true && <span className="sess-status sess-status-warn">待确认<\/span>\}/, '')
writeFileSync(rosterPath, roster)

let view = readFileSync(viewPath, 'utf8')
view = view.replace(
  /\r?\n\s*pending: rows\.filter\(row => row\.pending === true\)\.length,/,
  '',
)
writeFileSync(viewPath, view)

console.log(JSON.stringify({ 胶囊去 pending: !roster.includes('sess-status-warn'), 计数去 pending: !view.includes('pending: rows') }))
