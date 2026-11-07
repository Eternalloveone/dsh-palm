import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PKG = join(import.meta.dirname, '..', 'packages', 'dsh-palm')
const HANDLER = join(PKG, 'src', 'mobile', 'api', 'session-list-handler.ts')
const API = join(PKG, 'src', 'mobile-api.ts')

// 1) 修正 toRosterItems / RosterItem 的来源
let h = readFileSync(HANDLER, 'utf8')
h = h.replace(/  toRosterItems,\n/, '')
h = h.replace(/import type \{ RosterItem \} from '\.\.\/\.\.\/host\/session-roster\.ts'\n/, '')
h = h.replace(
  "import {\n  afterCursor,\n  parseSessionListCursor,\n  sessionListCursor,\n  trimSessionListRow,\n  visibleSessionRows,\n} from '../../host/session-list.ts'",
  "import {\n  afterCursor,\n  parseSessionListCursor,\n  sessionListCursor,\n  toRosterItems,\n  trimSessionListRow,\n  visibleSessionRows,\n} from '../../host/session-list.ts'\nimport type { RosterItem } from '../../host/session-list.ts'",
)
writeFileSync(HANDLER, h)

// 2) mobile-api：避免与本地变量 sessionList 撞名
let a = readFileSync(API, 'utf8')
a = a.replace(
  "import { sessionList } from './mobile/api/session-list-handler.ts'",
  "import { sessionList as sessionListHandler } from './mobile/api/session-list-handler.ts'",
)
a = a.replace('async (ctx) => sessionList({', 'async (ctx) => sessionListHandler({')
writeFileSync(API, a)
console.log('imports fixed')
